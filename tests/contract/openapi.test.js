import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as yaml from "js-yaml";

import { HTTP_METHODS, ROUTES, toOpenApiPath } from "../../src/routes/registry.js";

// Contract drift test (I8b.4, spec §4b): the public surface mounted by the code
// (src/routes/registry.js — the single source of truth for the scaffold) must equal the
// surface declared in docs/api/openapi.yaml, and the security expectation of every route
// must match how the contract secures it:
//   * "api-key"       -> operation security includes ApiKeyAuth
//   * "webhook-secret" -> X-Telegram-Bot-Api-Secret-Token parameter and no operation security
// Per-endpoint status CODES are verified incrementally in phases 04-07 when each 501
// stub is replaced by the real handler; here the scope is surface + auth shape.

const WEBHOOK_SECRET_REF = "#/components/parameters/TelegramWebhookSecret";
const WEBHOOK_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

// js-yaml load() is the safe loader: the default schema only builds plain JSON types.
const contractPath = new URL("../../docs/api/openapi.yaml", import.meta.url);
const doc = yaml.load(readFileSync(contractPath, "utf8"));

/** "METHOD /openapi-path" -> operation object, straight from the contract. */
function contractSurface() {
  const surface = new Map();
  for (const [openApiPath, pathItem] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (operation) {
        surface.set(`${method.toUpperCase()} ${openApiPath}`, operation);
      }
    }
  }
  return surface;
}

const contract = contractSurface();
const registry = new Map(ROUTES.map((route) => [`${route.method} ${toOpenApiPath(route.path)}`, route]));

test("toOpenApiPath converts Express params to OpenAPI templating", () => {
  assert.equal(toOpenApiPath("/api/tickets/:id"), "/api/tickets/{id}");
  assert.equal(toOpenApiPath("/api/tickets/:id/reply"), "/api/tickets/{id}/reply");
  assert.equal(toOpenApiPath("/webhook/telegram"), "/webhook/telegram");
});

test("registry and openapi declare exactly the same METHOD + path surface", () => {
  assert.deepEqual([...registry.keys()].sort(), [...contract.keys()].sort());
  assert.equal(registry.size, 4, "the frozen contract has four endpoints (I3)");
});

test("every route's security expectation matches the contract", () => {
  for (const route of ROUTES) {
    const key = `${route.method} ${toOpenApiPath(route.path)}`;
    const operation = contract.get(key);
    assert.ok(operation, `${key}: present in the registry but missing from openapi.yaml`);

    const operations = Array.isArray(operation.security) ? operation.security : [];
    const hasApiKeySecurity = operations.some((entry) => Object.hasOwn(entry ?? {}, "ApiKeyAuth"));
    const hasWebhookSecretParam = (operation.parameters ?? []).some(
      (param) => param?.$ref === WEBHOOK_SECRET_REF || param?.name === WEBHOOK_SECRET_HEADER
    );

    if (route.security === "api-key") {
      assert.ok(hasApiKeySecurity, `${key}: code enforces x-api-key, the contract must declare ApiKeyAuth`);
      assert.ok(!hasWebhookSecretParam, `${key}: panel routes never carry the webhook secret`);
    } else if (route.security === "webhook-secret") {
      assert.ok(hasWebhookSecretParam, `${key}: the webhook must declare the ${WEBHOOK_SECRET_HEADER} parameter`);
      assert.equal(operation.security, undefined, `${key}: the webhook has no operation-level security (public route + secret header)`);
    } else {
      assert.fail(`${key}: unknown security expectation "${route.security}"`);
    }
  }
});

test("no contract operation hides a security scheme the registry does not know", () => {
  for (const [key, operation] of contract.entries()) {
    const usesApiKey = (operation.security ?? []).some((entry) => Object.hasOwn(entry ?? {}, "ApiKeyAuth"));
    const route = registry.get(key);
    assert.ok(route, `${key}: in the contract but not in the registry`);
    assert.equal(usesApiKey, route.security === "api-key", `${key}: security drift between code and contract`);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as yaml from "js-yaml";
import request from "supertest";

import { HTTP_METHODS, ROUTES, toOpenApiPath } from "../../src/routes/registry.js";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { createTicketRepositoryFake } from "../../src/repositories/ticketRepository.fake.js";
import { createLogger } from "../../src/utils/logger.js";

// Contract drift test (I8b.4, spec §4b): the public surface mounted by the code
// (src/routes/registry.js — the single source of truth for the scaffold) must equal the
// surface declared in docs/api/openapi.yaml, and the security expectation of every route
// must match how the contract secures it:
//   * "api-key"       -> operation security includes ApiKeyAuth
//   * "webhook-secret" -> X-Telegram-Bot-Api-Secret-Token parameter and no operation security
// Per-endpoint status CODES are verified incrementally as each 501 stub is replaced by
// the real handler (D-23 "contrato en dos tiempos"). Since PHASE 05 the second half is
// ACTIVE FOR THE WEBHOOK (spec 05 §5.5(8) / C7): codes exactly {200, 403}, strict
// WebhookReceived / WebhookIgnored bodies (additionalProperties: false, enum of 6) and
// the 403 literal — everything READ FROM the document, nothing copied by hand. The
// panel endpoints follow in phases 06-08.

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

// --- Second half of the contract test, ACTIVE FOR THE WEBHOOK since phase 05 (T-11,
// spec 05 §5.5(8) / C7). Everything expected here is read FROM docs/api/openapi.yaml:
// the declared codes, the strict schemas (additionalProperties: false), the ignored
// enum of 6 and the ForbiddenWebhook example literal. Zero AWS: the app runs on the
// in-memory fake repository (D-23/I2). Fake values only (I4).

const FAKE_ADMIN_KEY = "test-admin-key-NO-REAL";
const FAKE_BOT_TOKEN = "test-bot-token-NO-REAL";
const FAKE_WH_SECRET = "test-webhook-NO-REAL";
const SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

const appConfig = loadConfig({
  TABLE_NAME: "TicketsTable-test",
  TELEGRAM_BOT_TOKEN: FAKE_BOT_TOKEN,
  ADMIN_API_KEY: FAKE_ADMIN_KEY,
  TELEGRAM_WEBHOOK_SECRET: FAKE_WH_SECRET,
});

const webhookApp = createApp({
  config: appConfig,
  logger: createLogger("silent"),
  ticketRepository: createTicketRepositoryFake(),
});

const webhookOp = doc.paths["/webhook/telegram"].post;
const DECLARED_CODES = Object.keys(webhookOp.responses).sort(); // read from the contract
const IGNORED_ENUM = doc.components.schemas.WebhookIgnored.properties.ignored.enum;
const RECEIVED_SCHEMA = doc.components.schemas.WebhookReceived;
const IGNORED_SCHEMA = doc.components.schemas.WebhookIgnored;
const FORBIDDEN_EXAMPLE = doc.components.responses.ForbiddenWebhook.content["application/json"].example;

/** Strict oneOf match against the contract schemas (both declare additionalProperties: false). */
function matchesWebhook200(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }
  const keys = Object.keys(body);
  const receivedOk =
    RECEIVED_SCHEMA.additionalProperties === false &&
    keys.length === 1 &&
    body.received === RECEIVED_SCHEMA.properties.received.const;
  const ignoredOk =
    IGNORED_SCHEMA.additionalProperties === false && keys.length === 1 && IGNORED_ENUM.includes(body.ignored);
  return receivedOk || ignoredOk;
}

function contractValidUpdate(updateId) {
  return {
    update_id: updateId,
    message: {
      message_id: 42,
      from: { id: 112233445, is_bot: false, first_name: "Ana", username: "ana_example" },
      chat: { id: 112233445, type: "private" },
      date: 1763424000,
      text: "Hola, mi suscripcion no se ha renovado.",
    },
  };
}

const postWebhook = (body, secret = FAKE_WH_SECRET) =>
  request(webhookApp).post("/webhook/telegram").set(SECRET_HEADER, secret).send(body);

test("contract codes: /webhook/telegram declares exactly {200, 403} and the app answers nothing else (C7)", async () => {
  assert.deepEqual(DECLARED_CODES, ["200", "403"], "the frozen contract admits exactly two codes (I3)");
  const observed = [];
  const received = await postWebhook(contractValidUpdate(982391001));
  observed.push(received.status);
  const ignored = await postWebhook({ update_id: 982391002, callback_query: { id: "x" } });
  observed.push(ignored.status);
  const forbidden = await postWebhook(contractValidUpdate(982391003), "wrong-secret-NO-REAL");
  observed.push(forbidden.status);
  for (const status of observed) {
    assert.ok(DECLARED_CODES.includes(String(status)), `the app answered ${status}, outside the declared contract codes`);
  }
});

test("contract bodies: every 200 of the webhook matches WebhookReceived OR WebhookIgnored, strictly (C7)", async () => {
  const scenarios = [
    { name: "received", body: contractValidUpdate(982391010) },
    { name: "ignored (unsupported_update)", body: { update_id: 982391011, callback_query: { id: "x" } } },
    { name: "ignored (no_text)", body: { update_id: 982391012, message: { message_id: 1, chat: { id: 5 }, photo: [] } } },
    { name: "ignored (chat_not_found)", body: { update_id: 982391013, message: { message_id: 1, chat: { id: "abc" }, text: "hi" } } },
    { name: "ignored (empty_message)", body: { update_id: 982391014, message: { message_id: 1, chat: { id: 5 }, text: "   " } } },
  ];
  for (const scenario of scenarios) {
    const res = await postWebhook(scenario.body);
    assert.equal(res.status, 200, scenario.name);
    assert.ok(
      matchesWebhook200(res.body),
      `${scenario.name}: body ${JSON.stringify(res.body)} matches neither strict schema (extra keys or value outside the contract)`
    );
  }
});

test("contract bodies: the duplicate of an already-ingested update answers the strict WebhookIgnored shape with reason duplicate (C7)", async () => {
  const update = contractValidUpdate(982391020);
  const first = await postWebhook(update);
  const second = await postWebhook(update);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { received: true });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, { ignored: "duplicate" });
  assert.ok(matchesWebhook200(second.body));
  assert.ok(IGNORED_ENUM.includes("duplicate"), "the enum read from the contract must contain duplicate (D-19)");
});

test("contract 403: the body equals the ForbiddenWebhook example of openapi.yaml, literal included (C7)", async () => {
  assert.equal(FORBIDDEN_EXAMPLE.error.message, "invalid webhook secret", "sanity: the literal this test pins lives in the contract");
  for (const secret of [null, "wrong-secret-NO-REAL"]) {
    let req = request(webhookApp).post("/webhook/telegram");
    if (secret !== null) {
      req = req.set(SECRET_HEADER, secret);
    }
    const res = await req.send(contractValidUpdate(982391030));
    assert.equal(res.status, 403);
    assert.deepEqual(res.body, FORBIDDEN_EXAMPLE, "the 403 envelope is exactly the contract example");
  }
});

test("contract ignored enum: exactly the 6 frozen reasons (any drift is an I3 amendment, not a refactor)", () => {
  assert.equal(IGNORED_ENUM.length, 6);
  assert.deepEqual(
    [...IGNORED_ENUM].sort(),
    ["chat_not_found", "duplicate", "empty_message", "internal_error", "no_text", "unsupported_update"].sort()
  );
});

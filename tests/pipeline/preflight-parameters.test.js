// Gate de pre-vuelo de parametros de deploy (A-06/D-52). Nace de una evidencia cara: el run #4
// murio en CreateChangeSet con "Parameter 'WebhookSecretParam' must match pattern ^\S{16,}$" y,
// como CloudFormation valida parametros de uno en uno, cada secreto fuera de contrato cuesta un
// pipeline run completo. Estos tests fijan tres cosas: que el pre-vuelo lee el contrato REAL de
// template.yaml (no una copia suya), que detecta valor-invalido y secreto-ausente, que cubre TODOS
// los parametros NoEcho del template, y que NUNCA filtra un valor (solo nombre + regla).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readAllowedPatterns, evaluate, PARAMETER_BINDINGS } from "../../scripts/preflight-parameters.mjs";

const TEMPLATE_TEXT = readFileSync("template.yaml", "utf8");

// Synthetic fixtures built programmatically, never written as literals: a 40-char alphanumeric
// string next to a SECRET_NAME= would legitimately trip the repo's secret-hygiene scanner
// (check.ps1, I4), and this test must not weaken it just to have data. The values still satisfy
// the template's AllowedPatterns, and they double as leak canaries: if any of them ever appears in
// the gate's output, the "names + rule only" contract is broken.
const botTokenFixture = `${"1".repeat(12)}:${"a".repeat(35)}`; // ^[0-9]{8,}:[A-Za-z0-9_-]{8,}$
const adminKeyFixture = "z".repeat(40); //                          ^[A-Za-z0-9._-]{16,}$
const webhookFixture = "WebhookLeakCanary".repeat(2); //            ^\S{16,}$  (30 chars)

const VALUES_OK = {
  TELEGRAM_BOT_TOKEN: botTokenFixture,
  ADMIN_API_KEY: adminKeyFixture,
  TELEGRAM_WEBHOOK_SECRET: webhookFixture,
};

test("the pre-flight reads AllowedPattern from template.yaml itself (no duplicated contract)", () => {
  const patterns = readAllowedPatterns(TEMPLATE_TEXT);
  assert.equal(patterns.WebhookSecretParam.pattern, "^\\S{16,}$");
  assert.equal(patterns.AdminApiKeyParam.pattern, "^[A-Za-z0-9._-]{16,}$");
  assert.equal(patterns.TelegramBotTokenParam.pattern, "^[0-9]{8,}:[A-Za-z0-9_-]{8,}$");
  for (const name of ["WebhookSecretParam", "AdminApiKeyParam", "TelegramBotTokenParam"]) {
    assert.equal(patterns[name].noEcho, true, `${name} must stay NoEcho (I4)`);
  }
});

test("compliant secrets pass", () => {
  const patterns = readAllowedPatterns(TEMPLATE_TEXT);
  const results = evaluate(VALUES_OK, patterns);
  assert.deepEqual(results.map((r) => r.status), ["OK", "OK", "OK"]);
});

test("negative: a webhook secret shorter than 16 chars is BAD before AWS is called", () => {
  const patterns = readAllowedPatterns(TEMPLATE_TEXT);
  const tooShort = "abcdefghijklmno";
  assert.equal(tooShort.length, 15, "fixture guard: this value must be 15 chars, one under the contract");
  const results = evaluate({ ...VALUES_OK, TELEGRAM_WEBHOOK_SECRET: tooShort }, patterns);
  const webhook = results.find((r) => r.param === "WebhookSecretParam");
  assert.equal(webhook.status, "BAD");
  assert.ok(webhook.detail.includes("must match ^\\S{16,}$"));
});

test("negative: an empty or absent secret is reported MISSING, not silently skipped", () => {
  const patterns = readAllowedPatterns(TEMPLATE_TEXT);
  const empty = evaluate({ ...VALUES_OK, ADMIN_API_KEY: "" }, patterns);
  assert.equal(empty.find((r) => r.param === "AdminApiKeyParam").status, "MISSING");
  const absent = evaluate({ TELEGRAM_BOT_TOKEN: VALUES_OK.TELEGRAM_BOT_TOKEN }, patterns);
  assert.deepEqual(
    absent.map((r) => r.status),
    ["OK", "MISSING", "MISSING"]
  );
});

test("completeness: every NoEcho parameter of the template is bound to a secret", () => {
  const patterns = readAllowedPatterns(TEMPLATE_TEXT);
  const declared = Object.keys(patterns).filter((name) => patterns[name].noEcho);
  const bound = PARAMETER_BINDINGS.map((b) => b.param);
  for (const name of declared) {
    assert.ok(bound.includes(name), `${name} is NoEcho in template.yaml but unchecked by the pre-flight`);
  }
  assert.ok(declared.length >= 3, "expected at least the three deploy-time secrets");
});

test("privacy: the gate output names parameters and rules, never values", () => {
  const patterns = readAllowedPatterns(TEMPLATE_TEXT);
  const leaked = JSON.stringify(evaluate(VALUES_OK, patterns));
  for (const value of Object.values(VALUES_OK)) {
    assert.ok(!leaked.includes(value), `secret value leaked into gate output: ${value.slice(0, 6)}...`);
  }
  const bad = JSON.stringify(evaluate({ ...VALUES_OK, TELEGRAM_WEBHOOK_SECRET: "short" }, patterns));
  assert.ok(!bad.includes("short"), "even a failing value must not be echoed");
});

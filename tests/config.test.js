import test from "node:test";
import assert from "node:assert/strict";

import { ConfigError, loadConfig } from "../src/config.js";

// Fake values only — this repo must never contain a plausible real secret (I4).
const FAKE_TABLE = "TicketsTable-test";
const FAKE_BOT_TOKEN = "test-bot-token-NO-REAL";
const FAKE_ADMIN_KEY = "test-admin-key-NO-REAL";
const FAKE_WH_SECRET = "test-webhook-NO-REAL";

function fakeEnv(overrides = {}) {
  return {
    TABLE_NAME: FAKE_TABLE,
    TELEGRAM_BOT_TOKEN: FAKE_BOT_TOKEN,
    ADMIN_API_KEY: FAKE_ADMIN_KEY,
    TELEGRAM_WEBHOOK_SECRET: FAKE_WH_SECRET,
    ...overrides,
  };
}

test("loadConfig maps the seven D-17 variables to a frozen camelCase object", () => {
  const cfg = loadConfig(fakeEnv({ LOG_LEVEL: "debug", STAGE: "ci", PORT: "4123" }));
  assert.equal(cfg.tableName, FAKE_TABLE);
  assert.equal(cfg.telegramBotToken, FAKE_BOT_TOKEN);
  assert.equal(cfg.adminApiKey, FAKE_ADMIN_KEY);
  assert.equal(cfg.telegramWebhookSecret, FAKE_WH_SECRET);
  assert.equal(cfg.logLevel, "debug");
  assert.equal(cfg.stage, "ci");
  assert.equal(cfg.port, 4123);
  assert.ok(Object.isFrozen(cfg), "config must be frozen");
});

test("defaults: logLevel=info, stage=dev, port=3000 (PORT is local-only)", () => {
  const cfg = loadConfig(fakeEnv());
  assert.equal(cfg.logLevel, "info");
  assert.equal(cfg.stage, "dev");
  assert.equal(cfg.port, 3000);
});

test("missing TABLE_NAME throws ConfigError naming TABLE_NAME but no values (I4)", () => {
  const env = fakeEnv();
  delete env.TABLE_NAME;
  assert.throws(
    () => loadConfig(env),
    (err) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.name, "ConfigError");
      assert.match(err.message, /TABLE_NAME/);
      // The message lists NAMES only, never the values of the variables present.
      assert.ok(!err.message.includes(FAKE_ADMIN_KEY));
      assert.ok(!err.message.includes(FAKE_BOT_TOKEN));
      assert.ok(!err.message.includes(FAKE_WH_SECRET));
      return true;
    }
  );
});

test("empty-string required var counts as missing", () => {
  assert.throws(() => loadConfig(fakeEnv({ ADMIN_API_KEY: "" })), ConfigError);
});

test("invalid LOG_LEVEL throws naming LOG_LEVEL (no value echoed)", () => {
  assert.throws(
    () => loadConfig(fakeEnv({ LOG_LEVEL: "verbose" })),
    (err) => {
      assert.ok(err instanceof ConfigError);
      assert.match(err.message, /LOG_LEVEL/);
      assert.ok(!err.message.includes("verbose"));
      return true;
    }
  );
});

test("non-numeric PORT throws naming PORT", () => {
  assert.throws(
    () => loadConfig(fakeEnv({ PORT: "abc" })),
    (err) => {
      assert.ok(err instanceof ConfigError);
      assert.match(err.message, /PORT/);
      return true;
    }
  );
});

test("LOG_LEVEL silent is valid; unknown severities are rejected", () => {
  assert.equal(loadConfig(fakeEnv({ LOG_LEVEL: "silent" })).logLevel, "silent");
  assert.throws(() => loadConfig(fakeEnv({ LOG_LEVEL: "trace" })), ConfigError);
});

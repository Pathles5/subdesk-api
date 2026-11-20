import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";

// Fake values only (I4). The middleware under test must answer 401/403 BEFORE any
// DynamoDB access exists (I4): in the scaffold the authenticated path ends in the 501
// stub, which proves the request passed the gate.

const FAKE_ADMIN_KEY = "test-admin-key-NO-REAL";
const FAKE_BOT_TOKEN = "test-bot-token-NO-REAL";
const FAKE_WH_SECRET = "test-webhook-NO-REAL";

const config = loadConfig({
  TABLE_NAME: "TicketsTable-test",
  TELEGRAM_BOT_TOKEN: FAKE_BOT_TOKEN,
  ADMIN_API_KEY: FAKE_ADMIN_KEY,
  TELEGRAM_WEBHOOK_SECRET: FAKE_WH_SECRET,
});

const app = createApp({ config });

test("GET /api/tickets without x-api-key -> 401 UNAUTHORIZED envelope", async () => {
  const res = await request(app).get("/api/tickets");
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, "UNAUTHORIZED");
  assert.equal(res.body.error.message, "missing x-api-key header");
});

test("GET /api/tickets with empty x-api-key -> 401", async () => {
  const res = await request(app).get("/api/tickets").set("x-api-key", "");
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, "UNAUTHORIZED");
});

test("GET /api/tickets with a wrong x-api-key -> 403 FORBIDDEN envelope", async () => {
  const res = await request(app).get("/api/tickets").set("x-api-key", "nope");
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "FORBIDDEN");
  assert.equal(res.body.error.message, "invalid api key");
});

test("valid x-api-key passes the gate (the stub 501 proves it, never 401/403/500)", async () => {
  const res = await request(app).get("/api/tickets").set("x-api-key", FAKE_ADMIN_KEY);
  assert.equal(res.status, 501);
  assert.equal(res.body.error.code, "INTERNAL");
});

test("different-length wrong keys still get 403 (timingSafeEqual is fed normalized hashes)", async () => {
  for (const wrong of ["s", "a-significantly-longer-wrong-key-than-the-configured-one"]) {
    const res = await request(app).get("/api/tickets").set("x-api-key", wrong);
    assert.equal(res.status, 403, `key of length ${wrong.length} must yield 403, not a crash`);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { ROUTES } from "../../src/routes/registry.js";
import { createTicketRepositoryFake } from "../../src/repositories/ticketRepository.fake.js";
import { createLogger } from "../../src/utils/logger.js";

// Contract debt (d) of phase 02, closed in phase 05 (spec 05 §5.5(9)): the registry is
// the single source of truth of the surface and tests/contract/openapi.test.js proves it
// equals docs/api/openapi.yaml — but nothing proved the registry entries are ACTUALLY
// MOUNTED in createApp. This test closes that gap: for every ROUTES entry, a request
// with the declared method must answer something OTHER than the closed 404 envelope
// ({"error":{"code":"NOT_FOUND",...}}), unauthenticated AND authenticated. Zero AWS,
// zero network beyond supertest, zero cost (D-23/I2). Fake values only (I4).

const FAKE_ADMIN_KEY = "test-admin-key-NO-REAL";
const FAKE_BOT_TOKEN = "test-bot-token-NO-REAL";
const FAKE_WH_SECRET = "test-webhook-NO-REAL";
const SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";
// uuidv5(TG_UPDATE_NS, "tg:482391756") — the corrected contract example (D-75).
const SAMPLE_ID = "f53dea7a-383f-510d-b6ff-eddd5270f4b6";

const config = loadConfig({
  TABLE_NAME: "TicketsTable-test",
  TELEGRAM_BOT_TOKEN: FAKE_BOT_TOKEN,
  ADMIN_API_KEY: FAKE_ADMIN_KEY,
  TELEGRAM_WEBHOOK_SECRET: FAKE_WH_SECRET,
});

const app = createApp({
  config,
  logger: createLogger("silent"),
  ticketRepository: createTicketRepositoryFake(),
});

/** The closed 404 envelope of app.js notFoundHandler. */
function is404Envelope(res) {
  return res.status === 404 && res.body?.error?.code === "NOT_FOUND";
}

for (const route of ROUTES) {
  test(`registry<->mounting: ${route.method} ${route.path} is really mounted (never the 404 envelope)`, async () => {
    const path = route.path.replaceAll(":id", SAMPLE_ID);
    const method = route.method.toLowerCase();

    // Unauthenticated prong: the auth gate itself (401/403) proves the route exists.
    const anon = await request(app)[method](path);
    assert.ok(!is404Envelope(anon), `${route.method} ${path} answered the 404 envelope: registry and mounting disagree`);

    // Authenticated prong: with the right credential the route answers its own contract
    // (webhook: 200 ack; panel stubs: 501 until phases 06-08) — still never the 404.
    let authed = request(app)[method](path);
    authed =
      route.security === "api-key"
        ? authed.set("x-api-key", FAKE_ADMIN_KEY)
        : authed.set(SECRET_HEADER, FAKE_WH_SECRET);
    const res = await authed;
    assert.ok(!is404Envelope(res), `${route.method} ${path} answered the 404 envelope even with valid credentials`);
  });
}

test("mounting control: an UNREGISTERED path DOES answer the 404 envelope (the assertions above are not vacuous)", async () => {
  const res = await request(app).get("/api/tickets-not-mounted");
  assert.ok(is404Envelope(res), "control failed: the 404 envelope itself is not recognizable");
  assert.equal(res.status, 404);
  assert.match(res.body.error.message, /^no route for GET /);
});

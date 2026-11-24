import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createTicketRepositoryFake } from "../src/repositories/ticketRepository.fake.js";

// Smoke of the scaffold surface (spec §8 C3): the real app via createApp + supertest,
// no Lambda adapter, no AWS, no network (D-16/D-23). Fake values only (I4). Since
// phase 05 createApp REQUIRES a ticket repository: the in-memory fake is injected.

const FAKE_ADMIN_KEY = "test-admin-key-NO-REAL";
const FAKE_BOT_TOKEN = "test-bot-token-NO-REAL";
const FAKE_WH_SECRET = "test-webhook-NO-REAL";

const config = loadConfig({
  TABLE_NAME: "TicketsTable-test",
  TELEGRAM_BOT_TOKEN: FAKE_BOT_TOKEN,
  ADMIN_API_KEY: FAKE_ADMIN_KEY,
  TELEGRAM_WEBHOOK_SECRET: FAKE_WH_SECRET,
});

const app = createApp({ config, ticketRepository: createTicketRepositoryFake() });

test("GET /api/tickets with the right key -> 501 scaffold stub envelope (Fase 6)", async () => {
  const res = await request(app).get("/api/tickets").set("x-api-key", FAKE_ADMIN_KEY);
  assert.equal(res.status, 501);
  assert.equal(res.body.error.code, "INTERNAL");
  assert.equal(res.body.error.message, "not implemented yet — Fase 6");
});

test("PATCH /api/tickets/:id and POST reply stub the right phases", async () => {
  const patch = await request(app)
    .patch("/api/tickets/2f6cf473-16d5-5b61-9a3f-08e1a0d1f4e7")
    .set("x-api-key", FAKE_ADMIN_KEY)
    .send({ status: "IN_PROGRESS" });
  assert.equal(patch.status, 501);
  assert.equal(patch.body.error.message, "not implemented yet — Fase 7");

  const reply = await request(app)
    .post("/api/tickets/2f6cf473-16d5-5b61-9a3f-08e1a0d1f4e7/reply")
    .set("x-api-key", FAKE_ADMIN_KEY)
    .send({ response_text: "hello" });
  assert.equal(reply.status, 501);
  assert.equal(reply.body.error.message, "not implemented yet — Fase 8");
});

test("unknown route -> 404 ApiError envelope", async () => {
  const res = await request(app).get("/nope");
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "NOT_FOUND");
  assert.equal(res.body.error.message, "no route for GET /nope");
});

test("POST /webhook/telegram with valid secret and a message-less update -> 200 ignored ack (implemented in phase 05, no longer a stub)", async () => {
  const res = await request(app)
    .post("/webhook/telegram")
    .set("X-Telegram-Bot-Api-Secret-Token", FAKE_WH_SECRET)
    .send({ update_id: 482391756 });
  assert.equal(res.status, 200, "the webhook always acks 2xx with a valid secret (I5)");
  assert.deepEqual(res.body, { ignored: "unsupported_update" }, "an update without message is ignored (spec 05 §5.1 rule 3)");
});

test("POST /webhook/telegram with invalid secret -> 403 envelope", async () => {
  const res = await request(app)
    .post("/webhook/telegram")
    .set("X-Telegram-Bot-Api-Secret-Token", "wrong")
    .send({ update_id: 482391756 });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "FORBIDDEN");
  assert.equal(res.body.error.message, "invalid webhook secret");
});

test("malformed JSON on /api routes -> 400 VALIDATION_ERROR envelope, never 500", async () => {
  const res = await request(app)
    .patch("/api/tickets/2f6cf473-16d5-5b61-9a3f-08e1a0d1f4e7")
    .set("x-api-key", FAKE_ADMIN_KEY)
    .set("Content-Type", "application/json")
    .send("{not-json");
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "VALIDATION_ERROR");
  assert.equal(res.body.error.message, "invalid JSON body");
});

import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { createTicketRepositoryFake } from "../../src/repositories/ticketRepository.fake.js";
import { createLogger } from "../../src/utils/logger.js";
import { ticketIdFor } from "../../src/utils/ids.js";

// Spec 05 §5.5(6) / C4 / C8: the HTTP surface of POST /webhook/telegram through the real
// app (createApp + supertest; the serverless-http path lives in tests/lambda.adapter.test.js).
// Zero AWS, zero network beyond the in-process supertest socket, zero cost (D-23/I2).
// Fake values only (I4).

const FAKE_ADMIN_KEY = "test-admin-key-NO-REAL";
const FAKE_BOT_TOKEN = "test-bot-token-NO-REAL";
const FAKE_WH_SECRET = "test-webhook-NO-REAL";
const SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

const config = loadConfig({
  TABLE_NAME: "TicketsTable-test",
  TELEGRAM_BOT_TOKEN: FAKE_BOT_TOKEN,
  ADMIN_API_KEY: FAKE_ADMIN_KEY,
  TELEGRAM_WEBHOOK_SECRET: FAKE_WH_SECRET,
});

const silentLogger = createLogger("silent");

/** Fresh app + fake repository per test so write-count assertions stay honest. */
function buildApp({ ticketRepository = createTicketRepositoryFake() } = {}) {
  return { app: createApp({ config, logger: silentLogger, ticketRepository }), repo: ticketRepository };
}

function validUpdate(updateId = 482391756, text = "Hola, mi suscripcion no se ha renovado.") {
  return {
    update_id: updateId,
    message: {
      message_id: 42,
      from: { id: 112233445, is_bot: false, first_name: "Ana", username: "ana_example" },
      chat: { id: 112233445, type: "private" },
      date: 1763424000,
      text,
    },
  };
}

function post(app, { secret = FAKE_WH_SECRET, body = null, raw = null } = {}) {
  let req = request(app).post("/webhook/telegram");
  if (secret !== null) {
    req = req.set(SECRET_HEADER, secret);
  }
  if (raw !== null) {
    return req.set("Content-Type", "application/json").send(raw);
  }
  return req.send(body ?? validUpdate());
}

test("valid text message + secret -> 200 { received: true } and one PENDING item stored (C4/C5)", async () => {
  const { app, repo } = buildApp();
  const res = await post(app);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { received: true });
  assert.equal(repo._items().length, 1);
  const [item] = repo._items();
  assert.equal(item.id, ticketIdFor(482391756));
  assert.equal(item.status, "PENDING");
  assert.equal(item.telegram_chat_id, "112233445");
});

test("the six ignored reasons answer 200 with the exact contractual body (C4, closed enum of 6)", async () => {
  // unsupported_update: a callback_query (non-message update)
  {
    const { app, repo } = buildApp();
    const res = await post(app, {
      body: { update_id: 482391757, callback_query: { id: "1234567890", data: "noop", chat_instance: "-1" } },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ignored: "unsupported_update" });
    assert.equal(repo._items().length, 0);
  }
  // chat_not_found
  {
    const { app } = buildApp();
    const res = await post(app, { body: { update_id: 2, message: { message_id: 1, chat: { id: "abc" }, text: "hi" } } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ignored: "chat_not_found" });
  }
  // no_text
  {
    const { app } = buildApp();
    const res = await post(app, { body: { update_id: 3, message: { message_id: 1, chat: { id: 5 }, photo: [{ file_id: "x" }] } } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ignored: "no_text" });
  }
  // empty_message
  {
    const { app } = buildApp();
    const res = await post(app, { body: validUpdate(4, "    ") });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ignored: "empty_message" });
  }
  // duplicate: two consecutive posts of the same update to the SAME repository
  {
    const { app, repo } = buildApp();
    const first = await post(app);
    const second = await post(app);
    assert.deepEqual(first.body, { received: true });
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, { ignored: "duplicate" });
    assert.equal(repo._items().length, 1);
  }
  // internal_error: a throwing repository — the guard absorbs it into the 2xx ack (I5)
  {
    const failing = {
      createTicketIfAbsent: async () => {
        throw new Error("SimulatedDynamoFailure");
      },
    };
    const { app } = buildApp({ ticketRepository: failing });
    const res = await post(app);
    assert.equal(res.status, 200, "even an internal failure acks 200 (I5)");
    assert.deepEqual(res.body, { ignored: "internal_error" });
  }
});

test("text over 4096 chars -> 200 unsupported_update at HTTP level, nothing stored (rule 7, never truncated)", async () => {
  const { app, repo } = buildApp();
  const res = await post(app, { body: validUpdate(482391756, "A".repeat(4097)) });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ignored: "unsupported_update" });
  assert.equal(repo._items().length, 0);
});

test("missing secret header -> 403 FORBIDDEN envelope, nothing parsed or stored (D-21)", async () => {
  const { app, repo } = buildApp();
  const res = await post(app, { secret: null });
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: { code: "FORBIDDEN", message: "invalid webhook secret" } });
  assert.equal(repo._items().length, 0);
});

test("wrong secret -> 403, nothing stored", async () => {
  const { app, repo } = buildApp();
  const res = await post(app, { secret: "wrong-secret-NO-REAL" });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.message, "invalid webhook secret");
  assert.equal(repo._items().length, 0);
});

test("D-70: wrong secret AND a broken body -> 403 (before phase 05 this answered 200: the gate now runs BEFORE the parser) (C8)", async () => {
  const { app } = buildApp();
  const res = await post(app, { secret: "wrong-secret-NO-REAL", raw: "{not-json" });
  assert.equal(res.status, 403, "the 403 must not depend on the body content (D-70)");
  assert.deepEqual(res.body, { error: { code: "FORBIDDEN", message: "invalid webhook secret" } });
});

test("D-70: missing secret AND a broken body -> 403 as well", async () => {
  const { app } = buildApp();
  const res = await post(app, { secret: null, raw: "{not-json" });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "FORBIDDEN");
});

test("valid secret + broken JSON body -> 200 { ignored: 'unsupported_update' } (openapi.yaml prescribes it; was internal_error before phase 05)", async () => {
  const { app, repo } = buildApp();
  const res = await post(app, { raw: "{not-json" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ignored: "unsupported_update" });
  assert.equal(repo._items().length, 0);
});

test("valid secret + oversized body (70 KB > the 64 KB limit) -> 200 { ignored: 'unsupported_update' }", async () => {
  const { app } = buildApp();
  const res = await post(app, { raw: '{"pad":"' + "A".repeat(70000) + '"}' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ignored: "unsupported_update" });
});

test("valid secret + empty JSON object -> 200 { ignored: 'unsupported_update' } (no update_id)", async () => {
  const { app } = buildApp();
  const res = await post(app, { body: {} });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ignored: "unsupported_update" });
});

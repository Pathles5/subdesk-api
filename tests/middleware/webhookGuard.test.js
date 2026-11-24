import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";

import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { createWebhookSecretMiddleware, webhookGuard } from "../../src/middleware/webhookGuard.js";
import { createTicketRepositoryFake } from "../../src/repositories/ticketRepository.fake.js";

// Fake values only (I4).

const FAKE_ADMIN_KEY = "test-admin-key-NO-REAL";
const FAKE_BOT_TOKEN = "test-bot-token-NO-REAL";
const FAKE_WH_SECRET = "test-webhook-NO-REAL";

const config = loadConfig({
  TABLE_NAME: "TicketsTable-test",
  TELEGRAM_BOT_TOKEN: FAKE_BOT_TOKEN,
  ADMIN_API_KEY: FAKE_ADMIN_KEY,
  TELEGRAM_WEBHOOK_SECRET: FAKE_WH_SECRET,
});

// Phase 05: createApp REQUIRES a ticket repository — the in-memory fake keeps this suite
// at zero AWS (D-23/I2).
const app = createApp({ config, ticketRepository: createTicketRepositoryFake() });

test("valid X-Telegram-Bot-Api-Secret-Token passes the gate (the 200 ignored ack proves it — the webhook is implemented, phase 05)", async () => {
  const res = await request(app)
    .post("/webhook/telegram")
    .set("X-Telegram-Bot-Api-Secret-Token", FAKE_WH_SECRET)
    .send({ update_id: 1 });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ignored: "unsupported_update" }, "an update without message is ignored (spec 05 §5.1 rule 3)");
});

test("missing secret header -> 403 FORBIDDEN envelope (D-21, the unique non-2xx case)", async () => {
  const res = await request(app).post("/webhook/telegram").send({ update_id: 1 });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "FORBIDDEN");
  assert.equal(res.body.error.message, "invalid webhook secret");
});

test("wrong or different-length secret -> 403, never a crash (hash-normalized timingSafeEqual)", async () => {
  for (const wrong of ["x", "a-significantly-longer-wrong-secret-than-the-configured-one"]) {
    const res = await request(app)
      .post("/webhook/telegram")
      .set("X-Telegram-Bot-Api-Secret-Token", wrong)
      .send({ update_id: 1 });
    assert.equal(res.status, 403, `secret of length ${wrong.length} must yield 403`);
  }
});

test("webhookGuard: exception inside the sub-tree -> 200 { ignored: internal_error } and the body is never logged (I5/D-18)", async () => {
  const MARKER = "payload-marker-NEVER-LOGGED";

  // A throwaway tree mirroring the app.js mount pattern: parser + route that fails, with
  // the guard at the END of the router. The thrown message deliberately embeds the
  // request body so the stdout assertion below proves the guard logs names only.
  const throwingRouter = express.Router();
  throwingRouter.use(express.json({ limit: "64kb" }));
  throwingRouter.post("/boom", (req, res, next) => {
    next(new Error(`handler exploded over body ${JSON.stringify(req.body)}`));
  });
  throwingRouter.use(webhookGuard);

  const guardApp = express();
  guardApp.use("/webhook/telegram", throwingRouter);

  const loggedLines = [];
  const originalLog = console.log;
  console.log = (...args) => {
    loggedLines.push(args.join(" "));
  };
  try {
    const res = await request(guardApp)
      .post("/webhook/telegram/boom")
      .send({ message: { text: MARKER } });
    assert.equal(res.status, 200, "Telegram must always see a 2xx ack (I5)");
    assert.deepEqual(res.body, { ignored: "internal_error" });
  } finally {
    console.log = originalLog;
  }

  assert.ok(loggedLines.length > 0, "the guard must log the failure (I5)");
  const joined = loggedLines.join("\n");
  assert.ok(!joined.includes(MARKER), "logs must never contain the request body (D-18)");
  assert.ok(joined.includes("webhook_unhandled"), "the logged event must identify itself");
});

test("createWebhookSecretMiddleware is a pure factory (reusable with a fake secret)", async () => {
  const mini = express();
  mini.use(createWebhookSecretMiddleware({ expectedSecret: "unit-fake-secret" }));
  mini.get("/", (req, res) => res.json({ ok: true }));

  const denied = await request(mini).get("/");
  assert.equal(denied.status, 403);
  const allowed = await request(mini).get("/").set("X-Telegram-Bot-Api-Secret-Token", "unit-fake-secret");
  assert.equal(allowed.status, 200);
});

// --- T-08 (spec 05 §5.1 rule 1): the guard DISCRIMINATES body-parser rejections — the
// five of D-62, recognized by the shared isBodyParserRejection — and answers the value
// openapi.yaml prescribes: 200 {"ignored":"unsupported_update"}. Every OTHER error keeps
// answering 200 {"ignored":"internal_error"} (I5). Unit level: the guard is called
// directly with synthetic errors and a res spy; no HTTP, no AWS, no network.

function createResSpy() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

const PARSER_REJECTIONS = [
  { label: "entity.parse.failed", err: Object.assign(new SyntaxError("Unexpected token"), { type: "entity.parse.failed", status: 400 }) },
  { label: "entity.too.large", err: Object.assign(new Error("request entity too large"), { name: "PayloadTooLargeError", type: "entity.too.large", status: 413 }) },
  { label: "charset.unsupported", err: Object.assign(new Error("unsupported charset"), { name: "UnsupportedCharsetError", type: "charset.unsupported", status: 415 }) },
  { label: "encoding.unsupported", err: Object.assign(new Error("unsupported content encoding"), { name: "UnsupportedMediaTypeError", type: "encoding.unsupported", status: 415 }) },
  { label: "failed decompression (type null, status 400 fallback)", err: Object.assign(new Error("incorrect header check"), { type: null, status: 400, expose: true, code: "Z_DATA_ERROR" }) },
];

for (const { label, err } of PARSER_REJECTIONS) {
  test(`webhookGuard: body-parser rejection ${label} -> 200 {"ignored":"unsupported_update"} (not internal_error)`, () => {
    const res = createResSpy();
    webhookGuard(err, {}, res, () => {});
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ignored: "unsupported_update" });
  });
}

test("webhookGuard: a generic error still -> 200 {\"ignored\":\"internal_error\"} (unit level)", () => {
  const res = createResSpy();
  webhookGuard(new Error("repository exploded"), {}, res, () => {});
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ignored: "internal_error" });
});

test("webhookGuard: the status fallback is BOUNDED to 400 — a typeless 413/500/undefined is internal_error, not a parser rejection (D-62 acotamiento)", () => {
  for (const status of [413, 500, undefined]) {
    const res = createResSpy();
    webhookGuard(Object.assign(new Error("not a parser rejection"), { type: null, status }), {}, res, () => {});
    assert.deepEqual(res.body, { ignored: "internal_error" }, `status ${String(status)} must not be captured by the 400-only fallback`);
  }
});

test("webhookGuard via the real app: broken JSON + valid secret -> 200 {\"ignored\":\"unsupported_update\"} (spec 05 §5.1 rule 1)", async () => {
  const res = await request(app)
    .post("/webhook/telegram")
    .set("X-Telegram-Bot-Api-Secret-Token", FAKE_WH_SECRET)
    .set("Content-Type", "application/json")
    .send("{not-json");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ignored: "unsupported_update" });
});

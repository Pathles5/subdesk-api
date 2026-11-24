import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import serverlessHttp from "serverless-http";

import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createTicketRepositoryFake } from "../src/repositories/ticketRepository.fake.js";

// Adapter-level regression suite — the blind spot of the scaffold: every other test drives
// createApp through supertest, which NEVER exercises serverless-http. With 3.2.0 the adapter
// built the IncomingMessage on a socket stub ({ readable: false }) plus complete: true, so
// on-finished reported the request as finished and body-parser@2 (bundled with express@5)
// skipped parsing entirely: req.body stayed the raw Buffer the adapter assigns, and
// express.json() never ran under Lambda. These tests invoke the Lambda handler directly with
// synthetic Function URL payload v2.0 events — no AWS, no network, no cost (I2).
//
// Importing serverless-http here is allowed: eslint.config.js exempts tests/ from the layer
// restrictions (D-16 keeps src/lambda.js as the only importer inside src/). src/lambda.js is
// deliberately NOT imported: it calls loadConfig() at import time and would demand real
// environment variables; instead the app is built with createApp({ config, ticketRepository })
// and fake values, the same DI style as tests/app.smoke.test.js (D-23). Since phase 05
// createApp REQUIRES a ticket repository: the in-memory fake keeps this suite at zero AWS.

const FAKE_ADMIN_KEY = "test-admin-key-NO-REAL";
const FAKE_BOT_TOKEN = "test-bot-token-NO-REAL";
const FAKE_WH_SECRET = "test-webhook-NO-REAL";

const config = loadConfig({
  TABLE_NAME: "TicketsTable-test",
  TELEGRAM_BOT_TOKEN: FAKE_BOT_TOKEN,
  ADMIN_API_KEY: FAKE_ADMIN_KEY,
  TELEGRAM_WEBHOOK_SECRET: FAKE_WH_SECRET,
});

const handler = serverlessHttp(createApp({ config, ticketRepository: createTicketRepositoryFake() }));

// WebhookIgnored enum of the frozen contract (docs/api/openapi.yaml,
// components.schemas.WebhookIgnored). The membership assertion below is kept as the
// coarse contract-level invariant; phase 05 CLOSED the old divergence (openapi.yaml:52
// prescribed "unsupported_update" for an unparseable body while the guard answered
// "internal_error"), and the exact value is asserted by the parser-rejection suite at
// the bottom of this file.
const WEBHOOK_IGNORED_ENUM = [
  "no_text",
  "empty_message",
  "chat_not_found",
  "unsupported_update",
  "duplicate",
  "internal_error",
];

const TICKET_ID = "2f6cf473-16d5-5b61-9a3f-08e1a0d1f4e7";

/**
 * Build a Function URL payload-format-2.0 event — the only shape the live URL emits
 * (rawPath + requestContext.http.*; route params come from Express patterns, never from
 * event.pathParameters).
 */
function makeEvent({ method = "GET", path = "/", body = null, headers = {}, isBase64Encoded = false }) {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers,
    requestContext: {
      requestId: "test-request-id",
      http: {
        method,
        path,
        protocol: "HTTP/1.1",
        sourceIp: "203.0.113.1",
        userAgent: "node-test-adapter",
      },
    },
    body,
    isBase64Encoded,
  };
}

// Minimal throwaway app for the root-cause assert: report what express.json() left in
// req.body once the request has crossed the adapter (object vs raw Buffer).
const probeApp = express();
probeApp.use(express.json());
probeApp.post("/probe", (req, res) => {
  res.json({
    bodyType: typeof req.body,
    bodyIsBuffer: Buffer.isBuffer(req.body),
    bodyValue: req.body && req.body.probe,
  });
});
const probeHandler = serverlessHttp(probeApp);

const invokeApp = (event) => handler(event, {});
const invokeProbe = (event) => probeHandler(event, {});

test("adapter regression: broken JSON on PATCH /api/tickets/{id} -> 400 VALIDATION_ERROR (with serverless-http@3.2.0 this answered 401)", async () => {
  // The regression this fixes: with 3.2.0, body-parser@2 believed the body was "already
  // parsed" (socket stub => !socket.readable => on-finished isFinished) and called next()
  // without parsing, so the request sailed past express.json() and died on the x-api-key
  // gate: 401 instead of the contractual 400. The 4.0.0 PassThrough socket restores the
  // real parse, and the global parser (mounted before the router) rejects the body first.
  const res = await invokeApp(
    makeEvent({
      method: "PATCH",
      path: `/api/tickets/${TICKET_ID}`,
      headers: { "content-type": "application/json" },
      body: "{not-json",
    }),
  );
  assert.equal(res.statusCode, 400);
  const payload = JSON.parse(res.body);
  assert.equal(payload.error.code, "VALIDATION_ERROR");
  assert.equal(payload.error.message, "invalid JSON body");
});

test("adapter: valid JSON on PATCH without x-api-key -> 401 (a working parser never bypasses auth, I4)", async () => {
  const res = await invokeApp(
    makeEvent({
      method: "PATCH",
      path: `/api/tickets/${TICKET_ID}`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "IN_PROGRESS" }),
    }),
  );
  assert.equal(res.statusCode, 401);
  const payload = JSON.parse(res.body);
  assert.equal(payload.error.code, "UNAUTHORIZED");
  assert.equal(payload.error.message, "missing x-api-key header");
});

test("adapter: body over the 64 KB limit -> 400 VALIDATION_ERROR 'request body too large' with no uncaught exception", async () => {
  // Cheap ~70 KB payload (> express.json({ limit: "64kb" }) = 65536 bytes). Under 3.2.0 an
  // unmapped entity.too.large fell through to globalErrorHandler as 500 INTERNAL
  // (errName: PayloadTooLargeError), and with a naive socket shim the case even killed the
  // process (TypeError: ee.on is not a function inside on-finished/dump). Under 4.0.0 the
  // handler must simply resolve with the contractual 400.
  const res = await invokeApp(
    makeEvent({
      method: "PATCH",
      path: `/api/tickets/${TICKET_ID}`,
      headers: { "content-type": "application/json", "x-api-key": FAKE_ADMIN_KEY },
      body: '{"pad":"' + "A".repeat(70000) + '"}',
    }),
  );
  assert.equal(res.statusCode, 400);
  const payload = JSON.parse(res.body);
  assert.equal(payload.error.code, "VALIDATION_ERROR");
  assert.equal(payload.error.message, "request body too large");
});

test("adapter: unsupported charset (charset=iso-8859-1) -> 400 VALIDATION_ERROR 'unsupported charset' (table branch charset.unsupported)", async () => {
  // Exercises the charset.unsupported row of BODY_PARSER_ERROR_MESSAGES: the JSON body is
  // perfectly valid, what the parser rejects is the declared charset.
  const res = await invokeApp(
    makeEvent({
      method: "PATCH",
      path: `/api/tickets/${TICKET_ID}`,
      headers: { "content-type": "application/json; charset=iso-8859-1" },
      body: JSON.stringify({ status: "IN_PROGRESS" }),
    }),
  );
  assert.equal(res.statusCode, 400);
  const payload = JSON.parse(res.body);
  assert.equal(payload.error.code, "VALIDATION_ERROR");
  assert.equal(payload.error.message, "unsupported charset");
});

test("adapter: unknown content-encoding (bogus) -> 400 VALIDATION_ERROR 'unsupported content encoding' (table branch encoding.unsupported)", async () => {
  // Exercises the encoding.unsupported row of BODY_PARSER_ERROR_MESSAGES: an encoding the
  // parser does not know at all is rejected via err.type before any decompression.
  const res = await invokeApp(
    makeEvent({
      method: "PATCH",
      path: `/api/tickets/${TICKET_ID}`,
      headers: { "content-type": "application/json", "content-encoding": "bogus" },
      body: JSON.stringify({ status: "IN_PROGRESS" }),
    }),
  );
  assert.equal(res.statusCode, 400);
  const payload = JSON.parse(res.body);
  assert.equal(payload.error.code, "VALIDATION_ERROR");
  assert.equal(payload.error.message, "unsupported content encoding");
});

test("adapter regression: failed gzip decompression -> 400 VALIDATION_ERROR 'invalid request body', never a client-triggerable 500", async () => {
  // The regression this fixes: content-encoding: gzip with data that is not valid gzip
  // leaves body-parser with err.type === null (name "Error", code Z_DATA_ERROR,
  // status/expose 400 set by http-errors), so BODY_PARSER_ERROR_MESSAGES cannot catch it
  // and it used to fall through to globalErrorHandler as 500 INTERNAL — a 5xx any client
  // could trigger. Same shape for br/deflate/zstd. The status === 400 fallback closes it.
  const res = await invokeApp(
    makeEvent({
      method: "PATCH",
      path: `/api/tickets/${TICKET_ID}`,
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
      body: "not-valid-compressed-data",
    }),
  );
  assert.equal(res.statusCode, 400);
  const payload = JSON.parse(res.body);
  assert.equal(payload.error.code, "VALIDATION_ERROR");
  assert.equal(payload.error.message, "invalid request body");
});

test("adapter: GET without body -> 401 (bodyless requests stay a valid route through the adapter)", async () => {
  const res = await invokeApp(makeEvent({ method: "GET", path: "/api/tickets" }));
  assert.equal(res.statusCode, 401);
  const payload = JSON.parse(res.body);
  assert.equal(payload.error.code, "UNAUTHORIZED");
  assert.equal(payload.error.message, "missing x-api-key header");
});

test("adapter: webhook POST /webhook/telegram with broken JSON -> 200 ack, ignored within the WebhookIgnored enum (I5 preserved)", async () => {
  // The webhook sub-tree keeps its "always 2xx" contract under the adapter: the parse
  // failure is absorbed by webhookGuard inside the router and never reaches the global
  // handler. Membership is the coarse invariant; since phase 05 the exact value is
  // "unsupported_update" — asserted by the parser-rejection suite below (T-08).
  const res = await invokeApp(
    makeEvent({
      method: "POST",
      path: "/webhook/telegram",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": FAKE_WH_SECRET,
      },
      body: "{not-json",
    }),
  );
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  assert.ok(
    WEBHOOK_IGNORED_ENUM.includes(payload.ignored),
    `ignored="${payload.ignored}" must belong to the WebhookIgnored enum`,
  );
});

test("adapter root cause: req.body is a parsed object, not the raw Buffer (the direct assert against the 3.2.0 defect)", async () => {
  // Under 3.2.0 the adapter assigned the raw Buffer and body-parser never overwrote it:
  // bodyType would still read "object" but bodyIsBuffer would be true and bodyValue
  // undefined. A real parse yields a plain object with the field present.
  const res = await invokeProbe(
    makeEvent({
      method: "POST",
      path: "/probe",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ probe: "value" }),
    }),
  );
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.bodyType, "object");
  assert.equal(payload.bodyIsBuffer, false);
  assert.equal(payload.bodyValue, "value");
});

test("adapter: base64 body (isBase64Encoded: true) is decoded and parsed like a plain one", async () => {
  const res = await invokeProbe(
    makeEvent({
      method: "POST",
      path: "/probe",
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ probe: "value" }), "utf8").toString("base64"),
      isBase64Encoded: true,
    }),
  );
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.bodyType, "object");
  assert.equal(payload.bodyIsBuffer, false);
  assert.equal(payload.bodyValue, "value");
});

// --- Phase 05 (T-08 / spec 05 §5.5(7) / C4): the FIVE body-parser rejections of D-62,
// exercised against /webhook/telegram THROUGH THE ADAPTER — under Lambda only this path
// performs the real parse (the supertest blind spot D-62 registered). All five must ack
// 200 {"ignored":"unsupported_update"}: not 400 (that translation belongs to /api/*),
// not 501 (the webhook is implemented since phase 05), never a 5xx (I5).

const WEBHOOK_PARSER_REJECTIONS = [
  {
    name: "broken JSON (entity.parse.failed)",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": FAKE_WH_SECRET },
    body: "{not-json",
  },
  {
    name: "body over the 64 KB limit (entity.too.large)",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": FAKE_WH_SECRET },
    body: '{"pad":"' + "A".repeat(70000) + '"}',
  },
  {
    name: "unsupported charset (charset.unsupported)",
    headers: { "content-type": "application/json; charset=iso-8859-1", "x-telegram-bot-api-secret-token": FAKE_WH_SECRET },
    body: JSON.stringify({ update_id: 482391756 }),
  },
  {
    name: "unknown content-encoding (encoding.unsupported)",
    headers: { "content-type": "application/json", "content-encoding": "bogus", "x-telegram-bot-api-secret-token": FAKE_WH_SECRET },
    body: JSON.stringify({ update_id: 482391756 }),
  },
  {
    name: "failed gzip decompression (err.type null, bounded status 400 fallback)",
    headers: { "content-type": "application/json", "content-encoding": "gzip", "x-telegram-bot-api-secret-token": FAKE_WH_SECRET },
    body: "not-valid-compressed-data",
  },
];

for (const rejection of WEBHOOK_PARSER_REJECTIONS) {
  test(`adapter webhook: ${rejection.name} -> 200 {"ignored":"unsupported_update"} (spec 05 §5.1 rule 1)`, async () => {
    const res = await invokeApp(
      makeEvent({ method: "POST", path: "/webhook/telegram", headers: rejection.headers, body: rejection.body }),
    );
    assert.equal(res.statusCode, 200, "the webhook acks 2xx for every parser rejection (I5, C4)");
    assert.deepEqual(
      JSON.parse(res.body),
      { ignored: "unsupported_update" },
      "the value openapi.yaml prescribes (was internal_error before phase 05)"
    );
  });
}

test("adapter webhook: a VALID update through the adapter -> 200 {\"received\":true} (real parse + service + fake repository under Lambda shape)", async () => {
  const res = await invokeApp(
    makeEvent({
      method: "POST",
      path: "/webhook/telegram",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": FAKE_WH_SECRET },
      body: JSON.stringify({
        update_id: 482391799, // unique in this file: the module-level fake is shared
        message: {
          message_id: 1,
          from: { id: 112233445, is_bot: false, first_name: "Ana" },
          chat: { id: 112233445, type: "private" },
          date: 1763424000,
          text: "hola desde el adaptador",
        },
      }),
    }),
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { received: true });
});

test("adapter webhook (D-70): wrong secret + broken body -> 403 through the adapter too (the gate runs before the parser)", async () => {
  const res = await invokeApp(
    makeEvent({
      method: "POST",
      path: "/webhook/telegram",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "wrong-secret-NO-REAL" },
      body: "{not-json",
    }),
  );
  assert.equal(res.statusCode, 403, "the 403 must not depend on the body content (D-70, C8)");
  assert.deepEqual(JSON.parse(res.body).error, { code: "FORBIDDEN", message: "invalid webhook secret" });
});

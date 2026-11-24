import test from "node:test";
import assert from "node:assert/strict";

import { createTicketService } from "../../src/services/ticketService.js";
import { createTicketRepositoryFake } from "../../src/repositories/ticketRepository.fake.js";
import { ticketIdFor } from "../../src/utils/ids.js";

// Spec 05 §5.5(5) / C4-C6, D-23: the frozen precedence table of §5.1 case by case
// against the in-memory fake — zero AWS, zero network, zero cost (I2). The injected
// clock makes timestamps deterministic; the spy logger proves the D-18 promise: one
// line per ingestion, allowlisted fields only, NEVER the message text.

const FIXED_TS = "2026-11-23T12:00:00.000Z";
const fixedClock = () => FIXED_TS;

/** Spy logger: captures every call with its level (log-policy assertions). */
function createSpyLogger() {
  const calls = [];
  const spy = { calls };
  for (const level of ["debug", "info", "warn", "error"]) {
    spy[level] = (fields) => calls.push({ level, fields });
  }
  return spy;
}

/** D-18 allowlist for the webhook ingestion line (spec 05 §5.6). */
const ALLOWED_LOG_FIELDS = new Set(["msg", "updateId", "ticketId", "ignoredReason", "statusCode", "durationMs"]);

function assertAllowlistedLogFields(logger) {
  for (const call of logger.calls) {
    for (const key of Object.keys(call.fields)) {
      assert.ok(ALLOWED_LOG_FIELDS.has(key), `logged field "${key}" is outside the D-18 allowlist`);
    }
  }
}

function createHarness({ repository = null, clock = fixedClock } = {}) {
  const repo = repository ?? createTicketRepositoryFake();
  const logger = createSpyLogger();
  const service = createTicketService({ repository: repo, logger, clock });
  return { repo, logger, service };
}

/** A minimal VALID text-message update (the shape Telegram sends). */
function textUpdate(
  text,
  {
    updateId = 482391756,
    chatId = 112233445,
    from = { id: 112233445, is_bot: false, first_name: "Ana", username: "ana_example" },
  } = {}
) {
  return {
    update_id: updateId,
    message: { message_id: 42, from, chat: { id: chatId, type: "private" }, date: 1763424000, text },
  };
}

// --- Factory validation ------------------------------------------------------------

test("factory: TypeError when repository or logger are missing or malformed (loud wiring errors)", () => {
  const repo = createTicketRepositoryFake();
  const logger = createSpyLogger();
  assert.throws(() => createTicketService(), TypeError);
  assert.throws(() => createTicketService({ logger }), TypeError);
  assert.throws(() => createTicketService({ repository: {}, logger }), TypeError);
  assert.throws(() => createTicketService({ repository: { createTicketIfAbsent: "nope" }, logger }), TypeError);
  assert.throws(() => createTicketService({ repository: repo }), TypeError);
  assert.throws(() => createTicketService({ repository: repo, logger: {} }), TypeError);
  assert.throws(() => createTicketService({ repository: repo, logger: { info() {} } }), TypeError, "warn() is required too");
  assert.doesNotThrow(() => createTicketService({ repository: repo, logger }));
});

// --- Precedence table (spec 05 §5.1, rules 2-10), first matching rule wins ----------

test("§5.1 rule 2a: a non-object update (null, scalar, string, array) -> unsupported_update, nothing written", async () => {
  const { repo, service } = createHarness();
  for (const bad of [null, undefined, 42, "update", true, []]) {
    assert.deepEqual(await service.ingestUpdate(bad), { ignored: "unsupported_update" }, `update=${String(bad)}`);
  }
  assert.equal(repo._items().length, 0);
});

test("§5.1 rule 2b: update_id absent or not an integer >= 1 -> unsupported_update", async () => {
  const { repo, service } = createHarness();
  const message = { message_id: 1, chat: { id: 5 }, text: "hi" };
  for (const updateId of [undefined, null, 0, -3, 1.5, "482391756", NaN, 2 ** 53]) {
    assert.deepEqual(
      await service.ingestUpdate({ update_id: updateId, message }),
      { ignored: "unsupported_update" },
      `update_id=${String(updateId)}`
    );
  }
  assert.deepEqual(await service.ingestUpdate({ message }), { ignored: "unsupported_update" }, "key absent entirely");
  assert.equal(repo._items().length, 0);
});

test("§5.1 rule 3: message absent or not an object (callback_query & co.) -> unsupported_update", async () => {
  const { repo, service } = createHarness();
  const callbackQuery = {
    update_id: 482391757,
    callback_query: { id: "1234567890", data: "noop", chat_instance: "-1234567890" },
  };
  assert.deepEqual(await service.ingestUpdate(callbackQuery), { ignored: "unsupported_update" });
  for (const message of [null, "text", 42, []]) {
    assert.deepEqual(await service.ingestUpdate({ update_id: 482391757, message }), { ignored: "unsupported_update" });
  }
  assert.equal(repo._items().length, 0);
});

test("§5.1 rule 4: unusable chat id -> chat_not_found (frozen precedence: NOT unsupported_update)", async () => {
  const { repo, service } = createHarness();
  const badChats = [undefined, null, {}, { id: undefined }, { id: "abc" }, { id: 1.5 }, { id: "123456789012345678901" }, { id: NaN }];
  for (const chat of badChats) {
    assert.deepEqual(
      await service.ingestUpdate({ update_id: 482391758, message: { message_id: 1, chat, text: "hi" } }),
      { ignored: "chat_not_found" },
      `chat=${String(JSON.stringify(chat))}`
    );
  }
  assert.deepEqual(
    await service.ingestUpdate({ update_id: 482391758, message: { message_id: 1, text: "hi" } }),
    { ignored: "chat_not_found" },
    "chat key absent entirely"
  );
  assert.equal(repo._items().length, 0);
});

test("§5.1 rule 5: text absent or not a string -> no_text", async () => {
  const { repo, service } = createHarness();
  const photoMessage = { message_id: 1, chat: { id: 5 }, photo: [{ file_id: "x" }] };
  assert.deepEqual(await service.ingestUpdate({ update_id: 1, message: photoMessage }), { ignored: "no_text" });
  for (const text of [null, 42, {}, ["hi"]]) {
    assert.deepEqual(
      await service.ingestUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 5 }, text } }),
      { ignored: "no_text" }
    );
  }
  assert.equal(repo._items().length, 0);
});

test("§5.1 rule 6: whitespace-only text -> empty_message", async () => {
  const { repo, service } = createHarness();
  for (const text of ["", "   ", "\t\n\r "]) {
    assert.deepEqual(await service.ingestUpdate(textUpdate(text)), { ignored: "empty_message" }, `text=${JSON.stringify(text)}`);
  }
  assert.equal(repo._items().length, 0);
});

test("§5.1 rule 7: text over 4096 chars -> unsupported_update, NEVER truncated, logged at warn", async () => {
  const { repo, logger, service } = createHarness();
  assert.deepEqual(await service.ingestUpdate(textUpdate("A".repeat(4097))), { ignored: "unsupported_update" });
  assert.equal(repo._items().length, 0, "an over-long message is never stored, not even truncated");
  const warns = logger.calls.filter((c) => c.level === "warn");
  assert.equal(warns.length, 1, "the defensive case must be visible (spec 05 §5.1 rule 7)");
  assert.equal(warns[0].fields.ignoredReason, "unsupported_update");
});

test("§5.1 rule 7 frontier: exactly 4096 chars is accepted", async () => {
  const { repo, service } = createHarness();
  assert.deepEqual(await service.ingestUpdate(textUpdate("A".repeat(4096))), { received: true });
  assert.equal(repo._items().length, 1);
  assert.equal(repo._items()[0].message_content.length, 4096);
});

test("§5.1 rule 8: a valid text message -> { received: true } and exactly one item written", async () => {
  const { repo, service } = createHarness();
  assert.deepEqual(await service.ingestUpdate(textUpdate("Hola")), { received: true });
  assert.equal(repo._items().length, 1);
});

test("§5.1 rule 9: the conditional Put losing -> { ignored: 'duplicate' }, first write wins", async () => {
  const { repo, service } = createHarness();
  assert.deepEqual(await service.ingestUpdate(textUpdate("first")), { received: true });
  assert.deepEqual(await service.ingestUpdate(textUpdate("second, same update_id")), { ignored: "duplicate" });
  assert.equal(repo._items().length, 1);
  assert.equal(repo._items()[0].message_content, "first", "the duplicate does not overwrite");
});

test("§5.1 rule 10: a repository error PROPAGATES unchanged (webhookGuard owns the translation, I5)", async () => {
  const thrown = new Error("throttled after SDK retries");
  thrown.name = "ProvisionedThroughputExceededException";
  const failing = {
    createTicketIfAbsent: async () => {
      throw thrown;
    },
  };
  const { service } = createHarness({ repository: failing });
  await assert.rejects(() => service.ingestUpdate(textUpdate("Hola")), (err) => err === thrown);
});

test("precedence: the FIRST matching rule wins (2 before 3, 3 before 4, 4 before 5, 6 before 7)", async () => {
  const { service } = createHarness();
  // bad update_id + missing message -> rule 2, not rule 3's own reason order
  assert.deepEqual(await service.ingestUpdate({ update_id: 0 }), { ignored: "unsupported_update" });
  // null message wins as rule 3 even if a chat would have been broken
  assert.deepEqual(await service.ingestUpdate({ update_id: 1, message: null }), { ignored: "unsupported_update" });
  // broken chat + missing text -> rule 4 (chat_not_found) beats rule 5 (no_text)
  assert.deepEqual(await service.ingestUpdate({ update_id: 1, message: { chat: { id: "abc" } } }), { ignored: "chat_not_found" });
  // text present but null -> rule 5 (no_text) beats rule 6 (empty_message)
  assert.deepEqual(await service.ingestUpdate({ update_id: 1, message: { chat: { id: 5 }, text: null } }), { ignored: "no_text" });
  // 4097 whitespace chars -> rule 6 (empty_message) beats rule 7 (unsupported_update)
  assert.deepEqual(await service.ingestUpdate(textUpdate(" ".repeat(4097))), { ignored: "empty_message" });
});

// --- The exact item of spec 05 §5.2 --------------------------------------------------

test("§5.2: the stored item has EXACTLY the 9 contract attributes with the right types (C5)", async () => {
  const { repo, service } = createHarness();
  await service.ingestUpdate(textUpdate("  texto integro con espacios  "));
  const [item] = repo._items();
  assert.deepEqual(item, {
    id: ticketIdFor(482391756),
    telegram_chat_id: "112233445",
    message_content: "  texto integro con espacios  ",
    status: "PENDING",
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
    telegram_update_id: 482391756,
    username: "ana_example",
  });
  assert.equal(typeof item.telegram_update_id, "number", "telegram_update_id is a NUMBER (strict schema)");
  assert.equal(typeof item.telegram_chat_id, "string", "telegram_chat_id is stored as string");
  assert.equal(item.message_content, "  texto integro con espacios  ", "message_content is VERBATIM: no trim");
  assert.equal(
    Object.keys(item).length,
    8,
    "the creation item carries the 8 writable attributes of the 9-attribute schema: response_text is written by phase 08 only — zero extras"
  );
  assert.ok(!("response_text" in item), "response_text is written by phase 08 only");
});

test("§5.2: id is the deterministic uuid v5 of the update_id (D-19/D-69), stable across harnesses", async () => {
  const first = createHarness();
  const second = createHarness();
  await first.service.ingestUpdate(textUpdate("uno", { updateId: 482391756 }));
  await second.service.ingestUpdate(textUpdate("dos", { updateId: 482391756 }));
  assert.equal(first.repo._items()[0].id, ticketIdFor(482391756));
  assert.equal(first.repo._items()[0].id, second.repo._items()[0].id, "same update_id -> same id in any harness");
  assert.notEqual(first.repo._items()[0].id, ticketIdFor(482391757));
});

test("§5.2: created_at === updated_at === clock() with the injected clock (deterministic timestamps)", async () => {
  const { repo, service } = createHarness();
  await service.ingestUpdate(textUpdate("hola"));
  const [item] = repo._items();
  assert.equal(item.created_at, FIXED_TS);
  assert.equal(item.updated_at, FIXED_TS);
});

test("§5.2: negative group chat ids and numeric-string chat ids survive as strings", async () => {
  const { repo, service } = createHarness();
  await service.ingestUpdate(textUpdate("grupo", { updateId: 1, chatId: -1001234567890 }));
  await service.ingestUpdate(textUpdate("grupo en string", { updateId: 2, chatId: "-1009876543210" }));
  const [a, b] = repo._items();
  assert.equal(a.telegram_chat_id, "-1001234567890");
  assert.equal(b.telegram_chat_id, "-1009876543210");
});

test("§5.2 username: from.username wins; falls back to first_name; non-string username is skipped", async () => {
  const { repo, service } = createHarness();
  await service.ingestUpdate(textUpdate("a", { updateId: 1, from: { username: "ana_example", first_name: "Ana" } }));
  await service.ingestUpdate(textUpdate("b", { updateId: 2, from: { first_name: "Bea" } }));
  await service.ingestUpdate(textUpdate("c", { updateId: 3, from: { username: "", first_name: "Cia" } }));
  await service.ingestUpdate(textUpdate("d", { updateId: 4, from: { username: 42, first_name: "Dia" } }));
  const [a, b, c, d] = repo._items();
  assert.equal(a.username, "ana_example");
  assert.equal(b.username, "Bea");
  assert.equal(c.username, "Cia");
  assert.equal(d.username, "Dia");
});

test("§5.2 username: the ATTRIBUTE IS OMITTED (never '', never null) when neither username nor first_name exist (C5)", async () => {
  const { repo, service } = createHarness();
  // from: null (not undefined — that would trigger the helper's default parameter)
  await service.ingestUpdate(textUpdate("a", { updateId: 1, from: null }));
  await service.ingestUpdate(textUpdate("b", { updateId: 2, from: {} }));
  await service.ingestUpdate(textUpdate("c", { updateId: 3, from: { username: "", first_name: "" } }));
  await service.ingestUpdate({ update_id: 4, message: { message_id: 1, chat: { id: 9 }, text: "d" } }); // no from key at all
  const items = repo._items();
  assert.equal(items.length, 4);
  for (const item of items) {
    assert.ok(!("username" in item), "username must not exist as a key");
    assert.equal(Object.keys(item).length, 7, "the 8 writable attributes minus the omitted username");
  }
});

// --- Idempotency (C6) -----------------------------------------------------------------

test("C6 sequential dedupe: same update_id twice -> received then duplicate, ONE item", async () => {
  const { repo, service } = createHarness();
  assert.deepEqual(await service.ingestUpdate(textUpdate("hola")), { received: true });
  assert.deepEqual(await service.ingestUpdate(textUpdate("hola de nuevo, mismo update_id")), { ignored: "duplicate" });
  assert.equal(repo._items().length, 1, "zero duplicates by update_id");
});

test("C6 race: two concurrent ingestions of the same update_id (Promise.all) -> exactly one winner", async () => {
  const { repo, service } = createHarness();
  const results = await Promise.all([
    service.ingestUpdate(textUpdate("carrera A")),
    service.ingestUpdate(textUpdate("carrera B")),
  ]);
  assert.equal(results.filter((r) => r.received === true).length, 1, "exactly one received:true");
  assert.deepEqual(results.find((r) => r.ignored !== undefined), { ignored: "duplicate" });
  assert.equal(repo._items().length, 1);
});

// --- Logging policy (D-18, spec 05 §5.6) ------------------------------------------------

test("D-18: one info line per ingestion, allowlisted fields only, the message text NEVER reaches the logger", async () => {
  const MARKER = "texto-del-USUARIO-que-nunca-debe-salir-en-logs";
  const { logger, service } = createHarness();
  await service.ingestUpdate(textUpdate(MARKER));
  assert.equal(logger.calls.length, 1, "exactly one log line per ingestion");
  const [call] = logger.calls;
  assert.equal(call.level, "info", "a received ingestion logs at info");
  assertAllowlistedLogFields(logger);
  assert.equal(call.fields.msg, "webhook_ingest");
  assert.equal(call.fields.updateId, 482391756);
  assert.equal(call.fields.ticketId, ticketIdFor(482391756));
  assert.equal(call.fields.statusCode, 200);
  assert.equal(typeof call.fields.durationMs, "number");
  assert.ok(!("ignoredReason" in call.fields), "a received ingestion carries no ignoredReason");
  const serialized = JSON.stringify(logger.calls.map((c) => c.fields));
  assert.ok(!serialized.includes(MARKER), "the message text must never be logged (D-18/I4)");
});

test("D-18: ignored reasons log one allowlisted line each; not even a short text is logged", async () => {
  const { logger, service } = createHarness();
  await service.ingestUpdate({ update_id: 7, message: { message_id: 1, chat: { id: 1 }, text: null } }); // no_text
  await service.ingestUpdate({ update_id: 8, callback_query: { id: "x" } }); // unsupported_update
  await service.ingestUpdate({ update_id: 9, message: { message_id: 1, chat: { id: "zzz" }, text: "hi" } }); // chat_not_found
  await service.ingestUpdate(textUpdate("   ", { updateId: 10 })); // empty_message
  assert.equal(logger.calls.length, 4);
  assert.deepEqual(
    logger.calls.map((c) => c.fields.ignoredReason),
    ["no_text", "unsupported_update", "chat_not_found", "empty_message"]
  );
  for (const call of logger.calls) {
    assert.ok(["debug", "info"].includes(call.level), "routine ignores log at debug or info");
    assert.equal(call.fields.statusCode, 200);
  }
  assertAllowlistedLogFields(logger);
  const serialized = JSON.stringify(logger.calls.map((c) => c.fields));
  assert.ok(!serialized.includes("hi"), "the text of an ignored message is never logged either");
});

test("D-18: garbage updates log WITHOUT an updateId field (non-integer garbage is never logged)", async () => {
  const { logger, service } = createHarness();
  await service.ingestUpdate({ update_id: "482391756", message: {} });
  await service.ingestUpdate(null);
  assert.equal(logger.calls.length, 2);
  for (const call of logger.calls) {
    assert.ok(!("updateId" in call.fields));
    assert.equal(call.fields.ignoredReason, "unsupported_update");
  }
  assertAllowlistedLogFields(logger);
});

test("D-18: the duplicate outcome logs at info with ticketId and ignoredReason=duplicate", async () => {
  const { logger, service } = createHarness();
  await service.ingestUpdate(textUpdate("uno"));
  await service.ingestUpdate(textUpdate("uno otra vez"));
  const dup = logger.calls[1];
  assert.equal(dup.level, "info");
  assert.equal(dup.fields.ignoredReason, "duplicate");
  assert.equal(dup.fields.ticketId, ticketIdFor(482391756));
  assert.equal(dup.fields.updateId, 482391756);
  assertAllowlistedLogFields(logger);
});

test("D-18: a propagated repository error logs NOTHING here (the guard owns that line)", async () => {
  const thrown = new Error("boom");
  const failing = {
    createTicketIfAbsent: async () => {
      throw thrown;
    },
  };
  const { logger, service } = createHarness({ repository: failing });
  await assert.rejects(() => service.ingestUpdate(textUpdate("hola")));
  assert.equal(logger.calls.length, 0, "the service does not log the failure; webhookGuard logs the error NAME only");
});

test("clock defaults to nowIso: without injection, timestamps are current ISO-8601 UTC strings", async () => {
  const repo = createTicketRepositoryFake();
  const logger = createSpyLogger();
  const service = createTicketService({ repository: repo, logger });
  const before = new Date().toISOString();
  await service.ingestUpdate(textUpdate("hola"));
  const after = new Date().toISOString();
  const [item] = repo._items();
  assert.match(item.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(item.created_at, item.updated_at);
  assert.ok(item.created_at >= before && item.created_at <= after);
});

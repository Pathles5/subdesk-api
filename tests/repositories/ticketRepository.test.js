import test from "node:test";
import assert from "node:assert/strict";

import { PutCommand } from "@aws-sdk/lib-dynamodb";

import { createTicketRepository } from "../../src/repositories/ticketRepository.js";
import { createTicketRepositoryFake } from "../../src/repositories/ticketRepository.fake.js";

// Spec 05 §5.5(4) / C6, D-23: ZERO AWS, ZERO network, ZERO cost (I2). The real
// repository is exercised with an injected stub client that models the conditional
// Put semantics; the fake is pure memory. The SAME behaviour table runs against both
// implementations so the fake cannot drift from the real semantics without a red test.

const TABLE = "TicketsTable-test";

/** Creation item shape (spec 05 §5.2; response_text is written by phase 08 only). */
function sampleItem(id, overrides = {}) {
  return {
    id,
    telegram_chat_id: "1234567890",
    username: "ana",
    message_content: "Server will not boot",
    status: "PENDING",
    created_at: "2026-11-23T12:00:00.000Z",
    updated_at: "2026-11-23T12:00:00.000Z",
    telegram_update_id: 482391756,
    ...overrides,
  };
}

/**
 * Stub client modeling DynamoDB: stores by id and throws
 * ConditionalCheckFailedException when attribute_not_exists(id) is violated.
 * `failWith` forces a specific error on every send (translation/propagation tests).
 */
function createStubClient({ failWith = null } = {}) {
  const sent = [];
  const stored = new Map();
  return {
    sent,
    stored,
    async send(command) {
      sent.push(command);
      if (failWith) {
        throw failWith;
      }
      const { Item: item } = command.input;
      if (stored.has(item.id)) {
        const err = new Error("The conditional request failed");
        err.name = "ConditionalCheckFailedException";
        throw err;
      }
      stored.set(item.id, structuredClone(item));
      return {};
    },
  };
}

// Fresh state per test: each entry builds its own repository + store.
const IMPLEMENTATIONS = [
  {
    name: "real repo + stub client",
    create() {
      const stub = createStubClient();
      return {
        repo: createTicketRepository({ client: stub, tableName: TABLE }),
        storedItems: () => [...stub.stored.values()],
        stub,
      };
    },
  },
  {
    name: "in-memory fake",
    create() {
      const fake = createTicketRepositoryFake();
      return { repo: fake, storedItems: () => fake._items(), stub: null };
    },
  },
];

for (const impl of IMPLEMENTATIONS) {
  test(`[${impl.name}] first create resolves {created:true} and stores the item intact`, async () => {
    const { repo, storedItems } = impl.create();
    const item = sampleItem("ticket-a");

    assert.deepEqual(await repo.createTicketIfAbsent(item), { created: true });
    assert.deepEqual(storedItems(), [item], "the stored item equals the input item attribute by attribute");
  });

  test(`[${impl.name}] second create of the same id resolves duplicate and does NOT overwrite (C6)`, async () => {
    const { repo, storedItems } = impl.create();
    const first = sampleItem("ticket-dup", { message_content: "first write wins" });
    const second = sampleItem("ticket-dup", { message_content: "second write must be ignored" });

    assert.deepEqual(await repo.createTicketIfAbsent(first), { created: true });
    assert.deepEqual(await repo.createTicketIfAbsent(second), { created: false, reason: "duplicate" });

    const stored = storedItems();
    assert.equal(stored.length, 1, "exactly one item written after a duplicate");
    assert.equal(stored[0].message_content, "first write wins");
  });

  test(`[${impl.name}] item validation: a missing or invalid id rejects with TypeError and stores nothing`, async () => {
    const { repo, storedItems } = impl.create();
    for (const bad of [null, undefined, {}, { id: "" }, { id: 42 }, { id: null }, "ticket"]) {
      await assert.rejects(() => repo.createTicketIfAbsent(bad), TypeError);
    }
    assert.deepEqual(storedItems(), []);
  });
}

// --- Real repository specifics: the exact PutCommand and the error contract ----------

test("[real repo] sends a PutCommand with TableName, the item verbatim and ConditionExpression attribute_not_exists(id) (C6)", async () => {
  const stub = createStubClient();
  const repo = createTicketRepository({ client: stub, tableName: TABLE });
  const item = sampleItem("ticket-cmd");

  await repo.createTicketIfAbsent(item);

  assert.equal(stub.sent.length, 1, "one command per create: a single PutItem, zero reads (D-19)");
  const [command] = stub.sent;
  assert.ok(command instanceof PutCommand, "the stub must receive a lib-dynamodb PutCommand (D-68)");
  assert.equal(command.input.TableName, TABLE);
  assert.deepEqual(command.input.Item, item, "the item is forwarded intact, with no manual marshalling");
  assert.equal(command.input.ConditionExpression, "attribute_not_exists(id)", "the canonical idempotent-write condition, literal");
});

test("[real repo] ConditionalCheckFailedException is matched by NAME, never by message -> duplicate", async () => {
  const err = new Error("a completely custom message that must never be compared against");
  err.name = "ConditionalCheckFailedException";
  const stub = createStubClient({ failWith: err });
  const repo = createTicketRepository({ client: stub, tableName: TABLE });

  assert.deepEqual(await repo.createTicketIfAbsent(sampleItem("ticket-by-name")), {
    created: false,
    reason: "duplicate",
  });
});

test("[real repo] ProvisionedThroughputExceededException propagates unchanged (same error object)", async () => {
  const thrown = new Error("throughput exceeded");
  thrown.name = "ProvisionedThroughputExceededException";
  const stub = createStubClient({ failWith: thrown });
  const repo = createTicketRepository({ client: stub, tableName: TABLE });

  await assert.rejects(
    () => repo.createTicketIfAbsent(sampleItem("ticket-throttle")),
    (err) => err === thrown,
    "the guard/service layers must see the original error, not a wrapper (spec 05 §5.3)"
  );
});

test("[real repo] any other error propagates unchanged: the webhook guard owns the translation (I5)", async () => {
  const thrown = new Error("generic failure");
  const stub = createStubClient({ failWith: thrown });
  const repo = createTicketRepository({ client: stub, tableName: TABLE });

  await assert.rejects(
    () => repo.createTicketIfAbsent(sampleItem("ticket-generic")),
    (err) => err === thrown
  );
});

test("[real repo] factory validation: TypeError without a callable send() or without a tableName", () => {
  const goodStub = createStubClient();
  assert.throws(() => createTicketRepository(), TypeError);
  assert.throws(() => createTicketRepository({ client: null, tableName: TABLE }), TypeError);
  assert.throws(() => createTicketRepository({ client: {}, tableName: TABLE }), TypeError);
  assert.throws(() => createTicketRepository({ client: { send: "not-a-function" }, tableName: TABLE }), TypeError);
  assert.throws(() => createTicketRepository({ client: goodStub, tableName: "" }), TypeError);
  assert.throws(() => createTicketRepository({ client: goodStub, tableName: 42 }), TypeError);
  assert.throws(() => createTicketRepository({ client: goodStub }), TypeError);
});

// --- Fake specifics: races, write counting and the clone-on-write guarantee ----------

test("[fake] two concurrent creates of the same id (Promise.all): exactly one created:true", async () => {
  const fake = createTicketRepositoryFake();

  const results = await Promise.all([
    fake.createTicketIfAbsent(sampleItem("ticket-race")),
    fake.createTicketIfAbsent(sampleItem("ticket-race", { message_content: "the loser of the race" })),
  ]);

  assert.equal(results.filter((r) => r.created === true).length, 1, "one winner (C6 race semantics)");
  assert.deepEqual(results.find((r) => r.created === false), { created: false, reason: "duplicate" });
  assert.equal(fake._items().length, 1);
});

test("[fake] _items() counts real writes: one item per distinct id, duplicates add none", async () => {
  const fake = createTicketRepositoryFake();

  await fake.createTicketIfAbsent(sampleItem("ticket-count-1"));
  await fake.createTicketIfAbsent(sampleItem("ticket-count-1", { message_content: "retry" }));
  assert.equal(fake._items().length, 1, "after a duplicate the store still holds exactly one item");

  await fake.createTicketIfAbsent(sampleItem("ticket-count-2"));
  assert.equal(fake._items().length, 2);
});

test("[fake] the stored item is a clone: mutating the caller's object does not alter the store", async () => {
  const fake = createTicketRepositoryFake();
  const item = sampleItem("ticket-clone");

  await fake.createTicketIfAbsent(item);
  item.message_content = "mutated after the write";
  item.status = "RESOLVED";

  const [stored] = fake._items();
  assert.equal(stored.message_content, "Server will not boot");
  assert.equal(stored.status, "PENDING");
});

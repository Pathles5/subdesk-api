// repositories/ticketRepository.fake.js — in-memory fake with the EXACT interface of
// ticketRepository.js (D-23: tests inject fakes; zero AWS, zero network, zero cost —
// I2). tests/repositories/ticketRepository.test.js runs the same behaviour table
// against both implementations, so this fake cannot drift from the real conditional
// semantics without a test failing. No SDK import here on purpose: the fake stays
// usable (and dependency-free) anywhere the real repository is injected.

function assertValidItem(item) {
  if (item === null || typeof item !== "object" || typeof item.id !== "string" || item.id === "") {
    throw new TypeError("createTicketIfAbsent: item must be an object with a non-empty string id");
  }
}

/**
 * Fake ticket repository: same factory shape and same resolution contract as
 * createTicketRepository — { created: true } on insert, { created: false,
 * reason: "duplicate" } when the id already exists (the in-memory equivalent of
 * ConditionExpression "attribute_not_exists(id)"), TypeError on an invalid item.
 *
 * @returns {{
 *   createTicketIfAbsent(item: object): Promise<{created: true} | {created: false, reason: "duplicate"}>,
 *   _items(): object[]
 * }}
 */
export function createTicketRepositoryFake() {
  const items = new Map();

  return {
    async createTicketIfAbsent(item) {
      assertValidItem(item);
      if (items.has(item.id)) {
        return { created: false, reason: "duplicate" };
      }
      // Clone on write: mutating the caller's object afterwards must never alter the
      // stored item (tests rely on this to prove "no overwrite" honestly).
      items.set(item.id, structuredClone(item));
      return { created: true };
    },

    /** Test helper: every stored item, in insertion order (write-count assertions). */
    _items() {
      return [...items.values()];
    },
  };
}

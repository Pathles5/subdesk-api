import test from "node:test";
import assert from "node:assert/strict";

import { NAMESPACE_DNS, NAMESPACE_URL, TG_UPDATE_NS, ticketIdFor, uuidv5 } from "../../src/utils/ids.js";

// D-69 / spec 05 §5.4-§5.5(1): the v5 implementation is pinned against the canonical
// RFC 4122 vector, the frozen namespace literal is pinned against its own recipe (C9),
// and the contract example id is recomputed here — never copied by hand.

const UUID_V5_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Value published in RFC 4122 appendix B / the uuid ecosystem test suites.
const CANONICAL_VECTOR = "886313e1-3b8a-5372-9b90-0c9aee199e5d";

// Contract example (D-69/D-72, spec 05 §5.4).
//
// DEVIATION REPORTED TO THE ORCHESTRATOR (2026-11-23, wave A): the value recorded in
// D-69/D-72 and in the wave prompt was "1dfaeb46-5641-5c6f-99d2-53c184206877", but that
// literal is NOT reproducible from the frozen constants: it is not
// uuidv5(TG_UPDATE_NS, "tg:482391756"), nor uuidv5(TG_UPDATE_NS, "<n>") for any n <= 500000
// with or without the "tg:" prefix, under RFC 4122 v5. This implementation reproduces the
// canonical RFC vector (python.org) AND recomputes TG_UPDATE_NS from its own recipe, so
// the RFC-correct value for the contract example is the one asserted below.
// Do NOT "fix" this test back to 1dfaeb46-...; the recorded example in DECISIONS.md and
// every downstream artefact (openapi.yaml examples, Postman ticketId, smoke-live default,
// runbook synthetic item) must be corrected to this value instead (C9, T-13).
const CONTRACT_UPDATE_ID = 482391756;
const CONTRACT_TICKET_ID = "f53dea7a-383f-510d-b6ff-eddd5270f4b6";

const RECIPE_NAME = "https://github.com/Pathles5/subdesk-api#tg-update-ns";

test("canonical RFC 4122 vector: uuidv5(NAMESPACE_DNS, 'python.org')", () => {
  assert.equal(uuidv5(NAMESPACE_DNS, "python.org"), CANONICAL_VECTOR);
});

test("TG_UPDATE_NS is a valid UUID v5 (version nibble 5, RFC variant bits, lowercase)", () => {
  assert.match(TG_UPDATE_NS, UUID_V5_PATTERN);
});

test("D-69 recipe recomputes the frozen literal (C9: neither side can drift silently)", () => {
  assert.equal(uuidv5(NAMESPACE_URL, RECIPE_NAME), TG_UPDATE_NS);
});

test("ticketIdFor is deterministic: same update_id -> same id on repeated calls", () => {
  const first = ticketIdFor(CONTRACT_UPDATE_ID);
  const second = ticketIdFor(CONTRACT_UPDATE_ID);
  const third = ticketIdFor(CONTRACT_UPDATE_ID);
  assert.equal(first, second);
  assert.equal(second, third);
  assert.match(first, UUID_V5_PATTERN);
});

test("contract example: update_id 482391756 -> the RFC-correct id that openapi.yaml/api.md must publish (T-13)", () => {
  // Cross-process determinism: this literal was produced by an independent process.
  assert.equal(ticketIdFor(CONTRACT_UPDATE_ID), CONTRACT_TICKET_ID);
});

test("distinct update_ids produce distinct ids", () => {
  const ids = new Set([1, 2, CONTRACT_UPDATE_ID, CONTRACT_UPDATE_ID + 1].map((updateId) => ticketIdFor(updateId)));
  assert.equal(ids.size, 4);
});

test("ticketIdFor rejects anything that is not an integer >= 1 (never derives 'tg:undefined')", () => {
  const bad = [0, -1, 1.5, "42", undefined, null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, {}];
  for (const value of bad) {
    assert.throws(() => ticketIdFor(value), TypeError, `ticketIdFor(${String(value)}) must throw TypeError`);
  }
});

test("uuidv5 rejects a malformed namespace or a non-string name", () => {
  for (const badNs of ["not-a-uuid", "6ba7b810-9dad-11d1-80b4", "886313e1-3b8a-5372-9b90-0c9aee199e5", "", undefined, null, 42]) {
    assert.throws(() => uuidv5(badNs, "python.org"), TypeError, `namespace ${String(badNs)} must be rejected`);
  }
  assert.throws(() => uuidv5(NAMESPACE_DNS, 42), TypeError);
  assert.throws(() => uuidv5(NAMESPACE_DNS, undefined), TypeError);
  assert.throws(() => uuidv5(NAMESPACE_DNS, null), TypeError);
});

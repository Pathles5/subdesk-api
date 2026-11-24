import test from "node:test";
import assert from "node:assert/strict";

import { nowIso } from "../../src/utils/time.js";

// Spec 05 §5.5: created_at/updated_at are ISO 8601 UTC with "Z" and milliseconds.
// The injected-Date parameter keeps these tests deterministic without fake clocks (D-23).

const ISO_UTC_MILLIS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test("nowIso() returns ISO 8601 UTC with Z and millisecond precision", () => {
  assert.match(nowIso(), ISO_UTC_MILLIS_PATTERN);
});

test("nowIso is deterministic with an injected Date", () => {
  const fixed = new Date("2026-11-23T12:00:00Z");
  assert.equal(nowIso(fixed), "2026-11-23T12:00:00.000Z");
  assert.equal(nowIso(fixed), nowIso(fixed), "repeated calls with the same Date agree");
});

test("nowIso preserves the milliseconds of the injected Date", () => {
  assert.equal(nowIso(new Date("2026-11-23T12:00:00.123Z")), "2026-11-23T12:00:00.123Z");
});

test("an invalid Date throws TypeError", () => {
  assert.throws(() => nowIso(new Date("not-a-date")), TypeError);
  assert.throws(() => nowIso(new Date(NaN)), TypeError);
});

test("non-Date values throw TypeError (no silent coercion)", () => {
  for (const bad of [null, "2026-11-23T12:00:00Z", 1795459735886, {}, []]) {
    assert.throws(() => nowIso(bad), TypeError, `nowIso(${JSON.stringify(bad) ?? String(bad)}) must throw TypeError`);
  }
});

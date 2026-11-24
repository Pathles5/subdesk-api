// utils/time.js — the single source of timestamps for the whole project (spec 05 §2).
// ISO 8601 UTC with "Z" and millisecond precision: exactly what created_at / updated_at
// store per the frozen data model (I3, data-model.md). Pure module: no I/O, no config
// (D-16 utils layer).

/**
 * Current instant — or the injected Date — as an ISO 8601 UTC string,
 * e.g. "2026-11-23T12:00:00.000Z".
 *
 * The optional parameter exists so tests are deterministic (D-23: dependency injection,
 * no fake clocks and no libraries); production code calls nowIso() with no arguments.
 *
 * @param {Date} [date] defaults to the current instant
 * @returns {string} ISO 8601 UTC timestamp with milliseconds
 * @throws {TypeError} if date is present but is not a valid Date — never coerce strings
 *         or numbers silently into a timestamp that lands in the table.
 */
export function nowIso(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError("nowIso: expected a valid Date");
  }
  return date.toISOString();
}

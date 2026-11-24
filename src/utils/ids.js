// utils/ids.js — deterministic ticket identity (D-19 idempotency, D-69 frozen namespace).
// UUID v5 (RFC 4122) implemented directly on node:crypto (SHA-1): the `uuid` package
// deliberately does NOT enter the project (I4b minimum supply-chain surface, spec 01 §4.2).
// Pure module: no I/O, no config, no logging (D-16 utils layer).

import { createHash } from "node:crypto";

// RFC 4122 predefined namespaces (appendix C). NAMESPACE_URL is the origin of the
// TG_UPDATE_NS recipe below; NAMESPACE_DNS is exported so the test suite can pin the
// canonical vector uuidv5(NAMESPACE_DNS, "python.org") against a published value.
export const NAMESPACE_DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
export const NAMESPACE_URL = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Frozen namespace for every ticket id (D-69). THE LITERAL BELOW IS WHAT BINDS.
 *
 * Provenance (recipe — documentation, NOT the source of truth):
 *   TG_UPDATE_NS = uuidv5(NAMESPACE_URL, "https://github.com/Pathles5/subdesk-api#tg-update-ns")
 *
 * The recipe makes the value reproducible, but an identifier derived from a URL changes
 * if the repository is ever renamed or transferred — the lesson already paid once in
 * D-50 with the mutable OIDC subject claim (GitHub had to introduce immutable claims
 * precisely because name-derived identities break). Therefore:
 *   * this literal is frozen here and in docs/human/technical/data-model.md;
 *   * changing it requires a spec amendment (I3 / D-19) and silently loses the
 *     historical update_id -> ticket dedupe;
 *   * a test recomputes the recipe against the literal (spec 05 C9), so neither side
 *     can drift unnoticed.
 */
export const TG_UPDATE_NS = "57ef65e4-85f4-5f1d-a5c3-e55bd593494d";

/** Canonical 8-4-4-4-12 UUID string -> 16 raw bytes. */
function uuidToBytes(uuid) {
  return Buffer.from(uuid.replaceAll("-", ""), "hex");
}

/** 16 raw bytes -> canonical lowercase 8-4-4-4-12 UUID string. */
function bytesToUuid(bytes) {
  const hex = bytes.toString("hex"); // Buffer#toString("hex") is always lowercase
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * RFC 4122 UUID v5 (name-based, SHA-1): digest of bytes(namespace) || bytes(name),
 * truncated to 16 bytes, with the version nibble forced to 5 (byte 6) and the RFC
 * variant bits forced to 10xx (byte 8).
 *
 * @param {string} namespaceUuid a valid UUID (32 hex digits with dashes, any case)
 * @param {string} name arbitrary string, hashed as UTF-8
 * @returns {string} canonical lowercase 8-4-4-4-12 UUID
 * @throws {TypeError} on a malformed namespace or a non-string name — strict input
 *         validation keeps a garbage-in/garbage-out id from ever reaching the table.
 */
export function uuidv5(namespaceUuid, name) {
  if (typeof namespaceUuid !== "string" || !UUID_PATTERN.test(namespaceUuid)) {
    throw new TypeError("uuidv5: namespace must be a valid UUID string (32 hex digits with dashes)");
  }
  if (typeof name !== "string") {
    throw new TypeError("uuidv5: name must be a string");
  }

  const digest = createHash("sha1")
    .update(Buffer.concat([uuidToBytes(namespaceUuid), Buffer.from(name, "utf8")]))
    .digest();

  const bytes = Buffer.from(digest.subarray(0, 16)); // copy: never mutate the digest view
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant (10xx)
  return bytesToUuid(bytes);
}

/**
 * Deterministic ticket id for a Telegram update_id (D-19):
 *   id = uuidv5(TG_UPDATE_NS, "tg:" + updateId)
 * Together with the conditional PutItem attribute_not_exists(id) this gives exact
 * webhook idempotency on a single table with zero extra reads.
 *
 * @param {number} updateId Telegram update_id: safe integer >= 1
 * @returns {string} lowercase UUID v5
 * @throws {TypeError} on anything else — an id must NEVER be derivable from
 *         "tg:undefined", "tg:null" or any other coerced garbage.
 */
export function ticketIdFor(updateId) {
  if (!Number.isSafeInteger(updateId) || updateId < 1) {
    throw new TypeError("ticketIdFor: updateId must be an integer >= 1");
  }
  return uuidv5(TG_UPDATE_NS, `tg:${updateId}`);
}

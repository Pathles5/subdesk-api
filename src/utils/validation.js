// utils/validation.js — the D-22 input guards: pure functions, field by field, zero
// libraries (I4b). The rules mirror the frozen contract (docs/api/openapi.yaml) and the
// data model (docs/human/technical/data-model.md); nothing here invents rules the
// contract does not fix. No side effects, no logging: callers decide what an invalid
// value means (400 VALIDATION_ERROR on /api/*, ignored reason on the webhook — spec 05
// §5.1). Pure module (D-16 utils layer).

/**
 * Positive counters of the contract (update_id, telegram_update_id): safe integer >= 1.
 * Strings are never integers here — JSON numbers and JSON digits are different inputs.
 */
export function isPositiveInteger(v) {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
}

/**
 * Telegram chat id, in the numeric form it arrives in or in the string form it is
 * stored as (data-model.md pattern: ^-?[0-9]{1,20}$, optional leading "-" for groups).
 * Numbers must be safe integers; strings must match the documented pattern exactly —
 * no extra exclusions of our own. Any other type is never a chat id.
 */
export function isTelegramChatId(v) {
  if (typeof v === "number") {
    return Number.isSafeInteger(v);
  }
  if (typeof v === "string") {
    return /^-?[0-9]{1,20}$/.test(v);
  }
  return false;
}

/**
 * Text bounds of message_content / response_text: 1–4096 CHARACTERS (the contract
 * limit; DynamoDB bills UTF-8 bytes, the guard measures characters — data-model.md).
 * Text over the limit is never truncated: the webhook ignores it (spec 05 §5.1 rule 7).
 */
export function isMessageText(v) {
  return typeof v === "string" && v.length >= 1 && v.length <= 4096;
}

/**
 * Whitespace-only text: the empty_message case of the webhook (spec 05 §5.1 rule 6).
 * Non-strings are never "blank text" — absence of text is a different reason (no_text).
 */
export function isBlankText(v) {
  return typeof v === "string" && v.trim().length === 0;
}

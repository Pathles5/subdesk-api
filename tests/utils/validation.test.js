import test from "node:test";
import assert from "node:assert/strict";

import { isBlankText, isMessageText, isPositiveInteger, isTelegramChatId } from "../../src/utils/validation.js";

// Spec 05 §5.5(3): the D-22 guards with their exact frontiers (chat_id of 20 digits,
// negative group ids, text of 4096 vs 4097 characters). Long strings are always
// CONSTRUCTED, never pasted as literals (house rule after secret-scanner false positives).

const DIGITS_20 = "9".repeat(20);
const DIGITS_21 = "9".repeat(21);
const TEXT_4096 = "a".repeat(4096);
const TEXT_4097 = "a".repeat(4097);

test("isPositiveInteger: update_id frontiers (spec 05 §5.1 rule 2)", () => {
  assert.equal(isPositiveInteger(1), true, "1 is the smallest valid update_id");
  assert.equal(isPositiveInteger(Number.MAX_SAFE_INTEGER), true, "2^53-1 is still a safe integer");
  assert.equal(isPositiveInteger(0), false);
  assert.equal(isPositiveInteger(-1), false);
  assert.equal(isPositiveInteger(1.5), false);
  assert.equal(isPositiveInteger("1"), false, "a JSON string of digits is not an integer");
  assert.equal(isPositiveInteger(Number.MAX_SAFE_INTEGER + 1), false, "2^53 is not a safe integer");
  for (const bad of [NaN, Infinity, -Infinity, null, undefined, true, [], {}]) {
    assert.equal(isPositiveInteger(bad), false);
  }
});

test("isTelegramChatId: numbers, numeric strings, negative groups and the 20-digit frontier", () => {
  // Numeric form (as it arrives in update.message.chat.id).
  assert.equal(isTelegramChatId(1234567890), true);
  assert.equal(isTelegramChatId(-1001234567890), true, "group/supergroup ids are negative");
  assert.equal(isTelegramChatId(0), true, "the guard does not invent exclusions the contract lacks");
  assert.equal(isTelegramChatId(Number.MAX_SAFE_INTEGER), true);
  assert.equal(isTelegramChatId(1.5), false);
  assert.equal(isTelegramChatId(Number.MAX_SAFE_INTEGER + 1), false, "unsafe numbers are never chat ids");
  assert.equal(isTelegramChatId(NaN), false);
  // String form (as it is stored in telegram_chat_id): ^-?[0-9]{1,20}$.
  assert.equal(isTelegramChatId(DIGITS_20), true, "20 digits is inside the documented pattern");
  assert.equal(isTelegramChatId(`-${DIGITS_20}`), true);
  assert.equal(isTelegramChatId(DIGITS_21), false, "21 digits is outside the pattern");
  assert.equal(isTelegramChatId(`-${DIGITS_21}`), false);
  assert.equal(isTelegramChatId("1234567890"), true);
  assert.equal(isTelegramChatId("abc"), false);
  assert.equal(isTelegramChatId(""), false);
  assert.equal(isTelegramChatId("-"), false);
  assert.equal(isTelegramChatId("12 34"), false);
  assert.equal(isTelegramChatId("+1234567890"), false);
  // Any other type.
  for (const bad of [null, undefined, true, false, [], {}]) {
    assert.equal(isTelegramChatId(bad), false);
  }
});

test("isMessageText: 1-4096 characters, exact frontiers", () => {
  assert.equal(isMessageText("a"), true, "a single character is valid text");
  assert.equal(isMessageText("ñ"), true, "multibyte characters count as one character");
  assert.equal(isMessageText(TEXT_4096), true, "4096 is inside the contract limit");
  assert.equal(isMessageText(TEXT_4097), false, "4097 is outside (spec 05 §5.1 rule 7: ignore, never truncate)");
  assert.equal(isMessageText(""), false, "the empty string is not text (that is empty_message territory)");
  for (const bad of [null, undefined, 42, true, {}, ["a"]]) {
    assert.equal(isMessageText(bad), false);
  }
});

test("isBlankText: whitespace-only strings (spec 05 §5.1 rule 6)", () => {
  assert.equal(isBlankText(""), true);
  assert.equal(isBlankText("   "), true);
  assert.equal(isBlankText("\t\n"), true);
  assert.equal(isBlankText(" \r\n\t "), true);
  assert.equal(isBlankText("a"), false);
  assert.equal(isBlankText(" a "), false, "text with surrounding spaces is NOT blank");
  for (const bad of [null, undefined, 42, true, {}]) {
    assert.equal(isBlankText(bad), false, "absence of text is no_text, never blank text");
  }
});

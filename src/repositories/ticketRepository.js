// repositories/ticketRepository.js — the ONLY module of the project that touches the
// AWS SDK (D-16 layering, mechanized by eslint.config.js: @aws-sdk/* imports are
// allowed exclusively under src/repositories/). DynamoDB access for tickets starts and
// ends here. The DocumentClient commands of @aws-sdk/lib-dynamodb are used instead of
// the raw client so the 9-attribute item and the numeric telegram_update_id need no
// manual marshal/unmarshal (the reason D-68 bundles lib-dynamodb).
// No logging in this layer (D-18): the webhook service decides what is logged and with
// which fields — and never message_content.

import { PutCommand } from "@aws-sdk/lib-dynamodb";

function assertValidItem(item) {
  if (item === null || typeof item !== "object" || typeof item.id !== "string" || item.id === "") {
    throw new TypeError("createTicketIfAbsent: item must be an object with a non-empty string id");
  }
}

/**
 * Ticket repository factory (D-23: everything is injected; this module never builds a
 * DynamoDB client and never reads process.env — D-17).
 *
 * @param {{ client: { send: (command: object) => Promise<object> }, tableName: string }} deps
 *        client: a DynamoDBDocumentClient in production, any {send} stub in tests.
 * @returns {{ createTicketIfAbsent(item: object): Promise<{created: true} | {created: false, reason: "duplicate"}> }}
 * @throws {TypeError} on a client without a callable send() or an empty tableName.
 */
export function createTicketRepository({ client, tableName }) {
  if (client === null || typeof client !== "object" || typeof client.send !== "function") {
    throw new TypeError("createTicketRepository: client must expose a send() method");
  }
  if (typeof tableName !== "string" || tableName === "") {
    throw new TypeError("createTicketRepository: tableName must be a non-empty string");
  }

  return {
    /**
     * Idempotent insert of one ticket item (D-19, spec 05 §5.2/§5.3): a single PutItem
     * with ConditionExpression "attribute_not_exists(id)" — the canonical conditional
     * write, ZERO reads. Telegram retries of the same update_id can never duplicate a
     * ticket: the loser of the condition (or of a concurrent race) resolves duplicate.
     * Note: a failed conditional Put still consumes WCU (spec 05 §5.3).
     *
     * Resolution contract:
     *   success                            -> { created: true }
     *   ConditionalCheckFailedException    -> { created: false, reason: "duplicate" }
     *       (matched by error NAME, never by comparing the message)
     *   any other error                    -> propagated UNCHANGED: the webhook guard
     *       owns the translation to {"ignored":"internal_error"} (I5), and wrapping the
     *       error here would break that semantics.
     */
    async createTicketIfAbsent(item) {
      assertValidItem(item);
      try {
        await client.send(
          new PutCommand({
            TableName: tableName,
            Item: item,
            ConditionExpression: "attribute_not_exists(id)",
          })
        );
        return { created: true };
      } catch (err) {
        if (err?.name === "ConditionalCheckFailedException") {
          return { created: false, reason: "duplicate" };
        }
        throw err;
      }
    },
  };
}

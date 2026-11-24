// repositories/dynamoClient.js — the ONLY module that CONSTRUCTS an AWS SDK client.
// Why it lives here: the layer rule (D-16, mechanized by eslint.config.js) allows
// @aws-sdk/* imports exclusively under src/repositories/, so the composition roots
// (lambda.js / local.js) cannot build the client themselves — they call this factory and
// inject the result into createTicketRepository (D-23: everything is injected).
// No logic, no logging and no process.env reads in OUR code (D-17): the SDK resolves
// AWS_REGION and credentials from the Lambda environment by itself, so no new env
// variable exists and config.js stays the single reader of process.env.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/**
 * Build the DynamoDB DocumentClient used by the ticket repository (D-68: the SDK is
 * bundled with the function; lib-dynamodb marshals the 9-attribute item — including the
 * numeric telegram_update_id — with no manual conversion).
 *
 * @param {object} [options] forwarded verbatim to DynamoDBClient. Production calls this
 *        with NO arguments so the SDK takes region/credentials from the Lambda
 *        environment; the parameter exists for injected overrides only.
 * @returns {import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient}
 */
export function createDynamoDocumentClient(options = {}) {
  return DynamoDBDocumentClient.from(new DynamoDBClient(options));
}

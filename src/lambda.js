// lambda.js — the ONE Lambda entrypoint (D-16/D-27/D-28): `serverless-http` adapts the
// Function URL event (always payload format v2.0) to Node req/res and back. This module
// is a pure composition root: load config, wire the REAL ticket repository and hand the
// app to the adapter. No business logic here, and no direct @aws-sdk import — the
// DynamoDB client is constructed inside repositories/dynamoClient.js, because the layer
// rule (mechanized by eslint.config.js) reserves @aws-sdk/* to src/repositories/.
// This is the ONLY module allowed to import the adapter (enforced by eslint.config.js).
//
// The Function URL event carries rawPath / requestContext.http.* with pathParameters:
// null; routing and {id} extraction are done by Express inside app.js, never by parsing
// the event here.
//
// Composition happens at MODULE level on purpose: Lambda reuses the module scope across
// warm invocations, so the DynamoDB client (and its connection pool) is built once per
// container, not per request.

import serverlessHttp from "serverless-http";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDynamoDocumentClient } from "./repositories/dynamoClient.js";
import { createTicketRepository } from "./repositories/ticketRepository.js";

const config = loadConfig();

const ticketRepository = createTicketRepository({
  // No explicit region: the SDK reads AWS_REGION from the Lambda environment (D-17
  // intact — config.js stays the single reader of process.env in OUR code).
  client: createDynamoDocumentClient(),
  tableName: config.tableName,
});

const app = createApp({ config, ticketRepository });

export const handler = serverlessHttp(app);

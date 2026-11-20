// lambda.js — the ONE Lambda entrypoint (D-16/D-27/D-28): `serverless-http` adapts the
// Function URL event (always payload format v2.0) to Node req/res and back. Nothing else
// lives here: no business logic, no config reads beyond loadConfig(), no AWS SDK.
// This is the ONLY module allowed to import the adapter (enforced by eslint.config.js).
//
// The Function URL event carries rawPath / requestContext.http.* with pathParameters:
// null; routing and {id} extraction are done by Express inside app.js, never by parsing
// the event here.

import serverlessHttp from "serverless-http";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const app = createApp({ config: loadConfig() });

export const handler = serverlessHttp(app);

// local.js — `pnpm run dev` entrypoint (I7): the same Express tree from app.js on a
// real HTTP port, without the Lambda adapter. Reads .env through `node --env-file=.env`
// (package.json script), so no dotenv dependency (I4b). PORT is local-only (D-17).

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./utils/logger.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);
const app = createApp({ config, logger });

app.listen(config.port, () => {
  // No secrets in this line (D-18): port and stage are operational metadata, not keys.
  logger.info({ msg: "local_server_started", port: config.port, stage: config.stage });
});

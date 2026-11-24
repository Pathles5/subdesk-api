// local.js — `pnpm run dev` entrypoint (I7): the same Express tree from app.js on a
// real HTTP port, without the Lambda adapter. Reads .env through `node --env-file=.env`
// (package.json script), so no dotenv dependency (I4b). PORT is local-only (D-17).
//
// The ticket repository is the IN-MEMORY FAKE: there is no local DynamoDB table and the
// house rule is that nothing local ever touches AWS (D-42 / I6). `pnpm run dev` can
// therefore exercise the full webhook — intake, dedupe, ignored reasons — with zero
// credentials and zero cost (I2), and every "written" ticket vanishes with the process.

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createTicketRepositoryFake } from "./repositories/ticketRepository.fake.js";
import { createLogger } from "./utils/logger.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);
const ticketRepository = createTicketRepositoryFake();
const app = createApp({ config, logger, ticketRepository });

// Plain console.log ON PURPOSE: this warning must print even with LOG_LEVEL=error or
// silent — silently discarding writes would otherwise look like real persistence.
console.log("[local] writes are IN-MEMORY only (fake repository): no AWS from local (D-42/I6)");

app.listen(config.port, () => {
  // No secrets in this line (D-18): port and stage are operational metadata, not keys.
  logger.info({ msg: "local_server_started", port: config.port, stage: config.stage });
});

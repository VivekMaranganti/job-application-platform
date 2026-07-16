import { createApp } from "./server";
import { config } from "./config";

const server = createApp();
server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`apply-agent-service listening on :${config.port}`);
});

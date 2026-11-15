import { loadConfig } from "./config";
import { buildServer } from "./server";

const config = loadConfig();
const app = await buildServer(config);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

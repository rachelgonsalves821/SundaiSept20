import "dotenv/config";
import { loadConfig } from "./config.js";
import { startHttpServer } from "./http.js";

const config = loadConfig();
await startHttpServer(config);

import "dotenv/config";
import { assertApiEnv } from "./env.js";

assertApiEnv();

await import("./index.js");

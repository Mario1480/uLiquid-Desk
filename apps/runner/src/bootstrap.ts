import "dotenv/config";
import { assertRunnerEnv } from "./env.js";

assertRunnerEnv();

await import("./index.js");

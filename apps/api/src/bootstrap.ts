import "dotenv/config";
import { assertApiEnv } from "./env.js";

process.on("unhandledRejection", (reason) => {
  console.error("[api] unhandled rejection", reason);
});

assertApiEnv();

await import("./index.js");

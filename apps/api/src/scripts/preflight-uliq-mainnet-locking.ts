import { getUliqMainnetLockingConfig } from "../uliq/mainnetLocking.config.js";
import { preflightUliqMainnetLocking } from "../uliq/mainnetLocking.preflight.js";

try {
  const result = await preflightUliqMainnetLocking(getUliqMainnetLockingConfig());
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  // Provider error messages may contain authenticated URLs; only emit controlled error codes.
  const message = error instanceof Error ? error.message : "";
  console.error(/^uliq_[a-z_]+$/.test(message) ? message : "uliq_mainnet_locking_preflight_failed");
  process.exitCode = 1;
}

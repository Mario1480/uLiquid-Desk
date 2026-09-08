import UliqPage from "../page";
import MainnetLockingClient from "./MainnetLockingClient";

export default function LockingPage() {
  return process.env.NEXT_PUBLIC_ULIQ_MAINNET_LOCKING_ENABLED === "true" ? <MainnetLockingClient /> : <UliqPage />;
}

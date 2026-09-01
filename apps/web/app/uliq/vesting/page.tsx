import PublicPresaleClient from "../../presale/PublicPresaleClient";
import { isUliqPublicPresaleWebEnabled } from "../../../lib/uliqPublicPresale";
import LegacyUliqPage from "../page";

export default function UliqVestingPage() {
  return isUliqPublicPresaleWebEnabled()
    ? <PublicPresaleClient view="vesting" deskAuthenticated />
    : <LegacyUliqPage />;
}

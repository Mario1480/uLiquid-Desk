import PublicPresaleClient from "../../presale/PublicPresaleClient";
import { isUliqPublicPresaleWebEnabled } from "../../../lib/uliqPublicPresale";
import LegacyUliqPage from "../page";

export default function UliqPresalePage() {
  return isUliqPublicPresaleWebEnabled()
    ? <PublicPresaleClient view="presale" deskAuthenticated />
    : <LegacyUliqPage />;
}

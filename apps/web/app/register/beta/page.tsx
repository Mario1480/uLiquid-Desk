import type { Metadata } from "next";
import BetaRedemption from "../../../components/beta/BetaRedemption";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function BetaPage() { return <BetaRedemption />; }

"use client";

import { DeskBadge } from "@/components/desk/DeskBadge";
import { DeskButton } from "@/components/desk/DeskButton";
import { DeskCheckbox } from "@/components/desk/DeskCheckbox";
import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSelect } from "@/components/desk/DeskSelect";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { ApiError, apiPost } from "../../lib/api";
import { AppIcon } from "../components/AppIcon";
import { PageHeader } from "../components/ui";

const VENUES = ["binance", "bitget", "hyperliquid", "mexc", "bingx"] as const;
type Venue = typeof VENUES[number];
type ScannerKind = "arbitrage" | "xemm";
type Status = "candidate" | "below_threshold" | "blocked";
type InventoryState = "ready" | "insufficient" | "unknown";

type Opportunity = {
  id: string;
  status: Status;
  score: number;
  netEdgeBps: number;
  grossEdgeBps: number;
  expectedNetUsd: number;
  executableUsd: number;
  depthCoverage: number;
  feeBps: number;
  safetyBufferBps: number;
  warnings: string[];
  inventory: { state: InventoryState };
  buyVenue?: Venue;
  sellVenue?: Venue;
  buyPrice?: number;
  sellPrice?: number;
  slippageBps?: number;
  makerVenue?: Venue;
  takerVenue?: Venue;
  makerSide?: "buy" | "sell";
  makerPrice?: number;
  hedgeVwap?: number;
  hedgeSlippageBps?: number;
};

type ScanResponse = {
  mode: "scanner_only";
  kind: ScannerKind;
  symbol: string;
  generatedAt: string;
  assumptions: {
    bookLimit: number;
    maxBookAgeMs: number;
    maxObservationSkewMs: number;
    defaultMakerFeeBps: number;
    defaultTakerFeeBps: number;
    feeProfiles: Partial<Record<Venue, { makerBps: number; takerBps: number; source: "default_assumption" | "request_override" }>>;
  };
  sources: Array<{
    venue: Venue;
    providerId: string;
    snapshotId: string;
    observedAt: string | null;
    quality: "fresh" | "degraded" | "stale";
  }>;
  failures: Array<{ venue: Venue; code: string }>;
  opportunities: Opportunity[];
};

function badgeClass(status: Status | InventoryState | "fresh" | "degraded" | "stale"): string {
  if (status === "candidate" || status === "ready" || status === "fresh") return "uiStatusBadge uiStatusBadge-success";
  if (status === "blocked" || status === "insufficient" || status === "stale") return "uiStatusBadge uiStatusBadge-danger";
  if (status === "below_threshold" || status === "degraded") return "uiStatusBadge uiStatusBadge-warning";
  return "uiStatusBadge uiStatusBadge-neutral";
}

function venueLabel(venue: Venue): string {
  if (venue === "hyperliquid") return "Hyperliquid";
  if (venue === "bitget") return "Bitget";
  if (venue === "bingx") return "BingX";
  if (venue === "mexc") return "MEXC";
  return "Binance";
}

export default function CrossMarketPage() {
  const t = useTranslations("crossMarket");
  const locale = useLocale();
  const [kind, setKind] = useState<ScannerKind>("arbitrage");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [notional, setNotional] = useState("1000");
  const [minEdge, setMinEdge] = useState("5");
  const [safetyBuffer, setSafetyBuffer] = useState("3");
  const [venues, setVenues] = useState<Venue[]>(["binance", "bitget", "hyperliquid"]);
  const [inventory, setInventory] = useState<Partial<Record<Venue, string>>>({});
  const [payload, setPayload] = useState<ScanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const number = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }), [locale]);
  const candidates = payload?.opportunities.filter((item) => item.status === "candidate").length ?? 0;
  const bestNet = payload?.opportunities[0]?.netEdgeBps ?? null;

  function toggleVenue(venue: Venue, checked: boolean) {
    setVenues((current) => checked ? [...new Set([...current, venue])] : current.filter((item) => item !== venue));
  }

  async function scan() {
    if (venues.length < 2) {
      setError(t("errors.venues"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const inventoryPayload = Object.fromEntries(venues.flatMap((venue) => {
        const value = Number(inventory[venue]);
        return inventory[venue]?.trim() && Number.isFinite(value) && value >= 0 ? [[venue, { quoteUsd: value }]] : [];
      }));
      const result = await apiPost<ScanResponse>("/cross-market/scan", {
        kind,
        symbol,
        venues,
        targetNotionalUsd: Number(notional),
        minNetEdgeBps: Number(minEdge),
        safetyBufferBps: Number(safetyBuffer),
        bookLimit: 25,
        maxBookAgeMs: 30_000,
        maxObservationSkewMs: 2_000,
        inventory: Object.keys(inventoryPayload).length ? inventoryPayload : undefined
      });
      setPayload(result);
    } catch (nextError) {
      setPayload(null);
      setError(nextError instanceof ApiError ? `${t("errors.load")} (HTTP ${nextError.status})` : t("errors.load"));
    } finally {
      setLoading(false);
    }
  }

  function setScannerKind(next: ScannerKind) {
    setKind(next);
    setPayload(null);
    setError(null);
  }

  return (
    <div className="uiPage crossMarketPage">
      <PageHeader
        eyebrow="Phase 3"
        title={t("title")}
        description={t("subtitle")}
        actions={<DeskBadge className="uiStatusBadge uiStatusBadge-info">Read only</DeskBadge>}
      />

      <DeskSurface><div className="uiNotice uiNotice-info crossMarketReadOnlyNotice">
        <AppIcon name="shield" />
        <span>{t("scannerOnly")}</span>
      </div></DeskSurface>

      <div className="crossMarketTabs" role="tablist" aria-label={t("title")}>
        {(["arbitrage", "xemm"] as ScannerKind[]).map((tab) => (
          <DeskButton key={tab} type="button" role="tab" aria-selected={kind === tab}
            className={`btn ${kind === tab ? "btnPrimary" : ""}`} onClick={() => setScannerKind(tab)}>
            <AppIcon name={tab === "arbitrage" ? "performance" : "exchange"} />
            {t(`tabs.${tab}`)}
          </DeskButton>
        ))}
      </div>

      <DeskSurface><section className="uiSection crossMarketControls">
        <div className="uiSectionHeader">
          <div><h2>{t("controls.title")}</h2><p>{t("controls.description")}</p></div>
        </div>
        <div className="crossMarketControlGrid">
          <label><span>{t("controls.symbol")}</span><DeskSelect className="input" value={symbol} onChange={(event) => setSymbol(event.target.value)}>
            <option value="BTCUSDT">BTC/USDT</option><option value="ETHUSDT">ETH/USDT</option><option value="SOLUSDT">SOL/USDT</option>
          </DeskSelect></label>
          <label><span>{t("controls.notional")}</span><DeskInput className="input" type="number" min={25} max={1_000_000} step={25} value={notional} onChange={(event) => setNotional(event.target.value)} /></label>
          <label><span>{t("controls.minEdge")}</span><DeskInput className="input" type="number" min={0} max={1000} step={1} value={minEdge} onChange={(event) => setMinEdge(event.target.value)} /></label>
          <label><span>{t("controls.safetyBuffer")}</span><DeskInput className="input" type="number" min={0} max={200} step={1} value={safetyBuffer} onChange={(event) => setSafetyBuffer(event.target.value)} /></label>
        </div>
        <fieldset className="crossMarketVenueFieldset">
          <legend>{t("controls.venues")}</legend>
          <div className="crossMarketVenueChoices">
            {VENUES.map((venue) => <label key={venue} className="crossMarketVenueChoice">
              <DeskCheckbox checked={venues.includes(venue)} onCheckedChange={(checked) => toggleVenue(venue, checked)} aria-label={venueLabel(venue)} />
              <span>{venueLabel(venue)}</span>
            </label>)}
          </div>
        </fieldset>
        <div className="crossMarketInventoryHeader"><strong>{t("controls.inventory")}</strong><span>{t("controls.inventoryHint")}</span></div>
        <div className="crossMarketInventoryGrid">
          {venues.map((venue) => <label key={venue}><span>{venueLabel(venue)}</span><DeskInput className="input" inputMode="decimal" min={0} placeholder="—" value={inventory[venue] ?? ""} onChange={(event) => setInventory((current) => ({ ...current, [venue]: event.target.value }))} /></label>)}
        </div>
        <DeskButton type="button" className="btn btnPrimary crossMarketScanButton" disabled={loading} onClick={() => void scan()}>
          <AppIcon name="search" />{loading ? t("controls.scanning") : t("controls.scan")}
        </DeskButton>
      </section></DeskSurface>

      {error ? <DeskSurface><div className="uiNotice uiNotice-danger">{error}</div></DeskSurface> : null}

      <section className="crossMarketMetrics" aria-label={t("results.title")}>
        <DeskSurface><div className="uiMetricTile"><span>{t("summary.candidates")}</span><strong>{payload ? candidates : "—"}</strong></div></DeskSurface>
        <DeskSurface><div className="uiMetricTile"><span>{t("summary.bestNet")}</span><strong>{bestNet === null ? "—" : `${number.format(bestNet)} bps`}</strong></div></DeskSurface>
        <DeskSurface><div className="uiMetricTile"><span>{t("summary.venues")}</span><strong>{payload ? `${payload.sources.length}/${venues.length}` : "—"}</strong></div></DeskSurface>
        <DeskSurface><div className="uiMetricTile"><span>{t("summary.updated")}</span><strong>{payload ? new Date(payload.generatedAt).toLocaleTimeString(locale) : "—"}</strong></div></DeskSurface>
      </section>

      <div className="crossMarketMainGrid">
        <DeskSurface><section className="uiSection">
          <div className="uiSectionHeader"><div><h2>{t("results.title")}</h2><p>{t("results.description")}</p></div></div>
          {!payload ? <div className="uiEmptyState">{t("results.waiting")}</div> : payload.opportunities.length === 0 ? <div className="uiEmptyState">{t("results.empty")}</div> : (
            <div className="crossMarketOpportunityList">
              {payload.opportunities.slice(0, 8).map((item) => <article key={item.id} className="crossMarketOpportunityRow">
                <div className="crossMarketOpportunityRoute">
                  <div><span>{payload.kind === "arbitrage" ? t("results.buy") : t("results.maker")}</span><strong>{venueLabel((item.buyVenue ?? item.makerVenue)!)}</strong><small>{number.format(item.buyPrice ?? item.makerPrice ?? 0)}</small></div>
                  <AppIcon name="transfer" />
                  <div><span>{payload.kind === "arbitrage" ? t("results.sell") : t("results.taker")}</span><strong>{venueLabel((item.sellVenue ?? item.takerVenue)!)}</strong><small>{number.format(item.sellPrice ?? item.hedgeVwap ?? 0)}</small></div>
                </div>
                <div className="crossMarketOpportunityBadges">
                  <DeskBadge className={badgeClass(item.status)}>{t(`status.${item.status}`)}</DeskBadge>
                  <DeskBadge className={badgeClass(item.inventory.state)}>{t("results.inventory")}: {t(`status.${item.inventory.state}`)}</DeskBadge>
                  {item.makerSide ? <DeskBadge>{t("results.makerSide", { side: item.makerSide.toUpperCase() })}</DeskBadge> : null}
                </div>
                <div className="crossMarketOpportunityMetrics">
                  <span>{t("results.grossEdge")}<strong>{number.format(item.grossEdgeBps)} bps</strong></span>
                  <span>{t("results.netEdge")}<strong>{number.format(item.netEdgeBps)} bps</strong></span>
                  <span>{t("results.netUsd")}<strong>{number.format(item.expectedNetUsd)} USDT</strong></span>
                  <span>{t("results.size")}<strong>{number.format(item.executableUsd)} USDT</strong></span>
                  <span>{t("results.depth")}<strong>{number.format(item.depthCoverage * 100)}%</strong></span>
                  <span>{t("results.score")}<strong>{item.score}/100</strong></span>
                </div>
                <div className="crossMarketCostLine">
                  <span>{t("results.fees")}: {number.format(item.feeBps)} bps</span>
                  <span>{t("results.slippage")}: {number.format(item.slippageBps ?? item.hedgeSlippageBps ?? 0)} bps</span>
                  <span>{t("results.buffer")}: {number.format(item.safetyBufferBps)} bps</span>
                </div>
              </article>)}
            </div>
          )}
        </section></DeskSurface>

        <aside className="crossMarketAside">
          <DeskSurface><section className="uiSection">
            <div className="uiSectionHeader"><div><h2>{t("assumptions.title")}</h2></div></div>
            <dl className="crossMarketDefinitionList">
              <div><dt>{t("assumptions.makerFee")}</dt><dd>{payload?.assumptions.defaultMakerFeeBps ?? 2} bps</dd></div>
              <div><dt>{t("assumptions.takerFee")}</dt><dd>{payload?.assumptions.defaultTakerFeeBps ?? 10} bps</dd></div>
              <div><dt>{t("assumptions.bookDepth")}</dt><dd>{payload?.assumptions.bookLimit ?? 25}</dd></div>
              <div><dt>{t("assumptions.freshness")}</dt><dd>{t("assumptions.milliseconds", { value: payload?.assumptions.maxBookAgeMs ?? 30_000 })}</dd></div>
              <div><dt>{t("assumptions.skew")}</dt><dd>{t("assumptions.milliseconds", { value: payload?.assumptions.maxObservationSkewMs ?? 2_000 })}</dd></div>
            </dl>
          </section></DeskSurface>
          <DeskSurface><section className="uiSection">
            <div className="uiSectionHeader"><div><h2>{t("sources.title")}</h2><p>{t("sources.description")}</p></div></div>
            <div className="crossMarketSourceList">
              {(payload?.sources ?? []).map((source) => <div key={source.venue} className="crossMarketSourceRow">
                <div><strong>{venueLabel(source.venue)}</strong><span>{source.observedAt ? t("sources.observed", { value: new Date(source.observedAt).toLocaleTimeString(locale) }) : t("sources.timestampMissing")}</span></div>
                <DeskBadge className={badgeClass(source.quality)}>{t(`sources.${source.quality}`)}</DeskBadge>
              </div>)}
              {(payload?.failures ?? []).map((failure) => <div key={failure.venue} className="crossMarketSourceRow"><div><strong>{venueLabel(failure.venue)}</strong><span>{failure.code}</span></div><DeskBadge className="uiStatusBadge uiStatusBadge-danger">{t("sources.unavailable")}</DeskBadge></div>)}
              {!payload ? <div className="uiEmptyState">{t("results.waiting")}</div> : null}
            </div>
          </section></DeskSurface>
        </aside>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, ApiError } from "../../../../lib/api";
import { useOnchainActionFlow } from "../../../../components/grid/OnchainVaultActions";
import type { ExchangeAccount, GridInstanceCreateResponse, GridInstancePreviewResponse, GridTemplate } from "../../../../components/grid/types";
import { createIdempotencyKey, errMsg, formatNumber, isPerpCapable, readAllowedGridExchanges } from "../../../../components/grid/utils";

type GridPilotAccess = {
  allowed: boolean;
  reason: "admin" | "allowlist" | "disabled" | "not_listed";
  scope: "global" | "user" | "workspace" | "none";
  provider?: "mock" | "hyperliquid_demo" | "hyperliquid";
  allowLiveHyperliquid?: boolean;
};

function usesHyperliquidMarketData(account: ExchangeAccount | null | undefined): boolean {
  const exchange = String(account?.exchange ?? "").trim().toLowerCase();
  const marketDataExchange = String(account?.marketDataExchange ?? "").trim().toLowerCase();
  return exchange === "hyperliquid" || marketDataExchange === "hyperliquid";
}

function formatExecutionAccountOption(row: ExchangeAccount): string {
  if (usesHyperliquidMarketData(row)) {
    return `${row.label} (HyperVaults)`;
  }
  const exchange = String(row.exchange ?? "").trim();
  const marketDataExchange = String(row.marketDataExchange ?? "").trim();
  if (exchange && marketDataExchange && exchange.toLowerCase() !== marketDataExchange.toLowerCase()) {
    return `${row.label} (${exchange} -> ${marketDataExchange})`;
  }
  return exchange ? `${row.label} (${exchange})` : row.label;
}

function replaceStablecoinUnit(label: string, stablecoinLabel: string): string {
  return label.replaceAll("USDT", stablecoinLabel);
}

export default function GridBotsCreatePage() {
  const tGrid = useTranslations("grid.marketplace");
  const router = useRouter();

  const [templates, setTemplates] = useState<GridTemplate[]>([]);
  const [accounts, setAccounts] = useState<ExchangeAccount[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [exchangeAccountId, setExchangeAccountId] = useState("");
  const [investUsd, setInvestUsd] = useState("300");
  const [extraMarginUsd, setExtraMarginUsd] = useState("0");
  const [tpPct, setTpPct] = useState("");
  const [slPrice, setSlPrice] = useState("");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [marginMode, setMarginMode] = useState<"MANUAL" | "AUTO">("MANUAL");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<GridInstancePreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewInsufficient, setPreviewInsufficient] = useState(false);
  const [pilotAccess, setPilotAccess] = useState<GridPilotAccess | null>(null);
  const [createdInstanceId, setCreatedInstanceId] = useState<string | null>(null);
  const previewRequestSeq = useRef(0);
  const provisionCreateKey = useRef<string>(createIdempotencyKey("grid_create_provision"));
  const flowRedirectedRef = useRef(false);
  const flow = useOnchainActionFlow(async () => {
    if (!createdInstanceId || flowRedirectedRef.current) return;
    flowRedirectedRef.current = true;
    router.push(`/bots/grid?instanceId=${encodeURIComponent(createdInstanceId)}`);
  });
  const allowedGridExchanges = useMemo(() => readAllowedGridExchanges(), []);
  const selectedAccount = useMemo(
    () => accounts.find((row) => row.id === exchangeAccountId) ?? null,
    [accounts, exchangeAccountId]
  );
  const stablecoinLabel = usesHyperliquidMarketData(selectedAccount) ? "USDC" : "USDT";

  const selectedTemplate = useMemo(
    () => templates.find((row) => row.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId]
  );

  const autoMarginActive = marginMode === "AUTO";
  const investValueNum = Number(investUsd);
  const leverageValue = Number(selectedTemplate?.leverageDefault ?? 0);
  const canCreate = Boolean(
    selectedTemplate
      && exchangeAccountId
      && !saving
      && !previewInsufficient
      && Number(investUsd) > 0
      && (autoMarginActive || Number(extraMarginUsd) >= 0)
  );
  const liqRiskActive = Boolean(
    preview && Number.isFinite(Number(preview.liq?.worstCaseLiqDistancePct)) && Number(preview.liq.worstCaseLiqDistancePct) < Number(preview.liq?.liqDistanceMinPct ?? 8)
  );
  const estimatedLiqPrice = useMemo(() => {
    if (!preview || !selectedTemplate) return null;
    if (selectedTemplate.mode === "long") return preview.liq.liqEstimateLong;
    if (selectedTemplate.mode === "short") return preview.liq.liqEstimateShort;
    return preview.liq.worstCaseLiqPrice;
  }, [preview, selectedTemplate]);
  const actualInvestAfterLeverage = useMemo(() => {
    if (!Number.isFinite(leverageValue)) return Number.NaN;
    if (autoMarginActive) {
      const gridAlloc = Number(preview?.allocation?.gridInvestUsd);
      if (!Number.isFinite(gridAlloc)) return Number.NaN;
      return gridAlloc * leverageValue;
    }
    if (!Number.isFinite(investValueNum)) return Number.NaN;
    return investValueNum * leverageValue;
  }, [autoMarginActive, investValueNum, leverageValue, preview?.allocation?.gridInvestUsd]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [templateResponse, accountResponse, pilotResponse] = await Promise.all([
        apiGet<{ items: GridTemplate[] }>("/grid/templates"),
        apiGet<{ items: ExchangeAccount[] }>("/exchange-accounts?purpose=execution"),
        apiGet<GridPilotAccess>("/grid/pilot-access")
      ]);
      const templateItems = Array.isArray(templateResponse.items) ? templateResponse.items : [];
      const resolvedPilotAccess = pilotResponse;
      const allowHyperliquid = Boolean(resolvedPilotAccess?.allowed || resolvedPilotAccess?.allowLiveHyperliquid);
      const rawAccounts = (accountResponse.items ?? []).filter(isPerpCapable);
      const accountItems = rawAccounts
        .filter((row) => {
          const exchange = String(row.exchange ?? "").trim().toLowerCase();
          if (allowedGridExchanges.has(exchange)) return true;
          return allowHyperliquid && usesHyperliquidMarketData(row);
        })
        .filter((row) => allowHyperliquid || !usesHyperliquidMarketData(row));
      setPilotAccess(resolvedPilotAccess);
      setTemplates(templateItems);
      setAccounts(accountItems);
      setSelectedTemplateId((prev) => prev && templateItems.some((row) => row.id === prev) ? prev : (templateItems[0]?.id ?? ""));
      setExchangeAccountId((prev) => prev && accountItems.some((row) => row.id === prev) ? prev : (accountItems[0]?.id ?? ""));
    } catch (loadError) {
      setError(errMsg(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!selectedTemplate) return;
    setInvestUsd(String(selectedTemplate.investDefaultUsd ?? 300));
    setExtraMarginUsd("0");
    setTpPct(selectedTemplate.tpDefaultPct == null ? "" : String(selectedTemplate.tpDefaultPct));
    setSlPrice(selectedTemplate.slDefaultPrice == null ? "" : String(selectedTemplate.slDefaultPrice));
    setMarginMode(selectedTemplate.marginPolicy === "AUTO_ALLOWED" ? "AUTO" : "MANUAL");
  }, [selectedTemplateId]);

  useEffect(() => {
    if (!selectedTemplate || !exchangeAccountId) {
      setPreview(null);
      setPreviewError(null);
      setPreviewInsufficient(false);
      setPreviewLoading(false);
      return;
    }

    const investValue = Number(investUsd);
    const extraMarginValue = autoMarginActive ? 0 : Number(extraMarginUsd || 0);
    if (!Number.isFinite(investValue) || investValue <= 0 || !Number.isFinite(extraMarginValue) || extraMarginValue < 0) {
      setPreview(null);
      setPreviewError(null);
      setPreviewInsufficient(false);
      setPreviewLoading(false);
      return;
    }

    const requestId = ++previewRequestSeq.current;
    const timer = setTimeout(() => {
      const selectedExchangeAccount = accounts.find((row) => row.id === exchangeAccountId) ?? null;
      if (
        !(pilotAccess?.allowed || pilotAccess?.allowLiveHyperliquid)
        && usesHyperliquidMarketData(selectedExchangeAccount)
      ) {
        setPreview(null);
        setPreviewError(tGrid("pilotRequired"));
        setPreviewInsufficient(false);
        setPreviewLoading(false);
        return;
      }
      setPreviewLoading(true);
      void apiPost<GridInstancePreviewResponse>(`/grid/templates/${selectedTemplate.id}/instance-preview`, {
        exchangeAccountId,
        investUsd: investValue,
        extraMarginUsd: extraMarginValue,
        triggerPrice: triggerPrice.trim() ? Number(triggerPrice) : null,
        tpPct: tpPct.trim() ? Number(tpPct) : null,
        slPrice: slPrice.trim() ? Number(slPrice) : null,
        marginMode,
        autoMarginEnabled: autoMarginActive
      }).then((response) => {
        if (requestId !== previewRequestSeq.current) return;
        setPreview(response);
        setPreviewError(null);
        setPreviewInsufficient(Boolean(response.allocation?.insufficient));
      }).catch((previewLoadError) => {
        if (requestId !== previewRequestSeq.current) return;
        if (previewLoadError instanceof ApiError && previewLoadError.status === 400 && previewLoadError.payload?.error === "grid_instance_invest_below_minimum") {
          const payload = previewLoadError.payload as Record<string, any>;
          setPreview({
            markPrice: Number(payload.markPrice ?? 0),
            minInvestmentUSDT: Number(payload.requiredMinInvestmentUSDT ?? 0),
            allocation: {
              totalBudgetUsd: Number(payload.allocation?.totalBudgetUsd ?? investValue + extraMarginValue),
              gridInvestUsd: Number(payload.allocation?.gridInvestUsd ?? 0),
              extraMarginUsd: Number(payload.allocation?.extraMarginUsd ?? 0),
              splitMode: payload.allocation?.splitMode === "auto_fixed_ratio" || payload.allocation?.splitMode === "auto_liq_guard_dynamic" ? payload.allocation.splitMode : "manual",
              policy: payload.allocation?.policy === "FIXED_RATIO" ? "FIXED_RATIO" : payload.allocation?.policy === "LIQ_GUARD_MAX_GRID" ? "LIQ_GUARD_MAX_GRID" : null,
              targetLiqDistancePct: Number.isFinite(Number(payload.allocation?.targetLiqDistancePct)) ? Number(payload.allocation.targetLiqDistancePct) : null,
              searchIterationsUsed: Number.isFinite(Number(payload.allocation?.searchIterationsUsed)) ? Math.trunc(Number(payload.allocation.searchIterationsUsed)) : 0,
              insufficient: true,
              reasonCodes: Array.isArray(payload.allocation?.reasonCodes) ? payload.allocation.reasonCodes : []
            },
            minInvestmentBreakdown: payload.minInvestmentBreakdown ?? null,
            initialSeed: payload.initialSeed ?? null,
            marginMode: payload.marginMode === "AUTO" ? "AUTO" : "MANUAL",
            allocationBreakdown: payload.allocationBreakdown ?? null,
            qtyModel: payload.qtyModel ?? null,
            windowMeta: payload.windowMeta ?? null,
            profitPerGridEstimateUSDT: Number.isFinite(Number(payload.profitPerGridEstimateUSDT)) ? Number(payload.profitPerGridEstimateUSDT) : null,
            liq: {
              liqEstimateLong: Number.isFinite(Number(payload.liq?.liqEstimateLong)) ? Number(payload.liq.liqEstimateLong) : null,
              liqEstimateShort: Number.isFinite(Number(payload.liq?.liqEstimateShort)) ? Number(payload.liq.liqEstimateShort) : null,
              worstCaseLiqPrice: Number.isFinite(Number(payload.liq?.worstCaseLiqPrice)) ? Number(payload.liq.worstCaseLiqPrice) : null,
              worstCaseLiqDistancePct: Number.isFinite(Number(payload.liq?.worstCaseLiqDistancePct)) ? Number(payload.liq.worstCaseLiqDistancePct) : null,
              liqDistanceMinPct: Number.isFinite(Number(payload.liq?.liqDistanceMinPct)) ? Number(payload.liq.liqDistanceMinPct) : 8
            },
            warnings: Array.isArray(payload.warnings) ? payload.warnings.map((row) => String(row)) : []
          });
          setPreviewError(
            replaceStablecoinUnit(
              tGrid("minimumRequiredInvestment", { value: formatNumber(Number(payload.requiredMinInvestmentUSDT ?? 0), 2) }),
              stablecoinLabel
            )
          );
          setPreviewInsufficient(true);
          return;
        }
        if (previewLoadError instanceof ApiError && previewLoadError.status === 403 && previewLoadError.payload?.error === "grid_hyperliquid_pilot_required") {
          setPreview(null);
          setPreviewError(tGrid("pilotRequired"));
          setPreviewInsufficient(false);
          return;
        }
        setPreview((current) => current);
        setPreviewError(errMsg(previewLoadError));
        setPreviewInsufficient(false);
      }).finally(() => {
        if (requestId === previewRequestSeq.current) setPreviewLoading(false);
      });
    }, 450);

    return () => clearTimeout(timer);
  }, [accounts, autoMarginActive, exchangeAccountId, extraMarginUsd, investUsd, marginMode, pilotAccess, selectedTemplate, slPrice, tGrid, tpPct, triggerPrice]);

  async function createInstance(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedTemplate || !canCreate) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (
        !(pilotAccess?.allowed || pilotAccess?.allowLiveHyperliquid)
        && usesHyperliquidMarketData(selectedAccount)
      ) {
        setError(tGrid("pilotRequired"));
        return;
      }
      const created = await apiPost<GridInstanceCreateResponse>(`/grid/templates/${selectedTemplate.id}/instances`, {
        exchangeAccountId,
        investUsd: Number(investUsd),
        extraMarginUsd: autoMarginActive ? 0 : Number(extraMarginUsd || 0),
        triggerPrice: triggerPrice.trim() ? Number(triggerPrice) : null,
        tpPct: tpPct.trim() ? Number(tpPct) : null,
        slPrice: slPrice.trim() ? Number(slPrice) : null,
        marginMode,
        autoMarginEnabled: autoMarginActive,
        idempotencyKey: provisionCreateKey.current
      });
      if (created && typeof created === "object" && "txRequest" in created && "onchainAction" in created) {
        const instanceId = String(created.instance?.id ?? "");
        if (instanceId) {
          setCreatedInstanceId(instanceId);
        }
        await flow.executeBuiltAction({
          busyKey: "create-grid-bot",
          built: {
            ok: true,
            mode: created.mode,
            action: created.onchainAction,
            txRequest: created.txRequest
          }
        });
        setNotice(null);
      } else {
        setNotice(tGrid("createdAutoStarted"));
        provisionCreateKey.current = createIdempotencyKey("grid_create_provision");
      }
    } catch (createError) {
      if (createError instanceof ApiError && createError.status === 403 && createError.payload?.error === "grid_hyperliquid_pilot_required") {
        setError(tGrid("pilotRequired"));
      } else if (createError instanceof ApiError && createError.status === 403 && createError.payload?.error === "workspace_access_denied") {
        setError(tGrid("workspaceAccessDenied"));
      } else if (createError instanceof ApiError && createError.status === 400 && createError.payload?.error === "workspace_not_found") {
        setError(tGrid("workspaceNotFound"));
      } else {
        setError(errMsg(createError));
      }
      setCreatedInstanceId(null);
      flowRedirectedRef.current = false;
      provisionCreateKey.current = createIdempotencyKey("grid_create_provision");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="botsPage">
      <div className="dashboardHeader">
        <div>
          <h2 style={{ margin: 0 }}>{tGrid("createTitle")}</h2>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{tGrid("createSubtitle")}</div>
        </div>
      </div>

      {error || flow.error ? <div className="card" style={{ padding: 12, borderColor: "#ef4444", marginBottom: 12 }}>{error ?? flow.error}</div> : null}
      {notice || flow.notice ? <div className="card" style={{ padding: 12, borderColor: "#22c55e", marginBottom: 12 }}>{notice ?? flow.notice}</div> : null}

      <section className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div className="gridCreateHero">
          <div>
            <h3 style={{ marginTop: 0 }}>{tGrid("createTitle")}</h3>
            <div className="settingsMutedText">{tGrid("createHeroHint")}</div>
          </div>
          <div className="badge">{tGrid("createHeroBadge")}</div>
        </div>

        {loading ? (
          <div className="settingsMutedText">{tGrid("loadingTemplates")}</div>
        ) : (
          <form onSubmit={createInstance} className="gridCreateLayout">
            <div className="gridCreateFormColumn">
              <div className="card" style={{ padding: 12 }}>
                <label>
                  {tGrid("template")}
                  <select className="input" value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>
                    {templates.map((row) => (
                      <option key={row.id} value={row.id}>{row.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {usesHyperliquidMarketData(selectedAccount) ? tGrid("vaultAccount") : tGrid("exchangeAccount")}
                  <select className="input" value={exchangeAccountId} onChange={(event) => setExchangeAccountId(event.target.value)}>
                    {accounts.length > 0 ? (
                      accounts.map((row) => (
                        <option key={row.id} value={row.id}>{formatExecutionAccountOption(row)}</option>
                      ))
                    ) : (
                      <option value="">{tGrid("noExecutionAccountsOption")}</option>
                    )}
                  </select>
                </label>
                {pilotAccess?.provider === "hyperliquid_demo" && usesHyperliquidMarketData(selectedAccount) ? (
                  <div className="settingsMutedText">{tGrid("pilotBadge")}</div>
                ) : null}
                {accounts.length === 0 ? (
                  <div className="card" style={{ padding: 12, marginTop: 8, borderColor: "var(--warn)" }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>{tGrid("noExecutionAccountsTitle")}</div>
                    <div className="settingsMutedText" style={{ marginBottom: 8 }}>
                      {tGrid("noExecutionAccountsBody")}
                    </div>
                    <div className="settingsMutedText" style={{ marginBottom: 10 }}>
                      {tGrid("noExecutionAccountsHint", { exchanges: [...allowedGridExchanges].join(", ") })}
                    </div>
                    <Link href="/settings" className="btn">
                      {tGrid("openExchangeSettings")}
                    </Link>
                  </div>
                ) : null}
                <label>
                  {replaceStablecoinUnit(autoMarginActive ? tGrid("investTotalBudget") : tGrid("invest"), stablecoinLabel)}
                  <input className="input" type="number" min="1" step="0.01" value={investUsd} onChange={(event) => setInvestUsd(event.target.value)} />
                </label>
                {!autoMarginActive ? (
                  <label>
                    {replaceStablecoinUnit(tGrid("extraMargin"), stablecoinLabel)}
                    <input className="input" type="number" min="0" step="0.01" value={extraMarginUsd} onChange={(event) => setExtraMarginUsd(event.target.value)} />
                  </label>
                ) : null}
                <label>
                  {tGrid("triggerPrice")}
                  <input className="input" type="number" min="0" step="0.0001" value={triggerPrice} onChange={(event) => setTriggerPrice(event.target.value)} />
                </label>
                <label>
                  {tGrid("tpPct")}
                  <input className="input" type="number" min="0" step="0.01" value={tpPct} onChange={(event) => setTpPct(event.target.value)} />
                </label>
                <label>
                  {tGrid("slPrice")}
                  <input className="input" type="number" min="0" step="0.01" value={slPrice} onChange={(event) => setSlPrice(event.target.value)} />
                </label>
                <label>
                  {tGrid("marginMode")}
                  <select className="input" value={marginMode} disabled={selectedTemplate?.marginPolicy !== "AUTO_ALLOWED"} onChange={(event) => setMarginMode(event.target.value === "AUTO" ? "AUTO" : "MANUAL")}>
                    <option value="MANUAL">{tGrid("marginModeManual")}</option>
                    <option value="AUTO">{tGrid("marginModeAuto")}</option>
                  </select>
                </label>
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                  <button className="btn btnPrimary" type="submit" disabled={!canCreate}>{saving ? tGrid("creating") : tGrid("create")}</button>
                </div>
              </div>
            </div>

            <div className="gridCreatePreviewColumn">
              <div className="card" style={{ padding: 12, borderColor: previewInsufficient ? "#ef4444" : liqRiskActive ? "#f59e0b" : "var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <strong>{tGrid("previewTitle")}</strong>
                  {previewLoading ? <span className="badge badgeWarn">{tGrid("previewUpdating")}</span> : previewInsufficient ? <span className="badge badgeDanger">{tGrid("previewInsufficient")}</span> : preview ? <span className={`badge ${liqRiskActive ? "badgeWarn" : "badgeOk"}`}>{liqRiskActive ? tGrid("previewLiqRisk") : tGrid("previewReady")}</span> : <span className="badge">{tGrid("previewWaiting")}</span>}
                </div>

                <div className="settingsMutedText" style={{ marginBottom: 10 }}>{tGrid("previewOnlyHint")}</div>

                {preview ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8 }}>
                    <div className="settingsMutedText">{tGrid("actualInvestAfterLeverage")}: <strong>{Number.isFinite(actualInvestAfterLeverage) ? `${formatNumber(actualInvestAfterLeverage, 2)} ${stablecoinLabel}` : "n/a"}</strong></div>
                    <div className="settingsMutedText">{tGrid("estLiqPrice")}: <strong>{estimatedLiqPrice == null ? "n/a" : `${formatNumber(estimatedLiqPrice, 2)} ${stablecoinLabel}`}</strong></div>
                    <div className="settingsMutedText">{tGrid("minInvest")}: <strong>{formatNumber(preview.minInvestmentUSDT, 2)} {stablecoinLabel}</strong></div>
                    <div className="settingsMutedText">{tGrid("marginMode")}: <strong>{preview.marginMode ?? marginMode}</strong></div>
                    <div className="settingsMutedText">{tGrid("mark")}: <strong>{formatNumber(preview.markPrice, 4)}</strong></div>
                    {selectedTemplate?.mode !== "short" ? (
                      <div className="settingsMutedText">{tGrid("minInvestLong")}: <strong>{formatNumber(preview.minInvestmentBreakdown?.long ?? null, 2)} {stablecoinLabel}</strong></div>
                    ) : null}
                    {selectedTemplate?.mode !== "long" ? (
                      <div className="settingsMutedText">{tGrid("minInvestShort")}: <strong>{formatNumber(preview.minInvestmentBreakdown?.short ?? null, 2)} {stablecoinLabel}</strong></div>
                    ) : null}
                    {selectedTemplate?.mode !== "short" ? (
                      <div className="settingsMutedText">{tGrid("liqLong")}: <strong>{formatNumber(preview.liq.liqEstimateLong, 2)}</strong></div>
                    ) : null}
                    {selectedTemplate?.mode !== "long" ? (
                      <div className="settingsMutedText">{tGrid("liqShort")}: <strong>{formatNumber(preview.liq.liqEstimateShort, 2)}</strong></div>
                    ) : null}
                    <div className="settingsMutedText">{tGrid("profitPerGridEstimate")}: <strong>{formatNumber(preview.profitPerGridEstimateUSDT ?? null, 4)} {stablecoinLabel}</strong></div>
                  </div>
                ) : null}

                {preview?.initialSeed?.enabled ? (
                  <div className="settingsMutedText" style={{ marginTop: 4 }}>
                    {replaceStablecoinUnit(
                      tGrid("initialSeedLine", {
                        side: preview.initialSeed.seedSide ?? "n/a",
                        qty: formatNumber(preview.initialSeed.seedQty ?? null, 6),
                        notional: formatNumber(preview.initialSeed.seedNotionalUsd ?? null, 2),
                        margin: formatNumber(preview.initialSeed.seedMarginUsd ?? null, 2),
                        pct: formatNumber(preview.initialSeed.seedPct ?? null, 2)
                      }),
                      stablecoinLabel
                    )}
                  </div>
                ) : null}
                {previewError ? <div className="settingsMutedText" style={{ color: "#f59e0b", marginTop: 8 }}>{previewError}</div> : null}
                {liqRiskActive && preview ? <div className="settingsMutedText" style={{ color: "#f59e0b", marginTop: 8 }}>{tGrid("liqRiskWarning", { actual: formatNumber(preview.liq.worstCaseLiqDistancePct, 2), min: formatNumber(preview.liq.liqDistanceMinPct, 2) })}</div> : null}
                {selectedTemplate ? <div className="settingsMutedText" style={{ marginTop: 10 }}>{tGrid("templateBoundsSimple", { leverage: String(selectedTemplate.leverageDefault), slippage: formatNumber(selectedTemplate.slippageDefaultPct, 4) })}</div> : null}
              </div>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

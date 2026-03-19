"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiDelete, apiGet, apiPost } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import type {
  ExchangeAccount,
  GridInstancePreviewResponse,
  GridTemplate,
  GridTemplateFiltersResponse
} from "../../../components/grid/types";
import {
  createIdempotencyKey,
  errMsg,
  formatNumber,
  isPerpCapable,
  readAllowedGridExchanges
} from "../../../components/grid/utils";
import { buildGridCatalogQuery, updateGridCatalogFavoriteState } from "../../../src/grid/catalog";

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

function rangeSummary(template: GridTemplate): string {
  if (template.mode === "cross" && template.crossSideConfig) {
    return `L ${formatNumber(template.crossSideConfig.long.lowerPrice, 0)}-${formatNumber(template.crossSideConfig.long.upperPrice, 0)} · S ${formatNumber(template.crossSideConfig.short.lowerPrice, 0)}-${formatNumber(template.crossSideConfig.short.upperPrice, 0)}`;
  }
  return `${formatNumber(template.lowerPrice, 0)}-${formatNumber(template.upperPrice, 0)}`;
}

export default function GridBotCatalogPage() {
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const tGrid = useTranslations("grid.marketplace");
  const allowedGridExchanges = useMemo(() => readAllowedGridExchanges(), []);

  const [templates, setTemplates] = useState<GridTemplate[]>([]);
  const [filters, setFilters] = useState<GridTemplateFiltersResponse>({
    categories: [],
    tags: [],
    difficulties: [],
    risks: []
  });
  const [accounts, setAccounts] = useState<ExchangeAccount[]>([]);
  const [pilotAccess, setPilotAccess] = useState<GridPilotAccess | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [favoriteBusyId, setFavoriteBusyId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [selectedTag, setSelectedTag] = useState("ALL");
  const [selectedDifficulty, setSelectedDifficulty] = useState("ALL");
  const [selectedRisk, setSelectedRisk] = useState("ALL");
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [exchangeAccountId, setExchangeAccountId] = useState("");
  const [investUsd, setInvestUsd] = useState("300");
  const [extraMarginUsd, setExtraMarginUsd] = useState("0");
  const [tpPct, setTpPct] = useState("");
  const [slPrice, setSlPrice] = useState("");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [marginMode, setMarginMode] = useState<"MANUAL" | "AUTO">("MANUAL");
  const [preview, setPreview] = useState<GridInstancePreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewInsufficient, setPreviewInsufficient] = useState(false);
  const [creating, setCreating] = useState(false);
  const previewRequestSeq = useRef(0);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates]
  );
  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === exchangeAccountId) ?? null,
    [accounts, exchangeAccountId]
  );
  const stablecoinLabel = usesHyperliquidMarketData(selectedAccount) ? "USDC" : "USDT";
  const autoMarginActive = marginMode === "AUTO";
  const liqRiskActive = Boolean(
    preview
      && Number.isFinite(Number(preview.liq?.worstCaseLiqDistancePct))
      && Number(preview.liq.worstCaseLiqDistancePct) < Number(preview.liq?.liqDistanceMinPct ?? 8)
  );

  const canCreate = Boolean(
    selectedTemplate
      && exchangeAccountId
      && !creating
      && !previewInsufficient
      && Number(investUsd) > 0
      && (autoMarginActive || Number(extraMarginUsd) >= 0)
  );

  async function loadMeta() {
    setLoadingMeta(true);
    try {
      const [filterResponse, accountResponse, pilotResponse] = await Promise.all([
        apiGet<GridTemplateFiltersResponse>("/grid/templates/filters"),
        apiGet<{ items: ExchangeAccount[] }>("/exchange-accounts?purpose=execution"),
        apiGet<GridPilotAccess>("/grid/pilot-access")
      ]);
      const allowHyperliquid = Boolean(pilotResponse?.allowed || pilotResponse?.allowLiveHyperliquid);
      const accountItems = (accountResponse.items ?? [])
        .filter(isPerpCapable)
        .filter((row) => {
          const exchange = String(row.exchange ?? "").trim().toLowerCase();
          if (allowedGridExchanges.has(exchange)) return true;
          return allowHyperliquid && usesHyperliquidMarketData(row);
        })
        .filter((row) => allowHyperliquid || !usesHyperliquidMarketData(row));
      setFilters({
        categories: Array.isArray(filterResponse.categories) ? filterResponse.categories : [],
        tags: Array.isArray(filterResponse.tags) ? filterResponse.tags : [],
        difficulties: Array.isArray(filterResponse.difficulties) ? filterResponse.difficulties : [],
        risks: Array.isArray(filterResponse.risks) ? filterResponse.risks : []
      });
      setAccounts(accountItems);
      setPilotAccess(pilotResponse ?? null);
      setExchangeAccountId((previous) => previous && accountItems.some((row) => row.id === previous) ? previous : (accountItems[0]?.id ?? ""));
    } catch (loadError) {
      setError(errMsg(loadError));
    } finally {
      setLoadingMeta(false);
    }
  }

  async function loadCatalog() {
    setLoadingCatalog(true);
    setError(null);
    try {
      const query = buildGridCatalogQuery({
        search: deferredSearch,
        category: selectedCategory,
        tag: selectedTag,
        difficulty: selectedDifficulty,
        risk: selectedRisk,
        favoritesOnly
      });
      const response = await apiGet<{ items: GridTemplate[] }>(
        `/grid/templates${query ? `?${query}` : ""}`
      );
      const items = Array.isArray(response.items) ? response.items : [];
      setTemplates(items);
      setSelectedTemplateId((previous) => previous && items.some((row) => row.id === previous) ? previous : "");
    } catch (loadError) {
      setError(errMsg(loadError));
    } finally {
      setLoadingCatalog(false);
    }
  }

  useEffect(() => {
    void Promise.all([loadMeta(), loadCatalog()]);
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [deferredSearch, selectedCategory, selectedTag, selectedDifficulty, selectedRisk, favoritesOnly]);

  useEffect(() => {
    if (!selectedTemplate) {
      setPreview(null);
      setPreviewError(null);
      setPreviewInsufficient(false);
      return;
    }
    setInvestUsd(String(selectedTemplate.investDefaultUsd ?? 300));
    setExtraMarginUsd("0");
    setTpPct(selectedTemplate.tpDefaultPct == null ? "" : String(selectedTemplate.tpDefaultPct));
    setSlPrice(selectedTemplate.slDefaultPrice == null ? "" : String(selectedTemplate.slDefaultPrice));
    setTriggerPrice("");
    setMarginMode(selectedTemplate.marginPolicy === "AUTO_ALLOWED" ? "AUTO" : "MANUAL");
    setPreview(null);
    setPreviewError(null);
    setPreviewInsufficient(false);
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
      if (
        !(pilotAccess?.allowed || pilotAccess?.allowLiveHyperliquid)
        && usesHyperliquidMarketData(selectedAccount)
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
    }, 350);

    return () => clearTimeout(timer);
  }, [autoMarginActive, exchangeAccountId, extraMarginUsd, investUsd, marginMode, pilotAccess, selectedAccount, selectedTemplate, slPrice, stablecoinLabel, tGrid, tpPct, triggerPrice]);

  async function toggleFavorite(template: GridTemplate) {
    setFavoriteBusyId(template.id);
    setError(null);
    try {
      const nextIsFavorite = !template.isFavorite;
      if (template.isFavorite) {
        await apiDelete(`/grid/templates/${template.id}/favorite`);
      } else {
        await apiPost(`/grid/templates/${template.id}/favorite`, {});
      }
      setTemplates((previous) => updateGridCatalogFavoriteState(previous, template.id, nextIsFavorite, favoritesOnly));
      if (favoritesOnly && !nextIsFavorite && selectedTemplateId === template.id) setSelectedTemplateId("");
    } catch (favoriteError) {
      setError(errMsg(favoriteError));
    } finally {
      setFavoriteBusyId(null);
    }
  }

  async function createInstance(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedTemplate || !canCreate) return;
    setCreating(true);
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
      const created = await apiPost<{ id: string }>(`/grid/templates/${selectedTemplate.id}/instances`, {
        exchangeAccountId,
        investUsd: Number(investUsd),
        extraMarginUsd: autoMarginActive ? 0 : Number(extraMarginUsd || 0),
        triggerPrice: triggerPrice.trim() ? Number(triggerPrice) : null,
        tpPct: tpPct.trim() ? Number(tpPct) : null,
        slPrice: slPrice.trim() ? Number(slPrice) : null,
        marginMode,
        autoMarginEnabled: autoMarginActive,
        idempotencyKey: createIdempotencyKey("grid_catalog_create")
      });
      setNotice(tGrid("createdAutoStarted"));
      setSelectedTemplateId("");
      router.push(withLocalePath(`/bots/grid/${created.id}`, locale));
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
    } finally {
      setCreating(false);
    }
  }

  function closeDrawer() {
    setSelectedTemplateId("");
    setPreview(null);
    setPreviewError(null);
    setPreviewInsufficient(false);
    setNotice(null);
  }

  return (
    <div className="botsPage">
      <div className="dashboardHeader">
        <div>
          <h2 style={{ margin: 0 }}>{tGrid("catalogTitle")}</h2>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{tGrid("catalogSubtitle")}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href={withLocalePath("/bots/grid", locale)} className="btn">{tGrid("dashboard")}</Link>
          <Link href={withLocalePath("/bots/grid/new", locale)} className="btn">{tGrid("catalogFallbackCta")}</Link>
        </div>
      </div>

      {error ? <div className="card" style={{ padding: 12, borderColor: "#ef4444", marginBottom: 12 }}>{error}</div> : null}
      {notice ? <div className="card" style={{ padding: 12, borderColor: "#22c55e", marginBottom: 12 }}>{notice}</div> : null}

      <section className="card" style={{ padding: 12, marginBottom: 12, display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <label>
            {tGrid("catalogSearch")}
            <input className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tGrid("catalogSearchPlaceholder")} />
          </label>
          <label>
            {tGrid("catalogCategory")}
            <select className="input" value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}>
              <option value="ALL">{tGrid("catalogAll")}</option>
              {filters.categories.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            {tGrid("catalogTag")}
            <select className="input" value={selectedTag} onChange={(event) => setSelectedTag(event.target.value)}>
              <option value="ALL">{tGrid("catalogAll")}</option>
              {filters.tags.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            {tGrid("catalogDifficulty")}
            <select className="input" value={selectedDifficulty} onChange={(event) => setSelectedDifficulty(event.target.value)}>
              <option value="ALL">{tGrid("catalogAll")}</option>
              {filters.difficulties.map((value) => <option key={value} value={value}>{tGrid(`catalogDifficultyValues.${value}`)}</option>)}
            </select>
          </label>
          <label>
            {tGrid("catalogRisk")}
            <select className="input" value={selectedRisk} onChange={(event) => setSelectedRisk(event.target.value)}>
              <option value="ALL">{tGrid("catalogAll")}</option>
              {filters.risks.map((value) => <option key={value} value={value}>{tGrid(`catalogRiskValues.${value}`)}</option>)}
            </select>
          </label>
        </div>
        <label className="settingsToggle" style={{ width: "fit-content" }}>
          <input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} />
          <span>{tGrid("catalogFavoritesOnly")}</span>
        </label>
      </section>

      {(loadingCatalog || loadingMeta) ? (
        <div className="card" style={{ padding: 16 }}>{tGrid("catalogLoading")}</div>
      ) : templates.length === 0 ? (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{tGrid("catalogEmptyTitle")}</div>
          <div className="settingsMutedText" style={{ marginBottom: 10 }}>{tGrid("catalogEmptyBody")}</div>
          <button className="btn" type="button" onClick={() => {
            setSearch("");
            setSelectedCategory("ALL");
            setSelectedTag("ALL");
            setSelectedDifficulty("ALL");
            setSelectedRisk("ALL");
            setFavoritesOnly(false);
          }}>
            {tGrid("catalogResetFilters")}
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
          {templates.map((template) => (
            <article
              key={template.id}
              className="card"
              style={{ padding: 12, display: "grid", gap: 12, cursor: "pointer" }}
              onClick={() => setSelectedTemplateId(template.id)}
            >
              {template.catalogImageUrl ? (
                <img
                  src={template.catalogImageUrl}
                  alt={template.name}
                  style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 12, background: "rgba(255,255,255,0.04)" }}
                />
              ) : (
                <div style={{ height: 160, borderRadius: 12, background: "linear-gradient(135deg, rgba(16,185,129,0.18), rgba(59,130,246,0.14))", display: "grid", placeItems: "center", fontWeight: 700 }}>
                  {template.symbol}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{template.name}</div>
                  <div className="settingsMutedText" style={{ marginTop: 4 }}>
                    {template.catalogShortDescription || template.description || tGrid("catalogNoDescription")}
                  </div>
                </div>
                <button
                  type="button"
                  className={`btn ${template.isFavorite ? "btnPrimary" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void toggleFavorite(template);
                  }}
                  disabled={favoriteBusyId === template.id}
                >
                  {favoriteBusyId === template.id ? "..." : template.isFavorite ? tGrid("catalogUnfavorite") : tGrid("catalogFavorite")}
                </button>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="badge">{template.symbol}</span>
                <span className="badge">{tGrid(`catalogDifficultyValues.${template.catalogDifficulty ?? "BEGINNER"}`)}</span>
                <span className="badge">{tGrid(`catalogRiskValues.${template.catalogRiskLevel ?? "MEDIUM"}`)}</span>
                {template.catalogFeatured ? <span className="badge badgeOk">{tGrid("catalogFeatured")}</span> : null}
              </div>

              <div className="settingsMutedText" style={{ display: "grid", gap: 4 }}>
                <div>{tGrid("catalogCardMode", { mode: template.mode, leverage: String(template.leverageDefault) })}</div>
                <div>{tGrid("catalogCardRange", { range: rangeSummary(template) })}</div>
                {template.catalogCategory ? <div>{tGrid("catalogCardCategory", { category: template.catalogCategory })}</div> : null}
              </div>

              {Array.isArray(template.catalogTags) && template.catalogTags.length > 0 ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {template.catalogTags.slice(0, 4).map((tag) => <span key={tag} className="badge">{tag}</span>)}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {selectedTemplate ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(3,7,18,0.6)",
            display: "flex",
            justifyContent: "flex-end",
            zIndex: 60
          }}
          onClick={closeDrawer}
        >
          <aside
            className="card"
            style={{
              width: "min(720px, 100%)",
              height: "100%",
              overflowY: "auto",
              borderRadius: 0,
              padding: 16,
              display: "grid",
              gap: 16
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <div>
                <h3 style={{ margin: 0 }}>{selectedTemplate.name}</h3>
                <div className="settingsMutedText" style={{ marginTop: 6 }}>
                  {selectedTemplate.catalogShortDescription || selectedTemplate.description || tGrid("catalogNoDescription")}
                </div>
              </div>
              <button className="btn" type="button" onClick={closeDrawer}>{tGrid("catalogClose")}</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              <div className="card" style={{ padding: 10 }}>
                <strong>{tGrid("catalogTemplateSymbol")}</strong>
                <div>{selectedTemplate.symbol}</div>
              </div>
              <div className="card" style={{ padding: 10 }}>
                <strong>{tGrid("catalogTemplateMode")}</strong>
                <div>{selectedTemplate.mode} · {selectedTemplate.gridMode}</div>
              </div>
              <div className="card" style={{ padding: 10 }}>
                <strong>{tGrid("catalogTemplateRange")}</strong>
                <div>{rangeSummary(selectedTemplate)}</div>
              </div>
              <div className="card" style={{ padding: 10 }}>
                <strong>{tGrid("catalogTemplateLeverage")}</strong>
                <div>{selectedTemplate.leverageDefault}x</div>
              </div>
            </div>

            <form onSubmit={createInstance} style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                <label>
                  {usesHyperliquidMarketData(selectedAccount) ? tGrid("vaultAccount") : tGrid("exchangeAccount")}
                  <select className="input" value={exchangeAccountId} onChange={(event) => setExchangeAccountId(event.target.value)}>
                    {accounts.length > 0 ? accounts.map((row) => (
                      <option key={row.id} value={row.id}>{formatExecutionAccountOption(row)}</option>
                    )) : <option value="">{tGrid("noExecutionAccountsOption")}</option>}
                  </select>
                </label>
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
                  <select className="input" value={marginMode} disabled={selectedTemplate.marginPolicy !== "AUTO_ALLOWED"} onChange={(event) => setMarginMode(event.target.value === "AUTO" ? "AUTO" : "MANUAL")}>
                    <option value="MANUAL">{tGrid("marginModeManual")}</option>
                    <option value="AUTO">{tGrid("marginModeAuto")}</option>
                  </select>
                </label>
              </div>

              {accounts.length === 0 ? (
                <div className="card" style={{ padding: 12, borderColor: "var(--warn)" }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{tGrid("noExecutionAccountsTitle")}</div>
                  <div className="settingsMutedText" style={{ marginBottom: 8 }}>{tGrid("noExecutionAccountsBody")}</div>
                  <div className="settingsMutedText" style={{ marginBottom: 10 }}>
                    {tGrid("noExecutionAccountsHint", { exchanges: [...allowedGridExchanges].join(", ") })}
                  </div>
                  <Link href={withLocalePath("/settings", locale)} className="btn">{tGrid("openExchangeSettings")}</Link>
                </div>
              ) : null}

              <div className="card" style={{ padding: 12, borderColor: previewInsufficient ? "#ef4444" : liqRiskActive ? "#f59e0b" : "var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <strong>{tGrid("previewTitle")}</strong>
                  {previewLoading ? <span className="badge badgeWarn">{tGrid("previewUpdating")}</span> : previewInsufficient ? <span className="badge badgeDanger">{tGrid("previewInsufficient")}</span> : preview ? <span className={`badge ${liqRiskActive ? "badgeWarn" : "badgeOk"}`}>{liqRiskActive ? tGrid("previewLiqRisk") : tGrid("previewReady")}</span> : <span className="badge">{tGrid("previewWaiting")}</span>}
                </div>
                <div className="settingsMutedText" style={{ marginBottom: 10 }}>{tGrid("previewOnlyHint")}</div>
                {preview ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
                    <div className="settingsMutedText">{tGrid("mark")}: <strong>{formatNumber(preview.markPrice, 4)}</strong></div>
                    <div className="settingsMutedText">{tGrid("minInvest")}: <strong>{formatNumber(preview.minInvestmentUSDT, 2)} {stablecoinLabel}</strong></div>
                    <div className="settingsMutedText">{tGrid("profitPerGridEstimate")}: <strong>{formatNumber(preview.profitPerGridEstimateUSDT ?? null, 4)} {stablecoinLabel}</strong></div>
                    <div className="settingsMutedText">{tGrid("marginMode")}: <strong>{preview.marginMode ?? marginMode}</strong></div>
                    <div className="settingsMutedText">{tGrid("liqLong")}: <strong>{formatNumber(preview.liq.liqEstimateLong, 2)}</strong></div>
                    <div className="settingsMutedText">{tGrid("liqShort")}: <strong>{formatNumber(preview.liq.liqEstimateShort, 2)}</strong></div>
                  </div>
                ) : null}
                {previewError ? <div className="settingsMutedText" style={{ color: "#f59e0b", marginTop: 8 }}>{previewError}</div> : null}
                {liqRiskActive && preview ? <div className="settingsMutedText" style={{ color: "#f59e0b", marginTop: 8 }}>{tGrid("liqRiskWarning", { actual: formatNumber(preview.liq.worstCaseLiqDistancePct, 2), min: formatNumber(preview.liq.liqDistanceMinPct, 2) })}</div> : null}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="btn" type="button" onClick={closeDrawer}>{tGrid("catalogClose")}</button>
                <button className="btn btnPrimary" type="submit" disabled={!canCreate}>
                  {creating ? tGrid("creating") : tGrid("catalogStart")}
                </button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

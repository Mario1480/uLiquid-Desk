"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost } from "../../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../../i18n/config";
import SymbolSearchSelect from "../../../../components/SymbolSearchSelect";
import type {
  ExchangeAccount,
  GridInstancePreviewResponse,
  GridMode,
  GridPriceMode,
  GridTemplate
} from "../../../../components/grid/types";
import {
  errMsg,
  formatNumber,
  isPerpCapable,
  readAllowedGridExchanges
} from "../../../../components/grid/utils";

type GridPilotAccess = {
  allowed: boolean;
  reason: "admin" | "allowlist" | "disabled" | "not_listed";
  scope: "global" | "user" | "workspace" | "none";
  provider?: "mock" | "hyperliquid_demo" | "hyperliquid";
  allowLiveHyperliquid?: boolean;
};

type UserTemplateMode = Extract<GridMode, "long" | "short" | "neutral">;

type SymbolItem = {
  symbol: string;
  tradable?: boolean;
};

type UserTemplateRequestPayload = {
  draftTemplate: {
    name?: string;
    description?: string | null;
    symbol: string;
    mode: UserTemplateMode;
    gridMode: GridPriceMode;
    lowerPrice: number;
    upperPrice: number;
    gridCount: number;
    leverage: number;
    tpDefaultPct?: number | null;
    slDefaultPrice?: number | null;
    creatorProfitSharePct: number;
  };
  previewInput: {
    exchangeAccountId: string;
    investUsd: number;
    extraMarginUsd: number;
    triggerPrice: null;
    tpPct: number | null;
    slPrice: number | null;
    marginMode: "AUTO";
    autoMarginEnabled: true;
    markPriceOverride: null;
  };
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

function formatSymbolForDisplay(symbol: string, stablecoinLabel: string): string {
  const normalized = String(symbol ?? "").trim().toUpperCase();
  if (!normalized) return "";
  return normalized.replace(/USDT$|USDC$/u, stablecoinLabel);
}

function optionalPositiveNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.NaN;
}

function isPreviewReady(preview: GridInstancePreviewResponse | null, previewLoading: boolean, previewError: string | null): boolean {
  if (!preview || previewLoading || previewError) return false;
  if (preview.allocation?.insufficient) return false;
  if (preview.status?.ready === false || preview.validation?.ready === false) return false;
  return true;
}

function previewCodeSummary(preview: GridInstancePreviewResponse | null): string {
  const codes = [
    ...(Array.isArray(preview?.validation?.blockingCodes) ? preview.validation?.blockingCodes ?? [] : []),
    ...(Array.isArray(preview?.status?.codes) ? preview.status?.codes ?? [] : [])
  ]
    .map((code) => String(code ?? "").trim())
    .filter(Boolean);
  return Array.from(new Set(codes)).join(", ");
}

export default function UserGridTemplateCreatePage() {
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const tGrid = useTranslations("grid.marketplace");
  const allowedGridExchanges = useMemo(() => readAllowedGridExchanges(), []);

  const [accounts, setAccounts] = useState<ExchangeAccount[]>([]);
  const [pilotAccess, setPilotAccess] = useState<GridPilotAccess | null>(null);
  const [exchangeAccountId, setExchangeAccountId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<SymbolItem[]>([]);
  const [symbolsLoading, setSymbolsLoading] = useState(false);
  const [symbolsError, setSymbolsError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [mode, setMode] = useState<UserTemplateMode>("neutral");
  const [gridMode, setGridMode] = useState<GridPriceMode>("arithmetic");
  const [lowerPrice, setLowerPrice] = useState("90000");
  const [upperPrice, setUpperPrice] = useState("110000");
  const [gridCount, setGridCount] = useState("40");
  const [leverage, setLeverage] = useState("3");
  const [tpPct, setTpPct] = useState("");
  const [slPrice, setSlPrice] = useState("");
  const [previewInvestUsd, setPreviewInvestUsd] = useState("300");
  const [creatorProfitSharePct, setCreatorProfitSharePct] = useState("0");

  const [preview, setPreview] = useState<GridInstancePreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewInsufficient, setPreviewInsufficient] = useState(false);
  const previewRequestSeq = useRef(0);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === exchangeAccountId) ?? null,
    [accounts, exchangeAccountId]
  );
  const stablecoinLabel = usesHyperliquidMarketData(selectedAccount) ? "USDC" : "USDT";
  const previewReady = isPreviewReady(preview, previewLoading, previewError);
  const blockedCodes = previewCodeSummary(preview);
  const canSave = Boolean(name.trim() && exchangeAccountId && previewReady && !saving);
  const symbolOptions = useMemo(() => {
    const normalized = symbol.trim().toUpperCase();
    const options = symbols.map((item) => ({
      ...item,
      label: formatSymbolForDisplay(item.symbol, stablecoinLabel)
    }));
    if (!normalized || options.some((item) => item.symbol === normalized)) return options;
    return [
      {
        symbol: normalized,
        label: formatSymbolForDisplay(normalized, stablecoinLabel),
        meta: symbolsError ? tGrid("templateCreateSymbolsLoadFailed") : null
      },
      ...options
    ];
  }, [stablecoinLabel, symbol, symbols, symbolsError, tGrid]);

  function buildPayload(requireName: boolean): { payload: UserTemplateRequestPayload | null; error: string | null } {
    const nameValue = name.trim();
    const symbolValue = symbol.trim().toUpperCase();
    const lower = Number(lowerPrice);
    const upper = Number(upperPrice);
    const grids = Number(gridCount);
    const leverageValue = Number(leverage);
    const invest = Number(previewInvestUsd);
    const profitShare = Number(creatorProfitSharePct);
    const tpValue = optionalPositiveNumber(tpPct);
    const slValue = optionalPositiveNumber(slPrice);
    const optionalExitInvalid = (
      (typeof tpValue === "number" && Number.isNaN(tpValue))
      || (typeof slValue === "number" && Number.isNaN(slValue))
    );

    if (requireName && !nameValue) return { payload: null, error: tGrid("templateCreateNameRequired") };
    if (!symbolValue || !exchangeAccountId) return { payload: null, error: tGrid("templateCreateInvalidNumber") };
    if (
      !Number.isFinite(lower) || lower <= 0
      || !Number.isFinite(upper) || upper <= 0
      || !Number.isInteger(grids) || grids < 2 || grids > 500
      || !Number.isInteger(leverageValue) || leverageValue < 1 || leverageValue > 125
      || !Number.isFinite(invest) || invest <= 0
      || !Number.isFinite(profitShare) || profitShare < 0 || profitShare > 25
      || optionalExitInvalid
    ) {
      return { payload: null, error: tGrid("templateCreateInvalidNumber") };
    }
    if (upper <= lower) return { payload: null, error: tGrid("templateCreateInvalidRange") };

    const draftTemplate: UserTemplateRequestPayload["draftTemplate"] = {
      symbol: symbolValue,
      mode,
      gridMode,
      lowerPrice: lower,
      upperPrice: upper,
      gridCount: Math.trunc(grids),
      leverage: Math.trunc(leverageValue),
      tpDefaultPct: tpValue,
      slDefaultPrice: slValue,
      creatorProfitSharePct: Number(profitShare.toFixed(2))
    };
    if (nameValue) draftTemplate.name = nameValue;
    const descriptionValue = description.trim();
    draftTemplate.description = descriptionValue ? descriptionValue : null;

    return {
      payload: {
        draftTemplate,
        previewInput: {
          exchangeAccountId,
          investUsd: invest,
          extraMarginUsd: 0,
          triggerPrice: null,
          tpPct: tpValue,
          slPrice: slValue,
          marginMode: "AUTO",
          autoMarginEnabled: true,
          markPriceOverride: null
        }
      },
      error: null
    };
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [accountResponse, pilotResponse] = await Promise.all([
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
      setPilotAccess(pilotResponse ?? null);
      setAccounts(accountItems);
      setExchangeAccountId((previous) => previous && accountItems.some((row) => row.id === previous) ? previous : (accountItems[0]?.id ?? ""));
    } catch (loadError) {
      setError(errMsg(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadSymbols() {
      if (!exchangeAccountId) {
        setSymbols([]);
        setSymbolsError(null);
        setSymbolsLoading(false);
        return;
      }
      setSymbolsLoading(true);
      setSymbolsError(null);
      try {
        const response = await apiGet<{ items: SymbolItem[]; defaultSymbol?: string | null }>(
          `/api/symbols?exchangeAccountId=${encodeURIComponent(exchangeAccountId)}&marketType=perp`
        );
        if (!mounted) return;
        const items = Array.isArray(response.items) ? response.items : [];
        setSymbols(items);
        setSymbol((previous) => {
          const normalized = previous.trim().toUpperCase();
          if (normalized && items.some((item) => item.symbol === normalized)) return normalized;
          return response.defaultSymbol ?? items.find((item) => item.tradable !== false)?.symbol ?? items[0]?.symbol ?? normalized;
        });
      } catch (symbolLoadError) {
        if (!mounted) return;
        setSymbols([]);
        setSymbolsError(errMsg(symbolLoadError));
      } finally {
        if (mounted) setSymbolsLoading(false);
      }
    }
    void loadSymbols();
    return () => {
      mounted = false;
    };
  }, [exchangeAccountId]);

  useEffect(() => {
    if (!exchangeAccountId) {
      setPreview(null);
      setPreviewError(null);
      setPreviewInsufficient(false);
      setPreviewLoading(false);
      return;
    }
    const { payload, error: validationError } = buildPayload(false);
    if (!payload) {
      setPreview(null);
      setPreviewError(validationError);
      setPreviewInsufficient(false);
      setPreviewLoading(false);
      return;
    }

    const requestId = ++previewRequestSeq.current;
    const timer = window.setTimeout(() => {
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
      void apiPost<GridInstancePreviewResponse>("/grid/templates/draft-preview", payload)
        .then((response) => {
          if (requestId !== previewRequestSeq.current) return;
          setPreview(response);
          setPreviewError(null);
          setPreviewInsufficient(Boolean(response.allocation?.insufficient || response.status?.ready === false || response.validation?.ready === false));
        })
        .catch((previewLoadError) => {
          if (requestId !== previewRequestSeq.current) return;
          if (previewLoadError instanceof ApiError && previewLoadError.status === 403 && previewLoadError.payload?.error === "grid_hyperliquid_pilot_required") {
            setPreview(null);
            setPreviewError(tGrid("pilotRequired"));
            setPreviewInsufficient(false);
            return;
          }
          setPreview(null);
          setPreviewError(errMsg(previewLoadError));
          setPreviewInsufficient(false);
        })
        .finally(() => {
          if (requestId === previewRequestSeq.current) setPreviewLoading(false);
        });
    }, 450);

    return () => window.clearTimeout(timer);
  }, [
    creatorProfitSharePct,
    description,
    exchangeAccountId,
    gridCount,
    gridMode,
    leverage,
    lowerPrice,
    mode,
    pilotAccess,
    previewInvestUsd,
    selectedAccount,
    slPrice,
    stablecoinLabel,
    symbol,
    tGrid,
    tpPct,
    upperPrice
  ]);

  async function saveTemplate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const { payload, error: validationError } = buildPayload(true);
    if (!payload) {
      setError(validationError);
      return;
    }
    if (!previewReady) {
      setError(previewInsufficient ? tGrid("templateCreatePreviewBlocked") : tGrid("templateCreatePreviewRequired"));
      return;
    }

    setSaving(true);
    try {
      const created = await apiPost<GridTemplate>("/grid/templates", payload);
      setNotice(tGrid("templateCreateCreated", { name: created.name }));
      router.push(`${withLocalePath("/bots/catalog", locale)}?ownOnly=true`);
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.status === 409 && saveError.payload?.error === "grid_template_name_version_exists") {
        setError(tGrid("templateCreateDuplicateName"));
      } else if (saveError instanceof ApiError && saveError.status === 400 && saveError.payload?.error === "grid_template_preview_not_ready") {
        setError(tGrid("templateCreatePreviewBlocked"));
      } else {
        setError(errMsg(saveError));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="botsPage gridCatalogPage">
      <section className="card gridCatalogHero">
        <div className="gridCatalogHeroCopy">
          <div className="gridCatalogHeroText">
            <h1 className="gridCatalogHeroTitle">{tGrid("templateCreateTitle")}</h1>
            <p className="gridCatalogHeroSubtitle">{tGrid("templateCreateSubtitle")}</p>
          </div>
          <div className="gridCatalogHeroBadges">
            <span className="badge">{tGrid("templateCreateAutoMarginBadge")}</span>
            <span className="badge">{tGrid("templateCreateConservativeBadge")}</span>
          </div>
        </div>
        <div className="gridCatalogHeroActions">
          <Link href={withLocalePath("/bots/catalog", locale)} className="btn">{tGrid("templateCreateBack")}</Link>
        </div>
      </section>

      {error ? <div className="card gridCatalogStatus gridCatalogStatusError">{error}</div> : null}
      {notice ? <div className="card gridCatalogStatus gridCatalogStatusSuccess">{notice}</div> : null}

      <form onSubmit={saveTemplate} className="gridTemplateCreateLayout">
        <section className="card gridCatalogSection">
          <div className="gridCatalogSectionHeader">
            <div>
              <strong className="gridCatalogSectionTitle">{tGrid("templateCreateBasicTitle")}</strong>
              <div className="gridCatalogSectionHint">{tGrid("templateCreateProfitshareHint")}</div>
            </div>
          </div>
          <div className="gridCatalogLaunchGrid">
            <label className="gridCatalogField">
              {tGrid("templateCreateName")}
              <input className="input" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="gridCatalogField">
              {tGrid("templateCreateSymbol")}
              <SymbolSearchSelect
                value={symbol}
                onChange={setSymbol}
                options={symbolOptions}
                loading={symbolsLoading}
                loadingLabel={tGrid("templateCreateSymbolsLoading")}
                emptyLabel={tGrid("templateCreateSymbolsEmpty")}
                searchPlaceholder={tGrid("templateCreateSymbolSearchPlaceholder")}
                restrictedLabel={tGrid("templateCreateSymbolRestricted")}
                required
              />
              {symbolsError ? (
                <span>{tGrid("templateCreateSymbolsLoadFailed")}: {symbolsError}</span>
              ) : null}
            </label>
            <label className="gridCatalogField gridTemplateCreateFullSpan">
              {tGrid("templateCreateDescription")}
              <textarea className="input" rows={3} maxLength={280} value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
            <label className="gridCatalogField">
              {tGrid("templateCreateMode")}
              <select className="input" value={mode} onChange={(event) => setMode(event.target.value as UserTemplateMode)}>
                <option value="long">Long</option>
                <option value="short">Short</option>
                <option value="neutral">Neutral</option>
              </select>
            </label>
            <label className="gridCatalogField">
              {tGrid("templateCreateGridMode")}
              <select className="input" value={gridMode} onChange={(event) => setGridMode(event.target.value as GridPriceMode)}>
                <option value="arithmetic">Arithmetic</option>
                <option value="geometric">Geometric</option>
              </select>
            </label>
            <label className="gridCatalogField">
              {tGrid("templateCreateLowerPrice")}
              <input className="input" type="number" min="0" step="0.0001" value={lowerPrice} onChange={(event) => setLowerPrice(event.target.value)} />
            </label>
            <label className="gridCatalogField">
              {tGrid("templateCreateUpperPrice")}
              <input className="input" type="number" min="0" step="0.0001" value={upperPrice} onChange={(event) => setUpperPrice(event.target.value)} />
            </label>
            <label className="gridCatalogField">
              {tGrid("templateCreateGridCount")}
              <input className="input" type="number" min="2" max="500" step="1" value={gridCount} onChange={(event) => setGridCount(event.target.value)} />
            </label>
            <label className="gridCatalogField">
              {tGrid("templateCreateLeverage")}
              <input className="input" type="number" min="1" max="125" step="1" value={leverage} onChange={(event) => setLeverage(event.target.value)} />
            </label>
            <label className="gridCatalogField">
              {tGrid("tpPct")}
              <input className="input" type="number" min="0" step="0.01" value={tpPct} onChange={(event) => setTpPct(event.target.value)} />
            </label>
            <label className="gridCatalogField">
              {tGrid("slPrice")}
              <input className="input" type="number" min="0" step="0.01" value={slPrice} onChange={(event) => setSlPrice(event.target.value)} />
            </label>
            <label className="gridCatalogField">
              {tGrid("templateCreatePreviewInvest")}
              <input className="input" type="number" min="1" step="0.01" value={previewInvestUsd} onChange={(event) => setPreviewInvestUsd(event.target.value)} />
            </label>
            <label className="gridCatalogField">
              {tGrid("templateCreateProfitshare")}
              <input className="input" type="number" min="0" max="25" step="0.01" value={creatorProfitSharePct} onChange={(event) => setCreatorProfitSharePct(event.target.value)} />
            </label>
          </div>
        </section>

        <aside className="card gridCatalogPreview gridTemplateCreatePreviewPanel">
          <div className="gridCatalogPreviewHeader">
            <div>
              <strong>{tGrid("templateCreatePreviewTitle")}</strong>
              <div className="gridCatalogSectionHint">{tGrid("previewSectionHint")}</div>
            </div>
            {previewLoading ? (
              <span className="badge badgeWarn">{tGrid("previewUpdating")}</span>
            ) : previewInsufficient ? (
              <span className="badge badgeDanger">{tGrid("previewInsufficient")}</span>
            ) : previewReady ? (
              <span className="badge badgeOk">{tGrid("previewReady")}</span>
            ) : (
              <span className="badge">{tGrid("previewWaiting")}</span>
            )}
          </div>

          <label className="gridCatalogField">
            {usesHyperliquidMarketData(selectedAccount) ? tGrid("vaultAccount") : tGrid("templateCreateExchangeAccount")}
            <select className="input" value={exchangeAccountId} onChange={(event) => setExchangeAccountId(event.target.value)} disabled={loading}>
              {accounts.length > 0 ? accounts.map((row) => (
                <option key={row.id} value={row.id}>{formatExecutionAccountOption(row)}</option>
              )) : <option value="">{loading ? tGrid("loadingTemplates") : tGrid("noExecutionAccountsOption")}</option>}
            </select>
          </label>

          {accounts.length === 0 && !loading ? (
            <div className="card gridCatalogCallout gridCatalogCalloutWarn">
              <div className="gridCatalogCalloutTitle">{tGrid("noExecutionAccountsTitle")}</div>
              <div className="gridCatalogCalloutBody">{tGrid("noExecutionAccountsBody")}</div>
              <div className="gridCatalogCalloutBody">
                {tGrid("noExecutionAccountsHint", { exchanges: [...allowedGridExchanges].join(", ") })}
              </div>
              <Link href={withLocalePath("/settings", locale)} className="btn">{tGrid("openExchangeSettings")}</Link>
            </div>
          ) : null}

          {pilotAccess?.provider === "hyperliquid_demo" && usesHyperliquidMarketData(selectedAccount) ? (
            <div className="gridCatalogPreviewHint">{tGrid("pilotBadge")}</div>
          ) : null}

          <section className="gridCatalogPreviewSummaryGrid">
            <div className="card gridCatalogStatCard">
              <strong className="gridCatalogStatLabel">{replaceStablecoinUnit(tGrid("investTotalBudget"), stablecoinLabel)}</strong>
              <div className="gridCatalogStatValue">{formatNumber(Number(previewInvestUsd), 2)} {stablecoinLabel}</div>
            </div>
            <div className="card gridCatalogStatCard">
              <strong className="gridCatalogStatLabel">{tGrid("marginMode")}</strong>
              <div className="gridCatalogStatValue">AUTO</div>
            </div>
          </section>

          {preview ? (
            <div className="gridCatalogPreviewGrid">
              <div className="gridCatalogPreviewMetric">{tGrid("mark")}: <strong>{formatNumber(preview.markPrice, 4)}</strong></div>
              <div className="gridCatalogPreviewMetric">{tGrid("minInvest")}: <strong>{formatNumber(preview.minInvestmentUSDT, 2)} {stablecoinLabel}</strong></div>
              <div className="gridCatalogPreviewMetric">{tGrid("gridAllocation")}: <strong>{formatNumber(preview.allocation.gridInvestUsd, 2)} {stablecoinLabel}</strong></div>
              <div className="gridCatalogPreviewMetric">{tGrid("marginAllocation")}: <strong>{formatNumber(preview.allocation.extraMarginUsd, 2)} {stablecoinLabel}</strong></div>
              <div className="gridCatalogPreviewMetric">{tGrid("targetLiqDistance")}: <strong>{formatNumber(preview.allocation.targetLiqDistancePct, 2)}%</strong></div>
              <div className="gridCatalogPreviewMetric">{tGrid("profitPerGridEstimate")}: <strong>{formatNumber(preview.profitPerGridEstimateUSDT ?? null, 4)} {stablecoinLabel}</strong></div>
              <div className="gridCatalogPreviewMetric">{tGrid("liqLong")}: <strong>{formatNumber(preview.liq.liqEstimateLong, 2)}</strong></div>
              <div className="gridCatalogPreviewMetric">{tGrid("liqShort")}: <strong>{formatNumber(preview.liq.liqEstimateShort, 2)}</strong></div>
            </div>
          ) : null}

          {previewError ? <div className="gridCatalogPreviewWarning gridCatalogPreviewError">{previewError}</div> : null}
          {previewInsufficient && blockedCodes ? (
            <div className="gridCatalogPreviewWarning">{tGrid("templateCreatePreviewBlockedCodes", { codes: blockedCodes })}</div>
          ) : null}

          <div className="gridCatalogActionRow">
            <div className="gridCatalogActionMeta">
              <div className="gridCatalogActionMetaLabel">{tGrid("templateCreateSave")}</div>
              <div className="gridCatalogActionMetaHint">
                {previewLoading
                  ? tGrid("previewUpdating")
                  : previewReady
                    ? tGrid("previewReady")
                    : previewInsufficient
                      ? tGrid("templateCreatePreviewBlocked")
                      : tGrid("templateCreatePreviewRequired")}
              </div>
            </div>
            <button className="btn btnPrimary" type="submit" disabled={!canSave}>
              {saving ? tGrid("templateCreateSaving") : tGrid("templateCreateSave")}
            </button>
          </div>
        </aside>
      </form>
    </div>
  );
}

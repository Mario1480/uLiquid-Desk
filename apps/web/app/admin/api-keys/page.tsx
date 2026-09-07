"use client";
import { DeskBadge } from "@/components/desk/DeskBadge";

import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSelect } from "@/components/desk/DeskSelect";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost, apiPut } from "../../../lib/api";
import AdminActionButton from "../_components/AdminActionButton";
import AdminConfirmDialog from "../_components/AdminConfirmDialog";
import AdminNotice from "../_components/AdminNotice";
import AdminPageHeader from "../_components/AdminPageHeader";

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

type AiModelClass = "utility" | "standard" | "analysis" | "deep";
type AiModelRouting = Record<AiModelClass, string>;
const AI_MODEL_CLASSES: readonly AiModelClass[] = ["utility", "standard", "analysis", "deep"];
const DEFAULT_AI_MODEL_ROUTING: AiModelRouting = {
  utility: "gpt-5-nano",
  standard: "gpt-5.6-luna",
  analysis: "gpt-5.6-terra",
  deep: "gpt-5.6-sol"
};

type ApiKeysSettingsResponse = {
  aiProfiles?: {
    openai?: {
      aiBaseUrl?: string | null;
      aiModel?: string | null;
      aiApiKeyMasked?: string | null;
      hasAiApiKey?: boolean;
      saladRuntime?: {
        apiBaseUrl?: string | null;
        organization?: string | null;
        project?: string | null;
        container?: string | null;
      };
    };
    ollama?: {
      aiBaseUrl?: string | null;
      aiModel?: string | null;
      aiApiKeyMasked?: string | null;
      hasAiApiKey?: boolean;
      saladRuntime?: {
        apiBaseUrl?: string | null;
        organization?: string | null;
        project?: string | null;
        container?: string | null;
      };
    };
    vllm?: {
      aiBaseUrl?: string | null;
      aiModel?: string | null;
      aiApiKeyMasked?: string | null;
      hasAiApiKey?: boolean;
      saladRuntime?: {
        apiBaseUrl?: string | null;
        organization?: string | null;
        project?: string | null;
        container?: string | null;
      };
    };
  };
  aiApiKeyMasked?: string | null;
  hasAiApiKey?: boolean;
  aiProvider?: AiProvider | null;
  aiBaseUrl?: string | null;
  aiModel?: string | null;
  openaiApiKeyMasked?: string | null;
  hasOpenAiApiKey?: boolean;
  openaiModel?: string | null;
  effectiveAiProvider?: AiProvider;
  effectiveAiProviderSource?: "db" | "env" | "default";
  effectiveAiBaseUrl?: string;
  effectiveAiBaseUrlSource?: "db" | "env" | "default";
  effectiveAiModel?: string;
  effectiveAiModelSource?: "db" | "env" | "default";
  effectiveOpenaiModel?: string;
  effectiveOpenaiModelSource?: "db" | "env" | "default";
  effectiveOpenaiModelRouting?: AiModelRouting;
  effectiveOpenaiModelRoutingSources?: Record<AiModelClass, "db" | "default">;
  defaultOpenaiModelRouting?: AiModelRouting;
  modelOptions: string[];
  providerOptions?: string[];
  updatedAt: string | null;
  envOverride: boolean;
};

type AiProvider = "openai" | "ollama" | "vllm" | "disabled";
type AiProfileProvider = Exclude<AiProvider, "disabled">;
type ConfirmAction = "clearAi" | "stopSalad";
type AiProviderProfileState = {
  aiBaseUrl: string;
  aiModel: string;
  aiApiKeyMasked: string | null;
  hasAiApiKey: boolean;
  saladRuntime: { apiBaseUrl: string; organization: string; project: string; container: string };
};

type SaladRuntimeState =
  | "running"
  | "stopped"
  | "starting"
  | "stopping"
  | "error"
  | "unknown"
  | "healthy"
  | "unhealthy"
  | "skipped";

type SaladRuntimeResponse = {
  ok: boolean;
  state: SaladRuntimeState;
  checkedAt: string;
  latencyMs?: number;
  httpStatus?: number;
  message: string;
  source?: "env" | "db" | "none";
  target?: {
    apiBaseUrl?: string;
    organization?: string;
    project?: string;
    container?: string;
  };
  runtimeState?: "running" | "stopped" | "starting" | "stopping" | "error" | "unknown";
  error?: string;
};

type ApiKeyHealthResponse = {
  ok: boolean;
  status: "ok" | "missing_key" | "missing_model" | "error";
  source: "env" | "db" | "none";
  checkedAt: string;
  latencyMs?: number;
  httpStatus?: number;
  message: string;
  model?: string;
  provider?: string;
  baseUrl?: string;
};

const DEFAULT_SALAD_API_BASE_URL = "https://api.salad.com/api/public";

export default function AdminApiKeysPage() {
  const t = useTranslations("admin.apiKeys");
  const tCommon = useTranslations("admin.common");
  const [loading, setLoading] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [aiApiKey, setAiApiKey] = useState("");
  const [aiApiKeyMasked, setAiApiKeyMasked] = useState<string | null>(null);
  const [hasAiApiKey, setHasAiApiKey] = useState(false);
  const [aiProvider, setAiProvider] = useState<AiProvider>("openai");
  const [aiProfiles, setAiProfiles] = useState<Record<AiProfileProvider, AiProviderProfileState>>({
    openai: {
      aiBaseUrl: "",
      aiModel: "",
      aiApiKeyMasked: null,
      hasAiApiKey: false,
      saladRuntime: {
        apiBaseUrl: DEFAULT_SALAD_API_BASE_URL,
        organization: "",
        project: "",
        container: ""
      }
    },
    ollama: {
      aiBaseUrl: "",
      aiModel: "",
      aiApiKeyMasked: null,
      hasAiApiKey: false,
      saladRuntime: {
        apiBaseUrl: DEFAULT_SALAD_API_BASE_URL,
        organization: "",
        project: "",
        container: ""
      }
    },
    vllm: {
      aiBaseUrl: "",
      aiModel: "",
      aiApiKeyMasked: null,
      hasAiApiKey: false,
      saladRuntime: {
        apiBaseUrl: DEFAULT_SALAD_API_BASE_URL,
        organization: "",
        project: "",
        container: ""
      }
    }
  });
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiModel, setAiModel] = useState<string>("");
  const [effectiveAiProvider, setEffectiveAiProvider] = useState<AiProvider>("openai");
  const [effectiveAiProviderSource, setEffectiveAiProviderSource] = useState<"db" | "env" | "default">("default");
  const [effectiveAiBaseUrl, setEffectiveAiBaseUrl] = useState<string>("https://api.openai.com/v1");
  const [effectiveAiBaseUrlSource, setEffectiveAiBaseUrlSource] = useState<"db" | "env" | "default">("default");
  const [effectiveAiModel, setEffectiveAiModel] = useState<string>("gpt-5.6-luna");
  const [effectiveAiModelSource, setEffectiveAiModelSource] = useState<"db" | "env" | "default">("default");
  const [providerOptions, setProviderOptions] = useState<string[]>(["openai"]);
  const [modelOptions, setModelOptions] = useState<string[]>([
    "gpt-5-nano",
    "gpt-5.6-luna",
    "gpt-5.6-terra",
    "gpt-5.6-sol"
  ]);
  const [openAiModelRouting, setOpenAiModelRouting] = useState<AiModelRouting>(DEFAULT_AI_MODEL_ROUTING);
  const [openAiModelRoutingSources, setOpenAiModelRoutingSources] = useState<Record<AiModelClass, "db" | "default">>({
    utility: "default",
    standard: "default",
    analysis: "default",
    deep: "default"
  });

  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [envOverride, setEnvOverride] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [health, setHealth] = useState<ApiKeyHealthResponse | null>(null);
  const [saladRuntimeConfig, setSaladRuntimeConfig] = useState<{
    apiBaseUrl: string;
    organization: string;
    project: string;
    container: string;
  }>({
    apiBaseUrl: DEFAULT_SALAD_API_BASE_URL,
    organization: "",
    project: "",
    container: ""
  });
  const [saladRuntimeStatus, setSaladRuntimeStatus] = useState<SaladRuntimeResponse | null>(null);
  const [saladActionLoading, setSaladActionLoading] = useState<
    "none" | "save" | "status" | "start" | "stop"
  >("none");
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmAction | null>(null);

  function applyApiKeysSettings(res: ApiKeysSettingsResponse) {
    const profiles = {
      openai: {
        aiBaseUrl: res.aiProfiles?.openai?.aiBaseUrl ?? "",
        aiModel: res.aiProfiles?.openai?.aiModel ?? "",
        aiApiKeyMasked: res.aiProfiles?.openai?.aiApiKeyMasked ?? res.openaiApiKeyMasked ?? null,
        hasAiApiKey:
          typeof res.aiProfiles?.openai?.hasAiApiKey === "boolean"
            ? Boolean(res.aiProfiles?.openai?.hasAiApiKey)
            : Boolean(res.hasOpenAiApiKey),
        saladRuntime: {
          apiBaseUrl: res.aiProfiles?.openai?.saladRuntime?.apiBaseUrl ?? DEFAULT_SALAD_API_BASE_URL,
          organization: res.aiProfiles?.openai?.saladRuntime?.organization ?? "",
          project: res.aiProfiles?.openai?.saladRuntime?.project ?? "",
          container: res.aiProfiles?.openai?.saladRuntime?.container ?? ""
        }
      },
      ollama: {
        aiBaseUrl: res.aiProfiles?.ollama?.aiBaseUrl ?? "",
        aiModel: res.aiProfiles?.ollama?.aiModel ?? "",
        aiApiKeyMasked: res.aiProfiles?.ollama?.aiApiKeyMasked ?? null,
        hasAiApiKey: Boolean(res.aiProfiles?.ollama?.hasAiApiKey),
        saladRuntime: {
          apiBaseUrl: res.aiProfiles?.ollama?.saladRuntime?.apiBaseUrl ?? DEFAULT_SALAD_API_BASE_URL,
          organization: res.aiProfiles?.ollama?.saladRuntime?.organization ?? "",
          project: res.aiProfiles?.ollama?.saladRuntime?.project ?? "",
          container: res.aiProfiles?.ollama?.saladRuntime?.container ?? ""
        }
      },
      vllm: {
        aiBaseUrl: res.aiProfiles?.vllm?.aiBaseUrl ?? "",
        aiModel: res.aiProfiles?.vllm?.aiModel ?? "",
        aiApiKeyMasked: res.aiProfiles?.vllm?.aiApiKeyMasked ?? null,
        hasAiApiKey: Boolean(res.aiProfiles?.vllm?.hasAiApiKey),
        saladRuntime: {
          apiBaseUrl: res.aiProfiles?.vllm?.saladRuntime?.apiBaseUrl ?? DEFAULT_SALAD_API_BASE_URL,
          organization: res.aiProfiles?.vllm?.saladRuntime?.organization ?? "",
          project: res.aiProfiles?.vllm?.saladRuntime?.project ?? "",
          container: res.aiProfiles?.vllm?.saladRuntime?.container ?? ""
        }
      }
    };
    setAiProfiles(profiles);
    const selectedProvider = (res.aiProvider ?? "openai") as AiProvider;
    const selectedProfileProvider: AiProfileProvider =
      selectedProvider === "ollama" || selectedProvider === "vllm" ? selectedProvider : "openai";
    const selectedProfile = profiles[selectedProfileProvider];
    setSaladRuntimeConfig({
      apiBaseUrl: selectedProfile.saladRuntime.apiBaseUrl || DEFAULT_SALAD_API_BASE_URL,
      organization: selectedProfile.saladRuntime.organization,
      project: selectedProfile.saladRuntime.project,
      container: selectedProfile.saladRuntime.container
    });

    const resolvedAiApiKeyMasked = selectedProfile.aiApiKeyMasked ?? res.aiApiKeyMasked ?? null;
    const resolvedHasAiApiKey = selectedProfile.hasAiApiKey || Boolean(res.hasAiApiKey);

    setAiApiKeyMasked(resolvedAiApiKeyMasked);
    setHasAiApiKey(resolvedHasAiApiKey);
    setUpdatedAt(res.updatedAt ?? null);
    setEnvOverride(Boolean(res.envOverride));

    setAiProvider(selectedProvider);
    setAiBaseUrl(res.aiBaseUrl ?? selectedProfile.aiBaseUrl ?? "");
    setAiModel(res.aiModel ?? selectedProfile.aiModel ?? res.openaiModel ?? "");

    setEffectiveAiProvider((res.effectiveAiProvider ?? "openai") as AiProvider);
    setEffectiveAiProviderSource(res.effectiveAiProviderSource ?? "default");
    setEffectiveAiBaseUrl(res.effectiveAiBaseUrl ?? "https://api.openai.com/v1");
    setEffectiveAiBaseUrlSource(res.effectiveAiBaseUrlSource ?? "default");
    setEffectiveAiModel(res.effectiveAiModel ?? res.effectiveOpenaiModel ?? "gpt-5.6-luna");
    setEffectiveAiModelSource(res.effectiveAiModelSource ?? res.effectiveOpenaiModelSource ?? "default");
    setOpenAiModelRouting(res.effectiveOpenaiModelRouting ?? res.defaultOpenaiModelRouting ?? DEFAULT_AI_MODEL_ROUTING);
    setOpenAiModelRoutingSources(res.effectiveOpenaiModelRoutingSources ?? {
      utility: "default",
      standard: "default",
      analysis: "default",
      deep: "default"
    });

    setModelOptions(
      Array.isArray(res.modelOptions) && res.modelOptions.length > 0
        ? res.modelOptions
        : ["gpt-5-nano", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]
    );

    setProviderOptions(
      Array.isArray(res.providerOptions) && res.providerOptions.length > 0
        ? res.providerOptions
        : ["openai"]
    );
  }

  async function loadHealthStatus() {
    setHealthLoading(true);
    try {
      const res = await apiGet<ApiKeyHealthResponse>("/admin/settings/api-keys/status");
      setHealth(res);
    } catch (e) {
      setHealth({
        ok: false,
        status: "error",
        source: "none",
        checkedAt: new Date().toISOString(),
        message: errMsg(e)
      });
    } finally {
      setHealthLoading(false);
    }
  }

  async function loadSaladRuntimeStatus() {
    setSaladActionLoading("status");
    try {
      const res = await apiGet<SaladRuntimeResponse>("/admin/settings/api-keys/salad-runtime/status");
      setSaladRuntimeStatus(res);
    } catch (e) {
      setSaladRuntimeStatus({
        ok: false,
        state: "error",
        checkedAt: new Date().toISOString(),
        message: errMsg(e)
      });
    } finally {
      setSaladActionLoading("none");
    }
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const me = await apiGet<any>("/auth/me");
      if (!(me?.isSuperadmin || me?.hasAdminBackendAccess)) {
        setIsSuperadmin(false);
        setError(t("messages.accessRequired"));
        return;
      }
      setIsSuperadmin(true);

      const res = await apiGet<ApiKeysSettingsResponse>("/admin/settings/api-keys");
      applyApiKeysSettings(res);
      setAiApiKey("");
      setSaladRuntimeStatus(null);
      await loadHealthStatus();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function saveAiKey() {
    const trimmed = aiApiKey.trim();
    if (!trimmed) {
      setError(t("messages.aiKeyRequired"));
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        aiProvider,
        aiApiKey: trimmed,
        clearAiApiKey: false
      });
      setAiApiKey("");
      applyApiKeysSettings(res);
      setNotice(t("messages.aiKeySaved"));
      await loadHealthStatus();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function clearAiKey() {
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        aiProvider,
        clearAiApiKey: true
      });
      setAiApiKey("");
      applyApiKeysSettings(res);
      setNotice(t("messages.aiKeyRemoved"));
      await loadHealthStatus();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function saveAiProviderAndBaseUrl() {
    setError(null);
    setNotice(null);
    try {
      const trimmedBaseUrl = aiBaseUrl.trim();
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        aiProvider,
        aiBaseUrl: trimmedBaseUrl || undefined,
        clearAiBaseUrl: !trimmedBaseUrl
      });
      applyApiKeysSettings(res);
      setNotice(t("messages.aiProviderSaved"));
      await loadHealthStatus();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function saveAiModel() {
    const trimmed = aiModel.trim();
    if (!trimmed) {
      setError(t("messages.aiModelRequired"));
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        aiProvider,
        aiModel: trimmed,
        clearAiModel: false
      });
      applyApiKeysSettings(res);
      setNotice(t("messages.aiModelSaved"));
      await loadHealthStatus();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function resetAiModel() {
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        aiProvider,
        clearAiModel: true
      });
      applyApiKeysSettings(res);
      setNotice(t("messages.aiModelReset"));
      await loadHealthStatus();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function saveOpenAiModelRouting() {
    if (AI_MODEL_CLASSES.some((modelClass) => !openAiModelRouting[modelClass].trim())) {
      setError(t("messages.aiModelRoutingRequired"));
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        aiProvider: "openai",
        openaiModelRouting: Object.fromEntries(
          AI_MODEL_CLASSES.map((modelClass) => [modelClass, openAiModelRouting[modelClass].trim()])
        )
      });
      applyApiKeysSettings(res);
      setNotice(t("messages.aiModelRoutingSaved"));
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function resetOpenAiModelRouting() {
    setError(null);
    setNotice(null);
    try {
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        aiProvider: "openai",
        clearOpenaiModelRouting: true
      });
      applyApiKeysSettings(res);
      setNotice(t("messages.aiModelRoutingReset"));
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function saveSaladRuntimeConfig() {
    setError(null);
    setNotice(null);
    setSaladActionLoading("save");
    try {
      const apiBaseUrl = saladRuntimeConfig.apiBaseUrl.trim();
      const organization = saladRuntimeConfig.organization.trim();
      const project = saladRuntimeConfig.project.trim();
      const container = saladRuntimeConfig.container.trim();
      const res = await apiPut<ApiKeysSettingsResponse>("/admin/settings/api-keys", {
        aiProvider,
        saladApiBaseUrl: apiBaseUrl || undefined,
        clearSaladApiBaseUrl: !apiBaseUrl,
        saladOrganization: organization || undefined,
        clearSaladOrganization: !organization,
        saladProject: project || undefined,
        clearSaladProject: !project,
        saladContainer: container || undefined,
        clearSaladContainer: !container
      });
      applyApiKeysSettings(res);
      setNotice(t("messages.saladRuntimeSaved"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaladActionLoading("none");
    }
  }

  async function startSaladRuntime() {
    setError(null);
    setNotice(null);
    setSaladActionLoading("start");
    try {
      const res = await apiPost<SaladRuntimeResponse>("/admin/settings/api-keys/salad-runtime/start");
      setSaladRuntimeStatus(res);
      setNotice(t("messages.saladRuntimeStarted"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaladActionLoading("none");
    }
  }

  async function stopSaladRuntime() {
    setError(null);
    setNotice(null);
    setSaladActionLoading("stop");
    try {
      const res = await apiPost<SaladRuntimeResponse>("/admin/settings/api-keys/salad-runtime/stop");
      setSaladRuntimeStatus(res);
      setNotice(t("messages.saladRuntimeStopped"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaladActionLoading("none");
    }
  }

  const hasSaladRuntimeConfig = Boolean(
    saladRuntimeConfig.organization.trim()
    || saladRuntimeConfig.project.trim()
    || saladRuntimeConfig.container.trim()
    || (
      saladRuntimeConfig.apiBaseUrl.trim()
      && saladRuntimeConfig.apiBaseUrl.trim() !== DEFAULT_SALAD_API_BASE_URL
    )
  );
  const showSaladRuntimeSection = false;
  const saladStatusBadgeClass =
    saladRuntimeStatus?.state === "running" || saladRuntimeStatus?.state === "healthy"
      ? "badgeOk"
      : saladRuntimeStatus?.state === "starting"
        || saladRuntimeStatus?.state === "stopping"
        || saladRuntimeStatus?.state === "skipped"
        ? "badgeWarn"
      : saladRuntimeStatus?.state === "stopped"
        ? "badge"
          : "badgeDanger";
  const saladActionBusy = saladActionLoading !== "none";
  const confirmDetails = pendingConfirm
    ? {
        clearAi: {
          title: t("removeStoredKey"),
          description: t("messages.confirmClearAi"),
          confirmLabel: t("removeStoredKey")
        },
        stopSalad: {
          title: t("ai.saladRuntime.stop"),
          description: t("messages.confirmStopSaladRuntime"),
          confirmLabel: t("ai.saladRuntime.stop")
        }
      }[pendingConfirm]
    : null;

  async function runConfirmedAction() {
    const action = pendingConfirm;
    setPendingConfirm(null);
    if (action === "clearAi") await clearAiKey();
    if (action === "stopSalad") await stopSaladRuntime();
  }

  return (
    <div className="adminPageStack">
      <AdminPageHeader
        eyebrow="Integrations"
        title={t("title")}
        description={t("subtitle")}
      />

      {loading ? <div className="settingsMutedText">{t("loading")}</div> : null}
      {error ? (
        <AdminNotice tone="danger">{error}</AdminNotice>
      ) : null}
      {notice ? (
        <AdminNotice tone="success">{notice}</AdminNotice>
      ) : null}

      {isSuperadmin ? (
        <>
          <DeskSurface dense><section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("ai.sectionTitle")}</h3>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              {t("storedKey")}: {hasAiApiKey ? t("yes") : t("no")}
              {aiApiKeyMasked ? ` · ${aiApiKeyMasked}` : ""}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              {t("lastUpdated")}: {updatedAt ? new Date(updatedAt).toLocaleString() : t("never")}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <DeskBadge
                className={`badge ${
                  health?.status === "ok"
                    ? "badgeOk"
                    : health?.status === "missing_key" || health?.status === "missing_model"
                      ? "badgeWarn"
                      : "badgeDanger"
                }`}
                title={health?.message ?? t("statusNotChecked")}
              >
                {t("ai.statusLabel")}: {" "}
                {healthLoading
                  ? t("checking")
                  : health?.status === "ok"
                    ? "OK"
                    : health?.status === "missing_key" || health?.status === "missing_model"
                      ? t("missingKey")
                      : t("errorStatus")}
              </DeskBadge>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {t("source")}: {health?.source ?? (envOverride ? "env" : hasAiApiKey ? "db" : "none")}
                {typeof health?.latencyMs === "number" ? ` · ${health.latencyMs}ms` : ""}
                {health?.checkedAt ? ` · ${t("checked")} ${new Date(health.checkedAt).toLocaleString()}` : ""}
              </span>
              <AdminActionButton icon="refresh" type="button" onClick={() => void loadHealthStatus()} loading={healthLoading}>
                {healthLoading ? t("checkingButton") : t("refreshStatus")}
              </AdminActionButton>
            </div>
            {health?.message ? (
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{health.message}</div>
            ) : null}

            <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ai.currentProvider")}</span>
              <div>{health?.provider ?? effectiveAiProvider}</div>
              <DeskBadge className={`badge ${effectiveAiProviderSource === "env" ? "badgeWarn" : effectiveAiProviderSource === "db" ? "badgeOk" : "badge"}`}>
                {effectiveAiProviderSource.toUpperCase()}
              </DeskBadge>
            </div>

            <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ai.currentBaseUrl")}</span>
              <div style={{ wordBreak: "break-all" }}>{health?.baseUrl ?? effectiveAiBaseUrl}</div>
              <DeskBadge className={`badge ${effectiveAiBaseUrlSource === "env" ? "badgeWarn" : effectiveAiBaseUrlSource === "db" ? "badgeOk" : "badge"}`}>
                {effectiveAiBaseUrlSource.toUpperCase()}
              </DeskBadge>
            </div>

            <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ai.providerLabel")}</span>
              <DeskSelect
                className="select"
                value={aiProvider}
                onChange={(e) => {
                  const nextProvider = e.target.value as AiProvider;
                  setAiProvider(nextProvider);
                  const profileProvider: AiProfileProvider =
                    nextProvider === "ollama" || nextProvider === "vllm" ? nextProvider : "openai";
                  const profile = aiProfiles[profileProvider];
                  setAiBaseUrl(profile.aiBaseUrl ?? "");
                  setAiModel(profile.aiModel ?? "");
                  setAiApiKeyMasked(profile.aiApiKeyMasked ?? null);
                  setHasAiApiKey(Boolean(profile.hasAiApiKey));
                  setSaladRuntimeConfig({
                    apiBaseUrl: profile.saladRuntime.apiBaseUrl || DEFAULT_SALAD_API_BASE_URL,
                    organization: profile.saladRuntime.organization,
                    project: profile.saladRuntime.project,
                    container: profile.saladRuntime.container
                  });
                }}
              >
                {providerOptions.map((provider) => (
                  <option key={provider} value={provider}>{provider}</option>
                ))}
              </DeskSelect>
            </label>

            <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ai.baseUrlLabel")}</span>
              <DeskInput
                className="input"
                type="text"
                placeholder="https://api.openai.com/v1"
                value={aiBaseUrl}
                onChange={(e) => setAiBaseUrl(e.target.value)}
              />
            </label>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <AdminActionButton icon="save" variant="primary" onClick={() => void saveAiProviderAndBaseUrl()}>
                {t("ai.providerSave")}
              </AdminActionButton>
            </div>

            <datalist id="ai-model-presets">
              {modelOptions.map((model) => <option key={model} value={model} />)}
            </datalist>

            {aiProvider === "openai" ? (
              <section className="adminAiModelRouting">
                <div className="settingsSectionHeader">
                  <div>
                    <h4>{t("ai.modelRouting.title")}</h4>
                    <p>{t("ai.modelRouting.description")}</p>
                  </div>
                </div>
                <div className="settingsTwoColGrid">
                  {AI_MODEL_CLASSES.map((modelClass) => (
                    <label className="settingsField" key={modelClass}>
                      <span className="settingsFieldLabel adminAiModelRoutingLabel">
                        <span>{t(`ai.modelRouting.classes.${modelClass}.title`)}</span>
                        <DeskBadge className={`badge ${openAiModelRoutingSources[modelClass] === "db" ? "badgeOk" : "badge"}`}>
                          {openAiModelRoutingSources[modelClass].toUpperCase()}
                        </DeskBadge>
                      </span>
                      <DeskInput
                        className="input"
                        type="text"
                        value={openAiModelRouting[modelClass]}
                        onChange={(event) => setOpenAiModelRouting((current) => ({ ...current, [modelClass]: event.target.value }))}
                        list="ai-model-presets"
                        placeholder={t("ai.modelPlaceholder")}
                      />
                      <small>{t(`ai.modelRouting.classes.${modelClass}.description`)}</small>
                    </label>
                  ))}
                </div>
                <div className="adminAiModelRoutingActions">
                  <AdminActionButton icon="save" variant="primary" onClick={() => void saveOpenAiModelRouting()}>
                    {t("ai.modelRouting.save")}
                  </AdminActionButton>
                  <AdminActionButton icon="reset" onClick={() => void resetOpenAiModelRouting()}>
                    {t("ai.modelRouting.reset")}
                  </AdminActionButton>
                </div>
              </section>
            ) : (
              <>
                <label className="settingsField">
                  <span className="settingsFieldLabel">{t("ai.modelLabel")}</span>
                  <DeskInput className="input" type="text" value={aiModel} onChange={(event) => setAiModel(event.target.value)} list="ai-model-presets" placeholder={t("ai.modelPlaceholder")} />
                </label>
                <div className="adminAiModelRoutingActions">
                  <AdminActionButton icon="save" variant="primary" onClick={() => void saveAiModel()}>{t("ai.modelSave")}</AdminActionButton>
                  <AdminActionButton icon="reset" onClick={() => void resetAiModel()}>{t("ai.modelReset")}</AdminActionButton>
                </div>
              </>
            )}

            {envOverride ? (
              <div style={{ fontSize: 12, color: "#f59e0b", marginBottom: 10 }}>{t("ai.envOverrideHint")}</div>
            ) : null}

            <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ai.newKey")}</span>
              <DeskInput
                className="input"
                type="password"
                placeholder="sk-..."
                value={aiApiKey}
                onChange={(e) => setAiApiKey(e.target.value)}
              />
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <AdminActionButton icon="key" variant="primary" onClick={() => void saveAiKey()}>
                {t("ai.save")}
              </AdminActionButton>
              <AdminActionButton icon="delete" variant="danger" onClick={() => setPendingConfirm("clearAi")} disabled={!hasAiApiKey}>
                {t("removeStoredKey")}
              </AdminActionButton>
            </div>

            {showSaladRuntimeSection ? (
              <section
                style={{
                  marginTop: 16,
                  paddingTop: 14,
                  borderTop: "1px solid rgba(255, 193, 7, 0.2)"
                }}
              >
                <div className="settingsSectionHeader" style={{ marginBottom: 8 }}>
                  <h4 style={{ margin: 0 }}>{t("ai.saladRuntime.sectionTitle")}</h4>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                  {t("ai.saladRuntime.hint")}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                  <DeskBadge className={`badge ${saladStatusBadgeClass}`}>
                    {t("ai.saladRuntime.statusLabel")}:{" "}
                    {saladActionLoading === "status"
                      ? t("checking")
                      : t(`ai.saladRuntime.states.${saladRuntimeStatus?.state ?? "unknown"}`)}
                  </DeskBadge>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    {saladRuntimeStatus?.checkedAt
                      ? `${t("checked")} ${new Date(saladRuntimeStatus.checkedAt).toLocaleString()}`
                      : t("statusNotChecked")}
                    {typeof saladRuntimeStatus?.latencyMs === "number"
                      ? ` · ${saladRuntimeStatus.latencyMs}ms`
                      : ""}
                  </span>
                </div>
                {saladRuntimeStatus?.message ? (
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                    {saladRuntimeStatus.message}
                    {saladRuntimeStatus.runtimeState
                      ? ` · ${t("ai.saladRuntime.runtimeStateLabel")}: ${t(`ai.saladRuntime.states.${saladRuntimeStatus.runtimeState}`)}`
                      : ""}
                  </div>
                ) : null}

                <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ai.saladRuntime.apiBaseUrlLabel")}</span>
                  <DeskInput
                    className="input"
                    type="text"
                    value={saladRuntimeConfig.apiBaseUrl}
                    placeholder={DEFAULT_SALAD_API_BASE_URL}
                    onChange={(e) =>
                      setSaladRuntimeConfig((prev) => ({
                        ...prev,
                        apiBaseUrl: e.target.value
                      }))
                    }
                  />
                </label>
                <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ai.saladRuntime.organizationLabel")}</span>
                  <DeskInput
                    className="input"
                    type="text"
                    value={saladRuntimeConfig.organization}
                    placeholder="your-organization"
                    onChange={(e) =>
                      setSaladRuntimeConfig((prev) => ({
                        ...prev,
                        organization: e.target.value
                      }))
                    }
                  />
                </label>
                <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ai.saladRuntime.projectLabel")}</span>
                  <DeskInput
                    className="input"
                    type="text"
                    value={saladRuntimeConfig.project}
                    placeholder="your-project"
                    onChange={(e) =>
                      setSaladRuntimeConfig((prev) => ({
                        ...prev,
                        project: e.target.value
                      }))
                    }
                  />
                </label>
                <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("ai.saladRuntime.containerLabel")}</span>
                  <DeskInput
                    className="input"
                    type="text"
                    value={saladRuntimeConfig.container}
                    placeholder="your-container"
                    onChange={(e) =>
                      setSaladRuntimeConfig((prev) => ({
                        ...prev,
                        container: e.target.value
                      }))
                    }
                  />
                </label>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <AdminActionButton
                    icon="save"
                    variant="primary"
                    onClick={() => void saveSaladRuntimeConfig()}
                    disabled={saladActionBusy}
                  >
                    {saladActionLoading === "save"
                      ? t("checkingButton")
                      : t("ai.saladRuntime.saveConfig")}
                  </AdminActionButton>
                  <AdminActionButton
                    icon="refresh"
                    type="button"
                    onClick={() => void loadSaladRuntimeStatus()}
                    disabled={saladActionBusy}
                  >
                    {saladActionLoading === "status"
                      ? t("checkingButton")
                      : t("ai.saladRuntime.refreshStatus")}
                  </AdminActionButton>
                  <AdminActionButton
                    icon="start"
                    type="button"
                    onClick={() => void startSaladRuntime()}
                    disabled={saladActionBusy}
                  >
                    {saladActionLoading === "start"
                      ? t("checkingButton")
                      : t("ai.saladRuntime.start")}
                  </AdminActionButton>
                  <AdminActionButton
                    icon="stop"
                    variant="danger"
                    type="button"
                    onClick={() => setPendingConfirm("stopSalad")}
                    disabled={saladActionBusy}
                  >
                    {saladActionLoading === "stop"
                      ? t("checkingButton")
                      : t("ai.saladRuntime.stop")}
                  </AdminActionButton>
                </div>
              </section>
            ) : null}
          </section></DeskSurface>

        </>
      ) : null}
      <AdminConfirmDialog
        open={Boolean(confirmDetails)}
        title={confirmDetails?.title ?? ""}
        description={confirmDetails?.description ?? ""}
        confirmLabel={confirmDetails?.confirmLabel ?? ""}
        loading={saladActionLoading === "stop"}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => void runConfirmedAction()}
      />
    </div>
  );
}

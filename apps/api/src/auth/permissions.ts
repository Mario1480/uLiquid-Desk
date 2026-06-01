import type { PermissionKey } from "../rbac.js";

export type PermissionRequirement = {
  any: PermissionKey[];
};

function cleanPath(path: string): string {
  const cleaned = String(path ?? "/").split("?")[0]?.replace(/\/+$/, "") || "/";
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

function orderPermissionFromBody(body: unknown): PermissionKey {
  const row = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const raw = String(
    row.orderType
    ?? row.type
    ?? row.kind
    ?? row.executionType
    ?? ""
  ).toLowerCase();
  if (raw.includes("market")) return "trading.manual_market";
  return "trading.manual_limit";
}

function any(...permissions: PermissionKey[]): PermissionRequirement {
  return { any: permissions };
}

export function resolvePermissionRequirementForRequest(
  method: string,
  path: string,
  body?: unknown
): PermissionRequirement | null {
  const verb = String(method ?? "GET").toUpperCase();
  const p = cleanPath(path);

  if (p === "/auth/me" || p === "/me" || p.startsWith("/auth/")) return null;
  if (p.startsWith("/admin/")) return null;

  if (p === "/settings/security") return any("settings.security");
  if (p === "/settings/alerts" || p.startsWith("/settings/alerts/")) {
    return verb === "GET" ? any("settings.security") : any("settings.security");
  }
  if (p === "/settings/risk") return any("bots.view");
  if (p.startsWith("/settings/risk/")) return any("risk.edit");
  if (p === "/settings/prediction-defaults") return any("presets.view");
  if (p === "/api/trading/settings") {
    return any("bots.view", "trading.manual_market", "trading.manual_limit");
  }

  if (p === "/dashboard/open-positions") {
    return any("trading.manual_market", "trading.manual_limit");
  }
  if (
    p === "/dashboard/layout"
    || p === "/dashboard/overview"
    || p === "/dashboard/performance"
    || p === "/dashboard/risk-analysis"
    || p === "/dashboard/alerts"
  ) {
    return any("bots.view", "exchange_keys.view_present", "trading.manual_market", "trading.manual_limit");
  }

  if (p === "/exchange-accounts") {
    return verb === "GET" ? any("exchange_keys.view_present") : any("exchange_keys.edit");
  }
  if (p.startsWith("/exchange-accounts/")) {
    return verb === "GET" ? any("exchange_keys.view_present") : any("exchange_keys.edit");
  }

  if (p === "/api/symbols") return any("bots.view", "trading.manual_market", "trading.manual_limit");
  if (p === "/api/account/summary" || p === "/api/trading/live-state" || p === "/api/market/candles") {
    return any("trading.manual_market", "trading.manual_limit");
  }
  if (p === "/api/account/leverage") return any("trading.manual_market");
  if (p === "/api/orders") return any(orderPermissionFromBody(body));
  if (p.startsWith("/api/orders/")) {
    if (p.endsWith("/edit")) return any("trading.manual_limit");
    return any("trading.manual_market", "trading.manual_limit");
  }
  if (p === "/api/positions") return any("trading.manual_market", "trading.manual_limit");
  if (p.startsWith("/api/positions/")) return any("trading.manual_market");

  if (p === "/settings/ai-prompts/own" || p === "/settings/ai-prompts/public") {
    return verb === "GET" ? any("presets.view") : any("presets.create");
  }
  if (p.startsWith("/settings/ai-prompts/own/")) {
    return verb === "DELETE" ? any("presets.delete") : any("presets.create");
  }
  if (p === "/settings/local-strategies" || p === "/settings/composite-strategies") {
    return any("presets.view");
  }

  if (p === "/grid/templates") return verb === "POST" ? any("presets.create") : any("presets.view");
  if (p === "/grid/templates/draft-preview") return any("presets.create");
  if (p === "/grid/templates/filters") return any("presets.view");
  if (/^\/grid\/templates\/[^/]+\/favorite$/.test(p)) {
    return verb === "DELETE" ? any("presets.view") : any("presets.apply");
  }
  if (/^\/grid\/templates\/[^/]+\/instance-preview$/.test(p)) return any("presets.view");
  if (/^\/grid\/templates\/[^/]+\/instances$/.test(p)) return any("bots.create");
  if (p === "/grid/instances" || /^\/grid\/instances\/[^/]+$/.test(p)) return any("bots.view");
  if (/^\/grid\/instances\/[^/]+\/(metrics|orders|fills|events)$/.test(p)) return any("bots.view");
  if (/^\/grid\/instances\/[^/]+\/risk$/.test(p)) return any("risk.edit");
  if (/^\/grid\/instances\/[^/]+\/(start|pause|resume|stop|end|cancel-provisioning)$/.test(p)) {
    return any("bots.start_pause_stop");
  }
  if (/^\/grid\/instances\/[^/]+\/(margin|claim|withdraw-profit)/.test(p)) {
    return any("bots.start_pause_stop");
  }

  if (p === "/bots" || p === "/bots/overview" || p === "/bots/prediction-sources") {
    return verb === "POST" ? any("bots.create") : any("bots.view");
  }
  if (/^\/bots\/[^/]+\/(start|stop|end)$/.test(p)) return any("bots.start_pause_stop");
  if (/^\/bots\/[^/]+\/(delete)$/.test(p) || (verb === "DELETE" && /^\/bots\/[^/]+$/.test(p))) {
    return any("bots.delete");
  }
  if (/^\/bots\/[^/]+\/vault\/(create|fund|claim-profit)$/.test(p)) return any("bots.start_pause_stop");
  if (/^\/bots\/[^/]+\/backtests$/.test(p)) {
    return verb === "POST" ? any("bots.edit_config") : any("bots.view");
  }
  if (p.startsWith("/bots/") || p.startsWith("/backtests/")) {
    return verb === "PUT" ? any("bots.edit_config") : any("bots.view");
  }

  return null;
}

export function hasPermissionRequirement(
  permissions: Record<string, unknown>,
  requirement: PermissionRequirement | null
): boolean {
  if (!requirement) return true;
  return requirement.any.some((permission) => permissions[permission] === true);
}

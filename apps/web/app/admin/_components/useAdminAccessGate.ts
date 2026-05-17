"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../../../lib/api";
import { adminErrMsg } from "./admin-client";

type AdminAccessState = {
  loading: boolean;
  error: string | null;
  hasAccess: boolean;
  isSuperadmin: boolean;
};

export function useAdminAccessGate(accessRequiredMessage = "Admin backend access required."): AdminAccessState {
  const [state, setState] = useState<AdminAccessState>({
    loading: true,
    error: null,
    hasAccess: false,
    isSuperadmin: false
  });

  useEffect(() => {
    let active = true;
    async function loadAccess() {
      try {
        const me = await apiGet<any>("/auth/me");
        const hasAccess = Boolean(me?.isSuperadmin || me?.hasAdminBackendAccess);
        if (!active) return;
        setState({
          loading: false,
          error: hasAccess ? null : accessRequiredMessage,
          hasAccess,
          isSuperadmin: Boolean(me?.isSuperadmin)
        });
      } catch (error) {
        if (!active) return;
        setState({
          loading: false,
          error: adminErrMsg(error),
          hasAccess: false,
          isSuperadmin: false
        });
      }
    }
    void loadAccess();
    return () => {
      active = false;
    };
  }, [accessRequiredMessage]);

  return state;
}

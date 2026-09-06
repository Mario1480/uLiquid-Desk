"use client";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { useEffect, useState } from "react";
import { AppIcon, type AppIconName } from "../../components/AppIcon";

type AdminNoticeTone = "info" | "success" | "warning" | "danger";

const NOTICE_ICON: Record<AdminNoticeTone, AppIconName> = {
  info: "detail",
  success: "check",
  warning: "alerts",
  danger: "alerts"
};

export default function AdminNotice({
  tone = "info",
  children,
  autoDismissMs,
  dismissible,
  dismissLabel = "Dismiss",
  onDismiss
}: {
  tone?: AdminNoticeTone;
  children: React.ReactNode;
  autoDismissMs?: number | false;
  dismissible?: boolean;
  dismissLabel?: string;
  onDismiss?: () => void;
}) {
  const [hidden, setHidden] = useState(false);
  const resolvedAutoDismissMs = autoDismissMs ?? (tone === "success" ? 5200 : false);
  const canDismiss = dismissible || Boolean(onDismiss) || Boolean(resolvedAutoDismissMs);

  useEffect(() => {
    setHidden(false);
  }, [children, tone]);

  useEffect(() => {
    if (!resolvedAutoDismissMs || resolvedAutoDismissMs <= 0) return undefined;
    const timeout = window.setTimeout(() => {
      if (onDismiss) {
        onDismiss();
      } else {
        setHidden(true);
      }
    }, resolvedAutoDismissMs);

    return () => window.clearTimeout(timeout);
  }, [children, onDismiss, resolvedAutoDismissMs, tone]);

  if (hidden) return null;

  return (
    <DeskSurface dense><div className={`adminNotice adminNotice${tone}${canDismiss ? " adminNoticeDismissible" : ""}`}>
      <AppIcon name={NOTICE_ICON[tone]} />
      <div>{children}</div>
      {canDismiss ? (
        <DeskButton
          aria-label={dismissLabel}
          className="adminNoticeDismiss"
          type="button"
          onClick={() => {
            if (onDismiss) {
              onDismiss();
            } else {
              setHidden(true);
            }
          }}
        >
          <AppIcon name="close" />
        </DeskButton>
      ) : null}
    </div></DeskSurface>
  );
}

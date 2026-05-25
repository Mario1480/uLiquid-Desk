"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AppIcon } from "../AppIcon";

type NoticeTone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

type NoticeProps = {
  tone?: NoticeTone;
  children: ReactNode;
  className?: string;
  role?: "alert" | "status" | "note";
  autoDismissMs?: number | false;
  dismissible?: boolean;
  dismissLabel?: string;
  onDismiss?: () => void;
};

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export default function Notice({
  tone = "neutral",
  children,
  className,
  role,
  autoDismissMs,
  dismissible,
  dismissLabel = "Dismiss",
  onDismiss
}: NoticeProps) {
  const [hidden, setHidden] = useState(false);
  const resolvedRole = role ?? (tone === "danger" ? "alert" : "status");
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
    <div className={cx("uiNotice", `uiNotice-${tone}`, canDismiss && "uiNoticeDismissible", className)} role={resolvedRole}>
      <div className="uiNoticeContent">{children}</div>
      {canDismiss ? (
        <button
          aria-label={dismissLabel}
          className="uiNoticeDismiss"
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
        </button>
      ) : null}
    </div>
  );
}

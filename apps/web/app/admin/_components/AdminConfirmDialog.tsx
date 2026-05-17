"use client";

import { AppIcon } from "../../components/AppIcon";

type AdminConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function AdminConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  loading = false,
  onCancel,
  onConfirm
}: AdminConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="adminConfirmOverlay" role="presentation">
      <div className="adminConfirmDialog" role="dialog" aria-modal="true" aria-labelledby="admin-confirm-title">
        <div className={`adminConfirmIcon adminConfirmIcon${tone}`}>
          <AppIcon name={tone === "danger" ? "alerts" : "check"} />
        </div>
        <div className="adminConfirmBody">
          <h3 id="admin-confirm-title">{title}</h3>
          <p>{description}</p>
        </div>
        <div className="adminConfirmActions">
          <button className="btn" type="button" onClick={onCancel} disabled={loading}>
            <AppIcon name="cancel" />
            {cancelLabel}
          </button>
          <button
            className={`btn ${tone === "danger" ? "btnStop" : "btnPrimary"}`}
            type="button"
            onClick={onConfirm}
            disabled={loading}
          >
            <AppIcon name={tone === "danger" ? "delete" : "confirm"} />
            {loading ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

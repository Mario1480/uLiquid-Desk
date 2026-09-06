"use client";

import { DeskButton } from "@/components/desk/DeskButton";
import { AppIcon } from "../../components/AppIcon";
import { useRef } from "react";
import { GlassAlertDialog, GlassAlertDialogContent, GlassAlertDialogTitle, GlassAlertDialogDescription, GlassAlertDialogCancel } from "@/components/einui/liquid-glass/glass-alert-dialog";

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
  const returnFocus = useRef<HTMLElement | null>(null);

  return (
    <GlassAlertDialog open={open} onOpenChange={(next) => { if (!next && !loading) onCancel(); }}>
      <GlassAlertDialogContent className="adminConfirmDialog ein-admin-confirm" onOpenAutoFocus={() => { if (document.activeElement instanceof HTMLElement) returnFocus.current = document.activeElement; }} onEscapeKeyDown={(event) => { if (loading) event.preventDefault(); }} onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus.current?.focus(); }}>
        <div className={`adminConfirmIcon adminConfirmIcon${tone}`}>
          <AppIcon name={tone === "danger" ? "alerts" : "check"} />
        </div>
        <div className="adminConfirmBody">
          <GlassAlertDialogTitle asChild><h3>{title}</h3></GlassAlertDialogTitle>
          <GlassAlertDialogDescription asChild><p>{description}</p></GlassAlertDialogDescription>
        </div>
        <div className="adminConfirmActions">
          <GlassAlertDialogCancel asChild><DeskButton className="btn" type="button" disabled={loading}>
            <AppIcon name="cancel" />
            {cancelLabel}
          </DeskButton></GlassAlertDialogCancel>
          <DeskButton
            className={`btn ${tone === "danger" ? "btnStop" : "btnPrimary"}`}
            type="button"
            onClick={onConfirm}
            disabled={loading}
          >
            <AppIcon name={tone === "danger" ? "delete" : "confirm"} />
            {loading ? "Working..." : confirmLabel}
          </DeskButton>
        </div>
      </GlassAlertDialogContent>
    </GlassAlertDialog>
  );
}

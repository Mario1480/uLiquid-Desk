"use client";

import { DeskButton } from "@/components/desk/DeskButton";
import type { ButtonHTMLAttributes } from "react";
import { AppIcon, type AppIconName } from "../../components/AppIcon";

type AdminActionButtonVariant = "secondary" | "primary" | "danger" | "start" | "pause";

const VARIANT_CLASS: Record<AdminActionButtonVariant, string> = {
  secondary: "",
  primary: "btnPrimary",
  danger: "btnStop",
  start: "btnStart",
  pause: "btnPause"
};

type AdminActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: AppIconName;
  variant?: AdminActionButtonVariant;
  loading?: boolean;
  loadingLabel?: string;
};

export default function AdminActionButton({
  icon,
  variant = "secondary",
  loading = false,
  loadingLabel,
  className = "",
  disabled,
  children,
  ...props
}: AdminActionButtonProps) {
  const variantClass = VARIANT_CLASS[variant];

  return (
    <DeskButton
      {...props}
      className={`btn ${variantClass} ${className}`.trim()}
      disabled={disabled || loading}
    >
      <AppIcon name={loading ? "refresh" : icon} className={loading ? "adminSpinIcon" : undefined} />
      {loading && loadingLabel ? loadingLabel : children}
    </DeskButton>
  );
}

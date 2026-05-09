import type { ReactNode } from "react";

type MetricTileTone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

type MetricTileProps = {
  label: ReactNode;
  value: ReactNode;
  meta?: ReactNode;
  tone?: MetricTileTone;
  className?: string;
};

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export default function MetricTile({
  label,
  value,
  meta,
  tone = "neutral",
  className
}: MetricTileProps) {
  return (
    <div className={cx("uiMetricTile", `uiMetricTile-${tone}`, className)}>
      <div className="uiMetricLabel">{label}</div>
      <div className="uiMetricValue">{value}</div>
      {meta ? <div className="uiMetricMeta">{meta}</div> : null}
    </div>
  );
}

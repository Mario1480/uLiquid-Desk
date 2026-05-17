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
  children
}: {
  tone?: AdminNoticeTone;
  children: React.ReactNode;
}) {
  return (
    <div className={`adminNotice adminNotice${tone}`}>
      <AppIcon name={NOTICE_ICON[tone]} />
      <div>{children}</div>
    </div>
  );
}

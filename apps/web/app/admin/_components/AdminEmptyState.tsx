import { DeskSurface } from "@/components/desk/DeskSurface";
export default function AdminEmptyState({
  title,
  description
}: {
  title: string;
  description?: string;
}) {
  return (
    <DeskSurface dense><div className="card adminEmptyState">
      <strong>{title}</strong>
      {description ? <div className="settingsMutedText">{description}</div> : null}
    </div></DeskSurface>
  );
}

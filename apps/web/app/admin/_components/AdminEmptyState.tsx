export default function AdminEmptyState({
  title,
  description
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="card adminEmptyState">
      <strong>{title}</strong>
      {description ? <div className="settingsMutedText">{description}</div> : null}
    </div>
  );
}

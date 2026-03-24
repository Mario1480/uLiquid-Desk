export default function AdminDetailSection({
  title,
  description,
  children
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card settingsSection adminDetailSection">
      <div className="settingsSectionHeader adminDetailSectionHeader">
        <h3 style={{ margin: 0 }}>{title}</h3>
        {description ? <div className="adminDetailSectionDescription">{description}</div> : null}
      </div>
      {children}
    </section>
  );
}

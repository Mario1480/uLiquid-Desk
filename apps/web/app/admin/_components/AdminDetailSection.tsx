export default function AdminDetailSection({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card settingsSection adminDetailSection">
      <div className="settingsSectionHeader">
        <h3 style={{ margin: 0 }}>{title}</h3>
      </div>
      {children}
    </section>
  );
}

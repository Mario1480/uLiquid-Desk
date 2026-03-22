type AdminStatsCardProps = {
  label: string;
  value: string | number;
  hint?: string;
};

export default function AdminStatsCard({ label, value, hint }: AdminStatsCardProps) {
  return (
    <article className="card adminStatsCard">
      <div className="adminStatsLabel">{label}</div>
      <div className="adminStatsValue">{value}</div>
      {hint ? <div className="adminStatsHint">{hint}</div> : null}
    </article>
  );
}

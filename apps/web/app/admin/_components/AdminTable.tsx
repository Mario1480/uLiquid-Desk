type AdminTableProps = {
  columns: string[];
  children: React.ReactNode;
  loading?: boolean;
  emptyMessage?: string;
};

export default function AdminTable({ columns, children, loading = false, emptyMessage }: AdminTableProps) {
  return (
    <div className="settingsSection adminTableWrap">
      <div className="adminTableScroller">
        <table className="adminTable">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length}>Loading...</td>
              </tr>
            ) : emptyMessage ? (
              <tr>
                <td colSpan={columns.length}>{emptyMessage}</td>
              </tr>
            ) : (
              children
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

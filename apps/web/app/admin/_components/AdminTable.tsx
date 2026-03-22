type AdminTableProps = {
  columns: string[];
  children: React.ReactNode;
};

export default function AdminTable({ columns, children }: AdminTableProps) {
  return (
    <div className="card adminTableWrap">
      <div className="adminTableScroller">
        <table className="adminTable">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

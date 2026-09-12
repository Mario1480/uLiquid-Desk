import { DeskSurface } from "@/components/desk/DeskSurface";
import { DeskTable } from "@/components/desk/DeskTable";
type AdminTableProps = {
  columns: string[];
  children: React.ReactNode;
  loading?: boolean;
  loadingLabel?: string;
  emptyMessage?: string;
};

export default function AdminTable({ columns, children, loading = false, loadingLabel = "Loading...", emptyMessage }: AdminTableProps) {
  return (
    <DeskSurface dense><div className="settingsSection adminTableWrap">
      <div className="adminTableScroller">
        <DeskTable className="adminTable">
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
                <td colSpan={columns.length}>{loadingLabel}</td>
              </tr>
            ) : emptyMessage ? (
              <tr>
                <td colSpan={columns.length}>{emptyMessage}</td>
              </tr>
            ) : (
              children
            )}
          </tbody>
        </DeskTable>
      </div>
    </div></DeskSurface>
  );
}

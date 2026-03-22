import AdminSectionNav from "../_components/AdminSectionNav";
import { SYSTEM_SECTION_NAV } from "../_components/admin-sections";

export default function AdminSystemLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="adminPageStack">
      <AdminSectionNav items={SYSTEM_SECTION_NAV} ariaLabel="System navigation" />
      {children}
    </div>
  );
}

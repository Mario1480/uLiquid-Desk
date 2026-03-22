import AdminSectionNav from "../_components/AdminSectionNav";
import { LICENSES_SECTION_NAV } from "../_components/admin-sections";

export default function AdminLicensesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="adminPageStack">
      <AdminSectionNav items={LICENSES_SECTION_NAV} ariaLabel="Licenses navigation" />
      {children}
    </div>
  );
}

import { DeskSurface } from "@/components/desk/DeskSurface";
export default function AdminFilterBar({ children }: { children: React.ReactNode }) {
  return <DeskSurface dense><div className="settingsSection adminFilterBar">{children}</div></DeskSurface>;
}

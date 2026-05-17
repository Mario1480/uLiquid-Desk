import { redirect } from "next/navigation";

export default function AdminStrategiesIndexPage() {
  redirect("/admin/strategies/local");
  return null;
}

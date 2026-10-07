import { redirect } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { WorkspaceShell } from "@/components/workspace-shell";
import { WorkspaceSettingsProvider } from "@/components/date-time";
import { getGeneralSettings } from "@/modules/auth/settings";
export const dynamic = "force-dynamic";
export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireUser().catch(()=>null);
  if (!actor) redirect("/login");
  const general = await getGeneralSettings();
  return <WorkspaceSettingsProvider settings={{ timezone: general.timezone, dateFormat: general.dateFormat }}><WorkspaceShell actor={actor} businessName={general.businessName} mock={process.env.WHATSAPP_MODE !== "cloud"}>{children}</WorkspaceShell></WorkspaceSettingsProvider>;
}

import { requireUser } from "@/lib/authorization";
import { getGeneralSettings } from "@/modules/auth/settings";
import { SettingsUI } from "@/modules/auth/settings-ui";
import "@/modules/auth/auth.css";

export default async function SettingsPage() {
  const actor = await requireUser();
  return <div className="account-page"><SettingsUI settings={await getGeneralSettings()} editable={actor.role === "ADMIN"} /></div>;
}

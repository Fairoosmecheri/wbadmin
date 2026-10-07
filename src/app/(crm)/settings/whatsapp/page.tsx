import { requireRole } from "@/lib/authorization";
import { whatsappStatus } from "@/modules/whatsapp/settings";
import { WhatsAppSettingsUI } from "@/modules/whatsapp/settings-ui";
export default async function WhatsAppSettingsPage() { const actor = await requireRole("ADMIN"); return <WhatsAppSettingsUI initial={JSON.parse(JSON.stringify(await whatsappStatus(actor)))} />; }

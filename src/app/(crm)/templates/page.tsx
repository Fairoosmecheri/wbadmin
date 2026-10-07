import { requireUser } from "@/lib/authorization";
import { TemplatesUI } from "@/modules/templates/templates-ui";
import { providerMode } from "@/modules/whatsapp/provider";
export default async function TemplatesPage() { const actor = await requireUser(); return <TemplatesUI canSync={actor.role !== "SALESMAN"} mock={providerMode() === "mock"} />; }

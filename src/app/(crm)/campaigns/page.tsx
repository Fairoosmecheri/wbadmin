import { requireRole } from "@/lib/authorization";
import { listCampaigns } from "@/modules/campaigns/service";
import CampaignsList from "@/modules/campaigns/list";
export default async function CampaignsPage() { const actor = await requireRole("ADMIN", "MANAGER"); const data = await listCampaigns({}, actor); return <CampaignsList initial={JSON.parse(JSON.stringify(data))}/>; }

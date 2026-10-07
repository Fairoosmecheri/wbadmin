import { notFound } from "next/navigation";
import { AppError } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { getCampaign, listRecipients } from "@/modules/campaigns/service";
import CampaignReport from "@/modules/campaigns/report";
export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireRole("ADMIN", "MANAGER"); const { id } = await params;
  const [campaign, recipients] = await Promise.all([getCampaign(id, actor), listRecipients(id, {}, actor)]).catch(error => { if (error instanceof AppError && error.status === 404) notFound(); throw error; });
  return <CampaignReport initial={JSON.parse(JSON.stringify(campaign))} initialRecipients={JSON.parse(JSON.stringify(recipients))}/>;
}

import { requireRole } from "@/lib/authorization";
import { campaignOptions, getCampaign } from "@/modules/campaigns/service";
import CampaignWizard from "@/modules/campaigns/wizard";
import { redirect } from "next/navigation";
export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const actor = await requireRole("ADMIN", "MANAGER"); const { draft: id } = await searchParams;
  const [options, draft] = await Promise.all([campaignOptions(actor), id ? getCampaign(id, actor) : undefined]);
  if (draft && draft.status !== "DRAFT") redirect(`/campaigns/${draft.id}`);
  return <CampaignWizard options={JSON.parse(JSON.stringify(options))} draft={draft ? JSON.parse(JSON.stringify(draft)) : undefined}/>;
}

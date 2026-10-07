import Link from "next/link";
import { CheckCircle2, Circle, ArrowUpRight } from "lucide-react";
import { requireRole } from "@/lib/authorization";
import { getSetupChecklist } from "@/modules/reports/service";
import { PageHeader } from "@/components/ui";
export default async function SetupPage() {
  await requireRole("ADMIN"); const checklist = await getSetupChecklist();
  return <><PageHeader title="A workspace that feels like yours" description="Get your team ready for better customer conversations."/><div className="card max-w-3xl"><div className="card-header"><h2>Getting started</h2><span className="badge">{checklist.filter(c=>c.complete).length} / {checklist.length} complete</span></div>{checklist.map(c=><Link href={c.href} key={c.href} className="flex items-center gap-4 p-5 border-b border-[#eff2ed] last:border-0 hover:bg-[#fafcf7]">{c.complete?<CheckCircle2 className="text-brand" size={23}/>:<Circle className="text-muted" size={23}/>}<div className="flex-1"><h3>{c.title}</h3><p className="text-muted text-xs mt-1">{c.detail}</p></div><ArrowUpRight size={17}/></Link>)}</div></>;
}

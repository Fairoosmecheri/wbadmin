import { requireUser } from "@/lib/authorization";
import { providerMode } from "@/modules/whatsapp/provider";
import { InboxUI } from "@/modules/conversations/inbox-ui";
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ customerId?: string; conversationId?: string; filter?: string }> }) { const actor = await requireUser(); const query = await searchParams; return <InboxUI role={actor.role} mock={providerMode() === "mock"} customerId={query.customerId} conversationId={query.conversationId} initialFilter={query.filter} />; }

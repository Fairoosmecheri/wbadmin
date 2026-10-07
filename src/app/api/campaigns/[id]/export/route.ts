import { handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { prisma } from "@/lib/db";
import { getCampaign, recipientWhere } from "@/modules/campaigns/service";
function csvCell(value: unknown) { let text = value == null ? "" : value instanceof Date ? value.toISOString() : String(value); if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; }
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const actor = await requireRole("ADMIN", "MANAGER"); const { id } = await context.params; await getCampaign(id, actor);
    const where = recipientWhere(id, Object.fromEntries(new URL(request.url).searchParams)); const encoder = new TextEncoder(); let cursor: string | undefined; let started = false;
    const stream = new ReadableStream<Uint8Array>({ async pull(controller) {
      try {
        if (!started) { controller.enqueue(encoder.encode("\uFEFFCustomer,Phone,Status,Sent,Delivered,Read,Replied,Classification,Failure,Order reference,Order value,Currency,Notes\r\n")); started = true; }
        const recipients = await prisma.campaignRecipient.findMany({ where, take: 500, orderBy: { id: "asc" }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { customer: { select: { businessName: true } } } });
        if (!recipients.length) { controller.close(); return; }
        controller.enqueue(encoder.encode(recipients.map(r => { const metadata = r.conversionMetadata as Record<string, unknown> | null; return [r.customer.businessName, r.phone, r.status, r.sentAt, r.deliveredAt, r.readAt, r.repliedAt, r.responseClassification, r.failureReason, metadata?.orderReference, metadata?.orderValue, metadata?.currency, metadata?.notes].map(csvCell).join(","); }).join("\r\n") + "\r\n"));
        cursor = recipients.at(-1)!.id;
      } catch (error) { controller.error(error); }
    } });
    return new Response(stream, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="campaign-results.csv"`, "Cache-Control": "no-store" } });
  }, request);
}

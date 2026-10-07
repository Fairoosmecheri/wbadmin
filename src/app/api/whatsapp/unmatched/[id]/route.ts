import { z } from "zod";
import { handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { linkUnmatchedContact } from "@/modules/whatsapp/settings";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return handleApi(async () => {
  const actor = await requireRole("ADMIN", "MANAGER"); const { customerId } = z.object({ customerId: z.string().min(1).optional() }).parse(await request.json());
  return Response.json(await linkUnmatchedContact(actor, (await context.params).id, customerId));
}, request); }

import { z } from "zod";
import { handleApi } from "@/lib/api";
import { requireUser } from "@/lib/authorization";
import { listConversations, startConversation } from "@/modules/conversations/service";
export async function GET(request: Request) { return handleApi(async () => Response.json(await listConversations(await requireUser(), new URL(request.url).searchParams)), request); }
export async function POST(request: Request) { return handleApi(async () => { const actor = await requireUser(); const body = z.object({ customerId: z.string().min(1) }).parse(await request.json()); return Response.json(await startConversation(actor, body.customerId), { status: 201 }); }, request); }

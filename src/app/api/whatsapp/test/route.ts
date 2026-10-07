import { AppError, handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { testConnection } from "@/modules/whatsapp/settings";
import { WhatsAppProviderError } from "@/modules/whatsapp/provider";
export async function POST(request: Request) { return handleApi(async () => { const actor = await requireRole("ADMIN"); try { return Response.json(await testConnection(actor)); } catch (error) { if (error instanceof WhatsAppProviderError) throw new AppError(502, error.message); throw error; } }, request); }

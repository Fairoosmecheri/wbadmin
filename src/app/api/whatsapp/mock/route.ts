import { z } from "zod";
import { AppError, handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { normalizePhone } from "@/modules/customers/phone";
import { enqueueMockInbound, providerMode } from "@/modules/whatsapp/provider";
import { processMockEvents } from "@/modules/whatsapp/webhooks";
export async function POST(request: Request) { return handleApi(async () => { await requireRole("ADMIN", "MANAGER"); if (providerMode() !== "mock") throw new AppError(404, "Mock messaging is disabled."); const body = z.object({ phone: z.string(), text: z.string().trim().min(1).max(4096) }).parse(await request.json()); let phone: string; try { phone = normalizePhone(body.phone); } catch { throw new AppError(422, "Enter a valid phone number."); } await enqueueMockInbound(phone, body.text); await processMockEvents(); return Response.json({ simulated: true }); }, request); }

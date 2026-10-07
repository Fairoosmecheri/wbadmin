import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { verifyWebhookSignature } from "@/modules/whatsapp/policy";
import { processWebhookPayload } from "@/modules/whatsapp/webhooks";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams; const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN; const provided = query.get("hub.verify_token") ?? "";
  if (!expected || query.get("hub.mode") !== "subscribe" || Buffer.byteLength(provided) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return new Response("Verification failed", { status: 403 });
  await prisma.setting.upsert({ where: { key: "whatsapp.webhookVerified" }, create: { key: "whatsapp.webhookVerified", value: new Date().toISOString() }, update: { value: new Date().toISOString() } });
  return new Response(query.get("hub.challenge") ?? "", { headers: { "Content-Type": "text/plain" } });
}
export async function POST(request: Request) {
  const reader = request.body?.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024 * 1024) { await reader.cancel(); return new Response("Payload too large", { status: 413 }); }
        chunks.push(value);
      }
    } catch { return new Response("Unable to read request", { status: 400 }); }
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!verifyWebhookSignature(raw, request.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET)) return new Response("Invalid signature", { status: 401 });
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return new Response("Invalid JSON", { status: 400 }); }
  try { await processWebhookPayload(payload, { requireScope: true }); return Response.json({ received: true }); }
  catch (error) { if (error instanceof AppError) return Response.json({ error: error.message }, { status: error.status }); return Response.json({ error: "Webhook processing failed; retry required." }, { status: 500 }); }
}

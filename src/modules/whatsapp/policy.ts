import { createHmac, timingSafeEqual } from "node:crypto";
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
export function serviceWindowOpen(lastInbound: Date | string | null, now = new Date()) {
  if (!lastInbound) return false;
  const time = new Date(lastInbound).getTime();
  return time <= now.getTime() && now.getTime() - time < SERVICE_WINDOW_MS;
}
export function verifyWebhookSignature(rawBody: string, signature: string | null, secret: string | undefined) {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}
export function isOptOut(text: string) {
  const normalized = (value: string) => value.normalize("NFKC").trim().replace(/[.!?]+$/u, "").trim().toLocaleLowerCase();
  const defaults = ["stop", "unsubscribe", "cancel", "end", "quit", "opt-out", "opt out", "optout", "stop all"];
  const configured = (process.env.WHATSAPP_OPT_OUT_KEYWORDS ?? "").split(",").map(normalized).filter(Boolean);
  return new Set([...defaults, ...configured]).has(normalized(text));
}
const rank: Record<string, number> = { QUEUED: 0, PROCESSING: 0, FAILED: 2.5, SENT: 2, DELIVERED: 3, READ: 4, RECEIVED: 5 };
export function advanceStatus(current: string, incoming: string) {
  if (incoming === "FAILED") return ["QUEUED", "PROCESSING", "SENT"].includes(current) ? "FAILED" : current;
  return (rank[incoming] ?? -1) > (rank[current] ?? -1) ? incoming : current;
}
export function templateVariables(body: string): string[] {
  return [...new Set([...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(match => match[1]))].sort((a, b) => Number(a) - Number(b));
}
export function renderTemplate(body: string, parameters: string[]) {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, number: string) => parameters[Number(number) - 1] ?? `{{${number}}}`);
}

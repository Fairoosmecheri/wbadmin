import "dotenv/config";
import { prisma } from "@/lib/db";
import { runCampaignBatch } from "@/modules/campaigns/queue";
import { processMockEvents, replayPendingWebhooks } from "@/modules/whatsapp/webhooks";

import { providerMode } from "@/modules/whatsapp/provider";

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
async function main() {
  console.info("WhatsApp worker started. Processing durable campaigns and webhook events.");
  while (!stopping) {
    try {
      if (providerMode() === "mock") await processMockEvents(100);
      await replayPendingWebhooks(100);
      const processed = await runCampaignBatch();
      if (!processed) await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error("Worker cycle failed; durable jobs remain recoverable.", { type: error instanceof Error ? error.name : "UnknownError" });
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  await prisma.$disconnect(); console.info("WhatsApp worker stopped.");
}
main().catch(async () => { console.error("Worker startup failed."); await prisma.$disconnect(); process.exitCode = 1; });

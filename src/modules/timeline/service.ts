import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/authorization";
import { accessibleCustomer } from "@/modules/followups/service";
import { getGeneralSettings } from "@/modules/auth/settings";

export type TimelineItem = { id: string; kind: string; title: string; description: string; actorName: string | null; occurredAt: Date };
const titles: Record<string, string> = {
  CUSTOMER_CREATED: "Customer added", CUSTOMER_UPDATED: "Customer details updated", CUSTOMER_STATUS_CHANGED: "Customer status changed",
  ASSIGNMENT_CHANGED: "Salesperson changed", TAGS_CHANGED: "Tags updated", OPT_IN: "WhatsApp permission recorded", OPT_OUT: "WhatsApp permission withdrawn",
  NOTE_UPDATED: "Note edited", FOLLOWUP_CREATED: "Follow-up scheduled", FOLLOWUP_UPDATED: "Follow-up updated", FOLLOWUP_COMPLETED: "Follow-up completed", FOLLOWUP_CANCELLED: "Follow-up cancelled",
  CUSTOMER_ASSIGN: "Salesperson changed", CUSTOMER_ADDTAGS: "Tags added", CUSTOMER_REMOVETAGS: "Tags removed", CUSTOMER_STATUS: "Customer status changed", CUSTOMER_ARCHIVE: "Customer archived",
};
const querySchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });

/** A database-side union keeps pagination bounded even for long-lived customer conversations. */
export async function customerTimeline(actor: Actor, customerId: string, input: unknown) {
  await accessibleCustomer(actor, customerId);
  const { page, limit } = querySchema.parse(input);
  const followUpScope = actor.role === "SALESMAN" ? Prisma.sql`AND f."assignedUserId" = ${actor.id}` : Prisma.empty;
  const activityScope = actor.role === "SALESMAN" ? Prisma.sql`AND (a."entityType" IS DISTINCT FROM 'FollowUp' OR EXISTS (SELECT 1 FROM "FollowUp" own WHERE own.id = a."entityId" AND own."assignedUserId" = ${actor.id}))` : Prisma.empty;
  const events = Prisma.sql`
    SELECT 'activity:' || a.id AS id, a.type AS kind, ''::text AS title, a.description, u.name AS "actorName", a."createdAt" AS "occurredAt"
    FROM "ActivityLog" a LEFT JOIN "User" u ON u.id = a."userId"
    WHERE a."customerId" = ${customerId} AND a.type <> 'NOTE_ADDED' ${activityScope}
    UNION ALL
    SELECT 'created:' || c.id, 'CUSTOMER_CREATED', 'Customer added', 'Customer added to the CRM', NULL, c."createdAt"
    FROM "Customer" c WHERE c.id = ${customerId} AND NOT EXISTS (SELECT 1 FROM "ActivityLog" a WHERE a."customerId" = c.id AND a.type = 'CUSTOMER_CREATED')
    UNION ALL
    SELECT 'note:' || n.id, 'NOTE_ADDED', 'Note added', n.content, u.name, n."createdAt"
    FROM "CustomerNote" n JOIN "User" u ON u.id = n."createdByUserId" WHERE n."customerId" = ${customerId}
    UNION ALL
    SELECT 'followup:' || f.id, 'FOLLOWUP_CREATED', 'Follow-up scheduled', f.title, u.name, f."createdAt"
    FROM "FollowUp" f JOIN "User" u ON u.id = f."createdByUserId" WHERE f."customerId" = ${customerId} ${followUpScope}
      AND NOT EXISTS (SELECT 1 FROM "ActivityLog" a WHERE a."entityId" = f.id AND a.type = 'FOLLOWUP_CREATED')
    UNION ALL
    SELECT 'followup-completed:' || f.id, 'FOLLOWUP_COMPLETED', 'Follow-up completed', f.title || COALESCE(' · ' || lower(replace(f.outcome::text, '_', ' ')), ''), u.name, f."completedAt"
    FROM "FollowUp" f JOIN "User" u ON u.id = f."assignedUserId" WHERE f."customerId" = ${customerId} AND f."completedAt" IS NOT NULL ${followUpScope}
      AND NOT EXISTS (SELECT 1 FROM "ActivityLog" a WHERE a."entityId" = f.id AND a.type = 'FOLLOWUP_COMPLETED')
    UNION ALL
    SELECT 'message:' || m.id, CASE WHEN m.direction = 'INBOUND' THEN 'CUSTOMER_MESSAGE' ELSE 'BUSINESS_REPLY' END,
      CASE WHEN m.direction = 'INBOUND' THEN 'Customer WhatsApp message' ELSE 'Business WhatsApp message' END,
      COALESCE(NULLIF(m."textContent", ''), CASE WHEN m.type = 'TEMPLATE' THEN 'Template: ' || COALESCE(m."templateName", 'WhatsApp template') ELSE initcap(lower(m.type::text)) || ' message' END), NULL, COALESCE(m."sentAt", m."createdAt")
    FROM "Message" m WHERE m."customerId" = ${customerId}
      AND NOT EXISTS (SELECT 1 FROM "CampaignRecipient" r WHERE r."whatsappMessageId" = m."whatsappMessageId")
    UNION ALL
    SELECT 'message-status:' || m.id || ':' || s.kind, s.kind, s.title, COALESCE(left(m."textContent", 300), 'WhatsApp message'), NULL, s.at
    FROM "Message" m CROSS JOIN LATERAL (VALUES ('MESSAGE_DELIVERED', 'WhatsApp delivered', m."deliveredAt"), ('MESSAGE_READ', 'WhatsApp read', m."readAt"), ('MESSAGE_FAILED', 'WhatsApp delivery failed', m."failedAt")) AS s(kind, title, at)
    WHERE m."customerId" = ${customerId} AND s.at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "CampaignRecipient" r WHERE r."whatsappMessageId" = m."whatsappMessageId")
    UNION ALL
    SELECT 'campaign:' || r.id || ':' || s.kind, s.kind, s.title, c.name, NULL, s.at
    FROM "CampaignRecipient" r JOIN "Campaign" c ON c.id = r."campaignId"
    CROSS JOIN LATERAL (VALUES ('CAMPAIGN_SENT', 'Campaign sent', r."sentAt"), ('CAMPAIGN_DELIVERED', 'Campaign delivered', r."deliveredAt"), ('CAMPAIGN_READ', 'Campaign read', r."readAt"), ('CAMPAIGN_FAILED', 'Campaign delivery failed', r."failedAt"), ('CAMPAIGN_REPLY', 'Customer replied to campaign', r."repliedAt")) AS s(kind, title, at)
    WHERE r."customerId" = ${customerId} AND s.at IS NOT NULL
  `;
  const [items, count, settings] = await Promise.all([
    prisma.$queryRaw<TimelineItem[]>(Prisma.sql`SELECT * FROM (${events}) history ORDER BY "occurredAt" DESC, id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`),
    prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT count(*) AS total FROM (${events}) history`),
    getGeneralSettings(),
  ]);
  const total = Number(count[0]?.total ?? 0);
  return { items: items.map(item => ({ ...item, title: item.title || titles[item.kind] || "Customer activity" })), total, page, pages: Math.max(1, Math.ceil(total / limit)), timezone: settings.timezone };
}

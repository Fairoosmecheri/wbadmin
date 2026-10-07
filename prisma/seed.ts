import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

// These fixtures are deliberately limited to development and the mock provider.
// The phone range +1 202-555-0100–0199 is reserved for fictional use.
const seedPassword = process.env.SEED_ADMIN_PASSWORD || "ReachDev!2026";
const day = 86_400_000;
const now = new Date();
const ago = (days: number) => new Date(now.getTime() - days * day);

async function seed() {
  if (process.env.NODE_ENV === "production") throw new Error("Development seed is disabled in production.");
  if (process.env.WHATSAPP_MODE !== "mock") throw new Error("Set WHATSAPP_MODE=mock before loading fictional development records.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  if (seedPassword.length < 12 || seedPassword.length > 128) throw new Error("SEED_ADMIN_PASSWORD must contain 12–128 characters.");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const password = await hashPassword(seedPassword);
    await prisma.$transaction(async (tx) => {
      // Empty updates preserve edits and passwords made after the first seed run.
      const users = await Promise.all([
        { id: "seed_admin", name: "Alex Morgan", email: "admin@example.com", role: "ADMIN" as const },
        { id: "seed_sales_1", name: "Jamie Thomas", email: "sales1@example.com", role: "SALESMAN" as const },
        { id: "seed_sales_2", name: "Robin Lee", email: "sales2@example.com", role: "SALESMAN" as const },
        { id: "seed_sales_3", name: "Sam Taylor", email: "sales3@example.com", role: "SALESMAN" as const },
      ].map((user) => tx.user.upsert({ where: { email: user.email }, create: { ...user, emailVerified: true }, update: {} })));
      const admin = users[0];
      const salesmen = users.slice(1);
      for (const user of users) {
        await tx.account.upsert({
          where: { providerId_accountId: { providerId: "credential", accountId: user.id } },
          create: { id: `seed_account_${user.id}`, providerId: "credential", accountId: user.id, userId: user.id, password },
          update: {},
        });
      }

      const types = await Promise.all(["HoReCa", "Retail", "Wholesale", "Institutional"].map((name, index) =>
        tx.customerType.upsert({ where: { name }, create: { id: `seed_type_${index}`, name }, update: {} })));
      const areas = await Promise.all(["Manjeri", "Malappuram", "Perinthalmanna", "Kottakkal", "Nilambur"].map((name, index) =>
        tx.area.upsert({ where: { name }, create: { id: `seed_area_${index}`, name }, update: {} })));
      const routes = await Promise.all(["Manjeri Central", "Malappuram South", "Nilambur North"].map((name, index) =>
        tx.route.upsert({ where: { name }, create: { id: `seed_route_${index}`, name, assignedUserId: salesmen[index].id }, update: {} })));
      const tags = await Promise.all([
        { name: "Priority", color: "amber" }, { name: "Regular buyer", color: "emerald" },
        { name: "New lead", color: "blue" }, { name: "Needs follow-up", color: "violet" },
      ].map((tag, index) => tx.tag.upsert({ where: { name: tag.name }, create: { id: `seed_tag_${index}`, ...tag }, update: {} })));
      await tx.setting.upsert({ where: { key: "general" }, create: { key: "general", value: {
        businessName: "Reach CRM", timezone: "Asia/Kolkata", defaultPhoneCountry: "IN", dateFormat: "DD/MM/YYYY",
      } }, update: {} });

      const customers = [];
      const businessNames = ["Cedar Table", "Harbor Pantry", "Maple Market", "Olive Kitchen", "Summit Stores", "Willow Cafe", "Meadow Foods", "Birch Bakers", "Grove Hospitality", "Orchard Supply"];
      for (let index = 0; index < 100; index += 1) {
        const number = String(index + 1).padStart(3, "0");
        const phone = `+120255501${String(index).padStart(2, "0")}`;
        const status = index >= 97 ? "ARCHIVED" : index >= 92 ? "DO_NOT_CONTACT" : index >= 85 ? "INACTIVE" : index >= 75 ? "PROSPECT" : "ACTIVE";
        const optedOut = index >= 90;
        const optedIn = index % 5 !== 0 && !optedOut;
        customers.push(await tx.customer.upsert({
          where: { customerCode: `DEMO-${number}` }, update: {},
          create: {
            id: `seed_customer_${number}`, customerCode: `DEMO-${number}`,
            businessName: `${businessNames[index % businessNames.length]} ${number}`, contactPerson: `Demo Contact ${number}`,
            phone, phoneNormalized: phone, email: `customer${number}@example.com`,
            customerTypeId: types[index % types.length].id, areaId: areas[index % areas.length].id,
            routeId: routes[index % routes.length].id, assignedUserId: salesmen[index % salesmen.length].id,
            status, archivedAt: status === "ARCHIVED" ? ago(3) : null,
            whatsappOptIn: optedIn, whatsappOptInAt: optedIn ? ago(45) : null,
            whatsappOptInSource: optedIn ? "Fictional development fixture" : null,
            whatsappOptOutAt: optedOut ? ago(2) : null, whatsappOptOutReason: optedOut ? "Sample opt-out request" : null,
            addressLine1: `${index + 1}, Demo Business Lane`, city: areas[index % areas.length].name,
            district: "Malappuram", state: "Kerala", postalCode: "676121", country: "IN",
            notes: "Fictional development record. Reserved example phone number; use mock WhatsApp only.",
            lastContactedAt: index % 7 === 0 ? null : ago(index % 40),
            lastOrderDate: index % 3 === 0 ? ago(index % 25 + 1) : null,
            createdAt: ago(60 - (index % 30)),
          },
        }));
      }

      await tx.customerTag.createMany({ skipDuplicates: true, data: customers.flatMap((customer, index) => [
        { customerId: customer.id, tagId: tags[index % tags.length].id },
        ...(index % 3 === 0 ? [{ customerId: customer.id, tagId: tags[(index + 1) % tags.length].id }] : []),
      ]) });
      await tx.customerNote.createMany({ skipDuplicates: true, data: customers.slice(0, 30).map((customer, index) => ({
        id: `seed_note_${index}`, customerId: customer.id, createdByUserId: salesmen[index % 3].id,
        content: ["Prefers morning calls. Share the new product list on the next visit.", "Discussed weekly delivery requirements. Follow up before the next route visit.", "Interested in the upcoming range. Check availability and send a quotation."][index % 3],
        createdAt: ago(index % 14),
      })) });
      await tx.activityLog.createMany({ skipDuplicates: true, data: customers.map((customer, index) => ({
        id: `seed_activity_${index}`, customerId: customer.id, userId: admin.id,
        type: "CUSTOMER_CREATED", entityType: "Customer", entityId: customer.id,
        description: "Fictional customer added for development.", createdAt: customer.createdAt,
      })) });
      await tx.followUp.createMany({ skipDuplicates: true, data: customers.slice(0, 36).map((customer, index) => ({
        id: `seed_followup_${index}`, customerId: customer.id, assignedUserId: salesmen[index % 3].id,
        createdByUserId: admin.id, title: ["Discuss next delivery", "Share new product list", "Check quotation feedback", "Plan route visit"][index % 4],
        type: (["CALL", "WHATSAPP", "VISIT", "GENERAL"] as const)[index % 4],
        priority: (["NORMAL", "HIGH", "NORMAL", "URGENT"] as const)[index % 4],
        status: index >= 28 ? "COMPLETED" : "PENDING", dueAt: ago(4 - index % 10),
        completedAt: index >= 28 ? ago(1) : null, outcome: index >= 28 ? "INTERESTED" : null,
        notes: "Sample task for the development workspace.",
      })) });

      for (const [index, customer] of customers.slice(0, 16).entries()) {
        const conversation = await tx.conversation.upsert({
          where: { customerId: customer.id }, update: {},
          create: { id: `seed_conversation_${index}`, customerId: customer.id, assignedUserId: customer.assignedUserId,
            status: index >= 14 ? "CLOSED" : "OPEN", lastMessageAt: ago(index / 24), unreadCount: index < 6 ? 1 : 0 },
        });
        const hadInboundMessage = await tx.message.findUnique({ where: { id: `seed_message_in_${index}` }, select: { id: true } });
        await tx.message.createMany({ skipDuplicates: true, data: [
          { id: `seed_message_out_${index}`, conversationId: conversation.id, customerId: customer.id,
            direction: "OUTBOUND", type: "TEMPLATE", templateName: "seed_product_update", status: "READ",
            textContent: `Hello ${customer.contactPerson}, our latest product list is ready. Would you like a copy?`,
            whatsappMessageId: `mock_seed_out_${index}`, createdAt: ago((index + 2) / 24), sentAt: ago((index + 2) / 24),
            deliveredAt: ago((index + 1.5) / 24), readAt: ago((index + 1) / 24) },
          { id: `seed_message_in_${index}`, conversationId: conversation.id, customerId: customer.id,
            direction: "INBOUND", type: "TEXT", status: "RECEIVED", whatsappMessageId: `mock_seed_in_${index}`,
            textContent: ["Yes, please share the latest list. Thank you!", "Could you arrange a visit this week?", "Please call tomorrow morning to discuss the quantities."][index % 3],
            createdAt: ago(index / 24) },
        ] });
        // Do not refresh an existing customer's service window on repeat runs.
        if (!hadInboundMessage) await tx.customer.updateMany({ where: { id: customer.id, lastCustomerMessageAt: null }, data: {
          lastCustomerMessageAt: ago(index / 24), lastBusinessMessageAt: ago((index + 2) / 24),
        } });
      }

      const template = await tx.template.upsert({ where: { name_language: { name: "seed_product_update", language: "en" } }, update: {}, create: {
        id: "seed_template_product", metaTemplateId: "mock_seed_template_product", name: "seed_product_update", language: "en",
        category: "MARKETING", status: "APPROVED", body: "Hello {{1}}, our latest product list is ready. Reply if you would like a copy.",
        footer: "Reply STOP to opt out", variables: ["1"],
        components: [{ type: "BODY", text: "Hello {{1}}, our latest product list is ready. Reply if you would like a copy." }, { type: "FOOTER", text: "Reply STOP to opt out" }],
        lastSyncedAt: now, lastTestedAt: ago(7),
      } });
      await tx.template.upsert({ where: { name_language: { name: "seed_visit_reminder", language: "en" } }, update: {}, create: {
        id: "seed_template_visit", metaTemplateId: "mock_seed_template_visit", name: "seed_visit_reminder", language: "en",
        category: "UTILITY", status: "APPROVED", body: "Hello {{1}}, your scheduled visit is on {{2}}. Reply to reschedule.",
        variables: ["1", "2"], components: [{ type: "BODY", text: "Hello {{1}}, your scheduled visit is on {{2}}. Reply to reschedule." }], lastSyncedAt: now,
      } });
      const segment = await tx.segment.upsert({ where: { id: "seed_segment_optedin" }, update: {}, create: {
        id: "seed_segment_optedin", name: "Active WhatsApp subscribers", description: "Active customers with recorded WhatsApp consent.",
        filterDefinition: { status: "ACTIVE", whatsappOptIn: true }, createdBy: admin.id,
      } });
      await tx.segment.upsert({ where: { id: "seed_segment_manjeri" }, update: {}, create: {
        id: "seed_segment_manjeri", name: "Manjeri HoReCa", description: "HoReCa customers in Manjeri who have opted in.",
        filterDefinition: { areaId: areas[0].id, customerTypeId: types[0].id, whatsappOptIn: true }, createdBy: admin.id,
      } });
      await tx.savedCustomerView.upsert({ where: { id: "seed_view_no_contact" }, update: {}, create: {
        id: "seed_view_no_contact", name: "No contact in 30 days", userId: admin.id, filterDefinition: { notContactedDays: 30 },
      } });

      const campaignCustomers = customers.filter((customer) => customer.status === "ACTIVE" && customer.whatsappOptIn && !customer.whatsappOptOutAt).slice(0, 20);
      const campaign = await tx.campaign.upsert({ where: { id: "seed_campaign_complete" }, update: {}, create: {
        id: "seed_campaign_complete", name: "October product update · Demo", description: "Completed fictional campaign showing delivery and reply analytics.",
        templateId: template.id, segmentId: segment.id, status: "COMPLETED", createdByUserId: admin.id,
        filterDefinition: { status: "ACTIVE", whatsappOptIn: true }, variableMapping: { "1": { field: "contactPerson" } },
        audienceSummary: { eligible: 20, excluded: 0 }, previewedAt: ago(8), testSentAt: ago(8), confirmedAt: ago(7),
        startedAt: ago(7), completedAt: ago(6), totalRecipients: 20, queuedCount: 0,
        sentCount: 18, deliveredCount: 16, readCount: 12, failedCount: 2, repliedCount: 6, interestedCount: 4, orderCount: 2,
      } });
      const recipients: Prisma.CampaignRecipientCreateManyInput[] = campaignCustomers.map((customer, index) => ({
        id: `seed_recipient_${index}`, campaignId: campaign.id, customerId: customer.id, phone: customer.phoneNormalized,
        renderedPayload: { name: template.name, language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: customer.contactPerson }] }] },
        status: index < 12 ? "READ" : index < 16 ? "DELIVERED" : index < 18 ? "SENT" : "FAILED",
        whatsappMessageId: index < 18 ? `mock_seed_campaign_${index}` : null, queuedAt: ago(7), sentAt: index < 18 ? ago(7) : null,
        deliveredAt: index < 16 ? ago(6.9) : null, readAt: index < 12 ? ago(6.8) : null,
        failedAt: index >= 18 ? ago(7) : null, failureReason: index >= 18 ? "Simulated delivery failure" : null,
        repliedAt: index < 6 ? ago(6.5) : null, responseClassification: index < 2 ? "ORDER_CONFIRMED" : index < 6 ? "INTERESTED" : null,
        ...(index < 2 ? { conversionMetadata: { orderReference: `DEMO-ORDER-${index + 1}`, approximateAmount: 2500 + index * 750, note: "Fictional demo order." } } : {}),
        attempts: 1,
      }));
      await tx.campaignRecipient.createMany({ data: recipients, skipDuplicates: true });
      await tx.auditLog.createMany({ skipDuplicates: true, data: [{ id: "seed_audit", userId: admin.id, action: "DEVELOPMENT_SEEDED", entityType: "System", metadata: { fictional: true, customerCount: 100 } }] });
    }, { timeout: 60_000 });
    console.info("Development fixtures ready: 1 admin, 3 salespeople, 100 fictional customers, follow-ups, conversations, templates, and a sample campaign.");
    console.info("Admin: admin@example.com. Password: SEED_ADMIN_PASSWORD, or the development-only password documented in README. Existing passwords are preserved.");
  } finally {
    await prisma.$disconnect();
  }
}

seed().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Development seeding failed.";
  console.error(message.replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[database URL redacted]"));
  process.exitCode = 1;
});

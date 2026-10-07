import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { customerScope, type Actor } from "@/modules/auth/policy";
import { calendarBoundaries } from "@/modules/followups/dates";
import { getGeneralSettings } from "@/modules/auth/settings";

export async function getDashboard(actor: Actor) {
  const settings = await getGeneralSettings();
  const now = new Date();
  const bounds = calendarBoundaries(now, settings.timezone);
  const customerWhere = { ...customerScope(actor), archivedAt: null };
  const followScope: Prisma.FollowUpWhereInput = actor.role === "SALESMAN" ? { assignedUserId: actor.id, customer: customerScope(actor) } : {};
  const conversationScope = { customer: customerScope(actor) };
  const [total, active, optedIn, today, overdue, unread, recentCampaigns, followups, conversations, types, customerGroups] = await Promise.all([
    prisma.customer.count({ where: customerWhere }),
    prisma.customer.count({ where: { ...customerWhere, status: "ACTIVE" } }),
    prisma.customer.count({ where: { ...customerWhere, whatsappOptIn: true, whatsappOptOutAt: null, status: "ACTIVE" } }),
    prisma.followUp.count({ where: { ...followScope, status: "PENDING", dueAt: { gte: bounds.today, lt: bounds.tomorrow } } }),
    prisma.followUp.count({ where: { ...followScope, status: "PENDING", dueAt: { lt: now } } }),
    prisma.conversation.aggregate({ where: conversationScope, _sum: { unreadCount: true } }),
    actor.role === "SALESMAN" ? Promise.resolve([]) : prisma.campaign.findMany({ take: 5, orderBy: { createdAt: "desc" }, include: { template: { select: { name: true } } } }),
    prisma.followUp.findMany({ where: { ...followScope, status: "PENDING" }, take: 5, orderBy: [{ dueAt: "asc" }, { id: "asc" }], include: { customer: { select: { id: true, businessName: true } }, assignedUser: { select: { name: true } } } }),
    prisma.conversation.findMany({ where: conversationScope, take: 4, orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }], include: { customer: { select: { businessName: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { textContent: true, type: true } } } }),
    prisma.customerType.findMany({ select: { id: true, name: true } }),
    prisma.customer.groupBy({ by: ["customerTypeId"], where: customerWhere, _count: true }),
  ]);
  return { settings, total, active, optedIn, today, overdue, unread: unread._sum.unreadCount ?? 0, recentCampaigns, followups, conversations, customerGroups: customerGroups.map(g => ({ name: types.find(t=>t.id===g.customerTypeId)?.name ?? "Uncategorized", count: g._count })).sort((a,b)=>b.count-a.count) };
}

export async function getSetupChecklist() {
  const [general, users, types, customers, templates, segments, tests] = await Promise.all([
    prisma.setting.count({ where: { key: "general" } }), prisma.user.count({ where: { active: true } }),
    prisma.customerType.count({ where: { active: true } }), prisma.customer.count(),
    prisma.template.count({ where: { status: "APPROVED" } }), prisma.segment.count(), prisma.campaign.count({ where: { testSentAt: { not: null } } }),
  ]);
  const connected = process.env.WHATSAPP_MODE === "cloud" && !!process.env.WHATSAPP_ACCESS_TOKEN && !!process.env.WHATSAPP_PHONE_NUMBER_ID;
  return [
    { title: "Make this workspace yours", detail: "Business name, timezone, and phone defaults", href: "/settings", complete: general > 0 },
    { title: "Invite your team", detail: "Add users and assign the right roles", href: "/users", complete: users > 1 },
    { title: "Organize your customer types", detail: "Areas, routes, types, and reusable tags", href: "/settings/customers", complete: types > 0 },
    { title: "Bring your customers along", detail: "Import an Excel or CSV file", href: "/imports", complete: customers > 0 },
    { title: "Connect WhatsApp", detail: "Mock mode is available while you prepare your Meta account", href: "/settings/whatsapp", complete: connected },
    { title: "Sync message templates", detail: "Choose approved templates for your outreach", href: "/templates", complete: templates > 0 },
    { title: "Build your first audience", detail: "Save a dynamic customer segment", href: "/segments", complete: segments > 0 },
    { title: "Send a test campaign", detail: "Preview and test before contacting your audience", href: "/campaigns/new", complete: tests > 0 },
  ];
}

export async function getReports(from?: Date, to?: Date) {
  const dates = from || to ? { ...(from && { gte: from }), ...(to && { lte: to }) } : undefined;
  const customerWhere: Prisma.CustomerWhereInput = { archivedAt: null, ...(dates && { createdAt: dates }) };
  const campaignWhere: Prisma.CampaignWhereInput = dates ? { createdAt: dates } : {};
  const [customers, types, areas, routes, users, byType, byArea, byRoute, byUser, engagement, followups, campaigns, optedIn, optedOut, overdue, bySalesperson] = await Promise.all([
    prisma.customer.count({ where: customerWhere }),
    prisma.customerType.findMany({ select: { id: true, name: true } }), prisma.area.findMany({ select: { id: true, name: true } }),
    prisma.route.findMany({ select: { id: true, name: true } }), prisma.user.findMany({ select: { id: true, name: true } }),
    prisma.customer.groupBy({ by: ["customerTypeId"], where: customerWhere, _count: true }),
    prisma.customer.groupBy({ by: ["areaId"], where: customerWhere, _count: true }),
    prisma.customer.groupBy({ by: ["routeId"], where: customerWhere, _count: true }),
    prisma.customer.groupBy({ by: ["assignedUserId"], where: customerWhere, _count: true }),
    Promise.all([0,30,60,90].map(days=>prisma.customer.count({ where: { ...customerWhere, ...(days ? { OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: new Date(Date.now()-days*86400000) } }] } : { lastContactedAt: null }) } }))),
    prisma.followUp.groupBy({ by: ["status"], where: dates ? { dueAt: dates } : {}, _count: true }),
    prisma.campaign.aggregate({ where: campaignWhere, _sum: { totalRecipients: true, sentCount: true, deliveredCount: true, readCount: true, failedCount: true, repliedCount: true, interestedCount: true, orderCount: true }, _count: true }),
    prisma.customer.count({ where: { ...customerWhere, whatsappOptIn: true, whatsappOptOutAt: null } }),
    prisma.customer.count({ where: { ...customerWhere, OR: [{ whatsappOptOutAt: { not: null } }, { status: "DO_NOT_CONTACT" }] } }),
    prisma.followUp.count({ where: { status: "PENDING", dueAt: { ...(dates ?? {}), lt: new Date() } } }),
    prisma.followUp.groupBy({ by: ["assignedUserId", "status"], where: dates ? { dueAt: dates } : {}, _count: true }),
  ]);
  const resolve = (rows: { name: string; id: string }[], id: string | null)=>rows.find(r=>r.id===id)?.name ?? "Unassigned";
  return { customers, campaigns, engagement, followups, optedIn, optedOut, overdue, followupsBySalesperson: users.map(u=>({ name: u.name, pending: bySalesperson.find(f=>f.assignedUserId===u.id&&f.status==="PENDING")?._count??0, completed: bySalesperson.find(f=>f.assignedUserId===u.id&&f.status==="COMPLETED")?._count??0 })).filter(u=>u.pending||u.completed), distribution: [
    { title: "By customer type", rows: byType.map(g=>({name:resolve(types,g.customerTypeId),count:g._count})) },
    { title: "By area", rows: byArea.map(g=>({name:resolve(areas,g.areaId),count:g._count})) },
    { title: "By route", rows: byRoute.map(g=>({name:resolve(routes,g.routeId),count:g._count})) },
    { title: "By salesperson", rows: byUser.map(g=>({name:resolve(users,g.assignedUserId),count:g._count})) },
  ] };
}

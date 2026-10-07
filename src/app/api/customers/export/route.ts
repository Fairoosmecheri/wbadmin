import { handleApi } from "@/lib/api";
import { requireUser } from "@/lib/authorization";
import { exportCustomers } from "@/modules/imports/export";
export const runtime = "nodejs";
export async function GET(request: Request) { return handleApi(async () => { const query = Object.fromEntries(new URL(request.url).searchParams); const { format, ids, ...filters } = query; return exportCustomers({ format, ...(ids && { ids: ids.split(",") }), filters }, await requireUser()); }, request); }
export async function POST(request: Request) { return handleApi(async () => exportCustomers(await request.json(), await requireUser()), request); }

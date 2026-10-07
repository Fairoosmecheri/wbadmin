import { handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { failedImportCsv } from "@/modules/imports/service";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return handleApi(async () => new Response(await failedImportCsv((await context.params).id, await requireRole("ADMIN", "MANAGER")), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="failed-import-rows.csv"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } }), request); }

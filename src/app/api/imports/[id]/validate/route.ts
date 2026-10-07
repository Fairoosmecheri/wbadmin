import { handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { validateImport } from "@/modules/imports/service";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return handleApi(async () => Response.json(await validateImport((await context.params).id, await request.json(), await requireRole("ADMIN", "MANAGER"))), request); }

import { handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { commitImport } from "@/modules/imports/service";
export const maxDuration = 180;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return handleApi(async () => Response.json(await commitImport((await context.params).id, await request.json(), await requireRole("ADMIN", "MANAGER"))), request); }

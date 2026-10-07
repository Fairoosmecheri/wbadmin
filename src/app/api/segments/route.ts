import { handleApi } from "@/lib/api";
import { requireRole, requireUser } from "@/lib/authorization";
import { listSegments, saveSegment } from "@/modules/segments/service";

export async function GET(request: Request) { return handleApi(async () => Response.json(await listSegments(await requireUser())), request); }
export async function POST(request: Request) { return handleApi(async () => { const actor = await requireRole("ADMIN", "MANAGER"); return Response.json(await saveSegment(await request.json(), actor), { status: 201 }); }, request); }

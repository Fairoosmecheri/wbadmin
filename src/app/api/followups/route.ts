import { handleApi } from "@/lib/api";
import { requireUser } from "@/lib/authorization";
import { createFollowUp, listFollowUps } from "@/modules/followups/service";
export async function GET(request: Request) { return handleApi(async () => Response.json(await listFollowUps(await requireUser(), Object.fromEntries(new URL(request.url).searchParams))), request); }
export async function POST(request: Request) { return handleApi(async () => Response.json(await createFollowUp(await requireUser(), await request.json()), { status: 201 }), request); }

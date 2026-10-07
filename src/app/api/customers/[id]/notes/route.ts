import { handleApi } from "@/lib/api";
import { requireUser } from "@/lib/authorization";
import { createNote, listNotes } from "@/modules/timeline/notes-service";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return handleApi(async () => Response.json(await listNotes(await requireUser(), (await context.params).id, Object.fromEntries(new URL(request.url).searchParams))), request); }
export async function POST(request: Request, context: Context) { return handleApi(async () => Response.json(await createNote(await requireUser(), (await context.params).id, await request.json()), { status: 201 }), request); }

import { handleApi } from "@/lib/api";
import { requireUser } from "@/lib/authorization";
import { updateNote } from "@/modules/timeline/notes-service";
export async function PATCH(request: Request, context: { params: Promise<{ id: string; noteId: string }> }) { return handleApi(async () => { const { id, noteId } = await context.params; return Response.json(await updateNote(await requireUser(), id, noteId, await request.json())); }, request); }

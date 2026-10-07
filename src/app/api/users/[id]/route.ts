import { handleApi } from "@/lib/api";
import { requireRole } from "@/lib/authorization";
import { updateUser } from "@/modules/auth/users";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(async () => Response.json({ user: await updateUser(await requireRole("ADMIN"), (await context.params).id, await request.json()) }), request);
}

import { handleApi } from "@/lib/api";
import { requireRole, requireUser } from "@/lib/authorization";
import { prisma } from "@/lib/db";
import { createUser, userSelect } from "@/modules/auth/users";

export async function GET(request: Request) {
  return handleApi(async () => {
    const actor = await requireUser();
    const { searchParams } = new URL(request.url);
    const options = searchParams.get("options") === "true";
    if (!options) await requireRole("ADMIN");
    const users = await prisma.user.findMany({ where: options ? { active: true, ...(actor.role === "SALESMAN" ? { id: actor.id } : {}) } : {}, select: options ? { id: true, name: true, role: true } : userSelect, orderBy: { name: "asc" }, take: 500 });
    return Response.json({ users });
  }, request);
}

export async function POST(request: Request) {
  return handleApi(async () => Response.json({ user: await createUser(await requireRole("ADMIN"), await request.json()) }, { status: 201 }), request);
}

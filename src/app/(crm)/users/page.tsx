import { requireUser } from "@/lib/authorization";
import { prisma } from "@/lib/db";
import { userSelect } from "@/modules/auth/users";
import { UsersUI } from "@/modules/auth/users-ui";
import "@/modules/auth/auth.css";

export default async function UsersPage() {
  const actor = await requireUser();
  if (actor.role !== "ADMIN") return <div className="card"><h1>Administrator access required</h1><p>Your administrator manages team accounts and permissions.</p></div>;
  const users = await prisma.user.findMany({ select: userSelect, orderBy: { name: "asc" }, take: 500 });
  return <div className="account-page"><UsersUI actorId={actor.id} initialUsers={users.map(user => ({ ...user, createdAt: user.createdAt.toISOString(), lastLoginAt: user.lastLoginAt?.toISOString() ?? null }))} /></div>;
}

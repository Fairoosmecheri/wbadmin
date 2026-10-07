import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
async function main() {
  const input = z.object({ ADMIN_EMAIL: z.email(), ADMIN_NAME: z.string().min(2).max(100), ADMIN_PASSWORD: z.string().min(16).max(128), DATABASE_URL: z.string().min(1) }).safeParse(process.env);
  if (!input.success) throw new Error("Set ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD (16–128 characters), and DATABASE_URL securely in the process environment.");
  const config = input.data;
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.DATABASE_URL }) });
  try {
    const id = randomUUID();
    await db.$transaction(async tx => {
      if (await tx.user.count({ where: { role: "ADMIN", active: true } })) throw new Error("An administrator already exists. Use authenticated Team management to add administrators.");
      await tx.user.create({ data: { id, name: config.ADMIN_NAME, email: config.ADMIN_EMAIL.toLowerCase(), role: "ADMIN", accounts: { create: { id: randomUUID(), accountId: id, providerId: "credential", password: await hashPassword(config.ADMIN_PASSWORD) } } } });
      await tx.auditLog.create({ data: { userId: id, action: "ADMIN_BOOTSTRAPPED", entityType: "User", entityId: id, metadata: {} } });
    }, { isolationLevel: "Serializable", timeout: 15000 });
    console.info("Initial administrator created. Remove ADMIN_PASSWORD from the bootstrap environment.");
  } finally { await db.$disconnect(); }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error && !error.message.includes("prisma") ? error.message : "Administrator creation failed. Verify database availability and that the email is unused.");
  process.exitCode = 1;
});

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { prisma } from "@/lib/db";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: process.env.AUTH_SECRET,
  baseURL: process.env.APP_URL,
  trustedOrigins: process.env.APP_URL ? [process.env.APP_URL] : [],
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
  },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 12 },
  advanced: { useSecureCookies: process.env.NODE_ENV === "production", defaultCookieAttributes: { httpOnly: true, sameSite: "lax" } },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 60,
    customRules: { "/sign-in/email": { window: 60, max: 5 } },
  },
  user: {
    additionalFields: {
      role: { type: "string", required: false, defaultValue: "SALESMAN", input: false },
      active: { type: "boolean", required: false, defaultValue: true, input: false },
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { active: true } });
          if (!user?.active) throw new APIError("UNAUTHORIZED", { message: "Your account is inactive. Contact your administrator." });
          return { data: session };
        },
        after: async (session) => {
          await prisma.user.update({ where: { id: session.userId }, data: { lastLoginAt: new Date() } });
        },
      },
    },
  },
});

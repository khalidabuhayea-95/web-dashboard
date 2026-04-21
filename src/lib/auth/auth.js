import { getServerSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { verifyPassword } from "@/lib/auth/passwords";
import {
  ensureSystemAdmin,
  findDashboardUserByEmail,
} from "@/lib/auth/dashboardUsers.server";
import { normalizeDashboardRole, sanitizeDisplayName } from "@/lib/auth/utils";

const authSecret =
  process.env.AUTH_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  (process.env.NODE_ENV === "production"
    ? undefined
    : "local-dev-auth-secret-change-me");

if (!authSecret) {
  throw new Error("Missing AUTH_SECRET or NEXTAUTH_SECRET.");
}

export const authOptions = {
  secret: authSecret,
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  providers: [
    Credentials({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        await ensureSystemAdmin();

        const email = String(credentials?.email || "").trim();
        const password = String(credentials?.password || "");
        if (!email || !password) {
          return null;
        }

        const user = await findDashboardUserByEmail(email);
        if (!user) {
          return null;
        }

        if (user.bannedUntil && user.bannedUntil.getTime() > Date.now()) {
          throw new Error("This account is banned.");
        }

        const passwordValid = await verifyPassword(password, user.passwordHash);
        if (!passwordValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: sanitizeDisplayName(user.name, user.email),
          role: normalizeDashboardRole(user.role),
          isSystemAdmin: Boolean(user.isSystemAdmin),
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.email = user.email;
        token.name = user.name;
        token.role = user.role;
        token.isSystemAdmin = user.isSystemAdmin;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.sub || "");
        session.user.email = String(token.email || "");
        session.user.name = String(token.name || session.user.name || "");
        session.user.role = normalizeDashboardRole(token.role);
        session.user.isSystemAdmin = Boolean(token.isSystemAdmin);
      }
      return session;
    },
  },
};

export function auth() {
  return getServerSession(authOptions);
}

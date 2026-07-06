import { PrismaClient } from "@prisma/client";

// Standard Next.js singleton pattern — prevents exhausting database
// connections from repeated PrismaClient instantiation during development
// hot-reload. This is the single Prisma client instance the rest of the
// application (including Better Auth's adapter, below) must reuse rather
// than instantiating its own.

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

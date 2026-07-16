import { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Shared Prisma client singleton.
//
// Stashed on `globalThis` so Next.js dev-server hot-reloads (which
// re-evaluate this module on every edit) don't open a fresh pool of Postgres
// connections each time -- the same pattern already used by the in-memory
// repository stub for its `globalForStore` (apps/web/lib/repository/memory.ts).
// ---------------------------------------------------------------------------

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

export const prisma = globalForPrisma.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}

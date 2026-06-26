import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7: connection URL is passed to the client via a driver adapter, not the
// schema. Supabase = direct postgres:// -> @prisma/adapter-pg over node-postgres.
// Runtime uses DATABASE_URL (the pooled / pgbouncer string for serverless).
const connectionString = process.env.DATABASE_URL ?? "";

function makeClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
}

const g = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = g.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") g.prisma = prisma;

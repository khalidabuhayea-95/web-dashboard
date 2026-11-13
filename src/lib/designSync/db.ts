import type { PrismaClient } from "@prisma/client";

import prismaUntyped from "@/lib/prisma";

/**
 * The shared Prisma client, typed. `@/lib/prisma` is a JavaScript module, so its export reaches
 * TypeScript untyped; the sync code leans on Prisma's types (composite keys, `select` payloads)
 * to stay honest, so it reads the same instance through this one cast.
 */
export const db = prismaUntyped as unknown as PrismaClient;

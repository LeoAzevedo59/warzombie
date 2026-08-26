import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

/** Instância única do Prisma Client (pool de conexões interno). */
export const prisma = new PrismaClient({
  log: env.isProd ? ['warn', 'error'] : ['warn', 'error'],
});

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

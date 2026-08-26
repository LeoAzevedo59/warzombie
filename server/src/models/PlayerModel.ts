import type { Player } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export type { Player };

/** Normaliza o nome para a chave única (case-insensitive, sem espaços nas pontas). */
export function toNameKey(name: string): string {
  return name.trim().toLocaleLowerCase('pt-BR');
}

/** Acesso a dados de `players`. Só SQL/Prisma aqui — regra de negócio fica no service. */
export const PlayerModel = {
  findByName(name: string): Promise<Player | null> {
    return prisma.player.findUnique({ where: { nameKey: toNameKey(name) } });
  },

  findById(id: string): Promise<Player | null> {
    return prisma.player.findUnique({ where: { id } });
  },

  /** Cria se não existir; caso exista, apenas marca como visto agora. */
  upsertByName(name: string): Promise<Player> {
    const trimmed = name.trim();
    return prisma.player.upsert({
      where: { nameKey: toNameKey(trimmed) },
      create: { name: trimmed, nameKey: toNameKey(trimmed) },
      update: { lastSeenAt: new Date() },
    });
  },

  saveState(id: string, data: { posX: number; posZ: number; hp: number; kills: number }): Promise<Player> {
    return prisma.player.update({ where: { id }, data: { ...data, lastSeenAt: new Date() } });
  },

  list(limit = 50): Promise<Player[]> {
    return prisma.player.findMany({ orderBy: { lastSeenAt: 'desc' }, take: limit });
  },

  count(): Promise<number> {
    return prisma.player.count();
  },
};

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

  saveState(
    id: string,
    data: { posX: number; posZ: number; hp: number; kills: number; pvpKills: number; deaths: number },
    playtimeDeltaSeconds = 0,
  ): Promise<Player> {
    return prisma.player.update({
      where: { id },
      data: { ...data, lastSeenAt: new Date(), playtimeSeconds: { increment: Math.max(0, Math.round(playtimeDeltaSeconds)) } },
    });
  },

  /** Top N por abates de zumbis. */
  topKills(limit = 10): Promise<Array<{ name: string; kills: number }>> {
    return prisma.player.findMany({ orderBy: { kills: 'desc' }, take: limit, where: { kills: { gt: 0 } }, select: { name: true, kills: true } });
  },

  /** Top N por tempo jogado. */
  topPlaytime(limit = 10): Promise<Array<{ name: string; playtimeSeconds: number }>> {
    return prisma.player.findMany({ orderBy: { playtimeSeconds: 'desc' }, take: limit, where: { playtimeSeconds: { gt: 0 } }, select: { name: true, playtimeSeconds: true } });
  },

  list(limit = 50): Promise<Player[]> {
    return prisma.player.findMany({ orderBy: { lastSeenAt: 'desc' }, take: limit });
  },

  count(): Promise<number> {
    return prisma.player.count();
  },
};

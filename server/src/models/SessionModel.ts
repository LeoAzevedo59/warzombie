import type { PlayerSession } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export type { PlayerSession };

/** Acesso a dados de `player_sessions` (histórico de conexões). */
export const SessionModel = {
  open(playerId: string, ip: string | null): Promise<PlayerSession> {
    return prisma.playerSession.create({ data: { playerId, ip } });
  },

  close(id: string): Promise<PlayerSession> {
    return prisma.playerSession.update({ where: { id }, data: { disconnectedAt: new Date() } });
  },

  /** Ao reiniciar o servidor, sessões que ficaram abertas são fechadas em lote. */
  closeAllOpen(): Promise<number> {
    return prisma.playerSession
      .updateMany({ where: { disconnectedAt: null }, data: { disconnectedAt: new Date() } })
      .then((r) => r.count);
  },
};

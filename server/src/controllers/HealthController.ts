import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import type { GameServer } from '../realtime/GameServer.js';

/** GET /api/health — usado pelo healthcheck do compose e por quem quiser ver se a API/DB respondem. */
export function healthController(game: GameServer) {
  return async (_req: Request, res: Response): Promise<void> => {
    let db: 'ok' | 'error' = 'ok';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'error';
    }
    res.status(db === 'ok' ? 200 : 503).json({
      status: db === 'ok' ? 'ok' : 'degraded',
      db,
      online: game.onlineCount,
      uptime: Math.round(process.uptime()),
    });
  };
}

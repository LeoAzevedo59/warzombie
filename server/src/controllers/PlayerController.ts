import type { Request, Response } from 'express';
import type { GameServer } from '../realtime/GameServer.js';

/** Endpoints REST de jogadores (consulta). O join em si acontece pelo WebSocket. */
export class PlayerController {
  constructor(private game: GameServer) {}

  /** GET /api/players/online — quem está conectado agora (estado em memória). */
  online = (_req: Request, res: Response): void => {
    res.json({ count: this.game.onlineCount, players: this.game.onlinePlayers() });
  };

  /** GET /api/players — últimos jogadores vistos (banco). */
  recent = async (req: Request, res: Response): Promise<void> => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
    const [players, total] = await Promise.all([this.game.players.listRecent(limit), this.game.players.countRegistered()]);
    res.json({
      total,
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        hp: p.hp,
        kills: p.kills,
        x: p.posX,
        z: p.posZ,
        lastSeenAt: p.lastSeenAt,
        createdAt: p.createdAt,
        online: this.game.onlinePlayers().some((o) => o.id === p.id),
      })),
    });
  };
}

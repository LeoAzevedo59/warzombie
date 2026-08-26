import type { Request, Response } from 'express';
import type { GameServer } from '../realtime/GameServer.js';

/** GET /api/rooms — salas abertas agora (estado em memória; o banco é o espelho). */
export class RoomController {
  constructor(private game: GameServer) {}

  list = (_req: Request, res: Response): void => {
    res.json({ rooms: this.game.roomSummaries() });
  };
}

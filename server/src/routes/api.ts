import { Router } from 'express';
import { healthController } from '../controllers/HealthController.js';
import { PlayerController } from '../controllers/PlayerController.js';
import type { GameServer } from '../realtime/GameServer.js';

/** Rotas HTTP sob /api. Tudo o que é "tempo real" vai pelo WebSocket em /ws. */
export function apiRouter(game: GameServer): Router {
  const router = Router();
  const players = new PlayerController(game);

  router.get('/health', healthController(game));
  router.get('/players/online', players.online);
  router.get('/players', players.recent);

  return router;
}

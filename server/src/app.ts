import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middlewares/errorHandler.js';
import type { GameServer } from './realtime/GameServer.js';
import { apiRouter } from './routes/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Build do Vite (a "View" do monolito). Em dev o Vite serve o client e faz proxy pra cá. */
const CLIENT_DIST = path.resolve(here, '../../../../client/dist');

export function createApp(game: GameServer): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '64kb' }));

  app.use('/api', apiRouter(game));

  if (env.isProd) {
    // assets do Vite têm hash no nome (cache longo); o index.html nunca pode ficar preso no cache
    app.use(
      express.static(CLIENT_DIST, {
        maxAge: '1h',
        index: 'index.html',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    // SPA fallback: qualquer rota que não seja /api nem asset devolve o index
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    });
  }

  app.use('/api', notFound);
  app.use(errorHandler);
  return app;
}

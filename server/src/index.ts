import http from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { disconnectPrisma, prisma } from './lib/prisma.js';
import { SessionModel } from './models/SessionModel.js';
import { GameServer } from './realtime/GameServer.js';

const log = createLogger('boot');

async function main(): Promise<void> {
  await prisma.$connect();
  const stale = await SessionModel.closeAllOpen();
  if (stale) log.warn(`${stale} sessão(ões) ficaram abertas na execução anterior; fechadas`);
  const rooms = await GameServer.resetPersistedRooms();
  if (rooms) log.warn(`${rooms} sala(s) da execução anterior apagadas`);

  const server = http.createServer();
  const game = new GameServer(server);
  server.on('request', createApp(game));
  game.start();

  server.listen(env.PORT, () => {
    log.info(`HTTP em http://localhost:${env.PORT}  |  WS em ws://localhost:${env.PORT}/ws  |  ${env.NODE_ENV}`);
  });

  const shutdown = async (signal: string) => {
    log.info(`${signal} recebido, encerrando...`);
    await game.stop();
    server.close();
    await disconnectPrisma();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error('falha ao iniciar', err);
  process.exit(1);
});

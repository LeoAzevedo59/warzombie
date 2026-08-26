import type { IncomingMessage } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type PlayerPose,
  type PlayerSnapshot,
  type ServerMessage,
} from '../../../shared/protocol.js';
import { env } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import { PlayerService, PlayerServiceError } from '../services/PlayerService.js';
import { parseClientMessage } from './messages.js';

const log = createLogger('ws');

/** Salva posição/hp/kills no banco a cada N ms por jogador (além do disconnect). */
const AUTOSAVE_MS = 15_000;
/** Conexões sem `join` são derrubadas depois disso. */
const JOIN_TIMEOUT_MS = 10_000;
/** Heartbeat: ping nativo do ws; quem não responde em 2 ciclos cai. */
const HEARTBEAT_MS = 15_000;

interface Connection {
  socket: WebSocket;
  ip: string | null;
  alive: boolean;
  /** preenchido depois do `join` */
  player: PlayerSnapshot | null;
  sessionId: string | null;
  lastSaveAt: number;
  dirty: boolean;
}

/**
 * Hub do multiplayer: aceita conexões, valida mensagens, mantém o estado em memória
 * dos jogadores online e faz broadcast a WS_TICK_RATE Hz.
 * Persistência (join/leave/autosave) passa sempre pelo PlayerService -> Model -> Prisma.
 */
export class GameServer {
  private wss: WebSocketServer;
  private connections = new Set<Connection>();
  private byPlayerId = new Map<string, Connection>();
  private tickTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  readonly players: PlayerService;

  constructor(httpServer: HttpServer) {
    this.players = new PlayerService((id) => this.byPlayerId.has(id));
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    this.wss.on('connection', (socket, req) => this.onConnection(socket, req));
  }

  start(): void {
    const interval = Math.max(10, Math.round(1000 / env.WS_TICK_RATE));
    this.tickTimer = setInterval(() => this.tick(), interval);
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    log.info(`GameServer iniciado (tick ${env.WS_TICK_RATE}Hz, path /ws)`);
  }

  async stop(): Promise<void> {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    await Promise.all([...this.connections].map((c) => this.leave(c, 'server_shutdown')));
    this.wss.close();
  }

  /** Snapshot de todos os jogadores online (usado pela API REST). */
  onlinePlayers(): PlayerSnapshot[] {
    const out: PlayerSnapshot[] = [];
    for (const c of this.byPlayerId.values()) if (c.player) out.push(c.player);
    return out;
  }

  get onlineCount(): number {
    return this.byPlayerId.size;
  }

  // ---------- ciclo de vida da conexão ----------

  private onConnection(socket: WebSocket, req: IncomingMessage): void {
    const conn: Connection = {
      socket,
      ip: clientIp(req),
      alive: true,
      player: null,
      sessionId: null,
      lastSaveAt: Date.now(),
      dirty: false,
    };
    this.connections.add(conn);
    log.debug(`conexão aberta de ${conn.ip} (${this.connections.size} sockets)`);

    const joinTimeout = setTimeout(() => {
      if (!conn.player) socket.close(4000, 'join timeout');
    }, JOIN_TIMEOUT_MS);

    socket.on('pong', () => (conn.alive = true));
    socket.on('message', (data) => this.onMessage(conn, data.toString()));
    socket.on('close', () => {
      clearTimeout(joinTimeout);
      void this.leave(conn, 'close');
    });
    socket.on('error', (err) => log.warn(`erro no socket de ${conn.player?.name ?? conn.ip}`, err.message));
  }

  private async onMessage(conn: Connection, raw: string): Promise<void> {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return this.send(conn, { type: 'error', code: 'invalid_message', message: 'JSON inválido' });
    }
    const msg = parseClientMessage(json);
    if (!msg) return this.send(conn, { type: 'error', code: 'invalid_message', message: 'Mensagem fora do protocolo' });

    if (msg.type === 'join') return this.handleJoin(conn, msg);
    if (msg.type === 'ping') return this.send(conn, { type: 'pong', t: msg.t });
    if (!conn.player) return this.send(conn, { type: 'error', code: 'not_joined', message: 'Envie join primeiro' });

    if (msg.type === 'move') this.handleMove(conn, msg);
    else if (msg.type === 'stats') {
      conn.player.hp = msg.hp;
      conn.player.kills = msg.kills;
      conn.dirty = true;
    }
  }

  private async handleJoin(conn: Connection, msg: Extract<ClientMessage, { type: 'join' }>): Promise<void> {
    if (conn.player) return; // join duplicado: ignora
    if (msg.version !== PROTOCOL_VERSION) {
      this.send(conn, { type: 'error', code: 'version_mismatch', message: `Protocolo ${msg.version} ≠ servidor ${PROTOCOL_VERSION}. Recarregue a página.` });
      return conn.socket.close(4001, 'version mismatch');
    }
    try {
      const { player, sessionId } = await this.players.join(msg.name, conn.ip);
      if (conn.socket.readyState !== WebSocket.OPEN) {
        await this.players.leave(player.id, sessionId, { posX: player.posX, posZ: player.posZ, hp: player.hp, kills: player.kills });
        return;
      }
      conn.sessionId = sessionId;
      conn.player = {
        id: player.id,
        name: player.name,
        hp: player.hp,
        kills: player.kills,
        x: player.posX,
        z: player.posZ,
        yaw: 0,
        anim: 'Idle',
        crouching: false,
      };
      this.byPlayerId.set(player.id, conn);

      this.send(conn, {
        type: 'welcome',
        you: conn.player,
        players: this.onlinePlayers().filter((p) => p.id !== player.id),
        seed: env.WORLD_SEED,
        tickRate: env.WS_TICK_RATE,
      });
      this.broadcast({ type: 'player_joined', player: conn.player }, conn);
      log.info(`${player.name} entrou (${this.onlineCount} online)`);
    } catch (err) {
      if (err instanceof PlayerServiceError) {
        this.send(conn, { type: 'error', code: err.code, message: err.message });
      } else {
        log.error('falha no join', err);
        this.send(conn, { type: 'error', code: 'server_error', message: 'Erro interno ao entrar no jogo' });
      }
    }
  }

  private handleMove(conn: Connection, pose: PlayerPose): void {
    const p = conn.player!;
    p.x = pose.x;
    p.z = pose.z;
    p.yaw = pose.yaw;
    p.anim = pose.anim;
    p.crouching = pose.crouching;
    conn.dirty = true;
  }

  private async leave(conn: Connection, reason: string): Promise<void> {
    if (!this.connections.delete(conn)) return;
    const { player, sessionId } = conn;
    if (!player || !sessionId) return;
    this.byPlayerId.delete(player.id);
    this.broadcast({ type: 'player_left', id: player.id });
    log.info(`${player.name} saiu (${reason}; ${this.onlineCount} online)`);
    try {
      await this.players.leave(player.id, sessionId, { posX: player.x, posZ: player.z, hp: player.hp, kills: player.kills });
    } catch (err) {
      log.error(`falha ao persistir saída de ${player.name}`, err);
    }
  }

  // ---------- loop ----------

  private tick(): void {
    if (this.byPlayerId.size === 0) return;
    const all = this.onlinePlayers();
    const now = Date.now();
    for (const conn of this.byPlayerId.values()) {
      const me = conn.player!;
      const others = all.filter((p) => p.id !== me.id).map(({ id, x, z, yaw, anim, crouching }) => ({ id, x, z, yaw, anim, crouching }));
      // mesmo sem "others" enviamos para o client saber que o servidor está vivo
      this.send(conn, { type: 'state', players: others });

      if (conn.dirty && now - conn.lastSaveAt > AUTOSAVE_MS) {
        conn.dirty = false;
        conn.lastSaveAt = now;
        this.players
          .saveState(me.id, { posX: me.x, posZ: me.z, hp: me.hp, kills: me.kills })
          .catch((err) => log.error(`autosave falhou para ${me.name}`, err));
      }
    }
  }

  private heartbeat(): void {
    for (const conn of this.connections) {
      if (!conn.alive) {
        conn.socket.terminate();
        continue;
      }
      conn.alive = false;
      conn.socket.ping();
    }
  }

  // ---------- envio ----------

  private send(conn: Connection, msg: ServerMessage): void {
    if (conn.socket.readyState === WebSocket.OPEN) conn.socket.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage, except?: Connection): void {
    const data = JSON.stringify(msg);
    for (const conn of this.byPlayerId.values()) {
      if (conn !== except && conn.socket.readyState === WebSocket.OPEN) conn.socket.send(data);
    }
  }
}

function clientIp(req: IncomingMessage): string | null {
  const fwd = req.headers['x-forwarded-for'];
  const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0];
  return (first ?? req.socket.remoteAddress ?? null)?.trim() ?? null;
}

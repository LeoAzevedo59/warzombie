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
import { RoomModel } from '../models/RoomModel.js';
import { Match, MatchError } from '../game/Match.js';
import { PlayerService, PlayerServiceError } from '../services/PlayerService.js';
import { RoomService, RoomServiceError } from '../services/RoomService.js';
import { parseClientMessage } from './messages.js';
import { Room } from './Room.js';

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
  /** sala atual (null = lobby) */
  room: Room | null;
  lastSaveAt: number;
  dirty: boolean;
  /** último instante em que o tempo jogado foi contabilizado (ms) */
  playtimeMark: number;
}

type Msg<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;

/**
 * Hub do multiplayer: aceita conexões, valida mensagens, mantém jogadores online e salas em
 * memória, e faz broadcast de estado por sala a WS_TICK_RATE Hz.
 * Persistência (join/leave/autosave/salas) passa sempre por Service -> Model -> Prisma.
 */
export class GameServer {
  private wss: WebSocketServer;
  private connections = new Set<Connection>();
  private byPlayerId = new Map<string, Connection>();
  readonly rooms = new Map<string, Room>();
  private tickTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  readonly players: PlayerService;
  readonly roomService = new RoomService();

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

  roomSummaries() {
    return [...this.rooms.values()].map((r) => r.summary());
  }

  // ---------- ciclo de vida da conexão ----------

  private onConnection(socket: WebSocket, req: IncomingMessage): void {
    const conn: Connection = {
      socket,
      ip: clientIp(req),
      alive: true,
      player: null,
      sessionId: null,
      room: null,
      lastSaveAt: Date.now(),
      dirty: false,
      playtimeMark: Date.now(),
    };
    this.connections.add(conn);
    log.debug(`conexão aberta de ${conn.ip} (${this.connections.size} sockets)`);

    const joinTimeout = setTimeout(() => {
      if (!conn.player) socket.close(4000, 'join timeout');
    }, JOIN_TIMEOUT_MS);

    socket.on('pong', () => (conn.alive = true));
    socket.on('message', (data) => void this.onMessage(conn, data.toString()));
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

    try {
      switch (msg.type) {
        case 'move':
          return this.handleMove(conn, msg);
        case 'pickup':
          return this.match(conn).pickup(conn.player.id, msg.objectId);
        case 'hit_node':
          return this.match(conn).hitNode(conn.player.id, msg.objectId);
        case 'select_slot':
          return this.match(conn).selectSlot(conn.player.id, msg.index);
        case 'sell':
          return this.match(conn).sell(conn.player.id);
        case 'buy':
          return this.match(conn).buy(conn.player.id, msg.itemId);
        case 'fire':
          return this.match(conn).fire(conn.player.id, msg.dx, msg.dz);
        case 'reload':
          return this.match(conn).reload(conn.player.id);
        case 'melee':
          return this.match(conn).melee(conn.player.id, msg.dx, msg.dz);
        case 'activate_battery':
          return this.match(conn).activateBattery(conn.player.id);
        case 'use_item':
          return this.match(conn).useItem(conn.player.id);
        case 'upgrade':
          return this.match(conn).buyUpgrade(conn.player.id, msg.kind);
        case 'tower_repair':
          return this.match(conn).repairTower(conn.player.id);
        case 'tower_upgrade':
          return this.match(conn).upgradeTower(conn.player.id);
        case 'buy_feature':
          return this.match(conn).buyFeature(conn.player.id, msg.feature);
        case 'place_wall':
          return this.match(conn).placeWall(conn.player.id, msg.x, msg.z, msg.yaw);
        case 'drop_item':
          return this.match(conn).dropItem(conn.player.id);
        case 'pickup_drop':
          return this.match(conn).pickupDrop(conn.player.id, msg.id);
        case 'dev':
          if (!env.devCheats) return this.send(conn, { type: 'error', code: 'dev_disabled', message: 'Cheats desligados neste servidor.' });
          log.warn(`[dev] ${conn.player.name}: ${msg.action}`);
          return this.match(conn).dev(conn.player.id, msg);
        case 'room_list':
          return this.send(conn, { type: 'lobby_state', rooms: this.roomSummaries() });
        case 'room_create':
          return await this.handleRoomCreate(conn, msg);
        case 'room_join':
          return await this.handleRoomJoin(conn, msg);
        case 'room_leave':
          return await this.handleRoomLeave(conn);
        case 'room_set_visibility':
          return await this.handleRoomSetVisibility(conn, msg);
        case 'room_start':
          return await this.handleRoomStart(conn);
        case 'room_ready':
          return this.handleRoomReady(conn, msg.ready);
        case 'set_character':
          return await this.handleSetCharacter(conn, msg.character);
      }
    } catch (err) {
      if (err instanceof RoomServiceError || err instanceof MatchError) {
        this.send(conn, { type: 'error', code: err.code, message: err.message });
      } else {
        log.error(`falha ao processar ${msg.type} de ${conn.player.name}`, err);
        this.send(conn, { type: 'error', code: 'server_error', message: 'Erro interno' });
      }
    }
  }

  private async handleJoin(conn: Connection, msg: Msg<'join'>): Promise<void> {
    if (conn.player) return; // join duplicado: ignora
    if (msg.version !== PROTOCOL_VERSION) {
      this.send(conn, { type: 'error', code: 'version_mismatch', message: `Protocolo ${msg.version} ≠ servidor ${PROTOCOL_VERSION}. Recarregue a página.` });
      return conn.socket.close(4001, 'version mismatch');
    }
    try {
      const { player, sessionId } = await this.players.join(msg.name, conn.ip);
      if (conn.socket.readyState !== WebSocket.OPEN) {
        await this.players.leave(player.id, sessionId, { posX: player.posX, posZ: player.posZ, hp: player.hp, kills: player.kills, pvpKills: player.pvpKills, deaths: player.deaths }, 0);
        return;
      }
      conn.sessionId = sessionId;
      conn.player = {
        id: player.id,
        name: player.name,
        character: this.players.characterOf(player),
        hp: player.hp,
        kills: player.kills,
        pvpKills: player.pvpKills,
        deaths: player.deaths,
        x: player.posX,
        z: player.posZ,
        yaw: 0,
        anim: 'Idle',
        crouching: false,
      };
      this.byPlayerId.set(player.id, conn);

      this.send(conn, { type: 'welcome', you: conn.player, tickRate: env.WS_TICK_RATE, devCheats: env.devCheats });
      this.send(conn, { type: 'lobby_state', rooms: this.roomSummaries() });
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

  /** Partida da sala do jogador (erro se não estiver em partida). */
  private match(conn: Connection): Match {
    const m = conn.room?.match;
    if (!m) throw new RoomServiceError('not_in_room', 'Você não está em uma partida.');
    return m;
  }

  private handleMove(conn: Connection, pose: PlayerPose): void {
    const p = conn.player!;
    // morto não se move: o servidor mantém a pose do momento da morte até o respawn
    if (conn.room?.match?.players.get(p.id)?.dead) return;
    p.x = pose.x;
    p.z = pose.z;
    p.yaw = pose.yaw;
    p.anim = pose.anim;
    p.crouching = pose.crouching;
    conn.dirty = true;
  }

  // ---------- salas ----------

  private async handleRoomCreate(conn: Connection, msg: Msg<'room_create'>): Promise<void> {
    const player = conn.player!;
    const row = await this.roomService.create(player.id, msg.name, msg.visibility, conn.room?.view() ?? null);
    const room = new Room(row);
    room.members.set(player.id, { socket: conn.socket, player });
    this.rooms.set(room.id, room);
    conn.room = room;
    log.info(`${player.name} criou a sala "${room.name}" (${room.visibility}${room.code ? ` #${room.code}` : ''})`);
    room.broadcastState();
    this.broadcastLobby();
  }

  private async handleRoomJoin(conn: Connection, msg: Msg<'room_join'>): Promise<void> {
    const player = conn.player!;
    const room = this.rooms.get(msg.roomId);
    if (!room) throw new RoomServiceError('room_not_found', 'Sala não encontrada.');
    await room.serialize(() => this.roomService.join(player.id, room.view(), msg.code, conn.room?.view() ?? null));
    if (!this.rooms.has(room.id)) throw new RoomServiceError('room_not_found', 'A sala foi fechada.');
    room!.members.set(player.id, { socket: conn.socket, player });
    conn.room = room!;
    log.info(`${player.name} entrou na sala "${room!.name}" (${room!.members.size}/${room!.members.size})`);
    room!.broadcastState();
    this.broadcastLobby();
    if (room!.status !== 'LOBBY') this.enterWorld(conn, room!);
  }

  private async handleRoomLeave(conn: Connection): Promise<void> {
    if (!conn.room) throw new RoomServiceError('not_in_room', 'Você não está em uma sala.');
    await this.leaveRoom(conn, 'saiu');
    this.send(conn, { type: 'room_left', reason: 'left' });
    this.send(conn, { type: 'lobby_state', rooms: this.roomSummaries() });
  }

  private async handleRoomSetVisibility(conn: Connection, msg: Msg<'room_set_visibility'>): Promise<void> {
    const room = conn.room;
    const code = await this.roomService.setVisibility(conn.player!.id, room?.view() ?? null, msg.visibility);
    room!.visibility = msg.visibility;
    room!.code = code;
    room!.broadcastState();
    this.broadcastLobby();
  }

  /** PRONTO no lobby: o dono só consegue iniciar quando todos marcaram. */
  private handleRoomReady(conn: Connection, ready: boolean): void {
    const room = conn.room;
    if (!room) throw new RoomServiceError('not_in_room', 'Você não está em uma sala.');
    if (room.status !== 'LOBBY') throw new RoomServiceError('room_not_in_lobby', 'A partida já começou.');
    if (ready) room.ready.add(conn.player!.id);
    else room.ready.delete(conn.player!.id);
    room.broadcastState();
  }

  /** Troca de personagem (persistida); não vale no meio de uma partida. */
  private async handleSetCharacter(conn: Connection, character: Msg<'set_character'>['character']): Promise<void> {
    const room = conn.room;
    if (room && room.status !== 'LOBBY') throw new RoomServiceError('room_not_in_lobby', 'Não dá para trocar de personagem durante a partida.');
    conn.player!.character = character;
    await this.players.setCharacter(conn.player!.id, character);
    if (room) room.broadcastState();
  }

  private async handleRoomStart(conn: Connection): Promise<void> {
    const room = conn.room;
    await this.roomService.start(conn.player!.id, room?.view() ?? null);
    room!.status = 'PLAYING';
    // trava a sala: só quem está aqui agora pode voltar se sair
    room!.roster.clear();
    for (const id of room!.members.keys()) room!.roster.add(id);
    room!.match = this.createMatch(room!);
    log.info(`sala "${room!.name}" iniciou com ${room!.members.size} jogador(es)`);
    // partida começa com todos no centro do mapa, espalhados num círculo para não nascerem sobrepostos
    let i = 0;
    const n = room!.members.size;
    for (const m of room!.members.values()) {
      const a = (i++ / n) * Math.PI * 2;
      m.player.x = n > 1 ? Math.cos(a) * 1.5 : 0;
      m.player.z = n > 1 ? Math.sin(a) * 1.5 : 0;
      m.player.anim = 'Idle';
    }
    room!.broadcastState();
    for (const m of room!.members.values()) {
      const c = this.byPlayerId.get(m.player.id);
      if (c) this.enterWorld(c, room!);
    }
    this.broadcastLobby();
  }

  private createMatch(room: Room): Match {
    return new Match(env.WORLD_SEED, room.money, {
      send: (playerId, msg) => {
        const m = room.members.get(playerId);
        if (m) room.send(m, msg);
      },
      broadcast: (msg) => room.broadcast(msg),
      onMoneyChanged: (amount) => {
        room.money = amount;
        if (!this.rooms.has(room.id)) return; // sala já apagada
        RoomModel.update(room.id, { money: amount }).catch((err) => log.error(`falha ao salvar dinheiro da sala ${room.name}`, err));
      },
      onWaveChanged: (wave) => {
        room.wave = wave;
        if (!this.rooms.has(room.id)) return;
        RoomModel.update(room.id, { wave }).catch((err) => log.error(`falha ao salvar wave da sala ${room.name}`, err));
      },
      onGameOver: () => {
        log.info(`sala "${room.name}": torre destruída — reiniciando do zero em 6s`);
        setTimeout(() => this.restartMatch(room), 6000);
      },
      onPhaseComplete: () => {
        room.status = 'FINISHED';
        log.info(`sala "${room.name}" concluiu a fase 1 (5 chefões)`);
        room.broadcastState();
        this.broadcastLobby();
        if (!this.rooms.has(room.id)) return;
        RoomModel.update(room.id, { status: 'FINISHED' }).catch((err) => log.error(`falha ao salvar status da sala ${room.name}`, err));
      },
    });
  }

  /** Torre destruída: partida nova (dinheiro 0, hotbars vazias, mundo/torre novos) para quem ainda está na sala. */
  private restartMatch(room: Room): void {
    if (!this.rooms.has(room.id) || room.members.size === 0) return;
    room.money = 0;
    room.wave = 0;
    room.status = 'PLAYING';
    room.match = this.createMatch(room);
    RoomModel.update(room.id, { money: 0, wave: 0, status: 'PLAYING' }).catch((err) => log.error('falha ao resetar sala', err));
    for (const m of room.members.values()) {
      m.player.x = 0;
      m.player.z = 0;
      m.player.anim = 'Idle';
      const c = this.byPlayerId.get(m.player.id);
      if (c) this.enterWorld(c, room);
    }
    room.broadcastState();
  }

  /** Manda o jogador para o mundo da sala e avisa quem já está lá. */
  private enterWorld(conn: Connection, room: Room): void {
    const match = room.match ?? (room.match = this.createMatch(room));
    const mp = match.addPlayer(conn.player!);
    this.send(conn, {
      type: 'game_start',
      seed: env.WORLD_SEED,
      players: room.snapshots(),
      removedObjects: [...match.removed],
      money: match.money,
      hotbar: mp.hotbar,
      equipped: mp.equipped,
      wave: match.waveState(),
      upgrades: { ...mp.upgrades },
      upgradePrices: match.upgradePrices(),
      magSize: match.magSizeOf(mp),
      ammo: mp.mag,
      batteryPrice: match.batteryPrice(),
      tower: match.towerPos,
      towerHp: match.towerHp,
      towerMaxHp: match.towerMaxHp,
      towerLevel: match.towerLevel,
      structures: [...match.structures.values()],
      drops: [...match.drops.values()],
      features: { ...match.features },
    });
    room.broadcast({ type: 'player_joined', player: conn.player! }, conn.player!.id);
  }

  /** Tira a conexão da sala atual (saída voluntária ou desconexão). */
  private async leaveRoom(conn: Connection, reason: string): Promise<void> {
    const room = conn.room;
    const player = conn.player;
    if (!room || !player) return;
    conn.room = null;
    // tudo dentro do lock da sala: saídas simultâneas não podem ver a sala "vazia" ao mesmo tempo
    await room.serialize(async () => {
      if (!room.members.delete(player.id)) return;
      room.ready.delete(player.id);
      room.match?.removePlayer(player.id);
      const remaining = [...room.members.keys()];
      const result = await this.roomService.leave(player.id, room.view(), remaining);
      if (result.deleted) {
        this.rooms.delete(room.id);
        log.info(`sala "${room.name}" ficou vazia e foi apagada`);
      } else {
        if (result.newOwnerId) room.ownerId = result.newOwnerId;
        room.broadcast({ type: 'player_left', id: player.id });
        room.broadcastState();
      }
      log.info(`${player.name} ${reason} da sala "${room.name}"`);
    });
    this.broadcastLobby();
  }

  /** Lista de salas para quem está no lobby (identificado e sem sala). */
  private broadcastLobby(): void {
    const msg: ServerMessage = { type: 'lobby_state', rooms: this.roomSummaries() };
    const data = JSON.stringify(msg);
    for (const c of this.byPlayerId.values()) {
      if (!c.room && c.socket.readyState === WebSocket.OPEN) c.socket.send(data);
    }
  }

  private async leave(conn: Connection, reason: string): Promise<void> {
    if (!this.connections.delete(conn)) return;
    const { player, sessionId } = conn;
    if (!player || !sessionId) return;
    this.byPlayerId.delete(player.id);
    try {
      await this.leaveRoom(conn, 'desconectou');
    } catch (err) {
      log.error(`falha ao tirar ${player.name} da sala`, err);
    }
    log.info(`${player.name} saiu (${reason}; ${this.onlineCount} online)`);
    try {
      await this.players.leave(player.id, sessionId, { posX: player.x, posZ: player.z, hp: player.hp, kills: player.kills, pvpKills: player.pvpKills, deaths: player.deaths }, (Date.now() - conn.playtimeMark) / 1000);
    } catch (err) {
      log.error(`falha ao persistir saída de ${player.name}`, err);
    }
  }

  // ---------- loop ----------

  private tick(): void {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (room.status === 'LOBBY') continue;
      room.match?.tick();
      const all = room.snapshots();
      const zombies = room.match?.zombieSnapshots() ?? [];
      const projectiles = room.match?.projectileSnapshots() ?? [];
      for (const m of room.members.values()) {
        const others = all
          .filter((p) => p.id !== m.player.id)
          .map(({ id, x, z, yaw, anim, crouching }) => ({ id, x, z, yaw, anim, crouching }));
        room.send(m, { type: 'state', players: others, zombies, projectiles });
      }
      // contagem regressiva/vivos mudam a cada segundo: manda wave_state 1x/s enquanto ativo
      if (room.match?.waves.active && now - room.lastWaveStateAt >= 1000) {
        room.lastWaveStateAt = now;
        room.broadcast({ type: 'wave_state', wave: room.match.waveState() });
      }
    }
    for (const conn of this.byPlayerId.values()) {
      const me = conn.player!;
      if (now - conn.lastSaveAt > AUTOSAVE_MS) {
        conn.dirty = false;
        conn.lastSaveAt = now;
        const delta = (now - conn.playtimeMark) / 1000;
        conn.playtimeMark = now;
        this.players
          .saveState(me.id, { posX: me.x, posZ: me.z, hp: me.hp, kills: me.kills, pvpKills: me.pvpKills, deaths: me.deaths }, delta)
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

  /** Limpeza no boot: salas não sobrevivem a restart. */
  static async resetPersistedRooms(): Promise<number> {
    return RoomModel.deleteAll();
  }
}

function clientIp(req: IncomingMessage): string | null {
  const fwd = req.headers['x-forwarded-for'];
  const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0];
  return (first ?? req.socket.remoteAddress ?? null)?.trim() ?? null;
}

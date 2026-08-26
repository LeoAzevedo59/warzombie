import { WebSocket } from 'ws';
import {
  MAX_ROOM_PLAYERS,
  type PlayerSnapshot,
  type RoomDetail,
  type RoomStatus,
  type RoomSummary,
  type RoomVisibility,
  type ServerMessage,
} from '../../../shared/protocol.js';
import type { Room as RoomRow } from '../models/RoomModel.js';
import type { RoomView } from '../services/RoomService.js';
import type { Match } from '../game/Match.js';

/** Conexão de um jogador já identificado (subset do Connection do GameServer). */
export interface Member {
  socket: WebSocket;
  player: PlayerSnapshot;
}

/**
 * Sala viva: membros conectados + estado da partida em memória.
 * A verdade "de quem está online" é esta; o banco guarda o espelho (rooms/room_members).
 */
export class Room {
  readonly id: string;
  name: string;
  visibility: RoomVisibility;
  code: string | null;
  ownerId: string;
  status: RoomStatus;
  money: number;
  wave: number;
  /** ordem de inserção = ordem de entrada (usada para transferir o owner) */
  readonly members = new Map<string, Member>();
  /** simulação da partida; existe a partir do room_start */
  match: Match | null = null;
  lastWaveStateAt = 0;
  /** operações de entrada/saída/owner são serializadas por sala (evita corrida ao apagar) */
  private lock: Promise<void> = Promise.resolve();

  /** Executa  depois das operações anteriores da sala terminarem. */
  serialize<T>(op: () => Promise<T>): Promise<T> {
    const run = this.lock.then(op);
    this.lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  constructor(row: RoomRow) {
    this.id = row.id;
    this.name = row.name;
    this.visibility = row.visibility;
    this.code = row.code;
    this.ownerId = row.ownerId;
    this.status = row.status;
    this.money = row.money;
    this.wave = row.wave;
  }

  get ownerName(): string {
    return this.members.get(this.ownerId)?.player.name ?? '?';
  }

  view(): RoomView {
    return {
      id: this.id,
      ownerId: this.ownerId,
      visibility: this.visibility,
      code: this.code,
      status: this.status,
      memberIds: [...this.members.keys()],
    };
  }

  summary(): RoomSummary {
    return {
      id: this.id,
      name: this.name,
      visibility: this.visibility,
      status: this.status,
      members: this.members.size,
      max: MAX_ROOM_PLAYERS,
      ownerName: this.ownerName,
    };
  }

  detail(forPlayerId: string): RoomDetail {
    const d: RoomDetail = {
      ...this.summary(),
      ownerId: this.ownerId,
      memberList: [...this.members.values()].map((m) => ({ id: m.player.id, name: m.player.name })),
      money: this.money,
      wave: this.wave,
    };
    if (forPlayerId === this.ownerId && this.code) d.code = this.code;
    return d;
  }

  snapshots(): PlayerSnapshot[] {
    return [...this.members.values()].map((m) => m.player);
  }

  send(member: Member, msg: ServerMessage): void {
    if (member.socket.readyState === WebSocket.OPEN) member.socket.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMessage, exceptPlayerId?: string): void {
    const data = JSON.stringify(msg);
    for (const m of this.members.values()) {
      if (m.player.id !== exceptPlayerId && m.socket.readyState === WebSocket.OPEN) m.socket.send(data);
    }
  }

  /** `room_state` é personalizado (código só para o owner), por isso não usa broadcast(). */
  broadcastState(): void {
    for (const m of this.members.values()) this.send(m, { type: 'room_state', room: this.detail(m.player.id) });
  }
}

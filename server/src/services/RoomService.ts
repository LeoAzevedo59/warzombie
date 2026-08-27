import { isValidRoomName, MAX_ROOM_PLAYERS, ROOM_CODE_REGEX } from '../../../shared/protocol.js';
import type { RoomStatus, RoomVisibility } from '../models/RoomModel.js';
import { RoomModel, type Room } from '../models/RoomModel.js';

export type RoomErrorCode =
  | 'invalid_message'
  | 'room_not_found'
  | 'room_full'
  | 'bad_code'
  | 'not_owner'
  | 'not_in_room'
  | 'already_in_room'
  | 'room_not_in_lobby'
  | 'not_all_ready'
  | 'room_locked';

export class RoomServiceError extends Error {
  constructor(
    readonly code: RoomErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Estado mínimo da sala em memória que o service precisa para validar (fornecido pelo realtime). */
export interface RoomView {
  id: string;
  ownerId: string;
  visibility: RoomVisibility;
  code: string | null;
  status: RoomStatus;
  memberIds: string[];
  /** quem já marcou PRONTO no lobby */
  readyIds: string[];
  /** quem estava na sala quando a partida começou (só eles podem voltar) */
  rosterIds: string[];
}

/**
 * Regras de negócio de salas. Persiste via RoomModel; o estado "vivo" (quem está conectado)
 * é passado como RoomView pelo GameServer, que é quem o mantém.
 */
export class RoomService {
  async create(ownerId: string, name: string, visibility: RoomVisibility, currentRoom: RoomView | null): Promise<Room> {
    if (currentRoom) throw new RoomServiceError('already_in_room', 'Saia da sala atual antes de criar outra.');
    if (!isValidRoomName(name)) throw new RoomServiceError('invalid_message', 'Nome da sala deve ter 2–24 caracteres.');
    const code = visibility === 'PRIVATE' ? await this.uniqueCode() : null;
    return RoomModel.create({ name: name.trim(), visibility, code, ownerId });
  }

  async join(playerId: string, room: RoomView | undefined, code: string | undefined, currentRoom: RoomView | null): Promise<void> {
    if (currentRoom) throw new RoomServiceError('already_in_room', 'Você já está em uma sala.');
    if (!room) throw new RoomServiceError('room_not_found', 'Sala não encontrada.');
    // partida em andamento: só quem estava na sala no início pode voltar
    if (room.status !== 'LOBBY' && !room.rosterIds.includes(playerId)) throw new RoomServiceError('room_locked', 'A partida já começou: só quem estava na sala pode entrar.');
    if (room.memberIds.length >= MAX_ROOM_PLAYERS) throw new RoomServiceError('room_full', `Sala cheia (${MAX_ROOM_PLAYERS}/${MAX_ROOM_PLAYERS}).`);
    if (room.visibility === 'PRIVATE') {
      if (!code || !ROOM_CODE_REGEX.test(code) || code !== room.code) {
        throw new RoomServiceError('bad_code', 'Código da sala incorreto.');
      }
    }
    await RoomModel.addMember(room.id, playerId);
  }

  /**
   * Remove o jogador. Retorna o novo owner (se mudou) ou `deleted: true` se a sala ficou vazia.
   * `remaining` deve vir em ordem de entrada (o mais antigo vira owner).
   */
  async leave(playerId: string, room: RoomView, remaining: string[]): Promise<{ deleted: boolean; newOwnerId: string | null }> {
    await RoomModel.removeMember(playerId);
    if (remaining.length === 0) {
      await RoomModel.delete(room.id);
      return { deleted: true, newOwnerId: null };
    }
    if (room.ownerId === playerId) {
      const newOwnerId = remaining[0];
      await RoomModel.update(room.id, { ownerId: newOwnerId });
      return { deleted: false, newOwnerId };
    }
    return { deleted: false, newOwnerId: null };
  }

  async setVisibility(playerId: string, room: RoomView | null, visibility: RoomVisibility): Promise<string | null> {
    this.assertOwner(playerId, room);
    const code = visibility === 'PRIVATE' ? (room!.code ?? (await this.uniqueCode())) : null;
    await RoomModel.update(room!.id, { visibility, code });
    return code;
  }

  async start(playerId: string, room: RoomView | null): Promise<void> {
    this.assertOwner(playerId, room);
    if (room!.status !== 'LOBBY') throw new RoomServiceError('room_not_in_lobby', 'A partida já começou.');
    const missing = room!.memberIds.filter((id) => !room!.readyIds.includes(id)).length;
    if (missing > 0) throw new RoomServiceError('not_all_ready', `Todos precisam marcar PRONTO (faltam ${missing}).`);
    await RoomModel.update(room!.id, { status: 'PLAYING' });
  }

  private assertOwner(playerId: string, room: RoomView | null): void {
    if (!room) throw new RoomServiceError('not_in_room', 'Você não está em uma sala.');
    if (room.ownerId !== playerId) throw new RoomServiceError('not_owner', 'Só o dono da sala pode fazer isso.');
  }

  private async uniqueCode(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      if (!(await RoomModel.codeExists(code))) return code;
    }
    throw new Error('Não foi possível gerar um código único de sala');
  }
}

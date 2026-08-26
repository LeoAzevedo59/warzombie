/**
 * Protocolo WebSocket do WarZombie — único contrato entre client e server.
 * Mensagens são JSON `{ type, ...payload }`. Alterou aqui? Os dois lados quebram no typecheck.
 *
 * Passo 1 (multiplayer de teste): o client é autoritativo sobre a própria posição/animação;
 * o server valida o formato, persiste e retransmite. Zumbis, loot e craft ainda são locais.
 */

import type { ItemId, ItemStack } from './items.js';

export const PROTOCOL_VERSION = 3;

export const MAX_ROOM_PLAYERS = 10;
export const ROOM_NAME_MIN = 2;
export const ROOM_NAME_MAX = 24;
export const ROOM_CODE_REGEX = /^\d{4}$/;

export type RoomVisibility = 'PUBLIC' | 'PRIVATE';
export type RoomStatus = 'LOBBY' | 'PLAYING' | 'FINISHED';

/** Sala como aparece na lista do lobby. */
export interface RoomSummary {
  id: string;
  name: string;
  visibility: RoomVisibility;
  status: RoomStatus;
  members: number;
  max: number;
  ownerName: string;
}

/** Sala vista por quem está dentro dela. */
export interface RoomDetail extends RoomSummary {
  ownerId: string;
  /** só enviado ao owner de sala privada */
  code?: string;
  memberList: Array<{ id: string; name: string }>;
  money: number;
  wave: number;
}

/** Nome de animação que os outros clientes reproduzem no modelo remoto. */
export type NetAnim = 'Idle' | 'Walk' | 'Run' | 'Gun_Shoot' | 'Death';

/** Estado dinâmico de um jogador, atualizado a cada tick. */
export interface PlayerPose {
  x: number;
  z: number;
  /** rotação em torno de Y, graus */
  yaw: number;
  anim: NetAnim;
  crouching: boolean;
}

/** Snapshot completo de um jogador, enviado no join e nas listagens. */
export interface PlayerSnapshot extends PlayerPose {
  id: string;
  name: string;
  hp: number;
  kills: number;
}

// ---------- client -> server ----------

export interface JoinMessage {
  type: 'join';
  version: number;
  name: string;
}

export interface MoveMessage extends PlayerPose {
  type: 'move';
}

export interface PingMessage {
  type: 'ping';
  t: number;
}

// ---------- lobby / salas (client -> server) ----------

export interface RoomListMessage {
  type: 'room_list';
}
export interface RoomCreateMessage {
  type: 'room_create';
  name: string;
  visibility: RoomVisibility;
}
export interface RoomJoinMessage {
  type: 'room_join';
  roomId: string;
  code?: string;
}
export interface RoomLeaveMessage {
  type: 'room_leave';
}
export interface RoomSetVisibilityMessage {
  type: 'room_set_visibility';
  visibility: RoomVisibility;
}
export interface RoomStartMessage {
  type: 'room_start';
}

// ---------- partida (client -> server) ----------

/** Pegar coletável simples (graveto/pedra) — validado por distância e slot livre. */
export interface PickupMessage {
  type: 'pickup';
  objectId: number;
}
/** Um hit em árvore/rocha (o client manda a cada HIT_INTERVAL enquanto segura o canal). */
export interface HitNodeMessage {
  type: 'hit_node';
  objectId: number;
}
export interface SelectSlotMessage {
  type: 'select_slot';
  index: number;
}
/** Vende todos os recursos da hotbar (precisa estar perto do vendedor). */
export interface SellMessage {
  type: 'sell';
}
export interface BuyMessage {
  type: 'buy';
  itemId: ItemId;
}
/** Tiro na direção unitária (dx,dz) no plano do chão. */
export interface FireMessage {
  type: 'fire';
  dx: number;
  dz: number;
}
export interface ReloadMessage {
  type: 'reload';
}

export type ClientMessage =
  | JoinMessage
  | MoveMessage
  | PingMessage
  | PickupMessage
  | HitNodeMessage
  | SelectSlotMessage
  | SellMessage
  | BuyMessage
  | FireMessage
  | ReloadMessage
  | RoomListMessage
  | RoomCreateMessage
  | RoomJoinMessage
  | RoomLeaveMessage
  | RoomSetVisibilityMessage
  | RoomStartMessage;

// ---------- server -> client ----------

export interface WelcomeMessage {
  type: 'welcome';
  /** o próprio jogador, já persistido */
  you: PlayerSnapshot;
  tickRate: number;
}

/** Lista de salas; enviada a quem está no lobby sempre que algo muda. */
export interface LobbyStateMessage {
  type: 'lobby_state';
  rooms: RoomSummary[];
}

/** Estado da sala em que o destinatário está; enviado a todos os membros a cada mudança. */
export interface RoomStateMessage {
  type: 'room_state';
  room: RoomDetail;
}

/** Owner iniciou: todos os membros entram no mundo. */
export interface GameStartMessage {
  type: 'game_start';
  seed: number;
  /** jogadores já no mundo (o próprio destinatário incluso, com sua posição salva) */
  players: PlayerSnapshot[];
  /** objetos já coletados/quebrados nesta sala (o client não os instancia) */
  removedObjects: number[];
  money: number;
  hotbar: Array<ItemStack | null>;
  equipped: number;
}

// ---------- partida (server -> client) ----------

/** Hotbar do destinatário (o server é dono do inventário). */
export interface HotbarMessage {
  type: 'hotbar';
  slots: Array<ItemStack | null>;
  equipped: number;
}
/** Dinheiro compartilhado da sala. */
export interface MoneyMessage {
  type: 'money';
  amount: number;
  /** variação que causou a mensagem (+venda / -compra), para feedback */
  delta: number;
}
export interface ItemGainedMessage {
  type: 'item_gained';
  itemId: ItemId;
  count: number;
}
export interface ObjectRemovedMessage {
  type: 'object_removed';
  objectId: number;
}
export interface NodeHitMessage {
  type: 'node_hit';
  objectId: number;
  hits: number;
  required: number;
}
/** Alguém atirou: todos desenham o traçante a partir da posição desse jogador. */
export interface ShotMessage {
  type: 'shot';
  playerId: string;
  dx: number;
  dz: number;
  /** comprimento do traçante (até o alvo ou o alcance) */
  length: number;
  hitPlayerId?: string;
  hitZombieId?: number;
}
export interface AmmoMessage {
  type: 'ammo';
  mag: number;
  magSize: number;
  reloading: boolean;
}
export interface HpMessage {
  type: 'hp';
  playerId: string;
  hp: number;
  /** quem causou (para flash/feedback) */
  by?: string;
}
export interface PlayerDiedMessage {
  type: 'player_died';
  playerId: string;
  killerId?: string;
  /** segundos até renascer */
  respawnIn: number;
}
export interface PlayerRespawnedMessage {
  type: 'player_respawned';
  playerId: string;
  x: number;
  z: number;
  hp: number;
}

/** Servidor tirou o jogador da sala (sala fechada, etc.). */
export interface RoomLeftMessage {
  type: 'room_left';
  reason: string;
}

export interface PlayerJoinedMessage {
  type: 'player_joined';
  player: PlayerSnapshot;
}

export interface PlayerLeftMessage {
  type: 'player_left';
  id: string;
}

/** Broadcast periódico (WS_TICK_RATE Hz) com a pose de todos, exceto o destinatário. */
export interface StateMessage {
  type: 'state';
  players: Array<PlayerPose & { id: string }>;
}

export interface ErrorMessage {
  type: 'error';
  code:
    | 'invalid_message'
    | 'name_taken'
    | 'invalid_name'
    | 'not_joined'
    | 'version_mismatch'
    | 'server_error'
    | 'room_not_found'
    | 'room_full'
    | 'bad_code'
    | 'not_owner'
    | 'not_in_room'
    | 'already_in_room'
    | 'room_not_in_lobby'
    | 'too_far'
    | 'hotbar_full'
    | 'no_tool'
    | 'not_enough_money'
    | 'no_weapon'
    | 'dead';
  message: string;
}

export interface PongMessage {
  type: 'pong';
  t: number;
}

export type ServerMessage =
  | WelcomeMessage
  | LobbyStateMessage
  | RoomStateMessage
  | GameStartMessage
  | RoomLeftMessage
  | HotbarMessage
  | MoneyMessage
  | ItemGainedMessage
  | ObjectRemovedMessage
  | NodeHitMessage
  | ShotMessage
  | AmmoMessage
  | HpMessage
  | PlayerDiedMessage
  | PlayerRespawnedMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | StateMessage
  | ErrorMessage
  | PongMessage;

export const NAME_MIN = 2;
export const NAME_MAX = 16;
/** letras (com acento), números, espaço, _ e - */
export const NAME_REGEX = /^[\p{L}\p{N} _-]+$/u;

export function isValidName(name: string): boolean {
  const t = name.trim();
  return t.length >= NAME_MIN && t.length <= NAME_MAX && NAME_REGEX.test(t);
}

export function isValidRoomName(name: string): boolean {
  const t = name.trim();
  return t.length >= ROOM_NAME_MIN && t.length <= ROOM_NAME_MAX && NAME_REGEX.test(t);
}

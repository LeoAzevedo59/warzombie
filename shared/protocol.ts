/**
 * Protocolo WebSocket do WarZombie — único contrato entre client e server.
 * Mensagens são JSON `{ type, ...payload }`. Alterou aqui? Os dois lados quebram no typecheck.
 *
 * Passo 1 (multiplayer de teste): o client é autoritativo sobre a própria posição/animação;
 * o server valida o formato, persiste e retransmite. Zumbis, loot e craft ainda são locais.
 */

import type { ItemId, ItemStack } from './items.js';

export const PROTOCOL_VERSION = 8;

export type UpgradeKind = 'damage' | 'ammo' | 'recoil';
export interface WeaponUpgrades {
  damage: number;
  ammo: number;
  recoil: number;
}

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
/** Compra um nível de upgrade da arma (precisa estar perto do vendedor). */
export interface UpgradeMessage {
  type: 'upgrade';
  kind: UpgradeKind;
}

/** Cheats de desenvolvimento — só aceitos quando o servidor roda com DEV_CHEATS ligado. */
export type DevAction =
  | { action: 'money'; amount: number }
  | { action: 'give'; itemId: ItemId }
  | { action: 'damage_mult'; value: number }
  | { action: 'heal' }
  | { action: 'kill_zombies' }
  | { action: 'next_wave' }
  | { action: 'spawn_boss' };
export type DevMessage = { type: 'dev' } & DevAction;

/** Coloca a bateria (da hotbar) na torre: inicia as waves. Precisa estar perto da torre. */
export interface ActivateBatteryMessage {
  type: 'activate_battery';
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
  | ActivateBatteryMessage
  | UpgradeMessage
  | DevMessage
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
  /** servidor aceita mensagens `dev` (painel ⚙ no client) */
  devCheats: boolean;
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
  wave: WaveState;
  upgrades: WeaponUpgrades;
  magSize: number;
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
/** Níveis atuais de upgrade do destinatário. */
export interface UpgradesMessage {
  type: 'upgrades';
  upgrades: WeaponUpgrades;
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

export type ZombieKind = 'zombie' | 'spitter' | 'boss';
export type ZombieAnim = 'Idle' | 'Walk' | 'Run' | 'Punch_Left' | 'Kick_Right' | 'Death';

/** Zumbi como o client o renderiza (a simulação é do servidor). */
export interface ZombieSnapshot {
  id: number;
  kind: ZombieKind;
  x: number;
  z: number;
  yaw: number;
  anim: ZombieAnim;
  hp: number;
  maxHp: number;
}

export type WavePhase = 'idle' | 'countdown' | 'wave' | 'boss' | 'complete';

export interface WaveState {
  phase: WavePhase;
  /** wave atual (1..TOTAL), 0 antes de começar */
  wave: number;
  total: number;
  /** zumbis vivos agora */
  alive: number;
  /** s até a próxima wave (ou até a primeira), null se não há próxima agendada */
  nextIn: number | null;
}

/** Projétil (cuspe) em voo, simulado no servidor. */
export interface ProjectileSnapshot {
  id: number;
  x: number;
  z: number;
  /** disparado pelo chefão (maior/mais forte) */
  boss: boolean;
}

/** Broadcast periódico (WS_TICK_RATE Hz) com a pose de todos, exceto o destinatário, zumbis e projéteis. */
export interface StateMessage {
  type: 'state';
  players: Array<PlayerPose & { id: string }>;
  zombies: ZombieSnapshot[];
  projectiles: ProjectileSnapshot[];
}

/** Jogador nasceu/renasceu com escudo: sem dano nem lentidão por `seconds`. */
export interface ShieldMessage {
  type: 'shield';
  playerId: string;
  seconds: number;
}

/** Jogador foi atingido por um cuspe: anda a `factor` da velocidade por `seconds`. */
export interface SlowedMessage {
  type: 'slowed';
  playerId: string;
  factor: number;
  seconds: number;
}

export interface WaveStateMessage {
  type: 'wave_state';
  wave: WaveState;
}
export interface WaveStartedMessage {
  type: 'wave_started';
  wave: number;
  count: number;
  /** jogadores considerados na escala de dificuldade */
  players: number;
}
export interface BossSpawnedMessage {
  type: 'boss_spawned';
  id: number;
  hp: number;
}
/** Aviso da pancada em área do boss: o client desenha o círculo no chão até `windup` s. */
export interface BossSlamMessage {
  type: 'boss_slam';
  x: number;
  z: number;
  radius: number;
  windup: number;
}
export interface ZombieDiedMessage {
  type: 'zombie_died';
  id: number;
  kind: ZombieKind;
  killerId?: string;
}
export interface PhaseCompleteMessage {
  type: 'phase_complete';
}
export interface KnockbackMessage {
  type: 'knockback';
  dx: number;
  dz: number;
  force: number;
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
    | 'dead'
    | 'no_battery'
    | 'already_active'
    | 'dev_disabled';
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
  | UpgradesMessage
  | HpMessage
  | PlayerDiedMessage
  | PlayerRespawnedMessage
  | WaveStateMessage
  | WaveStartedMessage
  | BossSpawnedMessage
  | BossSlamMessage
  | ZombieDiedMessage
  | PhaseCompleteMessage
  | KnockbackMessage
  | SlowedMessage
  | ShieldMessage
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

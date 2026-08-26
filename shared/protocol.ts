/**
 * Protocolo WebSocket do WarZombie — único contrato entre client e server.
 * Mensagens são JSON `{ type, ...payload }`. Alterou aqui? Os dois lados quebram no typecheck.
 *
 * Passo 1 (multiplayer de teste): o client é autoritativo sobre a própria posição/animação;
 * o server valida o formato, persiste e retransmite. Zumbis, loot e craft ainda são locais.
 */

export const PROTOCOL_VERSION = 1;

/** Nome de animação que os outros clientes reproduzem no modelo remoto. */
export type NetAnim = 'Idle' | 'Walk' | 'Run' | 'Gun_Shoot';

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

export interface StatsMessage {
  type: 'stats';
  hp: number;
  kills: number;
}

export interface PingMessage {
  type: 'ping';
  t: number;
}

export type ClientMessage = JoinMessage | MoveMessage | StatsMessage | PingMessage;

// ---------- server -> client ----------

export interface WelcomeMessage {
  type: 'welcome';
  /** o próprio jogador, já persistido */
  you: PlayerSnapshot;
  /** demais jogadores online no momento do join */
  players: PlayerSnapshot[];
  /** seed do mundo compartilhado (mesmo mapa para todos) */
  seed: number;
  tickRate: number;
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
  code: 'invalid_message' | 'name_taken' | 'invalid_name' | 'not_joined' | 'version_mismatch' | 'server_error';
  message: string;
}

export interface PongMessage {
  type: 'pong';
  t: number;
}

export type ServerMessage =
  | WelcomeMessage
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

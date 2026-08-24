/** Constantes globais do jogo. Unidade = 1 metro = 1 tile. */
export const CONFIG = {
  world: {
    CHUNK_SIZE: 16, // tiles por lado de um chunk
    TILE_SIZE: 1,
    ACTIVE_RADIUS: 2, // chunks carregados em cada direção ao redor do player
    MAP_RADIUS: 2, // mapa fixo: chunks de -MAP_RADIUS a +MAP_RADIUS (5x5 no total)
    SEED: 1337,
    OBJECTS_PER_CHUNK_MIN: 3,
    OBJECTS_PER_CHUNK_MAX: 6,
  },
  player: {
    WALK_SPEED: 4,
    RUN_SPEED: 7.5,
    CROUCH_SPEED: 2,
    HEIGHT: 1.8,
    CROUCH_HEIGHT: 1.1,
    RADIUS: 0.35,
    MAX_HP: 100,
    MAX_STAMINA: 100,
    STAMINA_DRAIN: 20, // por segundo correndo
    STAMINA_REGEN: 12, // por segundo parado/andando
  },
  camera: {
    PITCH: 35.264, // ângulo isométrico clássico
    YAW: 45,
    ORTHO_HEIGHT: 9,
    DISTANCE: 30,
    FOLLOW_LERP: 8,
  },
  interaction: {
    RADIUS: 1.6,
    HIT_INTERVAL: 1, // segundos entre hits automáticos em árvore/rocha
  },
  building: {
    PLACE_DISTANCE: 1.8,
  },
  inventory: {
    SLOTS: 12,
    HOTBAR_SLOTS: 5,
  },
  zombie: {
    MAX_ALIVE: 6,
    SPAWN_INTERVAL: 6, // s entre spawns enquanto abaixo de MAX_ALIVE
    SPAWN_MIN_DIST: 12, // nunca nasce mais perto que isso do player
    SPAWN_MAX_DIST: 22,
    MAX_HP: 60,
    WANDER_SPEED: 1.2,
    CHASE_SPEED: 3.6, // entre andar (4) e agachar (2): andando você escapa por pouco, correndo com folga
    DETECT_RADIUS: 11,
    LOSE_RADIUS: 18,
    HEAR_RADIUS: 26, // som do tiro: zumbis até essa distância acordam e vêm atrás do player
    RADIUS: 0.35,
    ATTACK: { RANGE: 1.4, DAMAGE: 8, COOLDOWN: 1.3, HIT_AT: 0.45 }, // HIT_AT = fração da animação em que o dano aplica
    SPECIAL: { RANGE: 2.0, DAMAGE: 22, COOLDOWN: 8, HIT_AT: 0.5, KNOCKBACK: 7 },
    CORPSE_TIME: 2.5, // s até o corpo sumir após Death
  },
  weapon: {
    pistol: { DAMAGE: 20, COOLDOWN: 0.3, RANGE: 14, HIT_RADIUS: 0.6 },
  },
} as const;

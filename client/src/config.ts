import { GAME } from '@shared/gameconfig';
import { WORLD } from '@shared/worldgen';
import { HOTBAR_SLOTS } from '@shared/items';

/** Constantes do client. Regras de jogo (HP, armas, interação, hub) vêm de @shared/gameconfig. Unidade = 1 metro = 1 tile. */
export const CONFIG = {
  world: {
    CHUNK_SIZE: WORLD.CHUNK_SIZE,
    TILE_SIZE: 1,
    ACTIVE_RADIUS: 2, // chunks carregados em cada direção ao redor do player
    MAP_RADIUS: WORLD.MAP_RADIUS,
    SEED: 1337,
  },
  player: {
    WALK_SPEED: 4,
    RUN_SPEED: 7.5,
    CROUCH_SPEED: 2,
    HEIGHT: 1.8,
    CROUCH_HEIGHT: 1.1,
    RADIUS: GAME.player.RADIUS,
    MAX_HP: GAME.player.MAX_HP,
    MAX_STAMINA: 60, // barra curta: ~1,8 s de corrida contínua
    STAMINA_DRAIN: 34, // por segundo correndo (~3 s de corrida contínua)
    STAMINA_REGEN: 10, // por segundo parado/andando
  },
  camera: {
    PITCH: 35.264, // ângulo isométrico clássico
    YAW: 45,
    ORTHO_HEIGHT: GAME.camera.ORTHO_HEIGHT,
    DISTANCE: 30,
    FOLLOW_LERP: 8,
  },
  interaction: {
    RADIUS: GAME.interaction.RADIUS,
    HIT_INTERVAL: GAME.interaction.HIT_INTERVAL,
    HUB_RADIUS: GAME.interaction.HUB_RADIUS,
  },
  inventory: {
    SLOTS: HOTBAR_SLOTS,
    HOTBAR_SLOTS,
  },
  zombie: {
    MAX_HP: 60,
    RADIUS: 0.35,
    CORPSE_TIME: 2.5, // s até o corpo sumir após Death
  },
  weapon: {
    glock: GAME.weapon.glock,
  },
} as const;

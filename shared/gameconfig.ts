/** Regras numéricas compartilhadas por client e server (o server é a autoridade; o client só prevê). */
export const GAME = {
  player: { MAX_HP: 100, RESPAWN_SECONDS: 5, RADIUS: 0.35 },
  interaction: {
    /** distância máxima player -> objeto para pegar/bater */
    RADIUS: 1.6,
    /** segundos entre hits automáticos em árvore/rocha */
    HIT_INTERVAL: 1,
    /** distância máxima até o vendedor/torre para negociar/ativar */
    HUB_RADIUS: 3,
  },
  weapon: {
    glock: { DAMAGE: 25, COOLDOWN: 0.3, RANGE: 14, HIT_RADIUS: 0.6, MAG: 10, RELOAD: 1.5 },
  },
  /** Estruturas fixas no centro do mapa (chunk 0,0 fica livre de nós num raio de 6). */
  hub: {
    VENDOR: { x: 0, z: -3.5 },
    TOWER: { x: 4, z: 4 },
    /** raio de colisão das estruturas */
    VENDOR_RADIUS: 1.4,
    TOWER_RADIUS: 0.9,
  },
} as const;

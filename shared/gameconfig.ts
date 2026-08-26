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
  zombie: {
    MAX_HP: 60,
    DAMAGE: 8,
    RADIUS: 0.35,
    WANDER_SPEED: 1.2,
    CHASE_SPEED: 3.6,
    DETECT_RADIUS: 14,
    LOSE_RADIUS: 30,
    /** soco: alcance, cooldown, duração da animação e fração em que o dano aplica */
    ATTACK: { RANGE: 1.4, COOLDOWN: 1.3, DURATION: 1.0, HIT_AT: 0.45 },
    /** chute: mais dano (x2.75), knockback, cooldown longo */
    SPECIAL: { RANGE: 2.0, DAMAGE_MULT: 2.75, COOLDOWN: 8, DURATION: 1.2, HIT_AT: 0.5, KNOCKBACK: 7 },
    DEATH_DURATION: 2.0,
    /** s até o corpo sumir no client após Death */
    CORPSE_TIME: 2.5,
  },
  boss: {
    HP_MULT: 15,
    DAMAGE: 20,
    RADIUS: 0.8,
    SCALE: 2.2,
    CHASE_SPEED: 2.6,
    /** pancada no chão em área: aviso (telegraph), raio, dano, cooldown */
    SLAM: { WINDUP: 1.5, RADIUS: 3.5, DAMAGE: 35, COOLDOWN: 10, RANGE: 3 },
    /** investida: velocidade, duração, dano de contato, cooldown, distância mínima do alvo para usar */
    CHARGE: { SPEED: 10, DURATION: 0.9, DAMAGE: 25, COOLDOWN: 8, MIN_DIST: 5, KNOCKBACK: 9 },
  },
  waves: {
    TOTAL: 5,
    /** zumbis por wave com 1 jogador; escala ×DIFFICULTY_PER_PLAYER^(n-1) */
    BASE_COUNT: [4, 6, 8, 10, 12],
    /** multiplicador de quantidade, vida e dano por jogador adicional */
    DIFFICULTY_PER_PLAYER: 1.5,
    /** s entre o início de uma wave e o início da próxima */
    INTERVAL: 60,
    /** primeira wave começa isso depois de ativar a bateria */
    FIRST_DELAY: 5,
    /** raio (em unidades) ao redor do centro onde os zumbis nascem */
    SPAWN_RADIUS_MIN: 24,
    SPAWN_RADIUS_MAX: 34,
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

/** Regras numéricas compartilhadas por client e server (o server é a autoridade; o client só prevê). */
export const GAME = {
  player: { MAX_HP: 100, RESPAWN_SECONDS: 5, RADIUS: 0.35, /** s de invulnerabilidade ao nascer/renascer */ SPAWN_SHIELD: 5 },
  interaction: {
    /** distância máxima player -> objeto para pegar/bater */
    RADIUS: 1.6,
    /** segundos entre hits automáticos em árvore/rocha */
    HIT_INTERVAL: 1,
    /** distância máxima até o vendedor/torre para negociar/ativar */
    HUB_RADIUS: 3,
  },
  weapon: {
    /** START_MAG: balas ao comprar a arma (o pente cheio só depois de recarregar) */
    glock: { DAMAGE: 25, COOLDOWN: 0.3, RANGE: 14, HIT_RADIUS: 0.6, MAG: 5, START_MAG: 5, RELOAD: 1.5 },
    /** faca: corpo a corpo num arco à frente */
    knife: { DAMAGE: 18, COOLDOWN: 0.5, RANGE: 1.8, ARC_DEG: 100 },
  },
  /**
   * Upgrades comprados no vendedor. Níveis são por jogador, mas o PREÇO é da sala:
   * cada compra de um tipo (por qualquer jogador) multiplica o próximo preço por PRICE_GROWTH.
   */
  /** Peso: capacidade base e quanto o personagem desacelera carregado (no limite: velocidade × (1 - SLOW_AT_FULL)) */
  weight: { BASE_CAPACITY: 30, SLOW_AT_FULL: 0.5 },
  /** Câmera: altura ortográfica (menor = mais perto) */
  camera: { ORTHO_HEIGHT: 6.5 },
  /** vigor gasto por hit em árvore/rocha (client) */
  farming: { STAMINA_PER_HIT: 8 },
  /** consumíveis (bandagem/analgésico): s entre usos */
  consumable: { USE_COOLDOWN: 1 },
  /**
   * Resgate: com o 5º chefão morto, um helicóptero pousa ao lado da antena (LAND_TIME s descendo).
   * Jogador a BOARD_RADIUS embarca (some e fica invulnerável). Todos embarcados, ou TIMEOUT s após
   * pousar, ele decola (quem não embarcou fica para trás) e sobem os créditos.
   */
  evac: { OFFSET: 6.5, LAND_TIME: 6, BOARD_RADIUS: 2.2, TIMEOUT: 90, CLEARANCE: 3 },
  /** itens largados no chão somem depois de TTL s */
  drops: { TTL: 180 },
  /** recursos renascem depois de coletados (s) */
  respawn: { SMALL: 60, NODE: 180 },
  /** paredes: distância máxima de colocação e tamanho (largura x espessura) */
  walls: { PLACE_DIST: 6, WIDTH: 2, THICK: 0.4, ROTATE_STEP_DEG: 15 },
  /** recursos da sala (comprados uma vez, valem para todos): preço */
  features: { MINIMAP_PRICE: 120 },
  /** reforço da torre (sala): +HP máximo por nível (e cura esse valor), preço base × GROWTH^nível */
  towerUpgrade: { HP_STEP: 500, BASE_PRICE: 100, GROWTH: 1.35, MAX_LEVEL: 10 },
  /** reparo da torre: $ por ponto de vida faltante e preço mínimo */
  towerRepair: { PRICE_PER_HP: 0.1, MIN_PRICE: 10 },
  /** zumbis ambientais fora das waves: máximo vivo (+ por jogador) e intervalo de spawn */
  ambient: { BASE_MAX: 2, PER_PLAYER: 1, INTERVAL: 20, FIRST_DELAY: 15 },
  upgrades: {
    PRICE_GROWTH: 1.35,
    /** +20% de dano por nível */
    damage: { MAX_LEVEL: 5, STEP: 0.2, BASE: 40 },
    /** +4 balas no pente por nível */
    ammo: { MAX_LEVEL: 5, STEP: 3, BASE: 30 },
    /** recoil = dispersão (graus) do tiro em torno da mira; cada nível reduz STEP graus */
    recoil: { MAX_LEVEL: 5, BASE_SPREAD: 12, STEP: 2, BASE: 40 },
    /** +25% de vigor máximo por nível (corrida) */
    stamina: { MAX_LEVEL: 5, STEP: 0.25, BASE: 35 },
    /** mira laser (mostra a linha de tiro); nível único */
    laser: { MAX_LEVEL: 1, STEP: 1, BASE: 60 },
    /** +10 de capacidade de peso por nível */
    weight: { MAX_LEVEL: 5, STEP: 10, BASE: 35 },
    /** visão: amplia a câmera por nível */
  },
  zombie: {
    MAX_HP: 60,
    DAMAGE: 16,
    RADIUS: 0.35,
    WANDER_SPEED: 1.2,
    /** acima do andar do jogador (4) e abaixo do correr (7.5): precisa correr para fugir */
    CHASE_SPEED: 5.2,
    DETECT_RADIUS: 16,
    LOSE_RADIUS: 34,
    /** soco: alcance, cooldown, duração da animação e fração em que o dano aplica */
    ATTACK: { RANGE: 1.4, COOLDOWN: 1.1, DURATION: 1.0, HIT_AT: 0.45 },
    /** dano em estruturas (torre/paredes) = dano × este fator */
    STRUCTURE_DAMAGE_MULT: 3,
    /** preferência pela torre: distância até a torre é multiplicada por isso ao escolher alvo */
    TOWER_BIAS: 0.7,
    /** chute: mais dano (x2.75), knockback, cooldown longo */
    SPECIAL: { RANGE: 2.0, DAMAGE_MULT: 2.75, COOLDOWN: 8, DURATION: 1.2, HIT_AT: 0.5, KNOCKBACK: 7 },
    /** fração da horda que nasce como cuspidor (ataque à distância que dá lentidão) */
    SPITTER_RATIO: 0.35,
    /** cuspe: alcance útil, cooldown, projétil (velocidade/raio/dano) e lentidão aplicada */
    SPIT: { RANGE_MIN: 3, RANGE_MAX: 13, COOLDOWN: 4.5, DURATION: 0.7, FIRE_AT: 0.5, SPEED: 11, RADIUS: 0.55, DAMAGE: 7, SLOW_FACTOR: 0.5, SLOW_TIME: 2.5, TTL: 2 },
    DEATH_DURATION: 2.0,
    /** s até o corpo sumir no client após Death */
    CORPSE_TIME: 2.5,
  },
  /**
   * Fogo amigo: quem morre para outro jogador vira zumbi ("infectado") por DURATION s, sem controle
   * (só assiste), caçando quem o matou; matou o assassino -> ele também vira. Mais forte que um zumbi
   * comum: vida × HP_MULT, dano × DAMAGE_MULT e SPEED (entre o andar 4 e o correr 7.5 do jogador).
   */
  infected: { DURATION: 30, HP_MULT: 3, DAMAGE_MULT: 1.5, SPEED: 6.5 },
  boss: {
    /**
     * Um chefão por wave (1..5). Por wave: vida (× vida do zumbi), dano (× DAMAGE) e zumbis
     * invocados por vez — a 5ª é a insana. Fora isso tudo ainda escala por jogador.
     */
    TIER: [
      { HP_MULT: 8, DMG_MULT: 0.6, SUMMON: 2 },
      { HP_MULT: 12, DMG_MULT: 0.75, SUMMON: 3 },
      { HP_MULT: 18, DMG_MULT: 0.9, SUMMON: 3 },
      { HP_MULT: 26, DMG_MULT: 1.0, SUMMON: 4 },
      { HP_MULT: 42, DMG_MULT: 1.3, SUMMON: 6 },
    ],
    DAMAGE: 35,
    RADIUS: 0.8,
    SCALE: 2.2,
    /** quase a corrida do jogador: correr só ganha distância devagar */
    CHASE_SPEED: 6.8,
    /** pancada no chão em área: aviso (telegraph), raio, dano, cooldown */
    SLAM: { WINDUP: 1.2, RADIUS: 4, DAMAGE: 45, COOLDOWN: 7, RANGE: 3.5 },
    /** investida: velocidade, duração, dano de contato, cooldown, distância mínima do alvo para usar */
    CHARGE: { SPEED: 14, DURATION: 1.0, DAMAGE: 35, COOLDOWN: 5, MIN_DIST: 6, KNOCKBACK: 11 },
    /** rajada de cuspes à distância (leque), cada um com dano e lentidão */
    VOLLEY: { COUNT: 3, SPREAD_DEG: 14, COOLDOWN: 5, DURATION: 0.8, FIRE_AT: 0.5, RANGE: 18, SPEED: 14, DAMAGE: 22, SLOW_FACTOR: 0.45, SLOW_TIME: 3, TTL: 2.2 },
    /** invoca zumbis ao redor de si (quantidade em TIER[wave].SUMMON) */
    SUMMON: { COOLDOWN: 20, FIRST_DELAY: 8 },
  },
  /**
   * Waves: cada bateria colocada na antena dispara UMA wave (horda + chefão). A antena precisa das
   * 5 baterias, uma por wave; a próxima só começa com outra bateria. Bateria: preço da sala
   * sobe a cada compra (BASE × GROWTH^compras).
   */
  battery: { GROWTH: 1.35 },
  waves: {
    TOTAL: 5,
    /** zumbis da horda por wave com 1 jogador; escala ×DIFFICULTY_PER_PLAYER^(n-1) */
    BASE_COUNT: [8, 12, 16, 22, 30],
    /** multiplicador de quantidade, vida e dano por jogador adicional */
    DIFFICULTY_PER_PLAYER: 1.5,
    /** vida e dano dos zumbis da horda crescem por wave: × GROWTH^(wave-1) */
    HP_GROWTH: 1.2,
    DMG_GROWTH: 1.12,
    /** s para limpar a horda; estourou -> horda some e a bateria daquela wave é perdida */
    TIME_LIMIT: 90,
    /** s para matar o chefão da wave */
    BOSS_TIME_LIMIT: 180,
    /** horda limpa -> chefão chega depois disso */
    BOSS_DELAY: 5,
    /** a horda começa isso depois de colocar a bateria */
    FIRST_DELAY: 5,
    /** raio (em unidades) ao redor do centro onde os zumbis nascem */
    SPAWN_RADIUS_MIN: 24,
    SPAWN_RADIUS_MAX: 34,
  },
  /** Estruturas fixas no centro do mapa (chunk 0,0 fica livre de nós num raio de 6). */
  hub: {
    VENDOR: { x: 0, z: -3.5 },
    /** posição padrão; na partida a torre nasce num ponto aleatório (Match.towerPos), entre TOWER_MIN_DIST e TOWER_MAX_DIST do centro */
    TOWER: { x: 4, z: 4 },
    TOWER_MIN_DIST: 14,
    TOWER_MAX_DIST: 34,
    /** vida da torre; zero = derrota e a partida recomeça do zero */
    TOWER_HP: 1500,
    /** raio de colisão das estruturas */
    VENDOR_RADIUS: 1.4,
    TOWER_RADIUS: 0.9,
  },
} as const;

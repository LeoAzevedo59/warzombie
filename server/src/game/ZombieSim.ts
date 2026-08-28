import { GAME } from '../../../shared/gameconfig.js';
import { dist, isClearOfCircles, pushOutCircle, type XZ } from '../../../shared/math.js';
import type { CharacterId, ProjectileSnapshot, ZombieAnim, ZombieKind, ZombieSnapshot } from '../../../shared/protocol.js';
import { mapBounds } from '../../../shared/worldgen.js';

export type ZombieState = 'wander' | 'chase' | 'attack' | 'special' | 'spit' | 'volley' | 'slam' | 'charge' | 'stunned' | 'dead';

export interface Zombie {
  id: number;
  kind: ZombieKind;
  x: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  damage: number;
  radius: number;
  state: ZombieState;
  stateTime: number;
  attackCooldown: number;
  specialCooldown: number;
  chargeCooldown: number;
  spitCooldown: number;
  summonCooldown: number;
  /** multiplicadores da wave (usados para os invocados do chefão) */
  hpMult: number;
  dmgMult: number;
  /** horda de wave: sempre sabe onde há jogador vivo (não depende do raio de detecção nem desiste) */
  hunter: boolean;
  /** chefão: wave (1..TOTAL) que define vida/dano/invocações (GAME.boss.TIER) */
  tier: number;
  /** infectado: jogador que virou este zumbi e quem ele caça (null = qualquer jogador vivo) */
  ownerId: string | null;
  /** infectado: personagem do dono (o client usa o mesmo modelo) */
  character: CharacterId | null;
  focusId: string | null;
  /** infectado: s até voltar ao normal (some sem morrer) */
  ttl: number | null;
  hitApplied: boolean;
  wanderTarget: XZ;
  wanderWait: number;
  vx: number;
  vz: number;
  targetId: string | null;
  /** direção da investida (boss) */
  chargeDir: XZ;
  /** jogadores já atingidos nesta investida */
  chargeHits: Set<string>;
  /** chefão: s de atordoamento (parado, sem atacar) ao entrar em 'stunned' */
  stunTime: number;
  /** posição no último check de "travado" e tempo parado em chase */
  lastX: number;
  lastZ: number;
  stuckTime: number;
}

/** Alvo visto pela IA: jogador, torre ou parede. */
export interface Target {
  id: string;
  position: XZ;
  dead: boolean;
  /** raio do alvo (jogador = GAME.player.RADIUS; estruturas maiores) */
  radius?: number;
  kind?: 'player' | 'tower' | 'wall';
  /** isca: carrega a bateria — todo zumbi do mapa vai atrás dele, de qualquer distância */
  lure?: boolean;
}

export interface Obstacle {
  position: XZ;
  solidRadius: number;
}

export interface Projectile {
  id: number;
  x: number;
  z: number;
  dx: number;
  dz: number;
  speed: number;
  radius: number;
  damage: number;
  slowFactor: number;
  slowTime: number;
  ttl: number;
  boss: boolean;
  from: number;
}

export interface ZombieSimIO {
  /** dano em jogador ('uuid'), torre ('tower') ou parede ('wall:id') */
  damagePlayer(targetId: string, amount: number, byZombie: number): void;
  knockback(playerId: string, dx: number, dz: number, force: number): void;
  slowPlayer(playerId: string, factor: number, seconds: number): void;
  bossSlam(x: number, z: number, radius: number, windup: number): void;
  zombieDied(z: Zombie, killerId?: string): void;
}

/**
 * IA e "física" dos zumbis no servidor (portado do ZombieSystem do client, sem PlayCanvas).
 * Máquina de estados: wander -> chase (jogador vivo mais próximo) -> attack/special (zumbi) ou
 * attack/slam/charge (boss) -> dead. Tempo em segundos; posições no plano XZ.
 */
export class ZombieSim {
  readonly zombies = new Map<number, Zombie>();
  readonly projectiles = new Map<number, Projectile>();
  private nextId = 1;
  private nextProjectileId = 1;
  private bounds = mapBounds();
  private rand: () => number;
  /** Pontos que o spawn evita (antena, jogadores vivos) com a distância mínima de cada um. */
  avoid: () => Iterable<{ position: XZ; minDist: number }> = () => [];

  constructor(
    private io: ZombieSimIO,
    private obstacles: () => Iterable<Obstacle>,
    rand: () => number = Math.random,
  ) {
    this.rand = rand;
  }

  get aliveCount(): number {
    let n = 0;
    for (const z of this.zombies.values()) if (z.state !== 'dead') n++;
    return n;
  }

  /** Só a horda das waves (caçadores); ambientais não contam para limpar a wave. */
  get aliveHunters(): number {
    let n = 0;
    for (const z of this.zombies.values()) if (z.state !== 'dead' && z.hunter) n++;
    return n;
  }

  get aliveAmbient(): number {
    let n = 0;
    for (const z of this.zombies.values()) if (z.state !== 'dead' && !z.hunter) n++;
    return n;
  }

  *alive(): IterableIterator<Zombie> {
    for (const z of this.zombies.values()) if (z.state !== 'dead') yield z;
  }

  snapshots(): ZombieSnapshot[] {
    return [...this.zombies.values()].map((z) => {
      const s: ZombieSnapshot = { id: z.id, kind: z.kind, x: z.x, z: z.z, yaw: z.yaw, anim: animFor(z), hp: z.hp, maxHp: z.maxHp };
      if (z.ownerId) s.owner = z.ownerId;
      if (z.character) s.character = z.character;
      if (z.state === 'stunned') s.stunned = true;
      return s;
    });
  }

  projectileSnapshots(): ProjectileSnapshot[] {
    return [...this.projectiles.values()].map((p) => ({ id: p.id, x: p.x, z: p.z, boss: p.boss }));
  }

  /** `tier` (chefão): wave 1..TOTAL, escolhe a linha de GAME.boss.TIER. */
  spawn(kind: ZombieKind, x: number, z: number, hpMult = 1, dmgMult = 1, hunter = false, tier = 1): Zombie {
    const cfg = GAME.zombie;
    const boss = kind === 'boss';
    const infected = kind === 'infected';
    const t = bossTier(tier);
    const zb: Zombie = {
      id: this.nextId++,
      kind,
      x,
      z,
      yaw: 0,
      hp: 0,
      maxHp: Math.round(cfg.MAX_HP * hpMult * (boss ? t.HP_MULT : infected ? GAME.infected.HP_MULT : 1)),
      damage: Math.round((boss ? GAME.boss.DAMAGE * t.DMG_MULT : infected ? cfg.DAMAGE * GAME.infected.DAMAGE_MULT : cfg.DAMAGE) * dmgMult),
      radius: boss ? GAME.boss.RADIUS : cfg.RADIUS,
      state: 'wander',
      stateTime: 0,
      attackCooldown: 0,
      // zumbi comum nasce com o chute em cooldown cheio: o primeiro golpe é o soco, não o chute
      // (o chute tem mais alcance que o soco e abria todo encontro com 2,75× de dano); o chefão segue como antes
      specialCooldown: boss ? GAME.boss.SLAM.COOLDOWN * 0.5 : cfg.SPECIAL.COOLDOWN,
      chargeCooldown: 3,
      spitCooldown: 1 + this.rand() * 2,
      summonCooldown: GAME.boss.SUMMON.FIRST_DELAY,
      hpMult,
      dmgMult,
      hunter,
      tier,
      ownerId: null,
      character: null,
      focusId: null,
      ttl: null,
      hitApplied: false,
      wanderTarget: { x, z },
      wanderWait: 0,
      vx: 0,
      vz: 0,
      targetId: null,
      chargeDir: { x: 0, z: 1 },
      chargeHits: new Set(),
      stunTime: 0,
      lastX: x,
      lastZ: z,
      stuckTime: 0,
    };
    zb.hp = zb.maxHp;
    this.zombies.set(zb.id, zb);
    return zb;
  }

  /**
   * Jogador `ownerId` virou zumbi onde morreu, caçando `focusId` (quem o matou) por GAME.infected.DURATION s.
   * Não é caçador de wave (não conta para limpar a horda) mas, como eles, acha jogadores a qualquer distância.
   */
  spawnInfected(ownerId: string, character: CharacterId, focusId: string | null, x: number, z: number): Zombie {
    const zb = this.spawn('infected', x, z, 1, 1, false);
    zb.ownerId = ownerId;
    zb.character = character;
    zb.focusId = focusId;
    zb.ttl = GAME.infected.DURATION;
    zb.state = 'chase';
    return zb;
  }

  /**
   * Ponto livre num anel ao redor do centro (borda do mapa) — nunca em cima de árvore/rocha nem perto
   * demais da antena/jogadores (`avoid`). Se nenhuma tentativa satisfizer tudo, usa a que ficou mais
   * longe do que devia evitar (nunca um ponto fixo, que podia ser justamente ao lado da antena).
   */
  pickSpawnPoint(): XZ {
    const { SPAWN_RADIUS_MIN: min, SPAWN_RADIUS_MAX: max } = GAME.waves;
    const b = this.bounds;
    const avoid = [...this.avoid()];
    let best: XZ | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 60; i++) {
      const a = this.rand() * Math.PI * 2;
      const d = min + this.rand() * (max - min);
      const x = Math.min(b.maxX, Math.max(b.minX, Math.cos(a) * d));
      const z = Math.min(b.maxZ, Math.max(b.minZ, Math.sin(a) * d));
      if (!isClearOfCircles(x, z, this.obstacles(), GAME.zombie.RADIUS)) continue;
      // folga mínima em relação aos pontos evitados (negativa = perto demais)
      let score = Infinity;
      for (const p of avoid) score = Math.min(score, dist({ x, z }, p.position) - p.minDist);
      if (score >= 0) return { x, z };
      if (score > bestScore) {
        bestScore = score;
        best = { x, z };
      }
    }
    return best ?? { x: -min, z: 0 };
  }

  damage(z: Zombie, amount: number, killerId?: string): boolean {
    if (z.state === 'dead') return false;
    z.hp = Math.max(0, z.hp - amount);
    if (z.hp > 0) return false;
    this.setState(z, 'dead');
    z.vx = z.vz = 0;
    this.io.zombieDied(z, killerId);
    return true;
  }

  clear(): void {
    this.zombies.clear();
    this.projectiles.clear();
  }

  /** Remove só a horda da wave (caçadores, chefão incluso); ambientais e infectados ficam. */
  clearHunters(): void {
    for (const [id, z] of this.zombies) if (z.hunter) this.zombies.delete(id);
    this.projectiles.clear();
  }

  /** Remove um zumbi sem animação de morte (infectado que expirou / dono saiu). */
  remove(id: number): void {
    this.zombies.delete(id);
  }

  // ---------- loop ----------

  tick(dt: number, targets: Target[]): void {
    const living = targets.filter((t) => !t.dead);
    for (const z of this.zombies.values()) {
      z.stateTime += dt;
      z.attackCooldown = Math.max(0, z.attackCooldown - dt);
      z.specialCooldown = Math.max(0, z.specialCooldown - dt);
      z.chargeCooldown = Math.max(0, z.chargeCooldown - dt);
      z.spitCooldown = Math.max(0, z.spitCooldown - dt);
      z.summonCooldown = Math.max(0, z.summonCooldown - dt);
      if (z.state === 'dead') {
        if (z.stateTime >= GAME.zombie.DEATH_DURATION + GAME.zombie.CORPSE_TIME) this.zombies.delete(z.id);
        continue;
      }
      if (z.ttl !== null) {
        z.ttl -= dt;
        if (z.ttl <= 0) {
          this.zombies.delete(z.id); // infectado voltou ao normal (o Match respawna o dono)
          continue;
        }
      }
      this.think(z, living, dt);
      this.integrate(z, dt);
    }
    this.separate(living);
    this.tickProjectiles(dt, living);
  }

  private tickProjectiles(dt: number, living: Target[]): void {
    const b = this.bounds;
    for (const p of this.projectiles.values()) {
      p.ttl -= dt;
      p.x += p.dx * p.speed * dt;
      p.z += p.dz * p.speed * dt;
      let hit = false;
      for (const t of living) {
        if (t.kind && t.kind !== 'player') continue;
        if (dist(p, t.position) <= p.radius + GAME.player.RADIUS) {
          this.io.damagePlayer(t.id, p.damage, p.from);
          this.io.slowPlayer(t.id, p.slowFactor, p.slowTime);
          hit = true;
          break;
        }
      }
      if (hit || p.ttl <= 0 || p.x < b.minX || p.x > b.maxX || p.z < b.minZ || p.z > b.maxZ) this.projectiles.delete(p.id);
    }
  }

  private fireProjectile(z: Zombie, dx: number, dz: number, boss: boolean): void {
    const c = boss ? GAME.boss.VOLLEY : GAME.zombie.SPIT;
    const id = this.nextProjectileId++;
    this.projectiles.set(id, {
      id,
      x: z.x + dx * (z.radius + 0.2),
      z: z.z + dz * (z.radius + 0.2),
      dx,
      dz,
      speed: c.SPEED,
      radius: boss ? 0.7 : GAME.zombie.SPIT.RADIUS,
      damage: Math.round(c.DAMAGE * z.dmgMult),
      slowFactor: c.SLOW_FACTOR,
      slowTime: c.SLOW_TIME,
      ttl: c.TTL,
      boss,
      from: z.id,
    });
  }

  /** Chefão invoca zumbis ao redor de si (mesma escala da wave; quantidade pela wave do chefão). */
  private summon(z: Zombie): void {
    const n = bossTier(z.tier).SUMMON;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand();
      const kind: ZombieKind = this.rand() < GAME.zombie.SPITTER_RATIO ? 'spitter' : 'zombie';
      const m = this.spawn(kind, z.x + Math.cos(a) * 2.5, z.z + Math.sin(a) * 2.5, z.hpMult, z.dmgMult, true);
      m.state = 'chase';
    }
  }

  /**
   * Alvo mais próximo. Caçadores consideram a torre (com preferência); paredes só quando travados.
   * Jogador vivo a até GUARD_RADIUS da torre "defende" a antena: a horda vai nele antes da torre.
   * Infectado: só jogadores, e quem o matou (focusId) tem prioridade absoluta enquanto estiver vivo.
   */
  private nearest(z: Zombie, living: Target[]): { t: Target; d: number } | null {
    let best: Target | null = null;
    let bd = Infinity;
    let bs = Infinity;
    const infected = z.kind === 'infected';
    // quem carrega a bateria é o alvo de todos (menos do infectado, que tem o próprio alvo)
    if (!infected) {
      let lure: { t: Target; d: number } | null = null;
      for (const t of living) {
        if (!t.lure) continue;
        const d = Math.max(0, dist(z, t.position) - (t.radius ?? 0));
        if (!lure || d < lure.d) lure = { t, d };
      }
      if (lure) return lure;
    }
    const tower = z.hunter ? living.find((t) => t.kind === 'tower') : undefined;
    const isPlayer = (t: Target) => !t.kind || t.kind === 'player';
    const guarding = (t: Target) => !!tower && isPlayer(t) && dist(t.position, tower.position) <= GAME.zombie.GUARD_RADIUS;
    const guarded = !!tower && living.some(guarding);
    for (const t of living) {
      if (t.kind === 'wall') continue;
      if (t.kind === 'tower' && (!z.hunter || guarded)) continue;
      if (infected) {
        if ((t.kind && t.kind !== 'player') || t.id === z.ownerId) continue;
        if (t.id === z.focusId) return { t, d: Math.max(0, dist(z, t.position) - (t.radius ?? 0)) };
      }
      const d = Math.max(0, dist(z, t.position) - (t.radius ?? 0));
      // a torre (ou quem a defende) ganha a preferência da horda
      const score = t.kind === 'tower' || (guarded && guarding(t)) ? d * GAME.zombie.TOWER_BIAS : d;
      if (score < bs) {
        bs = score;
        bd = d;
        best = t;
      }
    }
    return best ? { t: best, d: bd } : null;
  }

  private nearestWall(z: Zombie, living: Target[], maxDist: number): Target | null {
    let best: Target | null = null;
    let bd = maxDist;
    for (const t of living) {
      if (t.kind !== 'wall') continue;
      const d = Math.max(0, dist(z, t.position) - (t.radius ?? 0));
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  private think(z: Zombie, living: Target[], dt: number): void {
    const cfg = GAME.zombie;
    const near = this.nearest(z, living);
    const boss = z.kind === 'boss';
    // caçadores (waves), infectados e quem fareja a bateria sabem onde está o alvo a qualquer distância
    const relentless = z.hunter || z.kind === 'infected' || !!near?.t.lure;

    switch (z.state) {
      case 'wander':
        // atacam qualquer jogador vivo, inclusive quem acabou de renascer longe deles
        if (near && (relentless || near.d < cfg.DETECT_RADIUS)) {
          z.targetId = near.t.id;
          this.setState(z, 'chase');
          break;
        }
        this.wander(z, dt);
        break;

      case 'chase': {
        if (!near || (!relentless && near.d > cfg.LOSE_RADIUS && z.stateTime > 6)) {
          this.setState(z, 'wander');
          z.wanderWait = 1;
          z.vx = z.vz = 0;
          break;
        }
        z.targetId = near.t.id;
        this.lookAt(z, near.t.position);
        if (boss) {
          if (z.summonCooldown <= 0) {
            z.summonCooldown = GAME.boss.SUMMON.COOLDOWN;
            this.summon(z);
          }
          if (z.specialCooldown <= 0 && near.d <= GAME.boss.SLAM.RANGE) {
            this.startSlam(z);
            break;
          }
          if (near.t.kind !== 'tower' && z.spitCooldown <= 0 && near.d > GAME.boss.SLAM.RANGE && near.d <= GAME.boss.VOLLEY.RANGE) {
            this.setState(z, 'volley');
            z.vx = z.vz = 0;
            z.spitCooldown = GAME.boss.VOLLEY.COOLDOWN;
            break;
          }
          if (z.chargeCooldown <= 0 && near.d >= GAME.boss.CHARGE.MIN_DIST) {
            this.startCharge(z, near.t.position);
            break;
          }
        } else if (z.kind === 'spitter' && near.t.kind !== 'tower' && z.spitCooldown <= 0 && near.d >= cfg.SPIT.RANGE_MIN && near.d <= cfg.SPIT.RANGE_MAX) {
          this.setState(z, 'spit');
          z.vx = z.vz = 0;
          z.spitCooldown = cfg.SPIT.COOLDOWN;
          break;
        } else if (z.specialCooldown <= 0 && near.d <= cfg.SPECIAL.RANGE) {
          this.startAttack(z, 'special');
          break;
        }
        const reach = cfg.ATTACK.RANGE + (boss ? z.radius : 0);
        // travado numa parede? bate nela
        const moved = Math.hypot(z.x - z.lastX, z.z - z.lastZ);
        z.stuckTime = moved < 0.15 * dt * 10 ? z.stuckTime + dt : 0;
        z.lastX = z.x;
        z.lastZ = z.z;
        if (z.stuckTime > 0.8 && near.d > reach) {
          const wall = this.nearestWall(z, living, reach + 0.6);
          if (wall && z.attackCooldown <= 0) {
            z.targetId = wall.id;
            this.lookAt(z, wall.position);
            this.startAttack(z, 'attack');
            break;
          }
        }
        if (z.attackCooldown <= 0 && near.d <= reach) {
          this.startAttack(z, 'attack');
          break;
        }
        // não gruda no alvo: para de avançar quando já está no alcance do soco
        if (near.d <= reach * 0.9) {
          z.vx = z.vz = 0;
        } else {
          const dx = near.t.position.x - z.x;
          const dz = near.t.position.z - z.z;
          const l = Math.hypot(dx, dz) || 1;
          const speed = boss ? GAME.boss.CHASE_SPEED : z.kind === 'infected' ? GAME.infected.SPEED : cfg.CHASE_SPEED;
          z.vx = (dx / l) * speed;
          z.vz = (dz / l) * speed;
        }
        break;
      }

      case 'attack':
      case 'special': {
        const special = z.state === 'special';
        const c = special ? cfg.SPECIAL : cfg.ATTACK;
        z.vx = z.vz = 0;
        const target = living.find((t) => t.id === z.targetId) ?? near?.t;
        if (target && z.stateTime < c.DURATION * c.HIT_AT) this.lookAt(z, target.position);
        if (!z.hitApplied && z.stateTime >= c.DURATION * c.HIT_AT) {
          z.hitApplied = true;
          const reach = c.RANGE + (boss ? z.radius : 0) + (target?.radius ?? 0) + 0.3;
          if (target && dist(z, target.position) <= reach) this.hitPlayer(z, target, special);
        }
        if (z.stateTime >= c.DURATION) this.setState(z, 'chase');
        break;
      }

      case 'spit':
      case 'volley': {
        const bossShot = z.state === 'volley';
        const c = bossShot ? GAME.boss.VOLLEY : cfg.SPIT;
        z.vx = z.vz = 0;
        const target = living.find((t) => t.id === z.targetId && (!t.kind || t.kind === 'player')) ?? living.find((t) => !t.kind || t.kind === 'player');
        if (target && z.stateTime < c.DURATION * c.FIRE_AT) this.lookAt(z, target.position);
        if (!z.hitApplied && z.stateTime >= c.DURATION * c.FIRE_AT) {
          z.hitApplied = true;
          if (target) {
            const dx = target.position.x - z.x;
            const dz = target.position.z - z.z;
            const l = Math.hypot(dx, dz) || 1;
            const base = Math.atan2(dx / l, dz / l);
            const n = bossShot ? GAME.boss.VOLLEY.COUNT : 1;
            const spread = bossShot ? (GAME.boss.VOLLEY.SPREAD_DEG * Math.PI) / 180 : 0;
            for (let i = 0; i < n; i++) {
              const a = base + (n > 1 ? (i - (n - 1) / 2) * spread : 0);
              this.fireProjectile(z, Math.sin(a), Math.cos(a), bossShot);
            }
          }
        }
        if (z.stateTime >= c.DURATION) this.setState(z, 'chase');
        break;
      }

      case 'slam': {
        const s = GAME.boss.SLAM;
        z.vx = z.vz = 0;
        if (!z.hitApplied && z.stateTime >= s.WINDUP) {
          z.hitApplied = true;
          for (const t of living) {
            if (t.kind && t.kind !== 'player') continue;
            if (dist(z, t.position) <= s.RADIUS) {
              this.io.damagePlayer(t.id, Math.round(s.DAMAGE * bossTier(z.tier).DMG_MULT), z.id);
              const dx = t.position.x - z.x;
              const dz = t.position.z - z.z;
              const l = Math.hypot(dx, dz) || 1;
              this.io.knockback(t.id, dx / l, dz / l, cfg.SPECIAL.KNOCKBACK);
            }
          }
        }
        if (z.stateTime >= s.WINDUP + 0.6) this.stun(z, GAME.boss.STUN.AFTER_SLAM);
        break;
      }

      case 'charge': {
        const c = GAME.boss.CHARGE;
        z.vx = z.chargeDir.x * c.SPEED;
        z.vz = z.chargeDir.z * c.SPEED;
        for (const t of living) {
          if (t.kind && t.kind !== 'player') continue;
          if (z.chargeHits.has(t.id)) continue;
          if (dist(z, t.position) <= z.radius + GAME.player.RADIUS + 0.3) {
            z.chargeHits.add(t.id);
            this.io.damagePlayer(t.id, Math.round(c.DAMAGE * bossTier(z.tier).DMG_MULT), z.id);
            this.io.knockback(t.id, z.chargeDir.x, z.chargeDir.z, c.KNOCKBACK);
          }
        }
        if (z.stateTime >= c.DURATION) {
          z.vx = z.vz = 0;
          this.stun(z, GAME.boss.STUN.AFTER_CHARGE);
        }
        break;
      }

      case 'stunned':
        // atordoado: parado e sem atacar — a janela para os jogadores revidarem
        z.vx = z.vz = 0;
        if (z.stateTime >= z.stunTime) this.setState(z, 'chase');
        break;
    }
  }

  /** Chefão atordoado por `seconds` depois de uma habilidade pesada (investida/pancada). */
  private stun(z: Zombie, seconds: number): void {
    z.vx = z.vz = 0;
    z.stunTime = seconds;
    this.setState(z, 'stunned');
  }

  private setState(z: Zombie, s: ZombieState): void {
    if (z.state === s) return;
    z.state = s;
    z.stateTime = 0;
    z.hitApplied = false;
  }

  private startAttack(z: Zombie, kind: 'attack' | 'special'): void {
    this.setState(z, kind);
    z.vx = z.vz = 0;
    if (kind === 'special') {
      z.specialCooldown = GAME.zombie.SPECIAL.COOLDOWN;
      z.attackCooldown = Math.max(z.attackCooldown, 0.6);
    } else {
      z.attackCooldown = GAME.zombie.ATTACK.COOLDOWN;
    }
  }

  private startSlam(z: Zombie): void {
    this.setState(z, 'slam');
    z.vx = z.vz = 0;
    z.specialCooldown = GAME.boss.SLAM.COOLDOWN;
    this.io.bossSlam(z.x, z.z, GAME.boss.SLAM.RADIUS, GAME.boss.SLAM.WINDUP);
  }

  private startCharge(z: Zombie, target: XZ): void {
    this.setState(z, 'charge');
    z.chargeCooldown = GAME.boss.CHARGE.COOLDOWN;
    z.chargeHits.clear();
    const dx = target.x - z.x;
    const dz = target.z - z.z;
    const l = Math.hypot(dx, dz) || 1;
    z.chargeDir = { x: dx / l, z: dz / l };
    this.lookAt(z, target);
  }

  private hitPlayer(z: Zombie, t: Target, special: boolean): void {
    let dmg = special ? Math.round(z.damage * GAME.zombie.SPECIAL.DAMAGE_MULT) : z.damage;
    if (t.kind === 'tower' || t.kind === 'wall') dmg = Math.round(dmg * GAME.zombie.STRUCTURE_DAMAGE_MULT);
    this.io.damagePlayer(t.id, dmg, z.id);
    if (t.kind && t.kind !== 'player') return;
    if (special) {
      const dx = t.position.x - z.x;
      const dz = t.position.z - z.z;
      const l = Math.hypot(dx, dz) || 1;
      this.io.knockback(t.id, dx / l, dz / l, GAME.zombie.SPECIAL.KNOCKBACK);
    }
  }

  private wander(z: Zombie, dt: number): void {
    const cfg = GAME.zombie;
    const b = this.bounds;
    if (z.wanderWait > 0) {
      z.wanderWait -= dt;
      z.vx = z.vz = 0;
      if (z.wanderWait <= 0) {
        const a = this.rand() * Math.PI * 2;
        const d = 3 + this.rand() * 5;
        z.wanderTarget = {
          x: Math.min(b.maxX, Math.max(b.minX, z.x + Math.cos(a) * d)),
          z: Math.min(b.maxZ, Math.max(b.minZ, z.z + Math.sin(a) * d)),
        };
      }
      return;
    }
    const dx = z.wanderTarget.x - z.x;
    const dz = z.wanderTarget.z - z.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.5 || z.stateTime > 12) {
      z.wanderWait = 1.5 + this.rand() * 3;
      z.stateTime = 0;
      z.vx = z.vz = 0;
      return;
    }
    this.lookAt(z, z.wanderTarget);
    z.vx = (dx / l) * cfg.WANDER_SPEED;
    z.vz = (dz / l) * cfg.WANDER_SPEED;
  }

  private lookAt(z: Zombie, p: XZ): void {
    const dx = p.x - z.x;
    const dz = p.z - z.z;
    if (dx * dx + dz * dz < 0.0004) return;
    z.yaw = (Math.atan2(dx, dz) * 180) / Math.PI;
  }

  private integrate(z: Zombie, dt: number): void {
    if (z.vx === 0 && z.vz === 0) return;
    const b = this.bounds;
    let x = Math.min(b.maxX, Math.max(b.minX, z.x + z.vx * dt));
    let zz = Math.min(b.maxZ, Math.max(b.minZ, z.z + z.vz * dt));
    for (const o of this.obstacles()) {
      if (!o.solidRadius) continue;
      const pushed = pushOutCircle(x, zz, o.position.x, o.position.z, o.solidRadius + z.radius);
      if (pushed) {
        x = pushed.x;
        zz = pushed.z;
        if (z.state === 'wander') z.wanderWait = 0.3; // travou num obstáculo: escolhe outro ponto
      }
    }
    z.x = x;
    z.z = zz;
  }

  /** Zumbis não se sobrepõem entre si nem entram nos jogadores. */
  private separate(living: Target[]): void {
    const alive = [...this.alive()];
    for (let i = 0; i < alive.length; i++) {
      const a = alive[i];
      for (let j = i + 1; j < alive.length; j++) {
        const b = alive[j];
        const p = pushOutCircle(a.x, a.z, b.x, b.z, a.radius + b.radius);
        if (p) {
          const hx = (p.x - a.x) / 2;
          const hz = (p.z - a.z) / 2;
          a.x += hx;
          a.z += hz;
          b.x -= hx;
          b.z -= hz;
        }
      }
      if (a.state === 'charge') continue; // investida atravessa (o dano é por contato)
      for (const t of living) {
        if (t.kind && t.kind !== 'player') continue;
        const p = pushOutCircle(a.x, a.z, t.position.x, t.position.z, a.radius + GAME.player.RADIUS);
        if (p) {
          a.x = p.x;
          a.z = p.z;
        }
      }
    }
  }
}

/** Linha da tabela do chefão para a wave (fora da faixa: usa a última = insana). */
export function bossTier(wave: number): (typeof GAME.boss.TIER)[number] {
  const t = GAME.boss.TIER;
  return t[Math.min(t.length, Math.max(1, wave)) - 1];
}

function animFor(z: Zombie): ZombieAnim {
  switch (z.state) {
    case 'dead':
      return 'Death';
    case 'attack':
    case 'spit':
    case 'volley':
      return 'Punch_Left';
    case 'special':
    case 'slam':
      return 'Kick_Right';
    case 'charge':
      return 'Run';
    case 'stunned':
      return 'Idle';
    case 'chase':
      return z.vx === 0 && z.vz === 0 ? 'Idle' : 'Run';
    default:
      return z.vx === 0 && z.vz === 0 ? 'Idle' : 'Walk';
  }
}

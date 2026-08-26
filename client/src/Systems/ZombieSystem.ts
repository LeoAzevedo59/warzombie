import * as pc from 'playcanvas';
import { CONFIG } from '@/config';
import type { System } from '@/Core/GameLoop';
import type { EventBus } from '@/Core/EventBus';
import type { GameState } from '@/Core/GameState';
import type { Player } from '@/Entities/Player/Player';
import { Zombie } from '@/Entities/Enemies/Zombie';
import { World } from '@/World/World';
import { pushOutCircle, isClearOfCircles } from '@/Core/Spatial';

/**
 * Spawn, IA e ataques dos zumbis.
 *
 * Máquina de estados por zumbi:
 * - wander: perambula entre pontos aleatórios (Walk) com pausas (Idle). Vê o player em DETECT_RADIUS.
 * - chase: corre atrás do player (Run). Desiste além de LOSE_RADIUS.
 * - attack: soco (Punch_Left). Dano aplicado em HIT_AT da animação se o player ainda estiver no alcance.
 * - special: chute (Kick_Right), mais alcance, mais dano, knockback, cooldown longo. Tem prioridade
 *   sobre o soco sempre que estiver pronto e o player no alcance.
 * - dead: toca Death e some após CORPSE_TIME.
 */
export class ZombieSystem implements System {
  readonly name = 'Zombie';
  readonly root: pc.Entity;
  private zombies: Zombie[] = [];
  private spawnTimer = 2; // primeiro zumbi ~2s após entrar
  private nextId = 1;
  private bounds = World.mapBounds();
  private tmp = new pc.Vec3();
  private unsubs: Array<() => void> = [];
  private playerKnockback = new pc.Vec3();

  constructor(
    private bus: EventBus,
    private state: GameState,
    private player: Player,
    private world: World,
  ) {
    this.root = new pc.Entity('zombies');
    this.world.root.addChild(this.root);
    this.unsubs.push(
      bus.on('player:respawned', () => this.clearAll()),
      bus.on('weapon:fired', () => this.alertByNoise()),
    );
  }

  /** Zumbis vivos (alvo de tiros). */
  *alive(): IterableIterator<Zombie> {
    for (const z of this.zombies) if (z.alive) yield z;
  }

  get aliveCount(): number {
    let n = 0;
    for (const z of this.zombies) if (z.alive) n++;
    return n;
  }

  update(dt: number): void {
    this.tickSpawn(dt);

    const playerPos = this.player.position;
    for (const z of this.zombies) {
      z.tick(dt);
      z.attackCooldown = Math.max(0, z.attackCooldown - dt);
      z.specialCooldown = Math.max(0, z.specialCooldown - dt);
      if (z.state === 'dead') continue;
      // stats.dead lido ao vivo (não snapshot): outro zumbi pode matar o player neste mesmo frame
      this.think(z, playerPos, this.player.stats.dead, dt);
      this.integrate(z, dt);
    }
    this.separate();
    this.applyPlayerKnockback(dt);
    this.reapCorpses();
  }

  // --- spawn ---

  private tickSpawn(dt: number): void {
    if (this.aliveCount >= CONFIG.zombie.MAX_ALIVE || this.player.stats.dead) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = CONFIG.zombie.SPAWN_INTERVAL;
    const p = this.pickSpawnPoint();
    if (p) this.spawn(p.x, p.z);
  }

  private pickSpawnPoint(): { x: number; z: number } | null {
    const { SPAWN_MIN_DIST: min, SPAWN_MAX_DIST: max } = CONFIG.zombie;
    const pp = this.player.position;
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = min + Math.random() * (max - min);
      const x = pp.x + Math.cos(a) * d;
      const z = pp.z + Math.sin(a) * d;
      if (this.inBounds(x, z) && !this.blocked(x, z)) return { x, z };
    }
    return null;
  }

  spawn(x: number, z: number): Zombie {
    const z0 = new Zombie(this.nextId++, x, z);
    this.root.addChild(z0.entity);
    z0.initAnimation();
    z0.wanderTarget.set(x, 0, z);
    this.zombies.push(z0);
    this.bus.emit('zombie:countChanged', { alive: this.aliveCount });
    return z0;
  }

  private inBounds(x: number, z: number): boolean {
    const b = this.bounds;
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  }

  private blocked(x: number, z: number): boolean {
    return !isClearOfCircles(x, z, this.world.objects(), CONFIG.zombie.RADIUS);
  }

  // --- IA ---

  private think(z: Zombie, playerPos: pc.Vec3, playerDead: boolean, dt: number): void {
    const dist = this.dist(z.position, playerPos);
    const cfg = CONFIG.zombie;

    switch (z.state) {
      case 'wander':
        if (!playerDead && dist < cfg.DETECT_RADIUS) {
          z.setState('chase');
          break;
        }
        this.wander(z, dt);
        break;

      case 'chase': {
        // alertado pelo som vem de mais longe que LOSE_RADIUS: só desiste depois de perder de vista por um tempo
        if (playerDead || (dist > cfg.LOSE_RADIUS && z.stateTime > 6)) {
          z.setState('wander');
          z.wanderWait = 1;
          z.velocity.set(0, 0, 0);
          break;
        }
        z.lookAt(playerPos);
        if (z.specialCooldown <= 0 && dist <= cfg.SPECIAL.RANGE) {
          this.startAttack(z, 'special');
          break;
        }
        if (z.attackCooldown <= 0 && dist <= cfg.ATTACK.RANGE) {
          this.startAttack(z, 'attack');
          break;
        }
        // não gruda no player: para de avançar quando já está no alcance do soco
        if (dist <= cfg.ATTACK.RANGE * 0.9) {
          z.velocity.set(0, 0, 0);
          z.play('Idle');
        } else {
          this.tmp.copy(playerPos).sub(z.position);
          this.tmp.y = 0;
          z.velocity.copy(this.tmp.normalize().mulScalar(cfg.CHASE_SPEED));
          z.play('Run');
        }
        break;
      }

      case 'attack':
      case 'special': {
        const special = z.state === 'special';
        const c = special ? cfg.SPECIAL : cfg.ATTACK;
        const duration = z.anim.duration(special ? 'Kick_Right' : 'Punch_Left') || 1;
        z.velocity.set(0, 0, 0);
        if (z.stateTime < duration * c.HIT_AT) z.lookAt(playerPos); // ainda "mira" antes de acertar
        if (!z.hitApplied && z.stateTime >= duration * c.HIT_AT) {
          z.hitApplied = true;
          if (!playerDead && dist <= c.RANGE + 0.3) this.hitPlayer(z, special);
        }
        if (z.stateTime >= duration) {
          z.setState('chase');
        }
        break;
      }
    }
  }

  private startAttack(z: Zombie, kind: 'attack' | 'special'): void {
    z.setState(kind);
    z.velocity.set(0, 0, 0);
    if (kind === 'special') {
      z.specialCooldown = CONFIG.zombie.SPECIAL.COOLDOWN;
      z.attackCooldown = Math.max(z.attackCooldown, 0.6);
      z.play('Kick_Right', true);
    } else {
      z.attackCooldown = CONFIG.zombie.ATTACK.COOLDOWN;
      z.play('Punch_Left', true);
    }
  }

  private hitPlayer(z: Zombie, special: boolean): void {
    if (this.player.stats.dead) return; // morto neste mesmo frame por outro zumbi
    const c = special ? CONFIG.zombie.SPECIAL : CONFIG.zombie.ATTACK;
    const died = this.player.stats.damage(c.DAMAGE);
    this.bus.emit('player:damaged', { amount: c.DAMAGE, special });
    if (special) {
      this.tmp.copy(this.player.position).sub(z.position);
      this.tmp.y = 0;
      if (this.tmp.lengthSq() < 1e-4) this.tmp.set(0, 0, 1);
      this.playerKnockback.copy(this.tmp.normalize().mulScalar(CONFIG.zombie.SPECIAL.KNOCKBACK));
    }
    if (died) this.bus.emit('player:died');
  }

  /** Tiro faz barulho: zumbis perambulando dentro de HEAR_RADIUS passam a perseguir o player. */
  private alertByNoise(): void {
    const r = CONFIG.zombie.HEAR_RADIUS;
    const pp = this.player.position;
    for (const z of this.alive()) {
      if (z.state !== 'wander') continue;
      if (this.dist(z.position, pp) <= r) z.setState('chase');
    }
  }

  private wander(z: Zombie, dt: number): void {
    const cfg = CONFIG.zombie;
    if (z.wanderWait > 0) {
      z.wanderWait -= dt;
      z.velocity.set(0, 0, 0);
      z.play('Idle');
      if (z.wanderWait <= 0) {
        const a = Math.random() * Math.PI * 2;
        const d = 3 + Math.random() * 5;
        const x = Math.min(this.bounds.maxX, Math.max(this.bounds.minX, z.position.x + Math.cos(a) * d));
        const zz = Math.min(this.bounds.maxZ, Math.max(this.bounds.minZ, z.position.z + Math.sin(a) * d));
        z.wanderTarget.set(x, 0, zz);
      }
      return;
    }
    this.tmp.copy(z.wanderTarget).sub(z.position);
    this.tmp.y = 0;
    if (this.tmp.lengthSq() < 0.25 || z.stateTime > 12) {
      z.wanderWait = 1.5 + Math.random() * 3;
      z.stateTime = 0;
      z.velocity.set(0, 0, 0);
      return;
    }
    z.lookAt(z.wanderTarget);
    z.velocity.copy(this.tmp.normalize().mulScalar(cfg.WANDER_SPEED));
    z.play('Walk');
  }

  // --- física simples ---

  private integrate(z: Zombie, dt: number): void {
    if (z.velocity.lengthSq() < 1e-6) return;
    let x = z.position.x + z.velocity.x * dt;
    let zz = z.position.z + z.velocity.z * dt;
    const b = this.bounds;
    x = Math.min(b.maxX, Math.max(b.minX, x));
    zz = Math.min(b.maxZ, Math.max(b.minZ, zz));
    // desvia de árvores/rochas (mesma resolução circular do CollisionSystem do player)
    for (const o of this.world.objects()) {
      if (!o.solidRadius) continue;
      const pushed = pushOutCircle(x, zz, o.position.x, o.position.z, o.solidRadius + CONFIG.zombie.RADIUS);
      if (pushed) {
        x = pushed.x;
        zz = pushed.z;
        if (z.state === 'wander') z.wanderWait = 0.3; // travou num obstáculo: escolhe outro ponto
      }
    }
    z.entity.setPosition(x, 0, zz);
  }

  /** Zumbis não se sobrepõem entre si nem entram no player. */
  private separate(): void {
    const r = CONFIG.zombie.RADIUS;
    const alive = [...this.alive()];
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        this.pushApart(alive[i].entity, alive[j].entity, r * 2, 0.5);
      }
      this.pushApart(alive[i].entity, this.player.entity, r + CONFIG.player.RADIUS, 1);
    }
  }

  private pushApart(a: pc.Entity, b: pc.Entity, minDist: number, aShare: number): void {
    const pa = a.getPosition();
    const pb = b.getPosition();
    const dx = pa.x - pb.x;
    const dz = pa.z - pb.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= minDist * minDist) return;
    const d = Math.sqrt(d2) || 1e-4;
    const push = minDist - d;
    const nx = (d2 < 1e-8 ? 1 : dx / d) * push;
    const nz = (d2 < 1e-8 ? 0 : dz / d) * push;
    a.setPosition(pa.x + nx * aShare, 0, pa.z + nz * aShare);
    if (aShare < 1) b.setPosition(pb.x - nx * (1 - aShare), 0, pb.z - nz * (1 - aShare));
  }

  private applyPlayerKnockback(dt: number): void {
    const k = this.playerKnockback;
    if (k.lengthSq() < 1e-4) return;
    const p = this.player.position;
    const b = this.bounds;
    const x = Math.min(b.maxX, Math.max(b.minX, p.x + k.x * dt));
    const z = Math.min(b.maxZ, Math.max(b.minZ, p.z + k.z * dt));
    this.player.setPosition(x, 0, z);
    k.mulScalar(Math.max(0, 1 - dt * 6)); // decai rápido
    if (k.lengthSq() < 1e-4) k.set(0, 0, 0);
  }

  private reapCorpses(): void {
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      if (z.state === 'dead' && z.stateTime >= CONFIG.zombie.CORPSE_TIME) {
        z.destroy();
        this.zombies.splice(i, 1);
      }
    }
  }

  /** Chamado pelo CombatSystem quando um tiro acerta. */
  damage(z: Zombie, amount: number): void {
    const died = z.damage(amount);
    this.bus.emit('zombie:damaged', { id: z.id, hp: z.hp, maxHp: CONFIG.zombie.MAX_HP });
    if (died) {
      this.state.kills++;
      this.bus.emit('zombie:killed', { id: z.id, kills: this.state.kills });
      this.bus.emit('zombie:countChanged', { alive: this.aliveCount });
    }
  }

  private clearAll(): void {
    for (const z of this.zombies) z.destroy();
    this.zombies = [];
    this.spawnTimer = 4;
    this.playerKnockback.set(0, 0, 0);
    this.bus.emit('zombie:countChanged', { alive: 0 });
  }

  private dist(a: pc.Vec3, b: pc.Vec3): number {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    for (const z of this.zombies) z.destroy();
    this.zombies = [];
    this.root.destroy();
  }
}

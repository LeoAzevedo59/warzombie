import * as pc from 'playcanvas';
import { CONFIG } from '@/config';
import type { System } from '@/Core/GameLoop';
import type { EventBus } from '@/Core/EventBus';
import type { Player } from '@/Entities/Player/Player';
import { makeBox } from '@/Assets/Primitives';
import type { InputSystem } from './InputSystem';
import type { EquipmentSystem } from './EquipmentSystem';
import type { ZombieSystem } from './ZombieSystem';
import type { Zombie } from '@/Entities/Enemies/Zombie';

const TRACER_TIME = 0.07;
const MUZZLE_HEIGHT = 1.2;

/**
 * Tiro com a pistola equipada: clique dispara um "raio" no plano do chão, do player em direção
 * ao ponto do mouse. Acerta o zumbi vivo mais próximo cujo centro passe a menos de HIT_RADIUS
 * do raio, dentro de RANGE. Cooldown por arma.
 */
export class CombatSystem implements System {
  readonly name = 'Combat';
  private unsub: () => void;
  private cooldown = 0;
  private dir = new pc.Vec3();
  private tmp = new pc.Vec3();
  private tracers: Array<{ entity: pc.Entity; ttl: number }> = [];

  constructor(
    private bus: EventBus,
    private player: Player,
    private input: InputSystem,
    private equipment: EquipmentSystem,
    private zombies: ZombieSystem,
    private sceneRoot: pc.Entity,
  ) {
    this.unsub = bus.on('input:fire', () => this.fire());
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.ttl -= dt;
      if (t.ttl <= 0) {
        t.entity.destroy();
        this.tracers.splice(i, 1);
      }
    }
  }

  get canFire(): boolean {
    return this.equipment.equippedItem() === 'pistol' && this.cooldown <= 0 && !this.player.stats.dead;
  }

  private fire(): void {
    if (!this.canFire) return;
    const w = CONFIG.weapon.pistol;
    this.cooldown = w.COOLDOWN;

    // direção: player -> mouse no chão; sem mouse válido, pra onde está olhando
    const from = this.player.position;
    const aim = this.input.state.aimPoint;
    if (aim) {
      this.dir.set(aim.x - from.x, 0, aim.z - from.z);
      if (this.dir.lengthSq() < 1e-4) this.player.forward(this.dir);
      else this.dir.normalize();
      this.player.lookAt(aim);
    } else {
      this.player.forward(this.dir);
    }
    this.player.playShoot();

    // hit test: zumbi vivo mais próximo ao longo do raio
    let best: Zombie | null = null;
    let bestT: number = w.RANGE;
    for (const z of this.zombies.alive()) {
      this.tmp.copy(z.position).sub(from);
      this.tmp.y = 0;
      const t = this.tmp.dot(this.dir);
      if (t < 0 || t > bestT) continue;
      const perp2 = this.tmp.lengthSq() - t * t;
      if (perp2 > w.HIT_RADIUS * w.HIT_RADIUS) continue;
      best = z;
      bestT = t;
    }

    this.spawnTracer(from, bestT);
    if (best) this.zombies.damage(best, w.DAMAGE);
    this.bus.emit('weapon:fired', { itemId: 'pistol', hit: best !== null });
  }

  private spawnTracer(from: pc.Vec3, length: number): void {
    const e = makeBox({ color: '#ffd34d', scale: [0.035, 0.035, length], emissive: 1.5 });
    const mid = this.tmp.copy(this.dir).mulScalar(length / 2).add(from);
    e.setPosition(mid.x, MUZZLE_HEIGHT, mid.z);
    e.setEulerAngles(0, Math.atan2(this.dir.x, this.dir.z) * pc.math.RAD_TO_DEG, 0);
    this.sceneRoot.addChild(e);
    this.tracers.push({ entity: e, ttl: TRACER_TIME });
  }

  dispose(): void {
    this.unsub();
    for (const t of this.tracers) t.entity.destroy();
    this.tracers = [];
  }
}

import * as pc from 'playcanvas';
import { CONFIG } from '@/config';
import type { System } from '@/Core/GameLoop';
import type { EventBus } from '@/Core/EventBus';
import { Zombie } from '@/Entities/Enemies/Zombie';
import type { ZombieSnapshot } from '@shared/protocol';

/**
 * Renderiza os zumbis simulados no servidor: cria/atualiza/remove entidades a partir dos
 * snapshots do `state`. Corpos somem CORPSE_TIME depois do Death.
 */
export class ZombieSystem implements System {
  readonly name = 'Zombie';
  readonly root: pc.Entity;
  private zombies = new Map<number, Zombie>();
  private lastAlive = -1;
  private unsubs: Array<() => void> = [];

  constructor(
    private bus: EventBus,
    parent: pc.Entity,
  ) {
    this.root = new pc.Entity('zombies');
    parent.addChild(this.root);
    this.unsubs.push(bus.on('net:zombies', ({ zombies }) => this.apply(zombies)));
  }

  *alive(): IterableIterator<Zombie> {
    for (const z of this.zombies.values()) if (z.alive) yield z;
  }

  *all(): IterableIterator<Zombie> {
    yield* this.zombies.values();
  }

  get aliveCount(): number {
    let n = 0;
    for (const z of this.zombies.values()) if (z.alive) n++;
    return n;
  }

  get(id: number): Zombie | undefined {
    return this.zombies.get(id);
  }

  private apply(snaps: ZombieSnapshot[]): void {
    const seen = new Set<number>();
    for (const s of snaps) {
      seen.add(s.id);
      let z = this.zombies.get(s.id);
      if (!z) {
        z = new Zombie(s.id, s);
        this.root.addChild(z.entity);
        z.initAnimation();
        this.zombies.set(s.id, z);
      }
      const wasAttacking = z.attacking;
      z.apply(s);
      if (z.attacking && !wasAttacking) this.bus.emit('zombie:attack', { id: s.id, x: s.x, z: s.z });
    }
    for (const [id, z] of this.zombies) {
      if (!seen.has(id) && !z.dead) {
        // sumiu sem morrer (sala reiniciada etc.)
        z.destroy();
        this.zombies.delete(id);
      }
    }
  }

  update(dt: number): void {
    for (const [id, z] of this.zombies) {
      z.update(dt);
      if (z.dead && z.deadTime >= CONFIG.zombie.CORPSE_TIME) {
        z.destroy();
        this.zombies.delete(id);
      }
    }
    const alive = this.aliveCount;
    if (alive !== this.lastAlive) {
      this.lastAlive = alive;
      this.bus.emit('zombie:countChanged', { alive });
    }
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    for (const z of this.zombies.values()) z.destroy();
    this.zombies.clear();
    this.root.destroy();
  }
}

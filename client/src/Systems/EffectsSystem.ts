import * as pc from 'playcanvas';
import type { System } from '@/Core/GameLoop';
import type { EventBus } from '@/Core/EventBus';
import type { Player } from '@/Entities/Player/Player';
import { makeCylinder } from '@/Assets/Primitives';
import { mapBounds } from '@shared/worldgen';

/** Efeitos vindos do servidor: knockback no player local e aviso (círculo vermelho) da pancada do boss. */
export class EffectsSystem implements System {
  readonly name = 'Effects';
  private unsubs: Array<() => void> = [];
  private knockback = new pc.Vec3();
  private bounds = mapBounds();
  private telegraphs: Array<{ entity: pc.Entity; ttl: number; total: number }> = [];

  constructor(
    bus: EventBus,
    private player: Player,
    private sceneRoot: pc.Entity,
  ) {
    this.unsubs.push(
      bus.on('net:knockback', ({ dx, dz, force }) => this.knockback.set(dx * force, 0, dz * force)),
      bus.on('boss:slam', ({ x, z, radius, windup }) => {
        const disc = makeCylinder({ color: '#ff3b3b', scale: [radius * 2, 0.04, radius * 2], position: [x, 0.03, z], emissive: 1.2 });
        this.sceneRoot.addChild(disc);
        this.telegraphs.push({ entity: disc, ttl: windup + 0.3, total: windup + 0.3 });
      }),
    );
  }

  update(dt: number): void {
    const k = this.knockback;
    if (k.lengthSq() > 1e-4) {
      const p = this.player.position;
      const b = this.bounds;
      const x = Math.min(b.maxX, Math.max(b.minX, p.x + k.x * dt));
      const z = Math.min(b.maxZ, Math.max(b.minZ, p.z + k.z * dt));
      this.player.setPosition(x, 0, z);
      k.mulScalar(Math.max(0, 1 - dt * 6)); // decai rápido
      if (k.lengthSq() < 1e-4) k.set(0, 0, 0);
    }
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const t = this.telegraphs[i];
      t.ttl -= dt;
      // pulsa: cresce até o impacto
      const s = 0.6 + 0.4 * (1 - t.ttl / t.total);
      const base = t.entity.getLocalScale();
      t.entity.setLocalScale(base.x, 0.04, base.z);
      void s;
      if (t.ttl <= 0) {
        t.entity.destroy();
        this.telegraphs.splice(i, 1);
      }
    }
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    for (const t of this.telegraphs) t.entity.destroy();
    this.telegraphs = [];
  }
}

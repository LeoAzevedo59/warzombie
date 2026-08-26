import * as pc from 'playcanvas';
import type { System } from '@/Core/GameLoop';
import type { EventBus } from '@/Core/EventBus';
import type { Player } from '@/Entities/Player/Player';
import { makeCylinder, makeSphere } from '@/Assets/Primitives';
import type { GameState } from '@/Core/GameState';
import type { ProjectileSnapshot } from '@shared/protocol';
import { mapBounds } from '@shared/worldgen';

/** Efeitos vindos do servidor: knockback no player local e aviso (círculo vermelho) da pancada do boss. */
export class EffectsSystem implements System {
  readonly name = 'Effects';
  private unsubs: Array<() => void> = [];
  private knockback = new pc.Vec3();
  private bounds = mapBounds();
  private telegraphs: Array<{ entity: pc.Entity; ttl: number; total: number }> = [];
  private projectiles = new Map<number, { entity: pc.Entity; target: pc.Vec3 }>();
  /** anéis de escudo por jogador (posição atualizada a cada frame) */
  private shields = new Map<string, { entity: pc.Entity; ttl: number }>();

  constructor(
    bus: EventBus,
    private player: Player,
    private sceneRoot: pc.Entity,
    private state: GameState,
    private positionOf: (id: string) => pc.Vec3 | null,
  ) {
    this.unsubs.push(
      bus.on('net:shield', ({ playerId, seconds }) => {
        this.shields.get(playerId)?.entity.destroy();
        const ring = makeCylinder({ color: '#4db8ff', scale: [1.6, 0.05, 1.6], emissive: 1.2 });
        this.sceneRoot.addChild(ring);
        this.shields.set(playerId, { entity: ring, ttl: seconds });
      }),
      bus.on('net:knockback', ({ dx, dz, force }) => this.knockback.set(dx * force, 0, dz * force)),
      bus.on('net:projectiles', ({ projectiles }) => this.applyProjectiles(projectiles)),
      bus.on('boss:slam', ({ x, z, radius, windup }) => {
        const disc = makeCylinder({ color: '#ff3b3b', scale: [radius * 2, 0.04, radius * 2], position: [x, 0.03, z], emissive: 1.2 });
        this.sceneRoot.addChild(disc);
        this.telegraphs.push({ entity: disc, ttl: windup + 0.3, total: windup + 0.3 });
      }),
    );
  }

  /** Cuspes em voo: esferas verdes (roxas/maiores para o chefão) interpoladas entre snapshots. */
  private applyProjectiles(snaps: ProjectileSnapshot[]): void {
    const seen = new Set<number>();
    for (const s of snaps) {
      seen.add(s.id);
      let p = this.projectiles.get(s.id);
      if (!p) {
        const size = s.boss ? 0.6 : 0.35;
        const entity = makeSphere({ color: s.boss ? '#c05cff' : '#8cff4d', scale: [size, size, size], position: [s.x, 1.0, s.z], emissive: 1.4 });
        this.sceneRoot.addChild(entity);
        p = { entity, target: new pc.Vec3(s.x, 1.0, s.z) };
        this.projectiles.set(s.id, p);
      }
      p.target.set(s.x, 1.0, s.z);
    }
    for (const [id, p] of this.projectiles) {
      if (!seen.has(id)) {
        p.entity.destroy();
        this.projectiles.delete(id);
      }
    }
  }

  update(dt: number): void {
    for (const [id, sh] of this.shields) {
      sh.ttl -= dt;
      const pos = this.positionOf(id);
      if (sh.ttl <= 0 || !pos) {
        sh.entity.destroy();
        this.shields.delete(id);
        continue;
      }
      sh.entity.setPosition(pos.x, 0.05, pos.z);
      const pulse = 1.5 + 0.15 * Math.sin(sh.ttl * 8);
      sh.entity.setLocalScale(pulse, 0.05, pulse);
    }
    void this.state;
    for (const p of this.projectiles.values()) {
      const pos = p.entity.getPosition();
      const t = 1 - Math.exp(-20 * dt);
      p.entity.setPosition(pos.x + (p.target.x - pos.x) * t, 1.0, pos.z + (p.target.z - pos.z) * t);
    }
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
    for (const p of this.projectiles.values()) p.entity.destroy();
    this.projectiles.clear();
    for (const sh of this.shields.values()) sh.entity.destroy();
    this.shields.clear();
  }
}

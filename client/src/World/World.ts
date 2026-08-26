import * as pc from 'playcanvas';
import { CONFIG } from '@/config';
import type { EventBus } from '@/Core/EventBus';
import { GameMap, chunkKey, type Chunk } from './Map';
import type { WorldObject } from './WorldObject';
import { HubStructure } from './Hub';
import { isChunkInBounds, mapBounds, toChunkCoord } from '@shared/worldgen';

/** Mantém os chunks ativos ao redor de um ponto focal (o player) e as estruturas fixas do hub. */
export class World {
  readonly root: pc.Entity;
  private chunks = new Map<string, Chunk>();
  private lastCenter = { cx: NaN, cz: NaN };
  readonly vendor: HubStructure;
  readonly tower: HubStructure;

  constructor(
    private map: GameMap,
    private bus: EventBus,
  ) {
    this.root = new pc.Entity('world');
    this.vendor = new HubStructure('vendor');
    this.tower = new HubStructure('tower');
    this.root.addChild(this.vendor.entity);
    this.root.addChild(this.tower.entity);
  }

  /** Chame depois de `root` estar na cena (animação do vendedor). */
  init(): void {
    this.vendor.initAnimation();
    this.tower.initAnimation();
  }

  static toChunkCoord = toChunkCoord;
  static isChunkInBounds = isChunkInBounds;
  static mapBounds = mapBounds;

  /** Recalcula chunks ativos (dentro dos limites do mapa) se o foco mudou de chunk. */
  update(focus: pc.Vec3): void {
    const cx = toChunkCoord(focus.x);
    const cz = toChunkCoord(focus.z);
    if (cx === this.lastCenter.cx && cz === this.lastCenter.cz) return;
    this.lastCenter = { cx, cz };

    const r = CONFIG.world.ACTIVE_RADIUS;
    const wanted = new Set<string>();
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const ccx = cx + dx;
        const ccz = cz + dz;
        if (!isChunkInBounds(ccx, ccz)) continue;
        const key = chunkKey(ccx, ccz);
        wanted.add(key);
        if (!this.chunks.has(key)) this.load(ccx, ccz);
      }
    }
    for (const [key, chunk] of this.chunks) {
      if (!wanted.has(key)) this.unload(key, chunk);
    }
  }

  private load(cx: number, cz: number): void {
    const chunk = this.map.generate(cx, cz);
    this.root.addChild(chunk.root);
    this.chunks.set(chunkKey(cx, cz), chunk);
    this.bus.emit('chunk:loaded', { cx, cz });
  }

  private unload(key: string, chunk: Chunk): void {
    this.map.destroy(chunk);
    this.chunks.delete(key);
    this.bus.emit('chunk:unloaded', { cx: chunk.cx, cz: chunk.cz });
  }

  /** Todos os objetos coletáveis nos chunks ativos. */
  *objects(): IterableIterator<WorldObject> {
    for (const c of this.chunks.values()) yield* c.objects;
  }

  /** Estruturas fixas do hub. */
  *structures(): IterableIterator<HubStructure> {
    yield this.vendor;
    yield this.tower;
  }

  /** Tudo que bloqueia movimento. */
  *obstacles(): IterableIterator<{ position: pc.Vec3; solidRadius: number }> {
    yield* this.objects();
    yield* this.structures();
  }

  findObject(id: number): WorldObject | null {
    for (const c of this.chunks.values()) for (const o of c.objects) if (o.id === id) return o;
    return null;
  }

  removeObject(obj: WorldObject): void {
    for (const c of this.chunks.values()) {
      const i = c.objects.indexOf(obj);
      if (i >= 0) {
        c.objects.splice(i, 1);
        obj.destroy();
        return;
      }
    }
  }

  activeChunkCoords(): Array<{ cx: number; cz: number }> {
    return [...this.chunks.values()].map(({ cx, cz }) => ({ cx, cz }));
  }

  dispose(): void {
    this.vendor.destroy();
    this.tower.destroy();
  }
}

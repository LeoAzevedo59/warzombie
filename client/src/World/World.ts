import * as pc from 'playcanvas';
import { CONFIG } from '@/config';
import type { EventBus } from '@/Core/EventBus';
import { GameMap, chunkKey, type Chunk } from './Map';
import type { WorldObject } from './WorldObject';
import type { Workbench } from './Structure';

/** Mantém os chunks ativos ao redor de um ponto focal (o player). */
export class World {
  readonly root: pc.Entity;
  private chunks = new Map<string, Chunk>();
  private lastCenter = { cx: NaN, cz: NaN };
  /** Estruturas colocadas pelo jogador: independem do streaming de chunks. */
  private placedBenches: Workbench[] = [];

  constructor(
    private map: GameMap,
    private bus: EventBus,
  ) {
    this.root = new pc.Entity('world');
  }

  static toChunkCoord(v: number): number {
    return Math.floor(v / CONFIG.world.CHUNK_SIZE);
  }

  /** Mapa fixo: limites em unidades de mundo para o chunk (cx,cz) ficar dentro de [-MAP_RADIUS, MAP_RADIUS]. */
  static isChunkInBounds(cx: number, cz: number): boolean {
    const r = CONFIG.world.MAP_RADIUS;
    return cx >= -r && cx <= r && cz >= -r && cz <= r;
  }

  /** Limites em unidades de mundo dentro dos quais o player pode andar (com margem). */
  static mapBounds() {
    const size = CONFIG.world.CHUNK_SIZE;
    const r = CONFIG.world.MAP_RADIUS;
    const margin = 0.5;
    return {
      minX: -r * size + margin,
      maxX: (r + 1) * size - margin,
      minZ: -r * size + margin,
      maxZ: (r + 1) * size - margin,
    };
  }

  /** Recalcula chunks ativos (dentro dos limites do mapa) se o foco mudou de chunk. */
  update(focus: pc.Vec3): void {
    const cx = World.toChunkCoord(focus.x);
    const cz = World.toChunkCoord(focus.z);
    if (cx === this.lastCenter.cx && cz === this.lastCenter.cz) return;
    this.lastCenter = { cx, cz };

    const r = CONFIG.world.ACTIVE_RADIUS;
    const wanted = new Set<string>();
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const ccx = cx + dx;
        const ccz = cz + dz;
        if (!World.isChunkInBounds(ccx, ccz)) continue;
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

  addBench(wb: Workbench): void {
    this.placedBenches.push(wb);
    this.root.addChild(wb.entity);
  }

  *benches(): IterableIterator<Workbench> {
    yield* this.placedBenches;
  }
}

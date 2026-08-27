import * as pc from 'playcanvas';
import { CONFIG } from '@/config';
import type { EventBus } from '@/Core/EventBus';
import { GameMap, chunkKey, makeDirtPatch, type Chunk } from './Map';
import { HubStructure } from './Hub';
import { Wall } from './Wall';
import { Drop } from './Drop';
import { WorldObject } from './WorldObject';
import { instantiateModel, type ModelKey } from '@/Assets/ModelAssets';
import { generateChunk } from '@shared/worldgen';
import type { DroppedItem, StructureSnapshot } from '@shared/protocol';
import { isChunkInBounds, mapBounds, toChunkCoord } from '@shared/worldgen';

/** Mantém os chunks ativos ao redor de um ponto focal (o player) e as estruturas fixas do hub. */
export class World {
  readonly root: pc.Entity;
  private chunks = new Map<string, Chunk>();
  private lastCenter = { cx: NaN, cz: NaN };
  readonly vendor: HubStructure;
  readonly tower: HubStructure;
  readonly walls = new Map<number, Wall>();
  /** itens largados no chão */
  readonly drops = new Map<number, Drop>();
  /** cenografia do hub com colisão (picape, barris...) */
  private decorObstacles: Array<{ position: pc.Vec3; solidRadius: number }> = [];

  constructor(
    private map: GameMap,
    private bus: EventBus,
    towerPos: { x: number; z: number },
    private seed: number,
    app: pc.Application,
  ) {
    this.root = new pc.Entity('world');
    // clareira de terra batida do acampamento
    this.root.addChild(makeDirtPatch(app, 0, 0, 7.5, 0.8, 30, 0.05)); // acima das manchas dos chunks
    this.vendor = new HubStructure('vendor');
    this.tower = new HubStructure('tower', towerPos);
    this.root.addChild(this.vendor.entity);
    this.root.addChild(this.tower.entity);
    this.buildHubDecor();
  }

  /** Cenário fixo ao redor do hub (Zombie Apocalypse Kit): picape abandonada, barris, cones, sangue. */
  private buildHubDecor(): void {
    const place = (key: ModelKey, x: number, z: number, yaw: number, solidRadius = 0, scale = 1, y = 0): void => {
      const e = instantiateModel(key);
      const s = e.getLocalScale().x * scale;
      e.setLocalScale(s, s, s);
      e.setLocalPosition(x, y, z);
      e.setLocalEulerAngles(0, yaw, 0);
      this.root.addChild(e);
      if (solidRadius > 0) this.decorObstacles.push({ position: e.getPosition(), solidRadius });
    };
    place('pickup', -6.5, 4.5, 115, 2.2);
    place('cone', -4.2, 6.8, 0);
    place('cone', -3.4, 7.4, 30);
    place('barrier', 7.5, -2.5, 60, 0.7);
    place('barrel', 6.8, -4.2, 0, 0.4);
    place('pallet', 6.2, 7.2, 20);
    place('cinder', 6.9, 7.6, 70);
    place('blood_1', 2.5, -7.5, 40, 0, 1, 0.07); // decais acima da clareira de terra (y=0.05)
    place('blood_2', -7, -1.5, 0, 0, 1, 0.07);
    place('chest', -2.6, -5.2, 160, 0.4);
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
  *obstacles(): IterableIterator<{ position: pc.Vec3; solidRadius: number; segment?: { yaw: number; halfLen: number; radius: number } }> {
    yield* this.objects();
    yield* this.structures();
    yield* this.walls.values();
    yield* this.decorObstacles;
  }

  addWall(s: StructureSnapshot): void {
    if (this.walls.has(s.id)) return;
    const w = new Wall(s);
    this.root.addChild(w.entity);
    this.walls.set(s.id, w);
  }

  addDrop(d: DroppedItem): void {
    if (this.drops.has(d.id)) return;
    const drop = new Drop(d);
    this.root.addChild(drop.entity);
    this.drops.set(d.id, drop);
  }

  removeDrop(id: number): void {
    const d = this.drops.get(id);
    if (!d) return;
    d.destroy();
    this.drops.delete(id);
  }

  setWallHp(id: number, hp: number): void {
    this.walls.get(id)?.setHp(hp);
  }

  removeWall(id: number): void {
    const w = this.walls.get(id);
    if (!w) return;
    w.destroy();
    this.walls.delete(id);
  }

  /** Recurso renasceu: instancia de novo se o chunk dele está carregado. */
  respawnObject(id: number): void {
    for (const c of this.chunks.values()) {
      if (c.objects.some((o) => o.id === id)) return;
      const spec = generateChunk(this.seed, c.cx, c.cz).find((o) => o.id === id);
      if (!spec) continue;
      const obj = new WorldObject(spec);
      c.root.addChild(obj.entity);
      c.objects.push(obj);
      return;
    }
  }

  updateWalls(): void {
    for (const w of this.walls.values()) w.update();
  }

  /** Animações leves dos objetos (tremor ao ser golpeado). */
  updateObjects(dt: number): void {
    for (const c of this.chunks.values()) for (const o of c.objects) o.update(dt);
    for (const d of this.drops.values()) d.update(dt);
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
    for (const w of this.walls.values()) w.destroy();
    this.walls.clear();
    for (const d of this.drops.values()) d.destroy();
    this.drops.clear();
  }
}

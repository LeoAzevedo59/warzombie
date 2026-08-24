import * as pc from 'playcanvas';
import { CONFIG } from '@/config';
import { makeBox } from '@/Assets/Primitives';
import { tileForChunk } from './Tile';
import { WorldObject, type WorldObjectKind } from './WorldObject';

export interface Chunk {
  cx: number;
  cz: number;
  root: pc.Entity;
  objects: WorldObject[];
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

/** RNG determinístico (mulberry32). */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashChunk(seed: number, cx: number, cz: number): number {
  let h = seed ^ 0x9e3779b9;
  h = Math.imul(h ^ (cx * 0x85ebca6b), 0xc2b2ae35);
  h = Math.imul(h ^ (cz * 0x27d4eb2f), 0x165667b1);
  return h >>> 0;
}

/** Gera e destrói chunks. Não decide QUAIS chunks existem — isso é do World. */
export class GameMap {
  constructor(
    private seed: number,
    private isCollected: (objectId: number) => boolean,
  ) {}

  generate(cx: number, cz: number): Chunk {
    const size = CONFIG.world.CHUNK_SIZE;
    const root = new pc.Entity(`chunk(${cx},${cz})`);
    const originX = cx * size;
    const originZ = cz * size;

    const tile = tileForChunk(cx, cz);
    const floor = makeBox({
      name: 'floor',
      color: tile.color,
      scale: [size, 0.1, size],
      position: [originX + size / 2, -0.05, originZ + size / 2],
    });
    root.addChild(floor);

    const rand = mulberry32(hashChunk(this.seed, cx, cz));
    const { OBJECTS_PER_CHUNK_MIN: min, OBJECTS_PER_CHUNK_MAX: max } = CONFIG.world;
    const count = min + Math.floor(rand() * (max - min + 1));
    const objects: WorldObject[] = [];

    const spawn = (i: number, kind: WorldObjectKind, at?: { x: number; z: number }) => {
      const id = hashChunk(this.seed, cx * 1000 + i, cz * 1000 + i);
      const x = at?.x ?? originX + 1.5 + rand() * (size - 3);
      const z = at?.z ?? originZ + 1.5 + rand() * (size - 3);
      const rotY = rand() * 360;
      if (this.isCollected(id)) return;
      // chunk de origem: mantém a área do spawn do player livre de nós grandes
      if (cx === 0 && cz === 0 && kind !== 'stick' && kind !== 'stone' && kind !== 'pistol' && Math.hypot(x, z) < 6) return;
      const obj = new WorldObject(id, kind, x, z, rotY);
      root.addChild(obj.entity);
      objects.push(obj);
    };

    let i = 0;
    for (; i < count; i++) spawn(i, rand() < 0.55 ? 'stick' : 'stone');
    const trees = 1 + Math.floor(rand() * 2); // 1–2
    for (let t = 0; t < trees; t++) spawn(i++, 'tree');
    if (rand() < 0.6) spawn(i++, 'rock'); // 0–1
    // pistola: uma garantida a 3–5m do spawn do player; nos outros chunks, ~1 em 5
    if (cx === 0 && cz === 0) {
      const a = rand() * Math.PI * 2;
      const d = 3 + rand() * 2;
      spawn(i++, 'pistol', { x: Math.cos(a) * d, z: Math.sin(a) * d });
    } else if (rand() < 0.2) spawn(i++, 'pistol');

    return { cx, cz, root, objects };
  }

  destroy(chunk: Chunk): void {
    chunk.root.destroy();
    chunk.objects.length = 0;
  }
}

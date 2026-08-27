import * as pc from 'playcanvas';
import { groundMaterial } from '@/Assets/GroundTextures';
import { instantiateModel, type ModelKey } from '@/Assets/ModelAssets';
import { WorldObject } from './WorldObject';
import { generateChunk, hashChunk, mulberry32, WORLD } from '@shared/worldgen';

export interface Chunk {
  cx: number;
  cz: number;
  root: pc.Entity;
  objects: WorldObject[];
}

export { chunkKey } from '@shared/worldgen';

/** Decoração puramente visual (sem colisão nem interação), sorteada por chunk com uma seed própria. */
const DECOR_POOL: Array<{ key: ModelKey; weight: number }> = [
  { key: 'grass', weight: 14 },
  { key: 'grass_large', weight: 10 },
  { key: 'grass_leafs', weight: 6 },
  { key: 'flower_red', weight: 3 },
  { key: 'flower_yellow', weight: 3 },
  { key: 'flower_purple', weight: 2 },
  { key: 'mushroom_red', weight: 2 },
  { key: 'mushroom_tan', weight: 2 },
  { key: 'rock_small', weight: 3 },
  { key: 'rock_small_flat', weight: 3 },
  { key: 'stone_small', weight: 2 },
  { key: 'bush', weight: 3 },
  { key: 'bush_small', weight: 3 },
  { key: 'stump', weight: 1 },
  { key: 'log', weight: 1 },
];
const DECOR_PER_CHUNK = 26;
const DECOR_TOTAL_WEIGHT = DECOR_POOL.reduce((a, d) => a + d.weight, 0);

/** Disco achatado de terra (radius x radius*ratio), um pouco acima do chão para não brigar com a grama. */
/** `y` distinto por mancha evita z-fighting onde duas se sobrepõem (todas na mesma altura piscavam). */
export function makeDirtPatch(app: pc.Application, x: number, z: number, radius: number, ratio: number, yaw: number, y = 0.012): pc.Entity {
  const e = new pc.Entity('dirt');
  e.addComponent('render', { type: 'cylinder', material: groundMaterial(app, 'dirt', radius / 2), castShadows: false });
  e.setLocalScale(radius * 2, 0.02, radius * 2 * ratio);
  e.setLocalPosition(x, y, z);
  e.setLocalEulerAngles(0, yaw, 0);
  return e;
}

/** Instancia os visuais de um chunk a partir da geração determinística compartilhada (@shared/worldgen). */
export class GameMap {
  constructor(
    private app: pc.Application,
    private seed: number,
    private isRemoved: (objectId: number) => boolean,
  ) {}

  generate(cx: number, cz: number): Chunk {
    const size = WORLD.CHUNK_SIZE;
    const root = new pc.Entity(`chunk(${cx},${cz})`);
    const originX = cx * size;
    const originZ = cz * size;

    const floor = new pc.Entity('floor');
    floor.addComponent('render', { type: 'box', material: groundMaterial(this.app, 'grass', size / 4), castShadows: false });
    floor.setLocalScale(size, 0.1, size);
    floor.setLocalPosition(originX + size / 2, -0.05, originZ + size / 2);
    root.addChild(floor);

    const objects: WorldObject[] = [];
    const specs = generateChunk(this.seed, cx, cz);
    for (const spec of specs) {
      if (this.isRemoved(spec.id)) continue;
      const obj = new WorldObject(spec);
      root.addChild(obj.entity);
      objects.push(obj);
    }

    // decoração: evita o hub e as posições dos objetos interativos
    const rand = mulberry32(hashChunk(this.seed ^ 0x5eed1234, cx, cz));
    const clear2 = (WORLD.HUB_CLEAR_RADIUS + 1) ** 2;
    // manchas de terra (elipses achatadas sobre a grama) em vez de chunks inteiros de terra
    const patches = Math.floor(rand() * 3);
    for (let i = 0; i < patches; i++) {
      const x = originX + 2 + rand() * (size - 4);
      const z = originZ + 2 + rand() * (size - 4);
      if (x * x + z * z < clear2 * 2) continue;
      root.addChild(makeDirtPatch(this.app, x, z, 2.5 + rand() * 3.5, 0.55 + rand() * 0.6, rand() * 180, 0.012 + rand() * 0.03));
    }
    for (let i = 0; i < DECOR_PER_CHUNK; i++) {
      const x = originX + rand() * size;
      const z = originZ + rand() * size;
      if (x * x + z * z < clear2) continue;
      if (specs.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 1.2)) continue;
      let pick = rand() * DECOR_TOTAL_WEIGHT;
      let key: ModelKey = 'grass';
      for (const d of DECOR_POOL) {
        pick -= d.weight;
        if (pick <= 0) {
          key = d.key;
          break;
        }
      }
      const e = instantiateModel(key);
      const s = e.getLocalScale().x * (0.8 + rand() * 0.5);
      e.setLocalScale(s, s, s);
      e.setLocalPosition(x, 0, z);
      e.setLocalEulerAngles(0, rand() * 360, 0);
      root.addChild(e);
    }
    return { cx, cz, root, objects };
  }

  destroy(chunk: Chunk): void {
    chunk.root.destroy();
    chunk.objects.length = 0;
  }
}

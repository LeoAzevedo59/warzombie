import * as pc from 'playcanvas';
import { makeBox } from '@/Assets/Primitives';
import { tileForChunk } from './Tile';
import { WorldObject } from './WorldObject';
import { generateChunk, WORLD } from '@shared/worldgen';

export interface Chunk {
  cx: number;
  cz: number;
  root: pc.Entity;
  objects: WorldObject[];
}

export { chunkKey } from '@shared/worldgen';

/** Instancia os visuais de um chunk a partir da geração determinística compartilhada (@shared/worldgen). */
export class GameMap {
  constructor(
    private seed: number,
    private isRemoved: (objectId: number) => boolean,
  ) {}

  generate(cx: number, cz: number): Chunk {
    const size = WORLD.CHUNK_SIZE;
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

    const objects: WorldObject[] = [];
    for (const spec of generateChunk(this.seed, cx, cz)) {
      if (this.isRemoved(spec.id)) continue;
      const obj = new WorldObject(spec);
      root.addChild(obj.entity);
      objects.push(obj);
    }
    return { cx, cz, root, objects };
  }

  destroy(chunk: Chunk): void {
    chunk.root.destroy();
    chunk.objects.length = 0;
  }
}

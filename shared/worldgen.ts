import type { ItemId, ItemStack } from './items.js';

/**
 * Geração determinística do mundo: dada a seed, client e server produzem exatamente os mesmos
 * objetos (ids, tipos, posições). O client só instancia os visuais; o server valida pickups/hits.
 */

export const WORLD = {
  CHUNK_SIZE: 16,
  /** mapa fixo: chunks de -MAP_RADIUS a +MAP_RADIUS por eixo (5x5) */
  MAP_RADIUS: 2,
  OBJECTS_PER_CHUNK_MIN: 3,
  OBJECTS_PER_CHUNK_MAX: 6,
  /** raio ao redor do centro sem árvores/rochas (área do hub e do spawn) */
  HUB_CLEAR_RADIUS: 6,
} as const;

export type WorldObjectKind = 'stick' | 'stone' | 'tree' | 'rock';

export interface WorldObjectDef {
  name: string;
  /** null = pegar direto com E; senão exige ferramenta equipada e vários hits */
  requiredTool: ItemId | null;
  hitsRequired: number;
  drops: ItemStack[];
  verb: string;
  /** gerúndio usado enquanto o canal de hits automáticos está ativo (só nós usam) */
  verbing?: string;
  /** raio sólido para colisão (0 = anda por cima) */
  solidRadius: number;
  /** raio extra de interação para objetos grandes */
  radius: number;
}

export const WORLD_OBJECTS: Record<WorldObjectKind, WorldObjectDef> = {
  stick: { name: 'Graveto', requiredTool: null, hitsRequired: 1, drops: [{ itemId: 'stick', count: 1 }], verb: 'Pegar', solidRadius: 0, radius: 0 },
  stone: { name: 'Pedra', requiredTool: null, hitsRequired: 1, drops: [{ itemId: 'stone', count: 1 }], verb: 'Pegar', solidRadius: 0, radius: 0 },
  tree: {
    name: 'Árvore',
    requiredTool: 'axe',
    hitsRequired: 3,
    drops: [{ itemId: 'wood', count: 3 }],
    verb: 'Cortar',
    verbing: 'Cortando',
    solidRadius: 0.4,
    radius: 1.2,
  },
  rock: {
    name: 'Rocha',
    requiredTool: 'pickaxe',
    hitsRequired: 4,
    drops: [{ itemId: 'bigstone', count: 3 }],
    verb: 'Minerar',
    verbing: 'Minerando',
    solidRadius: 0.9,
    radius: 1.2,
  },
};

export interface WorldObjectSpec {
  id: number;
  kind: WorldObjectKind;
  x: number;
  z: number;
  rotY: number;
  cx: number;
  cz: number;
}

/** RNG determinístico (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashChunk(seed: number, cx: number, cz: number): number {
  let h = seed ^ 0x9e3779b9;
  h = Math.imul(h ^ (cx * 0x85ebca6b), 0xc2b2ae35);
  h = Math.imul(h ^ (cz * 0x27d4eb2f), 0x165667b1);
  return h >>> 0;
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export function toChunkCoord(v: number): number {
  return Math.floor(v / WORLD.CHUNK_SIZE);
}

export function isChunkInBounds(cx: number, cz: number): boolean {
  const r = WORLD.MAP_RADIUS;
  return cx >= -r && cx <= r && cz >= -r && cz <= r;
}

/** Limites em unidades de mundo dentro dos quais personagens podem andar (com margem). */
export function mapBounds() {
  const size = WORLD.CHUNK_SIZE;
  const r = WORLD.MAP_RADIUS;
  const margin = 0.5;
  return { minX: -r * size + margin, maxX: (r + 1) * size - margin, minZ: -r * size + margin, maxZ: (r + 1) * size - margin };
}

/** Objetos de um chunk. Determinístico: mesma seed/cx/cz -> mesma lista, sempre. */
export function generateChunk(seed: number, cx: number, cz: number): WorldObjectSpec[] {
  const size = WORLD.CHUNK_SIZE;
  const originX = cx * size;
  const originZ = cz * size;
  const rand = mulberry32(hashChunk(seed, cx, cz));
  const count = WORLD.OBJECTS_PER_CHUNK_MIN + Math.floor(rand() * (WORLD.OBJECTS_PER_CHUNK_MAX - WORLD.OBJECTS_PER_CHUNK_MIN + 1));
  const out: WorldObjectSpec[] = [];

  const spawn = (i: number, kind: WorldObjectKind) => {
    const id = hashChunk(seed, cx * 1000 + i, cz * 1000 + i);
    const x = originX + 1.5 + rand() * (size - 3);
    const z = originZ + 1.5 + rand() * (size - 3);
    const rotY = rand() * 360;
    // centro do mapa: hub + spawn livres de nós grandes
    if (kind !== 'stick' && kind !== 'stone' && Math.hypot(x, z) < WORLD.HUB_CLEAR_RADIUS) return;
    // coletáveis pequenos também não nascem em cima das estruturas do hub
    if (Math.hypot(x, z) < 2) return;
    out.push({ id, kind, x, z, rotY, cx, cz });
  };

  let i = 0;
  for (; i < count; i++) spawn(i, rand() < 0.55 ? 'stick' : 'stone');
  const trees = 1 + Math.floor(rand() * 2); // 1–2
  for (let t = 0; t < trees; t++) spawn(i++, 'tree');
  if (rand() < 0.6) spawn(i++, 'rock'); // 0–1
  return out;
}

/** Mundo inteiro (todos os chunks do mapa fixo), indexado por id. */
export function generateWorld(seed: number): Map<number, WorldObjectSpec> {
  const all = new Map<number, WorldObjectSpec>();
  const r = WORLD.MAP_RADIUS;
  for (let cx = -r; cx <= r; cx++) {
    for (let cz = -r; cz <= r; cz++) {
      for (const o of generateChunk(seed, cx, cz)) all.set(o.id, o);
    }
  }
  return all;
}

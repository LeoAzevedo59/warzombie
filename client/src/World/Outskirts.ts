import * as pc from 'playcanvas';
import { groundMaterial } from '@/Assets/GroundTextures';
import { instantiateModel, type ModelKey } from '@/Assets/ModelAssets';
import { markStatic } from './Batching';
import { mulberry32, WORLD } from '@shared/worldgen';

/**
 * Arredores do mapa (só cenário, sem colisão — os limites de movimento continuam em mapBounds):
 * um rio de margens irregulares contorna o mapa jogável e, do outro lado, começam outros biomas
 * (deserto seco a leste/sul, floresta escura a norte/oeste), dando a sensação de que o mundo
 * continua e de que aqueles lados podem abrir mais tarde.
 *
 * Tudo é construído como anéis "radiais": para cada ângulo em volta do centro, a borda do mapa
 * é deslocada por ruído periódico e as faixas (margem, barranco, água, margem externa, bioma)
 * viram malhas triangulares entre curvas vizinhas — sem buracos e sem retas.
 */
const SAMPLES = 320;
const WATER_Y = -0.16;
const BANK_Y = 0.02;
/** até onde o chão dos biomas vai além da margem externa (a névoa esconde o fim) */
const BIOME_DEPTH = 46;

interface Ring {
  /** ponto da borda do mapa nesse ângulo e direção radial unitária */
  x: number;
  z: number;
  dx: number;
  dz: number;
  angle: number;
}

/** Ruído periódico suave em [0,1] (fecha o anel: só frequências inteiras). */
function noiseFn(rand: () => number, freqs: number[]): (a: number) => number {
  const phases = freqs.map(() => rand() * Math.PI * 2);
  const amps = freqs.map((_, i) => 1 / (i + 1));
  const total = amps.reduce((s, v) => s + v, 0);
  return (a) => 0.5 + (0.5 * freqs.reduce((s, f, i) => s + amps[i] * Math.sin(f * a + phases[i]), 0)) / total;
}

/** Interseção do raio (do centro, no ângulo a) com o retângulo do mapa. */
function rayToRect(a: number, minX: number, maxX: number, minZ: number, maxZ: number, cx: number, cz: number): Ring {
  const dx = Math.cos(a);
  const dz = Math.sin(a);
  let t = Infinity;
  if (dx > 1e-6) t = Math.min(t, (maxX - cx) / dx);
  if (dx < -1e-6) t = Math.min(t, (minX - cx) / dx);
  if (dz > 1e-6) t = Math.min(t, (maxZ - cz) / dz);
  if (dz < -1e-6) t = Math.min(t, (minZ - cz) / dz);
  return { x: cx + dx * t, z: cz + dz * t, dx, dz, angle: a };
}

function meshEntity(app: pc.Application, name: string, material: pc.Material, positions: number[], indices: number[], uvs: number[]): pc.Entity {
  const normals = new Array((positions.length / 3) * 3).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0));
  const mesh = pc.createMesh(app.graphicsDevice, positions, { normals, uvs, indices });
  const e = new pc.Entity(name);
  e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, material)], castShadows: false });
  return e;
}

/** Faixa fechada entre duas curvas (arrays de [x,y,z] com o mesmo tamanho), com UV em coordenadas de mundo. */
function strip(app: pc.Application, name: string, material: pc.Material, a: number[][], b: number[][], uvScale = 0.25, range?: [number, number]): pc.Entity {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const n = a.length;
  const from = range ? range[0] : 0;
  const to = range ? range[1] : n; // exclusivo; sem range fecha o anel
  for (let i = from; i <= to; i++) {
    const k = i % n;
    for (const p of [a[k], b[k]]) {
      positions.push(p[0], p[1], p[2]);
      uvs.push(p[0] * uvScale, p[2] * uvScale);
    }
  }
  const quads = to - from;
  for (let q = 0; q < quads; q++) {
    const i0 = q * 2;
    indices.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3);
  }
  return meshEntity(app, name, material, positions, indices, uvs);
}

function flat(hex: string, gloss = 0.2, emissive = 0): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  const c = new pc.Color().fromString(hex);
  m.diffuse = c;
  if (emissive > 0) m.emissive = new pc.Color(c.r * emissive, c.g * emissive, c.b * emissive);
  m.useMetalness = false;
  m.gloss = gloss;
  m.update();
  return m;
}

/** Bioma por lado: leste/sul viram deserto, norte/oeste floresta escura (troca nas diagonais). */
function biomeAt(angle: number): 'sand' | 'darkgrass' {
  const a = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return a < Math.PI * 0.75 || a >= Math.PI * 1.75 ? 'sand' : 'darkgrass';
}

const SAND_DECOR: Array<{ key: ModelKey; weight: number; scale: number }> = [
  { key: 'tree_thin', weight: 3, scale: 0.85 },
  { key: 'stone_a', weight: 3, scale: 1 },
  { key: 'stone_c', weight: 3, scale: 1 },
  { key: 'stone_tall_b', weight: 2, scale: 1 },
  { key: 'rock_small', weight: 6, scale: 1.1 },
  { key: 'rock_small_flat', weight: 5, scale: 1.2 },
  { key: 'stump', weight: 2, scale: 1 },
  { key: 'log', weight: 2, scale: 1 },
  { key: 'grass_leafs', weight: 3, scale: 1 },
];
const FOREST_DECOR: Array<{ key: ModelKey; weight: number; scale: number }> = [
  { key: 'tree_pine', weight: 10, scale: 1.15 },
  { key: 'tree_pine_round', weight: 8, scale: 1.1 },
  { key: 'tree_detailed', weight: 3, scale: 1 },
  { key: 'stone_tall_g', weight: 2, scale: 1 },
  { key: 'stone_e', weight: 2, scale: 1 },
  { key: 'mushroom_red', weight: 2, scale: 1.2 },
  { key: 'mushroom_tan', weight: 2, scale: 1.2 },
  { key: 'bush', weight: 4, scale: 1.1 },
  { key: 'grass_large', weight: 3, scale: 1 },
];

function pick<T extends { weight: number }>(rand: () => number, pool: T[]): T {
  let r = rand() * pool.reduce((s, d) => s + d.weight, 0);
  for (const d of pool) {
    r -= d.weight;
    if (r <= 0) return d;
  }
  return pool[pool.length - 1];
}

export function buildOutskirts(app: pc.Application, seed: number): pc.Entity {
  const root = new pc.Entity('outskirts');
  const size = WORLD.CHUNK_SIZE;
  const r = WORLD.MAP_RADIUS;
  const minX = -r * size;
  const maxX = (r + 1) * size;
  const minZ = -r * size;
  const maxZ = (r + 1) * size;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const rand = mulberry32((seed ^ 0x0ff5e7) >>> 0);
  const nBank = noiseFn(rand, [2, 5, 9, 17]);
  const nShore = noiseFn(rand, [4, 6, 13, 23]);
  const nWidth = noiseFn(rand, [2, 5, 9]);
  const nFar = noiseFn(rand, [3, 8, 17]);

  const ring: Ring[] = [];
  for (let i = 0; i < SAMPLES; i++) ring.push(rayToRect((i / SAMPLES) * Math.PI * 2, minX, maxX, minZ, maxZ, cx, cz));

  // curvas (deslocamento radial a partir da borda do mapa)
  const at = (p: Ring, d: number, y: number): number[] => [p.x + p.dx * d, y, p.z + p.dz * d];
  const bankIn = ring.map((p) => at(p, -(0.6 + 2.6 * nBank(p.angle)), BANK_Y)); // cobre a borda reta da grama
  const shoreTop = ring.map((p) => at(p, 0.4 + 3.2 * nShore(p.angle), BANK_Y));
  const shoreBottom = ring.map((p) => at(p, 0.4 + 3.2 * nShore(p.angle), WATER_Y - 0.4));
  const farShoreBottom = ring.map((p) => at(p, 0.4 + 3.2 * nShore(p.angle) + 5 + 5 * nWidth(p.angle), WATER_Y - 0.4));
  const farShoreTop = ring.map((p) => at(p, 0.4 + 3.2 * nShore(p.angle) + 5 + 5 * nWidth(p.angle), BANK_Y));
  const farBank = ring.map((p) => at(p, 0.4 + 3.2 * nShore(p.angle) + 5 + 5 * nWidth(p.angle) + 1.5 + 2.5 * nFar(p.angle), BANK_Y - 0.01));
  const biomeEnd = ring.map((p) => at(p, BIOME_DEPTH + 40 * nFar(p.angle + 1), BANK_Y - 0.01));
  // o fundo do rio é uma faixa contínua (a água fica por cima)
  const bedIn = ring.map((p) => at(p, 0.4 + 3.2 * nShore(p.angle) - 0.2, WATER_Y - 0.4));
  const bedOut = ring.map((p) => at(p, 0.4 + 3.2 * nShore(p.angle) + 5 + 5 * nWidth(p.angle) + 0.2, WATER_Y - 0.4));
  const waterIn = ring.map((p) => at(p, 0.4 + 3.2 * nShore(p.angle) - 0.3, WATER_Y));
  const waterOut = ring.map((p) => at(p, 0.4 + 3.2 * nShore(p.angle) + 5 + 5 * nWidth(p.angle) + 0.3, WATER_Y));

  const dirt = groundMaterial(app, 'dirt', 1);
  const mud = flat('#4d3a28', 0.1);
  const bed = flat('#3a5a6a', 0.1);
  const water = flat('#2f78c4', 0.3, 0.1);
  water.opacity = 0.86;
  water.blendType = pc.BLEND_NORMAL;
  water.update();

  root.addChild(strip(app, 'bank_in', dirt, bankIn, shoreTop));
  root.addChild(strip(app, 'bank_wall', mud, shoreTop, shoreBottom));
  root.addChild(strip(app, 'river_bed', bed, bedIn, bedOut));
  root.addChild(strip(app, 'far_wall', mud, farShoreBottom, farShoreTop));
  root.addChild(strip(app, 'far_bank', dirt, farShoreTop, farBank));
  // biomas: um trecho de anel por lado (troca nas diagonais)
  const sand = groundMaterial(app, 'sand', 1);
  const dark = groundMaterial(app, 'darkgrass', 1);
  let segStart = 0;
  for (let i = 1; i <= SAMPLES; i++) {
    const cur = biomeAt(ring[i % SAMPLES].angle);
    const prev = biomeAt(ring[(i - 1) % SAMPLES].angle);
    if (cur !== prev || i === SAMPLES) {
      root.addChild(strip(app, `biome_${prev}`, prev === 'sand' ? sand : dark, farBank, biomeEnd, 0.25, [segStart, i]));
      segStart = i;
    }
  }
  const waterEnt = strip(app, 'river_water', water, waterIn, waterOut);
  root.addChild(waterEnt);

  // pedras aflorando no rio
  for (let i = 0; i < 40; i++) {
    const p = ring[Math.floor(rand() * SAMPLES)];
    const w = 5 + 5 * nWidth(p.angle);
    const d = 0.4 + 3.2 * nShore(p.angle) + 0.8 + rand() * (w - 1.6);
    const e = instantiateModel(rand() < 0.5 ? 'rock_small' : 'stone_small');
    const s = e.getLocalScale().x * (0.9 + rand() * 0.6);
    e.setLocalScale(s, s, s);
    e.setLocalPosition(p.x + p.dx * d, WATER_Y - 0.12, p.z + p.dz * d);
    e.setLocalEulerAngles(0, rand() * 360, 0);
    root.addChild(e);
    markStatic(app, e, false);
  }
  // vegetação/pedras do bioma do outro lado (mais densa perto da margem, some na névoa)
  for (let i = 0; i < 260; i++) {
    const p = ring[Math.floor(rand() * SAMPLES)];
    const start = 0.4 + 3.2 * nShore(p.angle) + 5 + 5 * nWidth(p.angle) + 1.5 + 2.5 * nFar(p.angle) + 0.8;
    const d = start + Math.pow(rand(), 1.4) * 34;
    const biome = biomeAt(p.angle);
    const def = pick(rand, biome === 'sand' ? SAND_DECOR : FOREST_DECOR);
    const e = instantiateModel(def.key);
    const s = e.getLocalScale().x * def.scale * (0.85 + rand() * 0.4);
    e.setLocalScale(s, s, s);
    e.setLocalPosition(p.x + p.dx * d, 0, p.z + p.dz * d);
    e.setLocalEulerAngles(0, rand() * 360, 0);
    root.addChild(e);
    markStatic(app, e, false); // cenário além do rio: só visual, sem sombra
  }
  return root;
}

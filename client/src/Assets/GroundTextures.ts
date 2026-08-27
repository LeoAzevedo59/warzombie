import * as pc from 'playcanvas';
import type { TileType } from '@/World/Tile';

/**
 * Texturas de chão geradas em canvas (estilo flat/low-poly, sem download): manchas suaves de
 * 3-4 tons + pontilhado fino. Uma textura por tipo de tile, repetida a cada ~4 m.
 */
const SIZE = 256;

const PALETTES: Record<TileType, { base: string; blobs: string[]; specks: string[] }> = {
  grass: { base: '#5c9a45', blobs: ['#66a64c', '#548e3f', '#71b055', '#4f8a3c'], specks: ['#83c264', '#3f7532', '#a9d27a'] },
  dirt: { base: '#8a6a45', blobs: ['#93724b', '#7d5f3d', '#9c7a52', '#75593a'], specks: ['#b08f65', '#5f4730', '#6f8a3e'] },
};

const cache = new Map<TileType, pc.StandardMaterial>();

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawTile(type: TileType): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d')!;
  const p = PALETTES[type];
  const rand = rng(type === 'grass' ? 91 : 173);
  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // manchas grandes (desenhadas com wrap para a textura repetir sem emenda)
  for (let i = 0; i < 70; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const r = 14 + rand() * 34;
    ctx.fillStyle = p.blobs[Math.floor(rand() * p.blobs.length)];
    ctx.globalAlpha = 0.55;
    for (const dx of [-SIZE, 0, SIZE]) for (const dy of [-SIZE, 0, SIZE]) {
      ctx.beginPath();
      ctx.ellipse(x + dx, y + dy, r, r * (0.6 + rand() * 0.6), rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // pontilhado fino (folhinhas / pedrinhas)
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 900; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    ctx.fillStyle = p.specks[Math.floor(rand() * p.specks.length)];
    const w = 1 + rand() * 2.5;
    ctx.fillRect(x, y, w, type === 'grass' ? w * 2 : w);
  }
  ctx.globalAlpha = 1;
  return c;
}

/** Material com a textura de chão do tile (cacheado). */
export function groundMaterial(app: pc.Application, type: TileType, tilesAcross: number): pc.StandardMaterial {
  const cached = cache.get(type);
  if (cached) return cached;
  const tex = new pc.Texture(app.graphicsDevice, {
    width: SIZE,
    height: SIZE,
    format: pc.PIXELFORMAT_RGBA8,
    mipmaps: true,
    addressU: pc.ADDRESS_REPEAT,
    addressV: pc.ADDRESS_REPEAT,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    anisotropy: 4,
  });
  tex.setSource(drawTile(type));
  const mat = new pc.StandardMaterial();
  mat.diffuseMap = tex;
  mat.diffuseMapTiling = new pc.Vec2(tilesAcross, tilesAcross);
  mat.useMetalness = false;
  mat.gloss = 0.1;
  mat.update();
  cache.set(type, mat);
  return mat;
}

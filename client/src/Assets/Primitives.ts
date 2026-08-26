import * as pc from 'playcanvas';

/** Helpers para gerar geometria primitiva colorida — substitui modelos até termos assets reais. */

const materialCache = new Map<string, pc.StandardMaterial>();

export function colorMaterial(hex: string, emissive = 0): pc.StandardMaterial {
  const key = `${hex}:${emissive}`;
  const cached = materialCache.get(key);
  if (cached) return cached;

  const mat = new pc.StandardMaterial();
  const c = hexToColor(hex);
  mat.diffuse = c;
  mat.emissive = new pc.Color(c.r * emissive, c.g * emissive, c.b * emissive);
  mat.useMetalness = false;
  mat.gloss = 0.2;
  mat.update();
  materialCache.set(key, mat);
  return mat;
}

export function hexToColor(hex: string): pc.Color {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; // '#111' -> '#111111'
  const n = parseInt(h, 16);
  return new pc.Color(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

type PrimitiveType = 'box' | 'capsule' | 'cylinder' | 'sphere' | 'cone';

interface PrimitiveOpts {
  name?: string;
  color: string;
  scale?: [number, number, number];
  position?: [number, number, number];
  emissive?: number;
}

export function makePrimitive(type: PrimitiveType, opts: PrimitiveOpts): pc.Entity {
  const e = new pc.Entity(opts.name ?? type);
  e.addComponent('render', { type, material: colorMaterial(opts.color, opts.emissive) });
  if (opts.scale) e.setLocalScale(...opts.scale);
  if (opts.position) e.setLocalPosition(...opts.position);
  return e;
}

export const makeBox = (o: PrimitiveOpts) => makePrimitive('box', o);
export const makeCapsule = (o: PrimitiveOpts) => makePrimitive('capsule', o);
export const makeCylinder = (o: PrimitiveOpts) => makePrimitive('cylinder', o);
export const makeSphere = (o: PrimitiveOpts) => makePrimitive('sphere', o);

/** X plano e emissivo no chão (indicador de "alvo selecionado" mais discreto que um disco). */
export function makeGroundX(color: string, size = 0.6): pc.Entity {
  const group = new pc.Entity('ground-x');
  const barScale: [number, number, number] = [size, 0.03, size * 0.1];
  const bar1 = makeBox({ color, scale: barScale, position: [0, 0.02, 0], emissive: 1 });
  bar1.setLocalEulerAngles(0, 45, 0);
  const bar2 = makeBox({ color, scale: barScale, position: [0, 0.02, 0], emissive: 1 });
  bar2.setLocalEulerAngles(0, -45, 0);
  group.addChild(bar1);
  group.addChild(bar2);
  return group;
}

/** Troca o material de um render component (usado para highlight). */
export function setEntityColor(e: pc.Entity, hex: string, emissive = 0): void {
  const render = e.render;
  if (!render) return;
  render.material = colorMaterial(hex, emissive);
}

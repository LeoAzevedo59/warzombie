/** Matemática 2D no plano do chão (x,z), sem dependência de engine — usada no client e no server. */

export interface XZ {
  x: number;
  z: number;
}

export function dist(a: XZ, b: XZ): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Colisão círculo-círculo no plano: empurra (x,z) para fora do círculo (cx,cz,minDist).
 * Retorna null se não havia sobreposição.
 */
export function pushOutCircle(x: number, z: number, cx: number, cz: number, minDist: number): XZ | null {
  const dx = x - cx;
  const dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= minDist * minDist || d2 < 1e-8) return null;
  const d = Math.sqrt(d2);
  const push = minDist - d;
  return { x: x + (dx / d) * push, z: z + (dz / d) * push };
}

/** (x,z) está livre de todos os obstáculos circulares dados? */
export function isClearOfCircles(
  x: number,
  z: number,
  obstacles: Iterable<{ position: XZ; solidRadius: number }>,
  radius: number,
): boolean {
  for (const o of obstacles) {
    if (!o.solidRadius) continue;
    const r = o.solidRadius + radius;
    const dx = x - o.position.x;
    const dz = z - o.position.z;
    if (dx * dx + dz * dz < r * r) return false;
  }
  return true;
}

/**
 * Raio no plano a partir de `from` na direção unitária (dx,dz): devolve o alvo mais próximo cujo
 * centro passe a menos de `hitRadius` do raio, dentro de `range`, e a distância até ele.
 */
export function rayHitNearest<T extends { position: XZ }>(
  from: XZ,
  dx: number,
  dz: number,
  targets: Iterable<T>,
  range: number,
  hitRadius: number,
): { target: T | null; t: number } {
  let best: T | null = null;
  let bestT = range;
  for (const tg of targets) {
    const ox = tg.position.x - from.x;
    const oz = tg.position.z - from.z;
    const t = ox * dx + oz * dz;
    if (t < 0 || t > bestT) continue;
    const perp2 = ox * ox + oz * oz - t * t;
    if (perp2 > hitRadius * hitRadius) continue;
    best = tg;
    bestT = t;
  }
  return { target: best, t: bestT };
}

/** Normaliza (dx,dz); vetor nulo vira (0,1). */
export function normalize2(dx: number, dz: number): { dx: number; dz: number } {
  const l = Math.hypot(dx, dz);
  return l < 1e-6 ? { dx: 0, dz: 1 } : { dx: dx / l, dz: dz / l };
}

import * as pc from 'playcanvas';

/**
 * Convenção de facing do jogo: personagens "olham" pelo eixo +Z local (modelos do worker.glb
 * têm a frente em +Z). ATENÇÃO: `entity.forward` do PlayCanvas é o eixo -Z — usar ele direto
 * inverte a direção (já causou mesa colocada atrás do player e tiro saindo pelas costas).
 * Todo código de "para onde olha / o que está à frente" deve passar por estes helpers.
 */

/** Gira `entity` (só yaw) para a frente (+Z) apontar para `point` no plano do chão. */
export function yawToward(entity: pc.Entity, point: pc.Vec3): void {
  const pos = entity.getPosition();
  const dx = point.x - pos.x;
  const dz = point.z - pos.z;
  if (dx * dx + dz * dz < 0.0004) return;
  entity.setEulerAngles(0, Math.atan2(dx, dz) * pc.math.RAD_TO_DEG, 0);
}

/** Direção unitária para onde `entity` olha (plano do chão). É -entity.forward (ver nota acima). */
export function facingDir(entity: pc.Entity, out = new pc.Vec3()): pc.Vec3 {
  out.set(-entity.forward.x, 0, -entity.forward.z);
  return out.lengthSq() > 1e-8 ? out.normalize() : out.set(0, 0, 1);
}

/**
 * Colisão círculo-círculo no plano: empurra (x,z) para fora do círculo (cx,cz,minDist).
 * Retorna null se não havia sobreposição.
 */
export function pushOutCircle(
  x: number,
  z: number,
  cx: number,
  cz: number,
  minDist: number,
): { x: number; z: number } | null {
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
  obstacles: Iterable<{ position: { x: number; z: number }; solidRadius: number }>,
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

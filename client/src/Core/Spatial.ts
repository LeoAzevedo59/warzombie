import * as pc from 'playcanvas';

export { pushOutCircle, isClearOfCircles } from '@shared/math';

/**
 * Convenção de facing do jogo: personagens "olham" pelo eixo +Z local (modelos do worker.glb
 * têm a frente em +Z). ATENÇÃO: `entity.forward` do PlayCanvas é o eixo -Z — usar ele direto
 * inverte a direção (já causou tiro saindo pelas costas).
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

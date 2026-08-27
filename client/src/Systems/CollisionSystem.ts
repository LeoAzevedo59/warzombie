import { CONFIG } from '@/config';
import type { System } from '@/Core/GameLoop';
import type { Player } from '@/Entities/Player/Player';
import type { World } from '@/World/World';
import { pushOutCapsule, pushOutCircle } from '@/Core/Spatial';

/**
 * Impede o player de atravessar árvores, rochas, estruturas do hub (círculos) e paredes (cápsula orientada)
 * (raio do player vs. raio sólido do obstáculo), empurrando o player pra fora da sobreposição.
 * Roda depois do MovementSystem, sobre a posição já integrada.
 */
export class CollisionSystem implements System {
  readonly name = 'Collision';

  constructor(
    private player: Player,
    private world: World,
  ) {}

  update(): void {
    let x = this.player.position.x;
    let z = this.player.position.z;
    const playerR = CONFIG.player.RADIUS;
    let moved = false;

    for (const obj of this.world.obstacles()) {
      if (!obj.solidRadius) continue;
      const seg = obj.segment;
      const pushed = seg
        ? pushOutCapsule(x, z, obj.position.x, obj.position.z, seg.yaw, seg.halfLen, playerR + seg.radius)
        : pushOutCircle(x, z, obj.position.x, obj.position.z, playerR + obj.solidRadius);
      if (pushed) {
        x = pushed.x;
        z = pushed.z;
        moved = true;
      }
    }

    if (moved) this.player.setPosition(x, 0, z);
  }
}

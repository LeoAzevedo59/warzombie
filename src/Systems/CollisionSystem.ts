import { CONFIG } from '@/config';
import type { System } from '@/Core/GameLoop';
import type { Player } from '@/Entities/Player/Player';
import type { World } from '@/World/World';
import { pushOutCircle } from '@/Core/Spatial';

/**
 * Impede o player de atravessar árvores, rochas e mesas de marceneiro: colisão circular simples
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

    const obstacles: Iterable<{ position: { x: number; z: number }; solidRadius: number }> = [
      ...this.world.objects(),
      ...this.world.benches(),
    ];

    for (const obj of obstacles) {
      if (!obj.solidRadius) continue;
      const pushed = pushOutCircle(x, z, obj.position.x, obj.position.z, playerR + obj.solidRadius);
      if (pushed) {
        x = pushed.x;
        z = pushed.z;
        moved = true;
      }
    }

    if (moved) this.player.setPosition(x, 0, z);
  }
}

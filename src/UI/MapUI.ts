import { CONFIG } from '@/config';
import type { World } from '@/World/World';
import type { Player } from '@/Entities/Player/Player';
import type { ZombieSystem } from '@/Systems/ZombieSystem';

/** Minimapa 2D: chunks ativos, objetos, zumbis vivos e posição do player. */
export class MapUI {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(
    parent: HTMLElement,
    private world: World,
    private player: Player,
    private zombies: ZombieSystem,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'minimap';
    this.canvas.width = 160;
    this.canvas.height = 160;
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  update(): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const size = CONFIG.world.CHUNK_SIZE;
    const range = CONFIG.world.ACTIVE_RADIUS * 2 + 1; // chunks visíveis por lado
    const px = W / (range * size); // pixels por unidade de mundo
    const p = this.player.position;

    ctx.clearRect(0, 0, W, W);
    for (const { cx, cz } of this.world.activeChunkCoords()) {
      const x = (cx * size - p.x) * px + W / 2;
      const y = (cz * size - p.z) * px + W / 2;
      ctx.fillStyle = (cx + cz) % 2 === 0 ? '#2b4d2a' : '#26432a';
      ctx.fillRect(x, y, size * px - 1, size * px - 1);
    }
    for (const obj of this.world.objects()) {
      const o = obj.position;
      const big = obj.isNode;
      ctx.fillStyle = { stick: '#b07a3c', stone: '#c2c7cc', tree: '#5fd15a', rock: '#9aa3ad', pistol: '#ffd34d' }[obj.kind];
      const s = big || obj.kind === 'pistol' ? 4 : 2;
      ctx.fillRect((o.x - p.x) * px + W / 2 - s / 2, (o.z - p.z) * px + W / 2 - s / 2, s, s);
    }
    for (const wb of this.world.benches()) {
      const o = wb.position;
      ctx.fillStyle = '#8a5a2b';
      ctx.fillRect((o.x - p.x) * px + W / 2 - 3, (o.z - p.z) * px + W / 2 - 3, 6, 6);
    }

    ctx.fillStyle = '#e23c3c';
    for (const z of this.zombies.alive()) {
      const o = z.position;
      ctx.beginPath();
      ctx.arc((o.x - p.x) * px + W / 2, (o.z - p.z) * px + W / 2, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#ffd34d';
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  dispose(): void {
    this.canvas.remove();
  }
}

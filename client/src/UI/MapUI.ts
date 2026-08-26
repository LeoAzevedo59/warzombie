import { CONFIG } from '@/config';
import type { World } from '@/World/World';
import type { Player } from '@/Entities/Player/Player';

interface Marker {
  position: { x: number; z: number };
}

/** Minimapa 2D: chunks ativos, objetos, hub, outros jogadores, zumbis e posição do player. */
export class MapUI {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(
    parent: HTMLElement,
    private world: World,
    private player: Player,
    private others: () => Iterable<Marker>,
    private zombies: () => Iterable<Marker> = () => [],
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
    const sx = (x: number) => (x - p.x) * px + W / 2;
    const sz = (z: number) => (z - p.z) * px + W / 2;

    ctx.clearRect(0, 0, W, W);
    for (const { cx, cz } of this.world.activeChunkCoords()) {
      ctx.fillStyle = (cx + cz) % 2 === 0 ? '#2b4d2a' : '#26432a';
      ctx.fillRect(sx(cx * size), sz(cz * size), size * px - 1, size * px - 1);
    }
    for (const obj of this.world.objects()) {
      const o = obj.position;
      ctx.fillStyle = { stick: '#b07a3c', stone: '#c2c7cc', tree: '#5fd15a', rock: '#9aa3ad' }[obj.kind];
      const s = obj.isNode ? 4 : 2;
      ctx.fillRect(sx(o.x) - s / 2, sz(o.z) - s / 2, s, s);
    }
    for (const st of this.world.structures()) {
      ctx.fillStyle = st.kind === 'vendor' ? '#ffd34d' : '#4db8ff';
      const s = st.kind === 'tower' ? 8 : 6;
      ctx.fillRect(sx(st.position.x) - s / 2, sz(st.position.z) - s / 2, s, s);
    }

    ctx.fillStyle = '#e23c3c';
    for (const z of this.zombies()) {
      ctx.beginPath();
      ctx.arc(sx(z.position.x), sz(z.position.z), 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#9fc2ff';
    for (const o of this.others()) {
      ctx.beginPath();
      ctx.arc(sx(o.position.x), sz(o.position.z), 3, 0, Math.PI * 2);
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

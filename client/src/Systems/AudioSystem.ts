import type * as pc from 'playcanvas';
import type { System } from '@/Core/GameLoop';
import type { EventBus } from '@/Core/EventBus';
import type { Player } from '@/Entities/Player/Player';
import type { World } from '@/World/World';
import type { Zombie } from '@/Entities/Enemies/Zombie';
import { audio } from '@/Assets/SoundAssets';
import type { WavePhase } from '@shared/protocol';

/** Distância (m) percorrida entre passos andando; correndo é menor. */
const STEP_DIST_WALK = 1.15;
const STEP_DIST_RUN = 1.6;

/**
 * Traduz eventos do jogo em sons (posicionais quando fazem sentido) e escolhe a música pela fase
 * das waves: calma explorando/entre waves, tensão durante wave/chefão.
 */
export class AudioSystem implements System {
  readonly name = 'Audio';
  private unsubs: Array<() => void> = [];
  private stepAcc = 0;
  private growlTimer = 2;
  private phase: WavePhase = 'idle';
  private right = { x: 1, z: 0 };

  constructor(
    bus: EventBus,
    private player: Player,
    private world: World,
    private camera: pc.Entity,
    private zombies: () => Iterable<Zombie>,
    private zombieById: (id: number) => Zombie | undefined,
    private remotePosition: (id: string) => pc.Vec3 | null,
    private localPlayerId: string,
  ) {
    const at = (p: { x: number; z: number } | null | undefined) => (p ? { x: p.x, z: p.z } : {});
    const objAt = (id: number) => at(this.world.findObject(id)?.position);
    this.unsubs.push(
      bus.on('audio:sfx', ({ name, x, z, volume }) => audio.play(name, { x, z, volume })),
      bus.on('net:shot', ({ playerId }) => {
        const p = playerId === this.localPlayerId ? this.player.position : this.remotePosition(playerId);
        audio.play('gun_shot', { ...at(p), pitchVar: 0.08 });
      }),
      bus.on('net:melee', ({ playerId, hitZombieId, hitPlayerId }) => {
        const p = playerId === this.localPlayerId ? this.player.position : this.remotePosition(playerId);
        audio.play('knife_swing', at(p));
        if (hitZombieId !== null || hitPlayerId) audio.play('hit', { ...at(p), volume: 0.8 });
      }),
      bus.on('net:nodeHit', ({ objectId }) => {
        const o = this.world.findObject(objectId);
        if (!o) return;
        audio.play(o.kind === 'tree' ? 'chop' : 'mine', at(o.position));
      }),
      bus.on('net:objectRemoved', ({ objectId }) => {
        const o = this.world.findObject(objectId);
        if (!o) return;
        if (o.kind === 'tree') audio.play('tree_break', at(o.position));
        else if (o.kind === 'rock') audio.play('rock_break', at(o.position));
        else audio.play('pickup', objAt(objectId));
      }),
      bus.on('item:collected', ({ itemId }) => {
        if (itemId === 'wood' || itemId === 'bigstone') return; // já tocou o som de quebra
        audio.play('pickup');
      }),
      bus.on('zombie:damaged', ({ id }) => audio.play('zombie_hurt', at(this.zombieById(id)?.position))),
      bus.on('zombie:died', ({ id, kind }) => {
        const z = this.zombieById(id);
        audio.play('zombie_death', { ...at(z?.position), volume: kind === 'boss' ? 1.2 : 1, pitchVar: kind === 'boss' ? 0 : 0.1 });
      }),
      bus.on('zombie:attack', ({ x, z }) => audio.play('zombie_attack', { x, z })),
      bus.on('player:damaged', ({ amount }) => {
        audio.play('hit_soft', { volume: 0.7 });
        if (amount >= 5) audio.play('player_hurt', { volume: 0.7 });
      }),
      bus.on('player:died', () => audio.play('player_death')),
      bus.on('player:respawned', () => audio.play('ui_confirm')),
      bus.on('wave:started', () => {
        audio.play('wave_bell');
        audio.play('zombie_growl', { volume: 1, variant: 1 });
      }),
      bus.on('boss:spawned', () => {
        audio.play('wave_bell', { volume: 1, pitchVar: 0 });
        audio.play('boss_roar');
      }),
      bus.on('boss:slam', ({ x, z }) => audio.play('boss_roar', { x, z, volume: 0.7 })),
      bus.on('phase:complete', () => audio.play('wave_clear')),
      bus.on('wave:failed', () => audio.play('ui_error')),
      bus.on('net:gameOver', () => audio.play('ui_error', { volume: 1 })),
      bus.on('wave:state', ({ wave }) => this.onPhase(wave.phase)),
      bus.on('net:dropAdded', ({ drop }) => audio.play('hit_soft', { x: drop.x, z: drop.z, volume: 0.6 })),
      bus.on('net:structureAdded', ({ structure }) => audio.play('wall_place', { x: structure.x, z: structure.z })),
      bus.on('net:structureRemoved', ({ id }) => audio.play('wall_break', at(this.world.walls.get(id)?.position))),
      bus.on('shop:open', () => audio.play('shop_open')),
      bus.on('input:closePanel', () => audio.play('shop_close')),
      bus.on('shop:transaction', ({ kind }) => audio.play(kind === 'buy' ? 'coins' : 'coins', { variant: kind === 'buy' ? 0 : 1 })),
      bus.on('equip:changed', ({ itemId }) => {
        if (itemId === 'knife') audio.play('knife_draw');
        else if (itemId === 'glock') audio.play('gun_reload', { volume: 0.5 });
        else audio.play('ui_click', { volume: 0.4 });
      }),
      bus.on('ui:toast', () => audio.play('ui_click', { volume: 0.3 })),
    );
    audio.setMusic('calm');
  }

  private onPhase(phase: WavePhase): void {
    if (phase === this.phase) return;
    const prev = this.phase;
    this.phase = phase;
    if (prev === 'idle' && phase === 'countdown') audio.play('battery_on');
    audio.setMusic(phase === 'wave' || phase === 'boss' ? 'tension' : 'calm');
  }

  update(dt: number): void {
    // ouvinte = player; eixo direita = da câmera projetado no chão
    const p = this.player.position;
    const r = this.camera.right;
    const len = Math.hypot(r.x, r.z) || 1;
    this.right.x = r.x / len;
    this.right.z = r.z / len;
    audio.listener = { x: p.x, z: p.z, rightX: this.right.x, rightZ: this.right.z };

    // passos
    const v = this.player.velocity;
    const speed = Math.hypot(v.x, v.z);
    if (speed > 0.3 && !this.player.stats.dead) {
      this.stepAcc += speed * dt;
      const need = this.player.running ? STEP_DIST_RUN : STEP_DIST_WALK;
      if (this.stepAcc >= need) {
        this.stepAcc = 0;
        audio.play('step', { volume: this.player.crouching ? 0.5 : this.player.running ? 1 : 0.8, pitchVar: 0.04 });
      }
    } else this.stepAcc = 0;

    // rosnados ambientes de zumbis próximos
    this.growlTimer -= dt;
    if (this.growlTimer <= 0) {
      this.growlTimer = 1.5 + Math.random() * 2.5;
      let best: Zombie | null = null;
      let bestD = 22 ** 2;
      let count = 0;
      for (const z of this.zombies()) {
        const d = (z.position.x - p.x) ** 2 + (z.position.z - p.z) ** 2;
        count++;
        if (d < bestD && Math.random() < 0.6) {
          bestD = d;
          best = z;
        }
      }
      if (best) audio.play('zombie_growl', { x: best.position.x, z: best.position.z, volume: best.kind === 'boss' ? 1.1 : 0.9, pitchVar: 0.15 });
      if (count > 6) this.growlTimer *= 0.6;
    }
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    audio.setMusic(null);
  }
}

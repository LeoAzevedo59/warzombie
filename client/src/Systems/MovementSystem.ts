import type { System } from '@/Core/GameLoop';
import type { EventBus } from '@/Core/EventBus';
import type { GameState } from '@/Core/GameState';
import type { Player } from '@/Entities/Player/Player';
import type { PlayerController } from '@/Entities/Player/PlayerController';
import { World } from '@/World/World';
import type { InputSystem } from './InputSystem';

/** Integra a velocidade do player (dentro dos limites do mapa) e atualiza stamina + GameState. */
export class MovementSystem implements System {
  readonly name = 'Movement';
  private bounds = World.mapBounds();
  private lastStance: 'idle' | 'walk' | 'run' | null = null;

  constructor(
    private input: InputSystem,
    private controller: PlayerController,
    private player: Player,
    private state: GameState,
    private bus: EventBus,
  ) {}

  /** Postura atual (mesma classificação que o servidor faz pela velocidade). */
  get stance(): 'idle' | 'walk' | 'run' {
    const v = this.player.velocity.length();
    return v < 0.05 ? 'idle' : this.player.running ? 'run' : 'walk';
  }

  update(dt: number): void {
    this.controller.apply(this.input.state);

    const p = this.player;
    p.updateAnimation(dt);
    // p.position é uma referência viva ao Vec3 interno do entity (não uma cópia) — nunca
    // mutar seus campos direto, isso pula as dirty flags de transform do PlayCanvas e
    // desalinha as matrizes de skinning do modelo animado. Ler como números simples.
    const b = this.bounds;
    const x = Math.min(b.maxX, Math.max(b.minX, p.position.x + p.velocity.x * dt));
    const z = Math.min(b.maxZ, Math.max(b.minZ, p.position.z + p.velocity.z * dt));
    p.setPosition(x, 0, z);

    p.stats.tickStamina(dt, p.running, this.input.state.run);

    this.state.playerPosition.x = x;
    this.state.playerPosition.z = z;

    const stance = this.stance;
    if (stance !== this.lastStance) {
      this.lastStance = stance;
      this.bus.emit('player:stance', { stance });
    }
  }
}

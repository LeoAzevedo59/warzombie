import { CONFIG } from '@/config';
import type { GameState } from '@/Core/GameState';
import type { EventBus } from '@/Core/EventBus';

/** Lê/escreve HP e stamina no GameState e notifica a UI. */
export class PlayerStats {
  constructor(
    private state: GameState,
    private bus: EventBus,
  ) {}

  get hp() {
    return this.state.hp;
  }
  get stamina() {
    return this.state.stamina;
  }

  /** Esgotou o vigor correndo e ainda não soltou Shift: força andar e trava a regeneração. */
  private exhausted = false;

  get canRun(): boolean {
    return this.state.stamina > 0;
  }

  /**
   * Chamado pelo MovementSystem. `runHeld` é o Shift bruto (não `running`, que já reflete se o
   * vigor permite correr) — precisa saber se o jogador ainda está segurando a tecla pra decidir
   * se pode regenerar.
   */
  tickStamina(dt: number, running: boolean, runHeld: boolean): void {
    const p = CONFIG.player;
    const before = this.state.stamina;

    if (running) {
      this.state.stamina = Math.max(0, before - p.STAMINA_DRAIN * dt);
      if (this.state.stamina <= 0) this.exhausted = true;
    } else if (this.exhausted && runHeld) {
      // esgotou correndo; segurando Shift ainda -> anda, sem regenerar até soltar
    } else {
      this.exhausted = false;
      this.state.stamina = Math.min(this.state.maxStamina, before + p.STAMINA_REGEN * dt);
    }

    if (Math.abs(this.state.stamina - before) > 0.01) this.notify();
  }

  get dead(): boolean {
    return this.state.hp <= 0;
  }

  /** HP vem do servidor (mensagens `hp`/`player_died`/`player_respawned`). */
  setHp(hp: number): void {
    this.state.hp = Math.max(0, Math.min(CONFIG.player.MAX_HP, hp));
    this.notify();
  }

  /** Vida e vigor cheios (respawn). */
  restore(): void {
    this.state.hp = CONFIG.player.MAX_HP;
    this.state.stamina = this.state.maxStamina;
    this.exhausted = false;
    this.notify();
  }

  notify(): void {
    this.bus.emit('player:statsChanged', {
      hp: this.state.hp,
      stamina: this.state.stamina,
      maxHp: CONFIG.player.MAX_HP,
      maxStamina: this.state.maxStamina,
    });
  }
}

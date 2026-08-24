/** Contrato de um System: lógica pura chamada a cada frame numa ordem determinística. */
export interface System {
  readonly name: string;
  update(dt: number): void;
  dispose?(): void;
}

/** Ordena e executa os systems. A ordem de registro é a ordem de execução. */
export class GameLoop {
  private systems: System[] = [];
  private running = false;

  register(system: System): this {
    this.systems.push(system);
    return this;
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  tick(dt: number): void {
    if (!this.running) return;
    // clamp evita "teleporte" ao voltar de uma aba inativa
    const step = Math.min(dt, 1 / 20);
    for (const s of this.systems) s.update(step);
  }

  dispose(): void {
    this.stop();
    for (const s of this.systems) s.dispose?.();
    this.systems = [];
  }
}

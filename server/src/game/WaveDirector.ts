import { GAME } from '../../../shared/gameconfig.js';
import type { WavePhase, WaveState } from '../../../shared/protocol.js';
import type { ZombieSim } from './ZombieSim.js';

export interface WaveIO {
  waveStarted(wave: number, count: number, players: number): void;
  bossSpawned(id: number, hp: number): void;
  phaseComplete(): void;
  /** jogadores online na sala agora (escala a dificuldade) */
  playerCount(): number;
}

/**
 * Orquestra as 5 waves da fase 1 e o boss. Tempo em segundos (relógio injetável para testes).
 * count/hp/dano escalam ×DIFFICULTY_PER_PLAYER^(n-1) com n = jogadores no início da wave.
 */
export class WaveDirector {
  phase: WavePhase = 'idle';
  wave = 0;
  private nextAt: number | null = null;
  private bossId: number | null = null;

  constructor(
    private sim: ZombieSim,
    private io: WaveIO,
    private now: () => number,
  ) {}

  get active(): boolean {
    return this.phase !== 'idle' && this.phase !== 'complete';
  }

  state(): WaveState {
    return {
      phase: this.phase,
      wave: this.wave,
      total: GAME.waves.TOTAL,
      alive: this.sim.aliveCount,
      nextIn: this.nextAt === null ? null : Math.max(0, Math.round(this.nextAt - this.now())),
    };
  }

  /** Bateria colocada: primeira wave em FIRST_DELAY s. */
  activate(): void {
    if (this.phase !== 'idle') return;
    this.phase = 'countdown';
    this.wave = 0;
    this.nextAt = this.now() + GAME.waves.FIRST_DELAY;
  }

  /** Chamado a cada tick; retorna true se o estado público mudou (para broadcast). */
  tick(): boolean {
    const now = this.now();
    switch (this.phase) {
      case 'countdown':
      case 'wave':
        if (this.nextAt !== null && now >= this.nextAt) {
          if (this.wave < GAME.waves.TOTAL) {
            this.startWave(this.wave + 1);
            return true;
          }
        }
        // última wave limpa -> boss
        if (this.phase === 'wave' && this.wave === GAME.waves.TOTAL && this.sim.aliveCount === 0) {
          this.spawnBoss();
          return true;
        }
        return false;
      case 'boss':
        if (this.bossId !== null && !this.sim.zombies.has(this.bossId)) {
          this.phase = 'complete';
          this.nextAt = null;
          this.io.phaseComplete();
          return true;
        }
        // boss removido do mapa só depois do corpo sumir; considere morto quando state === 'dead'
        if (this.bossId !== null && this.sim.zombies.get(this.bossId)?.state === 'dead') {
          this.phase = 'complete';
          this.nextAt = null;
          this.io.phaseComplete();
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  private difficulty(players: number): number {
    return Math.pow(GAME.waves.DIFFICULTY_PER_PLAYER, Math.max(0, players - 1));
  }

  private startWave(n: number): void {
    const players = Math.max(1, this.io.playerCount());
    const mult = this.difficulty(players);
    const count = Math.round(GAME.waves.BASE_COUNT[n - 1] * mult);
    for (let i = 0; i < count; i++) {
      const p = this.sim.pickSpawnPoint();
      // parte da horda cospe à distância (lentidão); o resto vai no corpo a corpo
      const kind = i % Math.round(1 / GAME.zombie.SPITTER_RATIO) === 1 ? 'spitter' : 'zombie';
      const z = this.sim.spawn(kind, p.x, p.z, mult, mult);
      // já nascem caçando (a bateria "acorda" a horda)
      z.state = 'chase';
    }
    this.wave = n;
    this.phase = 'wave';
    this.nextAt = n < GAME.waves.TOTAL ? this.now() + GAME.waves.INTERVAL : null;
    this.io.waveStarted(n, count, players);
  }

  private spawnBoss(): void {
    const players = Math.max(1, this.io.playerCount());
    const mult = this.difficulty(players);
    const p = this.sim.pickSpawnPoint();
    const boss = this.sim.spawn('boss', p.x, p.z, mult, mult);
    boss.state = 'chase';
    this.bossId = boss.id;
    this.phase = 'boss';
    this.nextAt = null;
    this.io.bossSpawned(boss.id, boss.maxHp);
  }
}

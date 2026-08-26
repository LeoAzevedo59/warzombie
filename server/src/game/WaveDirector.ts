import { GAME } from '../../../shared/gameconfig.js';
import type { WavePhase, WaveState } from '../../../shared/protocol.js';
import type { ZombieSim } from './ZombieSim.js';

export interface WaveIO {
  waveStarted(wave: number, count: number, players: number): void;
  bossSpawned(id: number, hp: number): void;
  phaseComplete(): void;
  /** tempo esgotado: horda removida, bateria perdida */
  waveFailed(wave: number, boss: boolean): void;
  /** jogadores online na sala agora (escala a dificuldade) */
  playerCount(): number;
}

/**
 * Orquestra as 5 waves da fase 1 e o chefão. Tempo em segundos (relógio injetável para testes).
 * Cada wave tem TIME_LIMIT s para ser limpa; limpou -> próxima em BREAK s; estourou -> falha
 * (zumbis somem, volta ao idle e a bateria foi perdida). Após a 5ª limpa vem o chefão (BOSS_TIME_LIMIT).
 * count/hp/dano escalam ×DIFFICULTY_PER_PLAYER^(n-1) com n = jogadores no início da wave.
 */
export class WaveDirector {
  phase: WavePhase = 'idle';
  wave = 0;
  /** instante da próxima wave (countdown) */
  private nextAt: number | null = null;
  /** prazo para limpar a wave/chefão atual */
  private deadline: number | null = null;
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
    const now = this.now();
    return {
      phase: this.phase,
      wave: this.wave,
      total: GAME.waves.TOTAL,
      alive: this.sim.aliveCount,
      nextIn: this.nextAt === null ? null : Math.max(0, Math.round(this.nextAt - now)),
      timeLeft: this.deadline === null ? null : Math.max(0, Math.round(this.deadline - now)),
    };
  }

  /** Bateria colocada: primeira wave em FIRST_DELAY s. */
  activate(): void {
    if (this.phase !== 'idle') return;
    this.phase = 'countdown';
    this.wave = 0;
    this.nextAt = this.now() + GAME.waves.FIRST_DELAY;
    this.deadline = null;
  }

  /** Chamado a cada tick; retorna true se o estado público mudou (para broadcast). */
  tick(): boolean {
    const now = this.now();
    switch (this.phase) {
      case 'countdown':
        if (this.nextAt !== null && now >= this.nextAt) {
          if (this.wave < GAME.waves.TOTAL) this.startWave(this.wave + 1);
          else this.spawnBoss();
          return true;
        }
        return false;
      case 'wave':
        if (this.sim.aliveCount === 0) {
          // limpou: respiro e próxima (ou chefão)
          this.phase = 'countdown';
          this.deadline = null;
          this.nextAt = now + GAME.waves.BREAK;
          return true;
        }
        if (this.deadline !== null && now >= this.deadline) {
          this.fail(false);
          return true;
        }
        return false;
      case 'boss': {
        const boss = this.bossId !== null ? this.sim.zombies.get(this.bossId) : undefined;
        if (!boss || boss.state === 'dead') {
          this.phase = 'complete';
          this.nextAt = null;
          this.deadline = null;
          this.io.phaseComplete();
          return true;
        }
        if (this.deadline !== null && now >= this.deadline) {
          this.fail(true);
          return true;
        }
        return false;
      }
      default:
        return false;
    }
  }

  /** (dev) força a próxima wave agora; na última, chama o chefão. */
  devNextWave(): void {
    if (this.phase === 'idle') this.activate();
    if (this.wave < GAME.waves.TOTAL) this.startWave(this.wave + 1);
    else if (this.phase !== 'boss' && this.phase !== 'complete') this.spawnBoss();
  }

  /** (dev) chefão agora, seja qual for a wave. */
  devSpawnBoss(): void {
    if (this.phase === 'boss' || this.phase === 'complete') return;
    if (this.phase === 'idle') this.activate();
    this.wave = GAME.waves.TOTAL;
    this.spawnBoss();
  }

  private fail(boss: boolean): void {
    const wave = this.wave;
    this.sim.clear();
    this.phase = 'idle';
    this.wave = 0;
    this.nextAt = null;
    this.deadline = null;
    this.bossId = null;
    this.io.waveFailed(wave, boss);
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
      const z = this.sim.spawn(kind, p.x, p.z, mult, mult, true);
      // já nascem caçando (a bateria "acorda" a horda)
      z.state = 'chase';
    }
    this.wave = n;
    this.phase = 'wave';
    this.nextAt = null;
    this.deadline = this.now() + GAME.waves.TIME_LIMIT;
    this.io.waveStarted(n, count, players);
  }

  private spawnBoss(): void {
    const players = Math.max(1, this.io.playerCount());
    const mult = this.difficulty(players);
    const p = this.sim.pickSpawnPoint();
    const boss = this.sim.spawn('boss', p.x, p.z, mult, mult, true);
    boss.state = 'chase';
    this.bossId = boss.id;
    this.phase = 'boss';
    this.nextAt = null;
    this.deadline = this.now() + GAME.waves.BOSS_TIME_LIMIT;
    this.io.bossSpawned(boss.id, boss.maxHp);
  }
}

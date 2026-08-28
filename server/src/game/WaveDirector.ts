import { GAME } from '../../../shared/gameconfig.js';
import type { WavePhase, WaveState } from '../../../shared/protocol.js';
import type { ZombieSim } from './ZombieSim.js';

export interface WaveIO {
  waveStarted(wave: number, count: number, players: number): void;
  /** horda limpa: chefão da wave chega em `inSeconds` */
  bossIncoming(wave: number, inSeconds: number): void;
  bossSpawned(id: number, hp: number, wave: number): void;
  /** chefão da wave morto e ainda faltam waves: a antena espera a próxima bateria */
  waveCleared(wave: number): void;
  /** chefão da última wave morto */
  phaseComplete(): void;
  /** tempo esgotado: horda removida, a bateria desta wave é perdida */
  waveFailed(wave: number, boss: boolean): void;
  /** jogadores online na sala agora (escala a dificuldade) */
  playerCount(): number;
}

/**
 * Orquestra as TOTAL waves da fase 1. Tempo em segundos (relógio injetável para testes).
 * Cada bateria colocada na antena dispara UMA wave: horda (TIME_LIMIT s) -> limpou -> chefão da
 * wave em BOSS_DELAY s (BOSS_TIME_LIMIT s) -> morto -> `idle` até a próxima bateria. A wave
 * TOTAL (5ª) concluída = fase completa. Estourou um prazo -> horda some, `wave` volta uma
 * (bateria perdida) e é preciso outra bateria para tentar a mesma wave de novo.
 * `wave` = baterias na antena. Dificuldade: ×DIFFICULTY_PER_PLAYER^(n-1) por jogador, ×HP/DMG_GROWTH
 * por wave e a tabela GAME.boss.TIER para o chefão.
 */
export class WaveDirector {
  phase: WavePhase = 'idle';
  wave = 0;
  /** countdown atual é para o chefão (horda já limpa) */
  bossNext = false;
  /** instante do próximo evento (horda/chefão) */
  private nextAt: number | null = null;
  /** prazo para limpar a horda/chefão atual */
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

  /** A antena aceita outra bateria? (parada e ainda faltam waves) */
  get canActivate(): boolean {
    return this.phase === 'idle' && this.wave < GAME.waves.TOTAL;
  }

  state(): WaveState {
    const now = this.now();
    return {
      phase: this.phase,
      wave: this.wave,
      total: GAME.waves.TOTAL,
      bossNext: this.bossNext,
      alive: this.sim.aliveHunters,
      nextIn: this.nextAt === null ? null : Math.max(0, Math.round(this.nextAt - now)),
      timeLeft: this.deadline === null ? null : Math.max(0, Math.round(this.deadline - now)),
    };
  }

  /** Bateria colocada: próxima wave (horda) em FIRST_DELAY s. */
  activate(): void {
    if (!this.canActivate) return;
    this.wave++;
    this.phase = 'countdown';
    this.bossNext = false;
    this.nextAt = this.now() + GAME.waves.FIRST_DELAY;
    this.deadline = null;
  }

  /** Chamado a cada tick; retorna true se o estado público mudou (para broadcast). */
  tick(): boolean {
    const now = this.now();
    switch (this.phase) {
      case 'countdown':
        if (this.nextAt !== null && now >= this.nextAt) {
          if (this.bossNext) this.spawnBoss();
          else this.startWave();
          return true;
        }
        return false;
      case 'wave':
        if (this.sim.aliveHunters === 0) {
          // horda limpa: respiro e o chefão desta wave
          this.phase = 'countdown';
          this.bossNext = true;
          this.deadline = null;
          this.nextAt = now + GAME.waves.BOSS_DELAY;
          this.io.bossIncoming(this.wave, GAME.waves.BOSS_DELAY);
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
          this.bossId = null;
          this.nextAt = null;
          this.deadline = null;
          this.bossNext = false;
          if (this.wave >= GAME.waves.TOTAL) {
            this.phase = 'complete';
            this.io.phaseComplete();
          } else {
            this.phase = 'idle';
            this.io.waveCleared(this.wave);
          }
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

  /**
   * (dev) avança: parado/esperando horda -> horda agora (conta como bateria colocada);
   * na horda -> pula para o chefão; no chefão -> mata o chefão.
   */
  devNextWave(): void {
    switch (this.phase) {
      case 'idle':
        if (this.wave >= GAME.waves.TOTAL) return;
        this.wave++;
        this.startWave();
        return;
      case 'countdown':
        if (this.bossNext) this.spawnBoss();
        else this.startWave();
        return;
      case 'wave':
        this.sim.clearHunters();
        this.spawnBoss();
        return;
      case 'boss': {
        const boss = this.bossId !== null ? this.sim.zombies.get(this.bossId) : undefined;
        if (boss) this.sim.damage(boss, 1e9);
        return;
      }
      default:
        return;
    }
  }

  /** (dev) chefão da wave atual agora (parado: conta como bateria colocada). */
  devSpawnBoss(): void {
    if (this.phase === 'boss' || this.phase === 'complete') return;
    if (this.phase === 'idle') {
      if (this.wave >= GAME.waves.TOTAL) return;
      this.wave++;
    }
    this.sim.clearHunters();
    this.spawnBoss();
  }

  /** Derrota no modo NORMAL: horda some e a antena volta a 0 baterias (a fase recomeça da wave 1). */
  reset(): void {
    this.sim.clearHunters();
    this.phase = 'idle';
    this.wave = 0;
    this.bossNext = false;
    this.nextAt = null;
    this.deadline = null;
    this.bossId = null;
  }

  private fail(boss: boolean): void {
    const wave = this.wave;
    this.sim.clearHunters();
    this.phase = 'idle';
    this.wave = Math.max(0, wave - 1);
    this.bossNext = false;
    this.nextAt = null;
    this.deadline = null;
    this.bossId = null;
    this.io.waveFailed(wave, boss);
  }

  /** Multiplicadores da wave atual: por jogador (quantidade/vida/dano) e por wave (vida/dano). */
  private difficulty(): { players: number; count: number; hp: number; dmg: number } {
    const players = Math.max(1, this.io.playerCount());
    const count = Math.pow(GAME.waves.DIFFICULTY_PER_PLAYER, players - 1);
    const n = Math.max(1, this.wave);
    return { players, count, hp: count * Math.pow(GAME.waves.HP_GROWTH, n - 1), dmg: count * Math.pow(GAME.waves.DMG_GROWTH, n - 1) };
  }

  private startWave(): void {
    const n = this.wave;
    const d = this.difficulty();
    const count = Math.round(GAME.waves.BASE_COUNT[Math.min(n, GAME.waves.BASE_COUNT.length) - 1] * d.count);
    for (let i = 0; i < count; i++) {
      const p = this.sim.pickSpawnPoint();
      // parte da horda cospe à distância (lentidão); o resto vai no corpo a corpo
      const kind = i % Math.round(1 / GAME.zombie.SPITTER_RATIO) === 1 ? 'spitter' : 'zombie';
      const z = this.sim.spawn(kind, p.x, p.z, d.hp, d.dmg, true);
      // já nascem caçando (a bateria "acorda" a horda)
      z.state = 'chase';
    }
    this.phase = 'wave';
    this.bossNext = false;
    this.nextAt = null;
    this.deadline = this.now() + GAME.waves.TIME_LIMIT;
    this.io.waveStarted(n, count, d.players);
  }

  private spawnBoss(): void {
    const d = this.difficulty();
    const p = this.sim.pickSpawnPoint();
    const boss = this.sim.spawn('boss', p.x, p.z, d.hp, d.dmg, true, this.wave);
    boss.state = 'chase';
    this.bossId = boss.id;
    this.phase = 'boss';
    this.bossNext = false;
    this.nextAt = null;
    this.deadline = this.now() + GAME.waves.BOSS_TIME_LIMIT;
    this.io.bossSpawned(boss.id, boss.maxHp, this.wave);
  }
}

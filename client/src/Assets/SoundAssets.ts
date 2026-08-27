/**
 * Motor de áudio (Web Audio API) + manifesto de sons. Fontes CC0/CC-BY em client/public/CREDITS.md.
 * - SFX: variantes aleatórias por nome, volume por distância ao ouvinte e pan estéreo.
 * - Música: dois loops (calma / tensão) com crossfade.
 * O AudioContext só pode tocar depois de um gesto do usuário: `unlock()` é chamado no primeiro clique/tecla.
 */

const SFX_VARIANTS = {
  gun_shot: 1,
  gun_reload: 1,
  gun_empty: 1,
  knife_swing: 3,
  knife_draw: 1,
  zombie_growl: 5,
  zombie_attack: 4,
  zombie_hurt: 4,
  zombie_death: 3,
  boss_roar: 1,
  player_hurt: 3,
  player_death: 1,
  pickup: 2,
  coins: 2,
  chop: 3,
  tree_break: 1,
  mine: 3,
  rock_break: 1,
  wall_place: 1,
  wall_break: 1,
  hit: 2,
  hit_soft: 1,
  step: 5,
  ui_click: 1,
  ui_open: 1,
  ui_close: 1,
  shop_open: 1,
  shop_close: 1,
  ui_error: 1,
  ui_confirm: 1,
  wave_bell: 1,
  wave_clear: 1,
  battery_on: 1,
} as const;

export type SfxName = keyof typeof SFX_VARIANTS;
export type MusicName = 'menu' | 'calm' | 'tension';

/** Volume base por som (1 = normal). */
const BASE_VOLUME: Partial<Record<SfxName, number>> = {
  gun_shot: 0.55,
  step: 0.18,
  zombie_growl: 0.6,
  zombie_hurt: 0.55,
  ui_click: 0.5,
  wave_bell: 0.9,
  boss_roar: 1,
  coins: 0.7,
  knife_swing: 0.5,
  shop_open: 0.8,
  shop_close: 0.8,
};

const MUSIC_URLS: Record<MusicName, string> = { menu: '/music/menu.mp3', calm: '/music/calm.mp3', tension: '/music/tension.mp3' };
const MUSIC_PAUSED_KEY = 'warzombie:musicPaused';
const MUSIC_VOLUME = 0.45;

/** Distância (m) além da qual um som posicional não é ouvido. */
const HEAR_RADIUS = 26;

export interface SfxOptions {
  /** posição no mundo (som posicional); sem isso toca "na cabeça" do jogador */
  x?: number;
  z?: number;
  volume?: number;
  /** variação aleatória de pitch (0.1 = ±10%) */
  pitchVar?: number;
  /** força uma variante específica (0..n-1) */
  variant?: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private musicSources = new Map<MusicName, { src: AudioBufferSourceNode; gain: GainNode }>();
  private currentMusic: MusicName | null = null;
  private loaded = false;
  private loading: Promise<void> | null = null;
  /** ouvinte: posição do player e eixo "direita" da câmera no plano do chão (para o pan) */
  listener = { x: 0, z: 0, rightX: 1, rightZ: 0 };
  /** último instante em que cada som tocou (limita spam) */
  private lastPlayed = new Map<SfxName, number>();
  muted = false;
  /** música pausada pelo usuário (botão); persiste entre sessões */
  musicPaused = (() => {
    try {
      return localStorage.getItem(MUSIC_PAUSED_KEY) === '1';
    } catch {
      return false;
    }
  })();

  /** Cria/retoma o AudioContext. Chame a partir de um gesto do usuário. */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 1;
      this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicPaused ? 0 : MUSIC_VOLUME;
      this.musicBus.connect(this.master);
      void this.loadAll();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get ready(): boolean {
    return this.loaded;
  }

  private loadAll(): Promise<void> {
    if (this.loading) return this.loading;
    const ctx = this.ctx!;
    const jobs: Promise<void>[] = [];
    const load = (key: string, url: string) =>
      fetch(`${url}?v=${__BUILD_ID__}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status} ${url}`))))
        .then((ab) => ctx.decodeAudioData(ab))
        .then((buf) => {
          this.buffers.set(key, buf);
        })
        .catch((e) => console.warn('[audio] falha ao carregar', url, e));
    for (const [name, n] of Object.entries(SFX_VARIANTS)) {
      if (n === 1) jobs.push(load(name, `/sfx/${name}.mp3`));
      else for (let i = 1; i <= n; i++) jobs.push(load(`${name}_${i}`, `/sfx/${name}_${i}.mp3`));
    }
    for (const [name, url] of Object.entries(MUSIC_URLS)) jobs.push(load(`music:${name}`, url));
    this.loading = Promise.all(jobs).then(() => {
      this.loaded = true;
      if (this.currentMusic) this.startMusic(this.currentMusic);
    });
    return this.loading;
  }

  /** Toca um efeito. Ignorado silenciosamente se o áudio ainda não destravou/carregou. */
  play(name: SfxName, opts: SfxOptions = {}): void {
    if (!this.ctx || this.muted) return;
    const n = SFX_VARIANTS[name];
    const idx = opts.variant ?? Math.floor(Math.random() * n);
    const buf = this.buffers.get(n === 1 ? name : `${name}_${idx + 1}`);
    if (!buf) return;
    let vol = (BASE_VOLUME[name] ?? 0.8) * (opts.volume ?? 1);
    let pan = 0;
    if (opts.x !== undefined && opts.z !== undefined) {
      const dx = opts.x - this.listener.x;
      const dz = opts.z - this.listener.z;
      const d = Math.hypot(dx, dz);
      if (d > HEAR_RADIUS) return;
      vol *= 1 - (d / HEAR_RADIUS) ** 1.5;
      const right = dx * this.listener.rightX + dz * this.listener.rightZ;
      pan = Math.max(-0.8, Math.min(0.8, right / 10));
    }
    if (vol <= 0.01) return;
    // limita repetição do mesmo som em < 30 ms (várias fontes no mesmo tick)
    const now = this.ctx.currentTime;
    if ((this.lastPlayed.get(name) ?? -1) > now - 0.03) return;
    this.lastPlayed.set(name, now);

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const pv = opts.pitchVar ?? 0.06;
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * pv;
    const gain = this.ctx.createGain();
    gain.gain.value = vol;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    src.connect(gain).connect(panner).connect(this.sfxBus);
    src.start();
  }

  /** Troca a música ambiente com crossfade (idempotente). */
  setMusic(name: MusicName | null, fade = 1.8): void {
    if (this.currentMusic === name) return;
    this.currentMusic = name;
    if (!this.ctx || !this.loaded) return; // aplicado quando carregar
    const now = this.ctx.currentTime;
    for (const [n, m] of this.musicSources) {
      if (n !== name) {
        m.gain.gain.cancelScheduledValues(now);
        m.gain.gain.setValueAtTime(m.gain.gain.value, now);
        m.gain.gain.linearRampToValueAtTime(0, now + fade);
        const src = m.src;
        setTimeout(() => {
          try {
            src.stop();
          } catch {
            /* já parado */
          }
        }, fade * 1000 + 50);
        this.musicSources.delete(n);
      }
    }
    if (name) this.startMusic(name, fade);
  }

  private startMusic(name: MusicName, fade = 1.8): void {
    if (!this.ctx || this.musicSources.has(name)) return;
    const buf = this.buffers.get(`music:${name}`);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + fade);
    src.connect(gain).connect(this.musicBus);
    src.start();
    this.musicSources.set(name, { src, gain });
  }

  /** Pausa/retoma a música (os loops continuam rodando; só o ganho vai a zero). */
  setMusicPaused(paused: boolean): void {
    this.musicPaused = paused;
    try {
      localStorage.setItem(MUSIC_PAUSED_KEY, paused ? '1' : '0');
    } catch {
      /* storage indisponível */
    }
    if (!this.ctx || !this.musicBus) return;
    const now = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(now);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, now);
    this.musicBus.gain.linearRampToValueAtTime(paused ? 0 : MUSIC_VOLUME, now + 0.4);
  }

  setMusicVolume(v: number): void {
    if (this.musicBus) this.musicBus.gain.value = v;
  }

  setSfxVolume(v: number): void {
    if (this.sfxBus) this.sfxBus.gain.value = v;
  }

  dispose(): void {
    this.setMusic(null, 0.3);
  }
}

/** Instância única (o AudioContext deve viver o jogo inteiro; cenas só registram/desregistram ouvintes). */
export const audio = new AudioEngine();
(window as unknown as { __wzAudio: AudioEngine }).__wzAudio = audio; // debug no console

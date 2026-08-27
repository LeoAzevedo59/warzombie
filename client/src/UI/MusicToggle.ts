import { audio } from '@/Assets/SoundAssets';

/** Botão fixo no canto inferior direito para pausar/retomar a música (estado lembrado no localStorage). */
export class MusicToggle {
  private el: HTMLButtonElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('button');
    this.el.className = 'music-toggle';
    this.el.type = 'button';
    this.el.onclick = () => {
      audio.setMusicPaused(!audio.musicPaused);
      this.render();
    };
    parent.appendChild(this.el);
    this.render();
  }

  private render(): void {
    const paused = audio.musicPaused;
    this.el.textContent = paused ? '🔇 Música pausada' : '🎵 Pausar música';
    this.el.title = paused ? 'Retomar a música' : 'Pausar a música';
    this.el.classList.toggle('paused', paused);
  }

  dispose(): void {
    this.el.remove();
  }
}

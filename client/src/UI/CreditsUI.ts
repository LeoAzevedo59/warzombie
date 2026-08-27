import type { EventBus } from '@/Core/EventBus';

/** Créditos que sobem sobre a cutscene do resgate (5º chefão morto e helicóptero decolando). */
export class CreditsUI {
  private el: HTMLElement;
  private unsubs: Array<() => void> = [];

  constructor(
    parent: HTMLElement,
    private bus: EventBus,
    private nameOf: (id: string) => string,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'credits';
    parent.appendChild(this.el);
  }

  show(rescued: string[], leftBehind: string[]): void {
    const line = (cls: string, text: string) => {
      const d = document.createElement('div');
      d.className = cls;
      d.textContent = text; // nomes de jogadores: sempre textContent
      return d;
    };
    const roll = document.createElement('div');
    roll.className = 'roll';
    roll.append(
      line('title', 'WARZOMBIE'),
      line('sub', 'Fase 1 — os cinco chefões caíram e o helicóptero chegou.'),
      line('h', 'Sobreviventes resgatados'),
      ...(rescued.length ? rescued.map((id) => line('name', `🏆 ${this.nameOf(id)}`)) : [line('name dim', 'ninguém embarcou a tempo…')]),
      ...(leftBehind.length ? [line('h', 'Ficaram para trás'), ...leftBehind.map((id) => line('name dim', this.nameOf(id)))] : []),
      line('h', 'Jogo'),
      line('name', 'LeoAzevedo59'),
      line('h', 'Modelos 3D'),
      line('name', 'Quaternius — Zombie Apocalypse Kit (CC0)'),
      line('name', 'Kenney — Nature Kit & Survival Kit (CC0)'),
      line('h', 'Ícones'),
      line('name', 'Lorc, Delapouite & Skoll — game-icons.net (CC-BY 3.0)'),
      line('h', 'Sons'),
      line('name', 'Kenney — Impact, RPG & Interface Sounds (CC0)'),
      line('name', 'Summoning Wars, artisticdude, thebardofblasphemy, MilitaryG — OpenGameArt (CC0)'),
      line('h', 'Música'),
      line('name', 'EmoPreben, TinyWorlds — OpenGameArt (CC0)'),
      line('h', 'Motor'),
      line('name', 'PlayCanvas · TypeScript · Node.js'),
      line('end', 'Obrigado por jogar.'),
    );
    const btn = document.createElement('button');
    btn.className = 'back-lobby';
    btn.textContent = 'Voltar ao lobby';
    btn.onclick = () => this.bus.emit('ui:leaveRoom');
    this.el.replaceChildren(roll, btn);
    this.el.classList.add('visible');
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.el.remove();
  }
}

import { BaseScene } from './BaseScene';
import { isValidRoomName, type RoomDetail, type RoomSummary, type ServerMessage } from '@shared/protocol';

/**
 * Lobby em DOM: lista de salas (criar/entrar) e, dentro de uma sala, a lista de membros com
 * as ações do owner (visibilidade, iniciar). `game_start` leva para a WorldScene.
 */
export class LobbyScene extends BaseScene {
  private el: HTMLElement | null = null;
  private rooms: RoomSummary[] = [];
  private room: RoomDetail | null = null;
  private status = '';
  private unsubs: Array<() => void> = [];
  /** sala privada aguardando código antes do join */
  private pendingJoin: RoomSummary | null = null;

  enter(): void {
    const { net, bus, ui } = this.game;
    this.el = document.createElement('div');
    this.el.className = 'menu lobby';
    ui.appendChild(this.el);

    this.unsubs.push(
      net.onMessage((m) => this.onMessage(m)),
      net.onClose((reason) => {
        this.setStatus(`Conexão perdida (${reason}).`, true);
        bus.emit('scene:change', { scene: 'menu' });
      }),
    );
    net.send({ type: 'room_list' });
    this.render();
  }

  private onMessage(msg: ServerMessage): void {
    const { state, bus } = this.game;
    switch (msg.type) {
      case 'lobby_state':
        this.rooms = msg.rooms;
        break;
      case 'room_state':
        this.room = msg.room;
        this.pendingJoin = null;
        state.roomId = msg.room.id;
        state.isOwner = msg.room.ownerId === state.playerId;
        this.status = '';
        break;
      case 'room_left':
        this.room = null;
        state.roomId = null;
        state.isOwner = false;
        break;
      case 'game_start':
        state.seed = msg.seed;
        state.roomPlayers = msg.players;
        const me = msg.players.find((p) => p.id === state.playerId);
        state.playerPosition = { x: me?.x ?? 0, y: 0, z: me?.z ?? 0 };
        state.hp = me?.hp ?? state.hp;
        state.collectedObjectIds = new Set(msg.removedObjects);
        state.money = msg.money;
        state.inventory = msg.hotbar.map((s) => (s ? { ...s } : null));
        state.equippedSlot = msg.equipped;
        state.wave = msg.wave;
        state.upgrades = { ...msg.upgrades };
        state.magSize = msg.magSize;
        state.ammo = msg.ammo;
        state.upgradePrices = { ...msg.upgradePrices };
        bus.emit('scene:change', { scene: 'world' });
        return;
      case 'error':
        this.setStatus(msg.message, true);
        return;
      default:
        return;
    }
    this.render();
  }

  private setStatus(text: string, error = false): void {
    this.status = text;
    const s = this.el?.querySelector<HTMLElement>('#status');
    if (s) {
      s.textContent = text;
      s.classList.toggle('error', error);
    }
  }

  private render(): void {
    if (!this.el) return;
    this.el.innerHTML = this.room ? this.roomHtml(this.room) : this.listHtml();
    this.bind();
  }

  private listHtml(): string {
    const rows = this.rooms.length
      ? this.rooms
          .map(
            (r) => `<li class="room" data-id="${r.id}">
              <span class="vis" title="${r.visibility === 'PRIVATE' ? 'Privada' : 'Pública'}">${r.visibility === 'PRIVATE' ? '🔒' : '🌐'}</span>
              <span class="rname"></span>
              <span class="meta">${r.members}/${r.max} · ${r.status === 'LOBBY' ? 'aguardando' : r.status === 'PLAYING' ? 'em jogo' : 'encerrada'}</span>
              <button class="join" ${r.members >= r.max ? 'disabled' : ''}>Entrar</button>
            </li>`,
          )
          .join('')
      : '<li class="empty">Nenhuma sala aberta. Crie a primeira!</li>';
    const pj = this.pendingJoin;
    return `
      <h1>LOBBY</h1>
      <p>Olá, <b class="me"></b>. Escolha uma sala ou crie a sua.</p>
      <div class="lobby-grid">
        <section class="panel">
          <h2>Salas</h2>
          <ul class="rooms">${rows}</ul>
          ${pj ? `<form class="code-form"><label>Código da sala "<span class="pj"></span>":</label><input id="code" inputmode="numeric" maxlength="4" placeholder="0000" autocomplete="off" /><button type="submit">Entrar</button><button type="button" class="cancel">Cancelar</button></form>` : ''}
        </section>
        <section class="panel">
          <h2>Criar sala</h2>
          <form class="create-form">
            <input id="rname" maxlength="24" placeholder="Nome da sala" autocomplete="off" />
            <label><input type="radio" name="vis" value="PUBLIC" checked /> Pública</label>
            <label><input type="radio" name="vis" value="PRIVATE" /> Privada (código)</label>
            <button type="submit">Criar</button>
          </form>
        </section>
      </div>
      <div class="status" id="status"></div>
      <button class="back">Trocar de nome</button>`;
  }

  private roomHtml(r: RoomDetail): string {
    const owner = this.game.state.isOwner;
    const members = r.memberList
      .map((m) => `<li${m.id === r.ownerId ? ' class="owner"' : ''}><span class="mname"></span>${m.id === r.ownerId ? ' <em>dono</em>' : ''}</li>`)
      .join('');
    return `
      <h1 class="rtitle"></h1>
      <p>${r.visibility === 'PRIVATE' ? '🔒 Sala privada' : '🌐 Sala pública'}${r.code ? ` · código <b class="code">${r.code}</b>` : ''} · ${r.members}/${r.max} jogadores · ${r.status === 'LOBBY' ? 'aguardando início' : 'em jogo'}</p>
      <div class="lobby-grid">
        <section class="panel">
          <h2>Jogadores</h2>
          <ul class="members">${members}</ul>
        </section>
        <section class="panel">
          <h2>Ações</h2>
          ${owner ? `<button class="start">Iniciar partida</button><button class="toggle-vis">${r.visibility === 'PRIVATE' ? 'Tornar pública' : 'Tornar privada'}</button>` : '<p class="hint">Aguardando o dono iniciar a partida…</p>'}
          <button class="leave">Sair da sala</button>
        </section>
      </div>
      <div class="status" id="status"></div>`;
  }

  /** textContent para nomes vindos de outros jogadores (nunca innerHTML). */
  private bind(): void {
    const el = this.el!;
    const { net, state, bus } = this.game;
    el.querySelector<HTMLElement>('.me')?.replaceChildren(state.playerName);
    el.querySelectorAll<HTMLElement>('li.room').forEach((li) => {
      const r = this.rooms.find((x) => x.id === li.dataset.id)!;
      li.querySelector('.rname')!.textContent = r.name;
      li.querySelector<HTMLButtonElement>('.join')!.onclick = () => {
        if (r.visibility === 'PRIVATE') {
          this.pendingJoin = r;
          this.render();
          el.querySelector<HTMLInputElement>('#code')?.focus();
        } else net.send({ type: 'room_join', roomId: r.id });
      };
    });
    const codeForm = el.querySelector<HTMLFormElement>('.code-form');
    if (codeForm) {
      el.querySelector('.pj')!.textContent = this.pendingJoin!.name;
      codeForm.onsubmit = (e) => {
        e.preventDefault();
        const code = el.querySelector<HTMLInputElement>('#code')!.value.trim();
        if (!/^\d{4}$/.test(code)) return this.setStatus('Código deve ter 4 dígitos.', true);
        net.send({ type: 'room_join', roomId: this.pendingJoin!.id, code });
      };
      codeForm.querySelector<HTMLButtonElement>('.cancel')!.onclick = () => {
        this.pendingJoin = null;
        this.render();
      };
    }
    const createForm = el.querySelector<HTMLFormElement>('.create-form');
    if (createForm) {
      createForm.onsubmit = (e) => {
        e.preventDefault();
        const name = el.querySelector<HTMLInputElement>('#rname')!.value.trim();
        if (!isValidRoomName(name)) return this.setStatus('Nome da sala: 2–24 caracteres (letras, números, espaço, _ ou -).', true);
        const visibility = (createForm.querySelector<HTMLInputElement>('input[name=vis]:checked')?.value ?? 'PUBLIC') as 'PUBLIC' | 'PRIVATE';
        net.send({ type: 'room_create', name, visibility });
      };
    }
    el.querySelector<HTMLButtonElement>('.back')?.addEventListener('click', () => {
      net.disconnect();
      bus.emit('scene:change', { scene: 'menu' });
    });

    // dentro da sala
    if (this.room) {
      el.querySelector('.rtitle')!.textContent = this.room.name;
      el.querySelectorAll<HTMLElement>('.members li').forEach((li, i) => {
        li.querySelector('.mname')!.textContent = this.room!.memberList[i].name;
      });
      el.querySelector<HTMLButtonElement>('.start')?.addEventListener('click', () => net.send({ type: 'room_start' }));
      el.querySelector<HTMLButtonElement>('.toggle-vis')?.addEventListener('click', () =>
        net.send({ type: 'room_set_visibility', visibility: this.room!.visibility === 'PRIVATE' ? 'PUBLIC' : 'PRIVATE' }),
      );
      el.querySelector<HTMLButtonElement>('.leave')!.onclick = () => net.send({ type: 'room_leave' });
    }
    const s = el.querySelector<HTMLElement>('#status');
    if (s && this.status) s.textContent = this.status;
  }

  update(): void {}

  exit(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.el?.remove();
    super.exit();
  }
}

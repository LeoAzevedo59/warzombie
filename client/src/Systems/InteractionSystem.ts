import { CONFIG } from '@/config';
import { GAME } from '@shared/gameconfig';
import type { System } from '@/Core/GameLoop';
import type { EventBus } from '@/Core/EventBus';
import type { Player } from '@/Entities/Player/Player';
import type { World } from '@/World/World';
import type { WorldObject } from '@/World/WorldObject';
import type { HubStructure } from '@/World/Hub';
import type { Drop } from '@/World/Drop';
import type { Wall } from '@/World/Wall';
import type { NetworkClient } from '@/Net/NetworkClient';
import type { EquipmentSystem } from './EquipmentSystem';

type Interactable = WorldObject | HubStructure | Drop | Wall;

interface HitChannel {
  target: WorldObject | Wall;
  elapsed: number;
}

/**
 * Encontra o objeto interativo mais próximo (coletável, nó de recurso, vendedor, torre),
 * destaca e age ao pressionar E. Toda ação vai para o servidor (`pickup` / `hit_node`);
 * em árvore/rocha o primeiro E abre um canal que manda um hit a cada HIT_INTERVAL.
 */
export class InteractionSystem implements System {
  readonly name = 'Interaction';
  private target: Interactable | null = null;
  private channel: HitChannel | null = null;
  private lastLabel: string | null = null;
  private unsubs: Array<() => void> = [];

  constructor(
    private bus: EventBus,
    private player: Player,
    private world: World,
    private equipment: EquipmentSystem,
    private net: NetworkClient,
  ) {
    this.unsubs.push(
      bus.on('input:interact', () => this.interact()),
      bus.on('net:nodeHit', ({ objectId, hits }) => this.world.findObject(objectId)?.setHits(hits)),
      bus.on('net:structureHit', ({ id, hits }) => {
        this.world.walls.get(id)?.setHits(hits);
        this.lastLabel = null; // atualiza o contador no prompt
      }),
      bus.on('net:structureRemoved', ({ id }) => {
        const w = this.world.walls.get(id);
        if (w && this.target === w) this.target = null;
        if (w && this.channel?.target === w) this.channel = null;
      }),
      bus.on('net:dropRemoved', ({ id }) => {
        if (this.target?.kind === 'drop' && this.target.id === id) {
          this.target = null;
          this.refreshLabel();
        }
      }),
      // o server recusou um hit (objeto sumiu, peso, hotbar cheia...): parar o canal em vez de repetir o erro a cada golpe
      bus.on('net:error', () => {
        this.channel = null;
        this.refreshLabel();
      }),
      bus.on('net:objectRemoved', ({ objectId }) => {
        const obj = this.world.findObject(objectId);
        if (!obj) return;
        if (this.target === obj) this.target = null;
        if (this.channel?.target === obj) this.channel = null;
        this.world.removeObject(obj);
        this.refreshLabel();
      }),
    );
  }

  update(dt: number): void {
    const pos = this.player.position;
    let best: Interactable | null = null;
    let bestScore = Infinity;

    const candidates: Iterable<Interactable> = [...this.world.objects(), ...this.world.structures(), ...this.world.drops.values(), ...this.world.walls.values()];
    for (const obj of candidates) {
      const p = obj.position;
      const dx = p.x - pos.x;
      const dz = p.z - pos.z;
      const reach = CONFIG.interaction.RADIUS + obj.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < reach * reach && d2 < bestScore) {
        bestScore = d2;
        best = obj;
      }
    }

    if (best !== this.target) {
      this.target?.setHighlight(false);
      this.target = best;
      this.target?.setHighlight(true);
    }
    this.tickChannel(dt);
    this.refreshLabel();
  }

  private isHub(t: Interactable): t is HubStructure {
    return t.kind === 'vendor' || t.kind === 'tower';
  }

  private isWall(t: Interactable): t is Wall {
    return 'passable' in t;
  }

  /** A ferramenta precisa estar equipada na mão (slot selecionado), não só na hotbar. */
  private hasTool(obj: WorldObject | Wall): boolean {
    const tool = obj.def.requiredTool;
    return tool === null || this.equipment.equippedItem() === tool;
  }

  /** Avança o canal de hits automáticos; cancela se o alvo mudou ou ficou inválido. */
  private tickChannel(dt: number): void {
    const c = this.channel;
    if (!c) return;
    if (c.target !== this.target || !this.hasTool(c.target)) {
      this.channel = null;
      return;
    }
    c.elapsed += dt;
    if (c.elapsed < CONFIG.interaction.HIT_INTERVAL) return;
    c.elapsed -= CONFIG.interaction.HIT_INTERVAL;
    if (!this.spendStamina()) {
      this.channel = null;
      return;
    }
    this.sendHit(c.target);
  }

  private sendHit(t: WorldObject | Wall): void {
    if (this.isWall(t)) this.net.send({ type: 'hit_wall', id: t.id });
    else this.net.send({ type: 'hit_node', objectId: t.id });
  }

  /** Cada golpe em árvore/rocha gasta vigor; sem vigor não dá para farmar. */
  private spendStamina(): boolean {
    const cost = GAME.farming.STAMINA_PER_HIT;
    if (this.player.stats.stamina < cost) {
      this.bus.emit('ui:toast', { text: 'Sem vigor! Descanse um pouco para continuar.' });
      return false;
    }
    this.player.stats.spend(cost);
    return true;
  }

  private refreshLabel(): void {
    const t = this.target;
    let label: string | null = null;
    if (t) {
      label = this.isHub(t) || t.kind === 'drop' ? t.promptLabel() : t.promptLabel(this.hasTool(t), this.channel?.target === t);
      if (this.isWall(t) && this.channel?.target === t) this.lastLabel = null; // contador muda a cada golpe
    }
    if (label === this.lastLabel) return;
    this.lastLabel = label;
    this.bus.emit('interaction:targetChanged', { label });
  }

  private interact(): void {
    const t = this.target;
    if (!t) return;
    if (t.kind === 'drop') {
      this.net.send({ type: 'pickup_drop', id: t.id });
      return;
    }
    if (this.isHub(t)) {
      if (t.kind === 'vendor') this.bus.emit('shop:open');
      else this.bus.emit('tower:open');
      return;
    }
    if (!this.hasTool(t)) return;
    if (t.isNode) {
      // hits acontecem automaticamente em tickChannel; o primeiro sai na hora
      if (this.channel?.target !== t) {
        if (!this.spendStamina()) return;
        this.channel = { target: t, elapsed: 0 };
        this.sendHit(t);
      }
      return;
    }
    this.net.send({ type: 'pickup', objectId: t.id });
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
  }
}

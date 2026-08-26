import { CONFIG } from '@/config';
import { GAME } from '@shared/gameconfig';
import type { System } from '@/Core/GameLoop';
import type { EventBus } from '@/Core/EventBus';
import type { Player } from '@/Entities/Player/Player';
import type { World } from '@/World/World';
import type { WorldObject } from '@/World/WorldObject';
import type { HubStructure } from '@/World/Hub';
import type { NetworkClient } from '@/Net/NetworkClient';
import type { EquipmentSystem } from './EquipmentSystem';

type Interactable = WorldObject | HubStructure;

interface HitChannel {
  target: WorldObject;
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

    const candidates: Iterable<Interactable> = [...this.world.objects(), ...this.world.structures()];
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

  /** A ferramenta precisa estar equipada na mão (slot selecionado), não só na hotbar. */
  private hasTool(obj: WorldObject): boolean {
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
    this.net.send({ type: 'hit_node', objectId: c.target.id });
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
      label = this.isHub(t) ? t.promptLabel() : t.promptLabel(this.hasTool(t), this.channel?.target === t);
    }
    if (label === this.lastLabel) return;
    this.lastLabel = label;
    this.bus.emit('interaction:targetChanged', { label });
  }

  private interact(): void {
    const t = this.target;
    if (!t) return;
    if (this.isHub(t)) {
      if (t.kind === 'vendor') this.bus.emit('shop:open');
      else this.net.send({ type: 'activate_battery' });
      return;
    }
    if (!this.hasTool(t)) return;
    if (t.isNode) {
      // hits acontecem automaticamente em tickChannel; o primeiro sai na hora
      if (this.channel?.target !== t) {
        if (!this.spendStamina()) return;
        this.channel = { target: t, elapsed: 0 };
        this.net.send({ type: 'hit_node', objectId: t.id });
      }
      return;
    }
    this.net.send({ type: 'pickup', objectId: t.id });
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
  }
}

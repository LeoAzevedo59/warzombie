import { CONFIG } from '@/config';
import type { System } from '@/Core/GameLoop';
import type { EventBus } from '@/Core/EventBus';
import type { GameState } from '@/Core/GameState';
import type { Player } from '@/Entities/Player/Player';
import type { World } from '@/World/World';
import type { WorldObject } from '@/World/WorldObject';
import type { Workbench } from '@/World/Structure';
import type { InventorySystem } from './InventorySystem';
import type { EquipmentSystem } from './EquipmentSystem';

type Interactable = WorldObject | Workbench;

interface HitChannel {
  target: WorldObject;
  elapsed: number;
}

/**
 * Encontra o objeto interativo mais próximo (coletável, nó de recurso ou mesa de
 * marceneiro), destaca e age ao pressionar E. Em árvore/rocha, o primeiro E inicia
 * um canal que aplica um hit a cada HIT_INTERVAL segundos até quebrar, sem exigir
 * pressionar E de novo.
 */
export class InteractionSystem implements System {
  readonly name = 'Interaction';
  private target: Interactable | null = null;
  private channel: HitChannel | null = null;
  private lastLabel: string | null = null;
  private unsub: () => void;

  constructor(
    private bus: EventBus,
    private state: GameState,
    private player: Player,
    private world: World,
    private inventory: InventorySystem,
    private equipment: EquipmentSystem,
  ) {
    this.unsub = bus.on('input:interact', () => this.interact());
  }

  update(dt: number): void {
    const pos = this.player.position;
    let best: Interactable | null = null;
    let bestScore = Infinity;

    const candidates: Iterable<Interactable> = [...this.world.objects(), ...this.world.benches()];
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

  /** A ferramenta precisa estar equipada na mão (slot selecionado), não só no inventário. */
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

    // o hit que quebraria o nó só acontece se os drops couberem — senão eles seriam destruídos
    if (c.target.hits + 1 >= c.target.def.hitsRequired && !this.inventory.canFit([...c.target.def.drops])) {
      this.channel = null;
      this.bus.emit('ui:toast', { text: 'Inventário cheio' });
      return;
    }

    c.target.hit();
    this.bus.emit('node:hit', { kind: c.target.kind, hits: c.target.hits, hitsRequired: c.target.def.hitsRequired });
    if (c.target.broken) {
      this.channel = null;
      this.harvest(c.target);
    }
  }

  private refreshLabel(): void {
    const t = this.target;
    let label: string | null = null;
    if (t) {
      label = t.kind === 'workbench' ? t.promptLabel() : t.promptLabel(this.hasTool(t), this.channel?.target === t);
    }
    if (label === this.lastLabel) return;
    this.lastLabel = label;
    this.bus.emit('interaction:targetChanged', { label });
  }

  private interact(): void {
    const t = this.target;
    if (!t) return;

    if (t.kind === 'workbench') {
      this.bus.emit('workbench:interact', { workbenchId: t.id });
      return;
    }
    if (!this.hasTool(t)) return;

    if (t.isNode) {
      if (this.channel?.target !== t) this.channel = { target: t, elapsed: 0 };
      return; // hits acontecem automaticamente em tickChannel, sem precisar de novo E
    }
    this.harvest(t);
  }

  /** Entrega os drops e remove o objeto do mundo. */
  private harvest(t: WorldObject): void {
    // coletável simples que não cabe: fica no chão (nós são bloqueados antes do hit final)
    if (!t.isNode && !this.inventory.canFit([...t.def.drops])) {
      this.bus.emit('ui:toast', { text: 'Inventário cheio' });
      return;
    }
    for (const drop of t.def.drops) {
      const leftover = this.inventory.add(drop.itemId, drop.count);
      const gained = drop.count - Math.max(0, leftover);
      if (gained > 0) this.bus.emit('item:collected', { itemId: drop.itemId, count: gained });
    }
    this.state.collectedObjectIds.add(t.id);
    this.world.removeObject(t);
    this.target = null;
    this.refreshLabel();
  }

  dispose(): void {
    this.unsub();
  }
}

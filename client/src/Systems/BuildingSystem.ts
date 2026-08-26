import { CONFIG } from '@/config';
import type { System } from '@/Core/GameLoop';
import type { EventBus } from '@/Core/EventBus';
import type { Player } from '@/Entities/Player/Player';
import type { World } from '@/World/World';
import { Workbench } from '@/World/Structure';
import { World as WorldClass } from '@/World/World';
import { facingDir, isClearOfCircles } from '@/Core/Spatial';
import type { InventorySystem } from './InventorySystem';

/** Coloca estruturas do inventário no mundo (hoje: só a mesa de marceneiro), tecla B. */
export class BuildingSystem implements System {
  readonly name = 'Building';
  private nextBenchId = 1;
  private unsub: () => void;

  constructor(
    private bus: EventBus,
    private inventory: InventorySystem,
    private player: Player,
    private world: World,
  ) {
    this.unsub = bus.on('input:place', () => this.place());
  }

  update(): void {
    /* sem lógica por frame */
  }

  private place(): void {
    if (!this.inventory.has('workbench', 1)) return;

    // à FRENTE do player (facingDir; entity.forward é -Z e apontaria para trás)
    const pos = this.player.position.clone();
    pos.add(facingDir(this.player.entity).mulScalar(CONFIG.building.PLACE_DISTANCE));

    if (!this.isValidSpot(pos.x, pos.z)) {
      this.bus.emit('ui:toast', { text: 'Sem espaço para colocar a mesa aqui' });
      return; // não consome o item
    }

    this.inventory.remove('workbench', 1);
    const wb = new Workbench(this.nextBenchId++, pos.x, pos.z);
    this.world.addBench(wb);
  }

  /** Dentro do mapa e sem sobrepor árvores/rochas/outras mesas. */
  private isValidSpot(x: number, z: number): boolean {
    const b = WorldClass.mapBounds();
    const r = 0.8; // solidRadius da mesa
    if (x < b.minX + r || x > b.maxX - r || z < b.minZ + r || z > b.maxZ - r) return false;
    return (
      isClearOfCircles(x, z, this.world.objects(), r) && isClearOfCircles(x, z, this.world.benches(), r)
    );
  }

  dispose(): void {
    this.unsub();
  }
}

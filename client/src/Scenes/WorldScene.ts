import { BaseScene } from './BaseScene';
import { GameLoop } from '@/Core/GameLoop';
import { IsoCamera } from '@/World/Camera';
import { GameMap } from '@/World/Map';
import { World } from '@/World/World';
import { Player } from '@/Entities/Player/Player';
import { PlayerStats } from '@/Entities/Player/PlayerStats';
import { PlayerController } from '@/Entities/Player/PlayerController';
import { InputSystem } from '@/Systems/InputSystem';
import { MovementSystem } from '@/Systems/MovementSystem';
import { CollisionSystem } from '@/Systems/CollisionSystem';
import { InteractionSystem } from '@/Systems/InteractionSystem';
import { InventorySystem } from '@/Systems/InventorySystem';
import { EquipmentSystem } from '@/Systems/EquipmentSystem';
import { CraftingSystem } from '@/Systems/CraftingSystem';
import { RefiningSystem } from '@/Systems/RefiningSystem';
import { CombatSystem } from '@/Systems/CombatSystem';
import { BuildingSystem } from '@/Systems/BuildingSystem';
import { ZombieSystem } from '@/Systems/ZombieSystem';
import { NetworkSystem } from '@/Systems/NetworkSystem';
import { PlayersHUD } from '@/UI/PlayersHUD';
import { CombatHUD } from '@/UI/CombatHUD';
import { HealthBar } from '@/UI/HealthBar';
import { InventoryUI } from '@/UI/InventoryUI';
import { WorkbenchUI } from '@/UI/WorkbenchUI';
import { MapUI } from '@/UI/MapUI';
import { ToastUI } from '@/UI/ToastUI';

/** Aviso de queda de conexão exibido por cima do menu (some sozinho). */
function alertDisconnect(reason: string): void {
  const el = document.createElement('div');
  el.className = 'disconnect-banner';
  el.textContent = `Conexão com o servidor perdida (${reason}).`;
  document.getElementById('ui')?.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

/** Monta o mundo jogável: entidades, systems (em ordem) e UI. */
export class WorldScene extends BaseScene {
  private loop = new GameLoop();
  private camera!: IsoCamera;
  private player!: Player;
  private world!: World;
  private input!: InputSystem;
  private ui: {
    healthBar: HealthBar;
    inventory: InventoryUI;
    workbench: WorkbenchUI;
    map: MapUI;
    toasts: ToastUI;
    combat: CombatHUD;
    players: PlayersHUD;
  } | null = null;
  private stats!: PlayerStats;
  private unsubs: Array<() => void> = [];
  private updateInputEnabled: (() => void) | null = null;

  enter(): void {
    const { app, bus, state, ui: uiRoot } = this.game;
    this.addDefaultLighting();

    // --- mundo ---
    this.camera = new IsoCamera();
    this.root.addChild(this.camera.entity);

    const map = new GameMap(state.seed, (id) => state.collectedObjectIds.has(id));
    this.world = new World(map, bus);
    this.root.addChild(this.world.root);

    // --- player ---
    const stats = new PlayerStats(state, bus);
    this.stats = stats;
    this.player = new Player(stats);
    const sp = state.playerPosition;
    this.player.setPosition(sp.x, 0, sp.z);
    this.root.addChild(this.player.entity);
    this.player.initAnimation();
    this.camera.follow(this.player.entity);
    this.world.update(this.player.position);

    // --- systems (ordem = ordem de execução) ---
    this.input = new InputSystem(bus, app.graphicsDevice.canvas as HTMLCanvasElement, () => this.camera.component);
    const controller = new PlayerController(this.player, this.camera);
    const inventory = new InventorySystem(state, bus);
    const equipment = new EquipmentSystem(bus, state);
    const crafting = new CraftingSystem(bus, inventory);
    const refining = new RefiningSystem(bus, inventory);
    const zombies = new ZombieSystem(bus, state, this.player, this.world);
    const network = new NetworkSystem(this.game.net, bus, state, this.player, this.root);
    if (import.meta.env.DEV) {
      // handle de debug pra testes manuais no console (só em dev)
      (window as unknown as { __wz: unknown }).__wz = { app, zombies, player: this.player, state, world: this.world, bus };
    }

    this.loop
      .register(this.input)
      .register(new MovementSystem(this.input, controller, this.player, state))
      .register(new CollisionSystem(this.player, this.world))
      .register(equipment)
      .register(new InteractionSystem(bus, state, this.player, this.world, inventory, equipment))
      .register(inventory)
      .register(crafting)
      .register(refining)
      .register(zombies)
      .register(new CombatSystem(bus, this.player, this.input, equipment, zombies, this.root))
      .register(new BuildingSystem(bus, inventory, this.player, this.world))
      .register(network)
      .start();

    // --- UI ---
    const inventoryUI = new InventoryUI(uiRoot, bus, crafting);
    const workbenchUI = new WorkbenchUI(uiRoot, bus, inventory, refining);
    const updateInputEnabled = () => {
      // morto não anda: painéis fechados não bastam pra religar o input
      this.input.enabled = !inventoryUI.open && !workbenchUI.open && !this.stats.dead;
    };
    this.updateInputEnabled = updateInputEnabled;
    inventoryUI.onOpenChanged = updateInputEnabled;
    workbenchUI.onOpenChanged = updateInputEnabled;

    this.ui = {
      healthBar: new HealthBar(uiRoot, bus),
      inventory: inventoryUI,
      workbench: workbenchUI,
      map: new MapUI(uiRoot, this.world, this.player, zombies),
      toasts: new ToastUI(uiRoot, bus),
      combat: new CombatHUD(uiRoot, bus, () => this.respawn()),
      players: new PlayersHUD(uiRoot, bus, state.playerName, () => network.remotes.values(), () => this.camera.component),
    };
    this.unsubs.push(
      bus.on('player:died', () => {
        updateInputEnabled();
        this.player.velocity.set(0, 0, 0);
      }),
      // caiu a conexão: volta pro menu (o próximo Entrar reconecta)
      // saiu/foi tirado da sala: volta ao lobby
      bus.on('ui:leaveRoom', () => this.game.net.send({ type: 'room_leave' })),
      bus.on('net:roomLeft', () => bus.emit('scene:change', { scene: 'lobby' })),
      bus.on('net:disconnected', ({ reason }) => {
        console.warn('Desconectado do servidor:', reason);
        alertDisconnect(reason);
        bus.emit('scene:change', { scene: 'menu' });
      }),
    );
    stats.notify();
    inventory.notify();
    bus.emit('equip:changed', { slotIndex: state.equippedSlot, itemId: equipment.equippedItem() });
  }

  /** Volta ao spawn com vida cheia; ZombieSystem limpa os zumbis ao ouvir player:respawned. */
  private respawn(): void {
    this.stats.restore();
    this.player.setPosition(0, 0, 0);
    this.game.bus.emit('player:respawned');
    this.updateInputEnabled?.();
  }

  update(dt: number): void {
    this.loop.tick(dt);
    this.world.update(this.player.position);
    this.camera.update(dt);
    this.ui?.map.update();
    this.ui?.players.update();
  }

  exit(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.loop.dispose();
    this.player.dispose();
    this.ui?.combat.dispose();
    this.ui?.healthBar.dispose();
    this.ui?.inventory.dispose();
    this.ui?.workbench.dispose();
    this.ui?.map.dispose();
    this.ui?.toasts.dispose();
    this.ui?.players.dispose();
    this.ui = null;
    super.exit();
  }
}

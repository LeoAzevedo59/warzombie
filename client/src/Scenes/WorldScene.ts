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
import { CombatSystem } from '@/Systems/CombatSystem';
import { NetworkSystem } from '@/Systems/NetworkSystem';
import { ZombieSystem } from '@/Systems/ZombieSystem';
import { EffectsSystem } from '@/Systems/EffectsSystem';
import { WaveHUD } from '@/UI/WaveHUD';
import { DevPanel } from '@/UI/DevPanel';
import { cameraOrthoHeight } from '@shared/upgrades';
import { CombatHUD } from '@/UI/CombatHUD';
import { HealthBar } from '@/UI/HealthBar';
import { HotbarUI } from '@/UI/HotbarUI';
import { ShopUI } from '@/UI/ShopUI';
import { EconomyHUD } from '@/UI/EconomyHUD';
import { MapUI } from '@/UI/MapUI';
import { ToastUI } from '@/UI/ToastUI';
import { PlayersHUD } from '@/UI/PlayersHUD';

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
    hotbar: HotbarUI;
    shop: ShopUI;
    economy: EconomyHUD;
    map: MapUI;
    toasts: ToastUI;
    combat: CombatHUD;
    players: PlayersHUD;
    wave: WaveHUD;
    dev: DevPanel | null;
  } | null = null;
  private stats!: PlayerStats;
  private unsubs: Array<() => void> = [];

  enter(): void {
    const { app, bus, state, net, ui: uiRoot } = this.game;
    this.addDefaultLighting();

    // --- mundo ---
    this.camera = new IsoCamera();
    this.root.addChild(this.camera.entity);

    const map = new GameMap(state.seed, (id) => state.collectedObjectIds.has(id));
    this.world = new World(map, bus);
    this.root.addChild(this.world.root);
    this.world.init();

    // --- player ---
    const stats = new PlayerStats(state, bus);
    this.stats = stats;
    this.player = new Player(stats);
    const sp = state.playerPosition;
    this.player.setPosition(sp.x, 0, sp.z);
    this.root.addChild(this.player.entity);
    this.player.initAnimation();
    this.camera.follow(this.player.entity);
    this.camera.setOrthoHeight(cameraOrthoHeight(state.upgrades));
    this.world.update(this.player.position);

    // --- systems (ordem = ordem de execução) ---
    this.input = new InputSystem(bus, app.graphicsDevice.canvas as HTMLCanvasElement, () => this.camera.component);
    const controller = new PlayerController(this.player, this.camera, () => state.weightSpeedMult);
    const inventory = new InventorySystem(state, bus);
    const equipment = new EquipmentSystem(bus, state, net);
    const network = new NetworkSystem(net, bus, state, this.player, this.root);
    const zombies = new ZombieSystem(bus, this.root);
    // handle de debug/teste no console (o servidor é autoritativo, então expor isso não dá vantagem)
    (window as unknown as { __wz: unknown }).__wz = { app, player: this.player, state, world: this.world, bus, network, net, zombies };

    this.loop
      .register(this.input)
      .register(new MovementSystem(this.input, controller, this.player, state))
      .register(new CollisionSystem(this.player, this.world))
      .register(equipment)
      .register(new InteractionSystem(bus, this.player, this.world, equipment, net))
      .register(inventory)
      .register(new CombatSystem(bus, state, this.player, this.input, equipment, net, this.root, (id) => network.positionOf(id)))
      .register(network)
      .register(zombies)
      .register(new EffectsSystem(bus, this.player, this.root, state, (id) => network.positionOf(id)))
      .start();

    // --- UI ---
    const shop = new ShopUI(uiRoot, bus, state, net);
    const updateInputEnabled = () => {
      // morto não anda: painéis fechados não bastam pra religar o input
      this.input.enabled = !shop.open && !this.ui?.players.open && !this.stats.dead;
    };
    shop.onOpenChanged = updateInputEnabled;

    this.ui = {
      healthBar: new HealthBar(uiRoot, bus, state),
      hotbar: new HotbarUI(uiRoot, bus),
      shop,
      economy: new EconomyHUD(uiRoot, bus, state.money),
      map: new MapUI(uiRoot, this.world, this.player, () => network.remotes.values(), () => zombies.alive()),
      toasts: new ToastUI(uiRoot, bus),
      combat: new CombatHUD(uiRoot, bus, state.playerId, state.kills, state.upgrades),
      players: new PlayersHUD(uiRoot, bus, state.playerName, state, () => network.remotes.values(), () => this.camera.component),
      wave: new WaveHUD(uiRoot, bus, state.wave, () => {
        for (const z of zombies.alive()) if (z.kind === 'boss') return { hp: z.hp, maxHp: z.maxHp };
        return null;
      }),
      dev: state.devCheats ? new DevPanel(uiRoot, bus, state, net) : null,
    };
    this.ui.players.onOpenChanged = updateInputEnabled;
    this.unsubs.push(
      // Esc: fecha a loja/painel dev se abertos; senão abre/fecha o menu
      bus.on('input:escape', () => {
        if (shop.open) bus.emit('input:closePanel');
        else this.ui?.players.toggle();
      }),
      bus.on('net:hotbar', ({ slots, equipped }) => inventory.apply(slots, equipped)),
      bus.on('net:upgrades', ({ upgrades }) => this.camera.setOrthoHeight(cameraOrthoHeight(upgrades))),
      bus.on('player:died', () => {
        updateInputEnabled();
        this.player.velocity.set(0, 0, 0);
      }),
      bus.on('player:respawned', () => updateInputEnabled()),
      // saiu/foi tirado da sala: volta ao lobby
      bus.on('ui:leaveRoom', () => net.send({ type: 'room_leave' })),
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
    bus.emit('net:ammo', { mag: state.ammo, magSize: state.magSize, reloading: false });
  }

  update(dt: number): void {
    this.loop.tick(dt);
    this.world.update(this.player.position);
    this.camera.update(dt);
    this.ui?.map.update();
    this.ui?.players.update();
    this.ui?.wave.update();
  }

  exit(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.loop.dispose();
    this.player.dispose();
    this.world.dispose();
    if (this.ui) for (const u of Object.values(this.ui)) u?.dispose();
    this.ui = null;
    super.exit();
  }
}

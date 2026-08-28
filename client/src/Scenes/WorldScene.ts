import { BaseScene } from './BaseScene';
import { GAME } from '@shared/gameconfig';
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
import { AudioSystem } from '@/Systems/AudioSystem';
import { WaveHUD } from '@/UI/WaveHUD';
import { DevPanel } from '@/UI/DevPanel';
import { SummaryUI } from '@/UI/SummaryUI';
import { CreditsUI } from '@/UI/CreditsUI';
import { Helicopter } from '@/World/Helicopter';
import { BuildSystem } from '@/Systems/BuildSystem';
import { CombatHUD } from '@/UI/CombatHUD';
import { HealthBar } from '@/UI/HealthBar';
import { HotbarUI } from '@/UI/HotbarUI';
import { ShopUI } from '@/UI/ShopUI';
import { TowerUI } from '@/UI/TowerUI';
import { BagUI } from '@/UI/BagUI';
import { EconomyHUD } from '@/UI/EconomyHUD';
import { MapUI } from '@/UI/MapUI';
import { ToastUI } from '@/UI/ToastUI';
import { PlayersHUD } from '@/UI/PlayersHUD';
import { GameOverUI } from '@/UI/GameOverUI';

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
  private zombies!: ZombieSystem;
  private input!: InputSystem;
  private ui: {
    healthBar: HealthBar;
    hotbar: HotbarUI;
    shop: ShopUI;
    tower: TowerUI;
    bag: BagUI;
    economy: EconomyHUD;
    map: MapUI;
    toasts: ToastUI;
    combat: CombatHUD;
    players: PlayersHUD;
    wave: WaveHUD;
    dev: DevPanel | null;
    summary: SummaryUI;
    credits: CreditsUI;
    gameOver: GameOverUI;
  } | null = null;
  private helicopter: Helicopter | null = null;
  private creditsTimer: number | null = null;
  private stats!: PlayerStats;
  private unsubs: Array<() => void> = [];

  enter(): void {
    const { app, bus, state, net, ui: uiRoot } = this.game;
    this.addDefaultLighting();

    // --- mundo ---
    this.camera = new IsoCamera();
    this.root.addChild(this.camera.entity);

    const map = new GameMap(app, state.seed, (id) => state.collectedObjectIds.has(id));
    this.world = new World(map, bus, state.tower, state.seed, app);
    this.root.addChild(this.world.root);
    this.world.init();
    for (const s of state.structures) this.world.addWall(s);
    for (const d of state.drops) this.world.addDrop(d);
    this.world.tower.setHpRatio(state.towerHp / state.towerMaxHp);

    // --- player ---
    const stats = new PlayerStats(state, bus);
    this.stats = stats;
    this.player = new Player(stats, state.character);
    const sp = state.playerPosition;
    this.player.setPosition(sp.x, 0, sp.z);
    this.root.addChild(this.player.entity);
    this.player.initAnimation();
    this.camera.follow(this.player.entity);
    this.world.update(this.player.position);

    // --- systems (ordem = ordem de execução) ---
    this.input = new InputSystem(bus, app.graphicsDevice.canvas as HTMLCanvasElement, () => this.camera.component);
    const controller = new PlayerController(this.player, this.camera, () => state.weightSpeedMult);
    const inventory = new InventorySystem(state, bus);
    const equipment = new EquipmentSystem(bus, state, net);
    const network = new NetworkSystem(net, bus, state, this.player, this.root);
    const zombies = new ZombieSystem(bus, this.root);
    this.zombies = zombies;
    // handle de debug/teste no console (o servidor é autoritativo, então expor isso não dá vantagem)
    (window as unknown as { __wz: unknown }).__wz = { app, player: this.player, state, world: this.world, bus, network, net, zombies, loop: this.loop };

    this.loop
      .register(this.input)
      .register(new MovementSystem(this.input, controller, this.player, state, bus))
      .register(new CollisionSystem(this.player, this.world))
      .register(equipment)
      .register(new InteractionSystem(bus, this.player, this.world, equipment, net))
      .register(inventory)
      .register(new CombatSystem(bus, state, this.player, this.input, equipment, net, this.root, (id) => network.positionOf(id)))
      .register(network)
      .register(zombies)
      .register(new EffectsSystem(bus, this.player, this.root, state, (id) => network.positionOf(id)))
      .register(new BuildSystem(bus, this.player, equipment, net, this.world, this.root, this.input))
      .register(new AudioSystem(bus, this.player, this.world, this.camera.entity, () => zombies.alive(), (id) => zombies.get(id), (id) => network.positionOf(id), state.playerId ?? ''))
      .start();

    // --- UI ---
    const shop = new ShopUI(uiRoot, bus, state, net, (id) => network.nameOf(id));
    const tower = new TowerUI(uiRoot, bus, state, net);
    const bag = new BagUI(uiRoot, bus, state, net);
    const updateInputEnabled = () => {
      // morto não anda: painéis fechados não bastam pra religar o input
      this.input.enabled = !shop.open && !tower.open && !bag.open && !this.ui?.players.open && !this.stats.dead && !state.boarded;
    };
    shop.onOpenChanged = updateInputEnabled;
    tower.onOpenChanged = updateInputEnabled;
    bag.onOpenChanged = updateInputEnabled;

    this.ui = {
      healthBar: new HealthBar(uiRoot, bus, state),
      hotbar: new HotbarUI(uiRoot, bus),
      shop,
      tower,
      bag,
      economy: new EconomyHUD(uiRoot, bus, state.money),
      map: new MapUI(uiRoot, this.world, this.player, () => network.remotes.values(), () => zombies.alive()),
      toasts: new ToastUI(uiRoot, bus),
      combat: new CombatHUD(uiRoot, bus, state.playerId, state.kills, state.upgrades, state.medals),
      players: new PlayersHUD(uiRoot, bus, state.playerName, state, () => network.remotes.values(), () => this.camera.component),
      wave: new WaveHUD(uiRoot, bus, state.wave, () => {
        for (const z of zombies.alive()) if (z.kind === 'boss') return { hp: z.hp, maxHp: z.maxHp };
        return null;
      }, { hp: state.towerHp, maxHp: state.towerMaxHp }),
      dev: state.devCheats ? new DevPanel(uiRoot, bus, state, net) : null,
      summary: new SummaryUI(uiRoot, bus, state.playerId),
      credits: new CreditsUI(uiRoot, bus, (id) => network.nameOf(id)),
      gameOver: new GameOverUI(uiRoot, bus),
    };
    // entrou com o resgate já em andamento
    if (state.evac) this.spawnHelicopter(state.evac.x, state.evac.z, GAME.evac.LAND_TIME, state.evac.landed);
    if (state.boarded) this.player.entity.enabled = false;
    this.ui.players.onOpenChanged = updateInputEnabled;
    this.ui.map.setEnabled(state.features.minimap);
    this.unsubs.push(
      // Esc: fecha a loja/painel dev se abertos; senão abre/fecha o menu
      bus.on('input:escape', () => {
        if (shop.open || tower.open || bag.open) bus.emit('input:closePanel');
        else this.ui?.players.toggle();
      }),
      // eliminado com medalha própria: volta com todas as vidas
      bus.on('medal:useSelf', () => {
        if (state.playerId) net.send({ type: 'use_medal', targetId: state.playerId });
      }),
      bus.on('net:hotbar', ({ slots, equipped }) => inventory.apply(slots, equipped)),
      bus.on('equip:changed', ({ itemId }) => this.player.setEquipped(itemId)),
      bus.on('input:drop', () => {
        if (!this.stats.dead && equipment.equippedItem()) net.send({ type: 'drop_item' });
      }),
      bus.on('net:dropAdded', ({ drop }) => this.world.addDrop(drop)),
      bus.on('net:dropRemoved', ({ id }) => this.world.removeDrop(id)),
      bus.on('net:ammo', ({ reloading }) => {
        if (reloading !== this.player.fx.reloading) this.player.fx.setReloading(reloading, GAME.weapon.glock.RELOAD);
      }),
      bus.on('net:towerHp', ({ hp, maxHp }) => this.world.tower.setHpRatio(hp / maxHp)),
      bus.on('net:features', ({ features }) => this.ui?.map.setEnabled(features.minimap)),
      bus.on('player:died', () => {
        updateInputEnabled();
        this.player.velocity.set(0, 0, 0);
      }),
      bus.on('player:eliminated', () => {
        updateInputEnabled();
        this.player.velocity.set(0, 0, 0);
      }),
      bus.on('net:gameOver', () => {
        // derrota: trava o input e fecha painéis; o game_start do reinício recria a cena
        this.input.enabled = false;
        bus.emit('input:closePanel');
      }),
      bus.on('evac:helicopter', ({ x, z, landsIn }) => this.spawnHelicopter(x, z, landsIn, false)),
      bus.on('evac:boarded', ({ playerId }) => {
        if (playerId === state.playerId) {
          updateInputEnabled();
          this.player.velocity.set(0, 0, 0);
          if (this.helicopter) this.camera.follow(this.helicopter.entity, false);
        }
      }),
      bus.on('evac:complete', ({ rescued, leftBehind }) => {
        // cutscene: helicóptero decola com a câmera nele; créditos sobem em seguida
        if (this.helicopter) {
          this.helicopter.takeOff();
          this.camera.follow(this.helicopter.entity, false);
        }
        this.input.enabled = false;
        bus.emit('input:closePanel');
        uiRoot.classList.add('cutscene'); // esconde o HUD durante a decolagem e os créditos
        this.creditsTimer = window.setTimeout(() => this.ui?.credits.show(rescued, leftBehind), 3500);
      }),
      bus.on('player:respawned', () => {
        updateInputEnabled();
        this.camera.follow(this.player.entity); // voltou a ser humano: câmera de volta
      }),
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
    if (!this.world) return; // enter() falhou: não inunda o console a cada frame
    this.loop.tick(dt);
    // virou zumbi (fogo amigo): espectador do próprio zumbi assim que ele aparece no snapshot
    const spectate = this.game.state.spectateZombieId;
    if (spectate !== null) {
      const z = this.zombies.get(spectate);
      if (z && this.camera.target !== z.entity) this.camera.follow(z.entity, false);
    }
    this.helicopter?.update(dt);
    this.world.update(this.camera.target?.getPosition() ?? this.player.position);
    this.camera.update(dt);
    this.world.updateObjects(dt);
    this.ui?.map.update();
    this.ui?.players.update();
    this.ui?.wave.update();
  }

  private spawnHelicopter(x: number, z: number, landsIn: number, landed: boolean): void {
    this.helicopter?.destroy();
    this.helicopter = new Helicopter(x, z, landsIn, landed);
    this.root.addChild(this.helicopter.pad);
    this.root.addChild(this.helicopter.entity);
  }

  exit(): void {
    this.game.ui.classList.remove('cutscene');
    if (this.creditsTimer) clearTimeout(this.creditsTimer);
    this.helicopter?.destroy();
    this.helicopter = null;
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

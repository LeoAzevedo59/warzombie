import * as pc from 'playcanvas';
import { getAnimTrack, type AnimStateDef, type CharacterAnimName, type ModelKey } from '@/Assets/ModelAssets';

/** Duração (s) padrão do crossfade entre estados. */
const DEFAULT_BLEND_TIME = 0.1;

interface RestBone {
  node: pc.GraphNode;
  pos: pc.Vec3;
  rot: pc.Quat;
  scale: pc.Vec3;
}

/**
 * Controlador de animação para personagens animados (player, remotos, zumbis, vendedor).
 *
 * Encapsula as pegadinhas do pc.AnimComponent com GLB que foram descobertas no Player:
 * 1. `anim` fica no PAI do entity instanciado — as curvas do GLB têm caminhos tipo
 *    "RootNode/CharacterArmature/...", esperando "RootNode" como filho do dono do componente.
 * 2. `addComponent('anim')` + `assignAnimation` precisam rodar com a entity já na cena.
 * 3. Trocar de estado no MESMO tick síncrono em que o anterior foi setado corrompe o skinning:
 *    `ready` só libera trocas depois de um `setTimeout(0)`.
 * 4. Tracks animam conjuntos diferentes de ossos (Idle 21, Walk 34, Run 50). Ossos que a track
 *    atual não anima ficariam presos na última pose da anterior — por isso repomos a bind pose
 *    de todos os ossos a cada `frameupdate` (que dispara ANTES do anim system avaliar), e o
 *    evaluator sobrescreve só os ossos que a track atual controla.
 * 5. BUG DO ENGINE (PlayCanvas 2.21): `AnimEvaluator.removeClip` chama `binder.resolve(path)`,
 *    que no AnimComponentBinder devolve um objeto NOVO; o `curves--` acontece no objeto errado e
 *    o target antigo nunca é removido de `evaluator._targets`. O loop final de `update()` escreve
 *    TODOS os `_targets` todo frame — inclusive esses órfãos, com o último valor do clip removido.
 *    Era isso que deixava pés/torso presos na pose da passada mesmo com o item 4.
 *    `purgeStaleTargets()` apaga os targets que nenhum clip ativo alimenta (API privada, isolada aqui).
 */

/** Formato interno (privado) do AnimEvaluator que precisamos tocar — ver nota 5 da classe. */
interface EvaluatorInternals {
  _targets: Record<string, unknown>;
  _outputs: Array<Array<{ target: { targetPath: string } }>>;
}
export class AnimatedModel {
  private anim: pc.AnimComponent | null = null;
  private current: CharacterAnimName | null = null;
  private ready = false;
  private restPose: RestBone[] = [];
  private app: pc.AppBase | null = null;
  private durations = new Map<CharacterAnimName, number>();
  private loops = new Map<CharacterAnimName, boolean>();

  /**
   * @param owner entity pai (dona do anim component)
   * @param model entity instanciado do GLB (filho de owner)
   */
  constructor(
    private owner: pc.Entity,
    private model: pc.Entity,
    private modelKey: ModelKey,
  ) {}

  /** Chame só depois de `owner` já estar na árvore da cena. Retorna false se faltar alguma track. */
  init(states: AnimStateDef[], initial: CharacterAnimName): boolean {
    const tracks = states.map((s) => ({ ...s, track: getAnimTrack(this.modelKey, s.track ?? s.name) }));
    const missing = tracks.filter((t) => !t.track).map((t) => t.track ?? t.name);
    if (missing.length) {
      console.warn(`[AnimatedModel] ${this.modelKey}: tracks ausentes ${missing.join(', ')}`);
      return false;
    }

    this.captureRestPose();
    this.anim = this.owner.addComponent('anim', { activate: true }) as pc.AnimComponent;
    for (const t of tracks) {
      this.anim.assignAnimation(t.name, t.track!, undefined, 1, t.loop ?? true);
      this.durations.set(t.name, t.track!.duration);
      this.loops.set(t.name, t.loop ?? true);
    }
    // O primeiro estado atribuído é o que o baseLayer começa tocando; garantimos que seja `initial`
    if (tracks[0]?.name !== initial) this.anim.baseLayer?.play(initial);
    this.current = initial;

    this.app = pc.AppBase.getApplication() ?? null;
    this.app?.on('frameupdate', this.onFrameUpdate, this);
    setTimeout(() => {
      this.ready = true;
      // trocas pedidas antes de liberar (ex.: Death logo após o spawn) não podem se perder
      if (this.current && this.current !== initial) this.anim?.baseLayer?.transition(this.current, 0);
    }, 0);
    return true;
  }

  get state(): CharacterAnimName | null {
    return this.current;
  }

  /** Duração (s) da track, ou 0 se não carregada. */
  duration(name: CharacterAnimName): number {
    return this.durations.get(name) ?? 0;
  }

  /** Troca de estado com crossfade. Ignorado se já está nesse estado (a menos que `restart`). */
  play(name: CharacterAnimName, blend = DEFAULT_BLEND_TIME, restart = false): void {
    if (!this.anim) return;
    if (name === this.current && !restart) return;
    this.current = name;
    if (!this.ready) return; // aplicado quando liberar (ver init)
    this.anim.baseLayer?.transition(name, blend);
  }

  private onFrameUpdate(): void {
    // estado não-loop que terminou (Death): segura o último frame em vez de voltar à bind pose
    if (this.current && this.loops.get(this.current) === false && (this.anim?.baseLayer?.activeStateProgress ?? 0) >= 0.999) return;
    this.purgeStaleTargets();
    this.resetToRestPose();
  }

  private liveTargets = new Set<string>();

  /** Remove de `evaluator._targets` entradas que nenhum clip ativo alimenta (bug do engine, nota 5). */
  private purgeStaleTargets(): void {
    const layer = this.anim?.baseLayer as unknown as { _controller?: { _animEvaluator?: EvaluatorInternals } } | undefined;
    const ev = layer?._controller?._animEvaluator;
    if (!ev) return;
    const targets = ev._targets;
    const keys = Object.keys(targets);
    let liveCount = 0;
    for (const outs of ev._outputs) liveCount += outs.length;
    if (keys.length <= liveCount) return; // nada órfão (targets compartilhados só reduzem o total)

    const live = this.liveTargets;
    live.clear();
    for (const outs of ev._outputs) for (const o of outs) live.add(o.target.targetPath);
    for (const k of keys) if (!live.has(k)) delete targets[k];
  }

  private captureRestPose(): void {
    this.restPose = [];
    const visit = (node: pc.GraphNode): void => {
      this.restPose.push({
        node,
        pos: node.getLocalPosition().clone(),
        rot: node.getLocalRotation().clone(),
        scale: node.getLocalScale().clone(),
      });
      for (const child of node.children) visit(child);
    };
    for (const child of this.model.children) visit(child);
  }

  private resetToRestPose(): void {
    for (const { node, pos, rot, scale } of this.restPose) {
      node.setLocalPosition(pos);
      node.setLocalRotation(rot);
      node.setLocalScale(scale);
    }
  }

  dispose(): void {
    this.app?.off('frameupdate', this.onFrameUpdate, this);
    this.app = null;
    this.restPose = [];
  }
}

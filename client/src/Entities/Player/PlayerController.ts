import * as pc from 'playcanvas';
import { CONFIG } from '@/config';
import type { InputState } from '@/Systems/InputSystem';
import type { Player } from './Player';
import type { IsoCamera } from '@/World/Camera';

/**
 * Converte InputState em velocidade desejada (relativa à câmera) e direção da mira.
 * Não integra posição — isso é do MovementSystem.
 */
export class PlayerController {
  private forward = new pc.Vec3();
  private right = new pc.Vec3();
  private desired = new pc.Vec3();

  constructor(
    private player: Player,
    private camera: IsoCamera,
  ) {}

  apply(input: InputState): void {
    const p = CONFIG.player;
    const player = this.player;

    player.setCrouch(input.crouch);
    player.running = input.run && !input.crouch && player.stats.canRun && (input.moveX !== 0 || input.moveY !== 0);

    const speed = player.crouching ? p.CROUCH_SPEED : player.running ? p.RUN_SPEED : p.WALK_SPEED;

    // eixos da câmera projetados no plano do chão: W = "para cima na tela"
    this.camera.groundAxes(this.forward, this.right);
    this.desired
      .set(0, 0, 0)
      .add(this.forward.mulScalar(input.moveY))
      .add(this.right.mulScalar(input.moveX));
    if (this.desired.lengthSq() > 1) this.desired.normalize();
    this.desired.mulScalar(speed);

    player.velocity.copy(this.desired);

    // Direção do personagem segue o movimento (WASD/setas), não o mouse: mantém a última
    // direção ao parar, só gira quando há input de movimento de fato.
    if (this.desired.lengthSq() > 0.01) player.lookAt(player.position.clone().add(this.desired));
  }
}

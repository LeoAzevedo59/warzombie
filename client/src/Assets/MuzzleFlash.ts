import * as pc from 'playcanvas';

/**
 * Material do clarão de tiro: textura em estrela de 8 pontas (gerada em canvas) com blend aditivo,
 * sem escrita de profundidade — não precisa de asset externo.
 */
let cached: pc.StandardMaterial | null = null;

export function muzzleFlashMaterial(): pc.StandardMaterial {
  if (cached) return cached;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const cx = size / 2;
  ctx.clearRect(0, 0, size, size);
  // estrela: 4 pontas longas + 4 curtas
  ctx.beginPath();
  const pts = 8;
  for (let i = 0; i < pts * 2; i++) {
    const a = (i / (pts * 2)) * Math.PI * 2;
    const long = i % 2 === 0;
    const r = long ? (i % 4 === 0 ? 62 : 44) : 14;
    ctx[i === 0 ? 'moveTo' : 'lineTo'](cx + Math.cos(a) * r, cx + Math.sin(a) * r);
  }
  ctx.closePath();
  const grad = ctx.createRadialGradient(cx, cx, 2, cx, cx, 62);
  grad.addColorStop(0, 'rgba(255,255,230,1)');
  grad.addColorStop(0.25, 'rgba(255,220,120,0.95)');
  grad.addColorStop(0.6, 'rgba(255,140,40,0.6)');
  grad.addColorStop(1, 'rgba(255,90,20,0)');
  ctx.fillStyle = grad;
  ctx.fill();
  // núcleo
  const core = ctx.createRadialGradient(cx, cx, 0, cx, cx, 18);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,240,180,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cx, 18, 0, Math.PI * 2);
  ctx.fill();

  const app = pc.AppBase.getApplication()!;
  const tex = new pc.Texture(app.graphicsDevice, { width: size, height: size, format: pc.PIXELFORMAT_RGBA8, mipmaps: true });
  tex.setSource(c);
  const m = new pc.StandardMaterial();
  m.emissiveMap = tex;
  m.emissive = new pc.Color(1, 1, 1);
  m.emissiveIntensity = 2.5;
  m.opacityMap = tex;
  m.opacityMapChannel = 'a';
  m.diffuse = new pc.Color(0, 0, 0);
  m.useLighting = false;
  m.blendType = pc.BLEND_ADDITIVE;
  m.depthWrite = false;
  m.cull = pc.CULLFACE_NONE;
  m.update();
  cached = m;
  return m;
}

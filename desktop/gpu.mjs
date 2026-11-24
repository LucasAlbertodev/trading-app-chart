// Aceleración por GPU de los gráficos.
//
// Los gráficos (TradingView Lightweight Charts) se dibujan en <canvas>; Chromium rasteriza ese
// canvas y compone la ventana en la GPU a través de ANGLE, que traduce a la API nativa:
//   macOS   → Metal          (Intel Mac incluidos: Iris, UHD, Radeon Pro)
//   Windows → Direct3D 11    (o Vulkan, a elegir)
//   Linux   → Vulkan         (u OpenGL si el driver da problemas)
// El backend se elige en ⚙ Fuentes de datos → Aceleración por GPU y se aplica al arrancar.
// Si el proceso de la GPU se cae dos veces con un backend, la app vuelve a OpenGL (y después a
// software) sola, para que nunca quede una ventana negra.

import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BACKENDS = {
  darwin: ['auto', 'metal', 'gl', 'off'],
  win32: ['auto', 'd3d11', 'vulkan', 'gl', 'off'],
  linux: ['auto', 'vulkan', 'gl', 'off'],
};
const AUTO = { darwin: 'metal', win32: 'd3d11', linux: 'vulkan' };

const available = () => BACKENDS[process.platform] || ['auto', 'gl', 'off'];
const file = () => path.join(app.getPath('userData'), 'gpu.json');

function load() {
  try {
    const j = JSON.parse(readFileSync(file(), 'utf8'));
    return { backend: available().includes(j.backend) ? j.backend : 'auto', fellBack: j.fellBack || null };
  } catch {
    return { backend: 'auto', fellBack: null };
  }
}

function save(s) {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(file(), JSON.stringify(s));
  } catch { /* no importante */ }
}

let chosen = 'auto';
let effective = 'metal';

/** Llamar antes de app.whenReady(): pone los interruptores de Chromium del backend elegido. */
export function applyGpuSwitches() {
  const s = load();
  chosen = process.env.WICKLINE_GPU && available().includes(process.env.WICKLINE_GPU) ? process.env.WICKLINE_GPU : s.backend;
  effective = chosen === 'auto' ? (AUTO[process.platform] || 'gl') : chosen;
  if (effective === 'off') {
    app.disableHardwareAcceleration();
    return;
  }
  const sw = (k, v) => app.commandLine.appendSwitch(k, v);
  // Usar la GPU aunque esté en la lista negra de Chromium (GPUs Intel antiguas, p. ej.), y
  // rasterizar en ella el canvas de los gráficos, sin copias intermedias.
  sw('ignore-gpu-blocklist');
  sw('enable-gpu-rasterization');
  sw('enable-zero-copy');
  sw('force_high_performance_gpu'); // Mac con dos GPU: la dedicada (Radeon) en vez de la integrada
  const features = ['CanvasOopRasterization'];
  if (effective === 'metal') sw('use-angle', 'metal');
  else if (effective === 'd3d11') sw('use-angle', 'd3d11');
  else if (effective === 'gl') sw('use-angle', 'gl');
  else if (effective === 'vulkan') {
    sw('use-angle', 'vulkan');
    sw('use-vulkan');
    features.push('Vulkan', 'VulkanFromANGLE', 'DefaultANGLEVulkan');
  }
  sw('enable-features', features.join(','));
}

/** Vigila el proceso de la GPU: dos caídas → un backend más seguro y reinicio. */
export function watchGpu() {
  let crashes = 0;
  app.on('child-process-gone', (_, d) => {
    if (d.type !== 'GPU' || d.reason === 'clean-exit' || d.reason === 'killed') return;
    if (++crashes < 2 || effective === 'off') return;
    const next = effective === 'gl' ? 'off' : 'gl';
    save({ backend: next, fellBack: effective });
    app.relaunch();
    app.exit(0);
  });
}

/** Qué API está usando de verdad Chromium (según el renderer de ANGLE). */
function activeFrom(renderer) {
  const r = String(renderer || '');
  if (/SwiftShader|llvmpipe|Software/i.test(r)) return 'swiftshader';
  if (/Metal/i.test(r)) return 'metal';
  if (/Direct3D11|D3D11/i.test(r)) return 'd3d11';
  if (/Vulkan/i.test(r)) return 'vulkan';
  if (/OpenGL|GL/i.test(r)) return 'gl';
  return effective;
}

let infoCache = null;
export async function gpuState() {
  if (!infoCache && effective !== 'off') {
    const info = await app.getGPUInfo('complete').catch(() => null);
    infoCache = info;
  }
  const renderer = infoCache?.auxAttributes?.glRenderer || '';
  const nice = renderer.replace(/^ANGLE \(/, '').replace(/\)$/, '').replace(/,\s*Unspecified Version$/, '');
  return {
    backend: chosen,
    available: available(),
    active: effective === 'off' ? 'off' : activeFrom(renderer),
    renderer: nice || (effective === 'off' ? 'CPU' : ''),
    status: app.getGPUFeatureStatus(),
    fellBack: load().fellBack,
  };
}

export function setGpuBackend(backend) {
  if (!available().includes(backend)) return false;
  save({ backend, fellBack: null });
  app.relaunch();
  app.exit(0);
  return true;
}

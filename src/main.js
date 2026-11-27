import { createInitialState, worldToScreen } from './state.js';
import { generateWorld } from './mapGen.js';
import { initStarterLine, stepSimulation } from './simulation.js';
import { stepFX } from './fx.js';
import { renderGame } from './renderer.js';
import { setupInput } from './input.js';
import { setupUI } from './ui.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

let state = createInitialState(133742);
try {
  const savedTheme = localStorage.getItem('minirail-theme');
  if (savedTheme === 'night' || savedTheme === 'day') {
    state.theme = savedTheme;
  }
} catch {
  // ignore storage errors
}
document.documentElement.dataset.theme = state.theme;

generateWorld(state);
initStarterLine(state);

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  state.viewport.width = width;
  state.viewport.height = height;
  state.viewport.dpr = dpr;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const ui = setupUI(state, {
  onRestart(newSeed) {
    const prevMuted = state.muted;
    const prevTheme = state.theme;
    const fresh = createInitialState(newSeed);
    Object.assign(state, fresh);
    state.muted = prevMuted;
    state.theme = prevTheme;
    document.documentElement.dataset.theme = state.theme;
    generateWorld(state);
    initStarterLine(state);
    resizeCanvas();
    ui.syncUI();
  },
});

setupInput(canvas, state, {
  onNetworkChanged() {
    ui.syncUI();
  },
});

const FIXED_DT = 1 / 60;

function stepCamera(dt) {
  const cam = state.camera;
  const posAlpha = Math.min(1, dt * 8.5);
  const dx = cam.targetX - cam.x;
  if (Math.abs(dx) > 0.05) {
    cam.x += dx * posAlpha;
  } else {
    cam.x = cam.targetX;
  }
  const dy = cam.targetY - cam.y;
  if (Math.abs(dy) > 0.05) {
    cam.y += dy * posAlpha;
  } else {
    cam.y = cam.targetY;
  }
  const dz = cam.targetZoom - cam.zoom;
  if (Math.abs(dz) > 0.0005) {
    cam.zoom += dz * Math.min(1, dt * 6.0);
  } else {
    cam.zoom = cam.targetZoom;
  }
}

// Expose inspection & deterministic test helper for automated verification
window.__MINIRAIL__ = {
  getState: () => state,
  worldToScreen: (wx, wy) => worldToScreen(state, wx, wy),
  stepFixed: (steps = 1) => {
    for (let i = 0; i < steps; i++) {
      stepSimulation(state, FIXED_DT, ui.hooks);
      stepFX(state, FIXED_DT);
      stepCamera(FIXED_DT);
    }
  },
};
let accumulator = 0;
let lastTime = performance.now();

function frame(now) {
  const rawDt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  accumulator += rawDt;

  while (accumulator >= FIXED_DT) {
    stepSimulation(state, FIXED_DT, ui.hooks);
    stepFX(state, FIXED_DT);
    accumulator -= FIXED_DT;
  }

  stepCamera(rawDt);
  renderGame(ctx, state);
  ui.syncUI();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

import { createInitialState, worldToScreen } from './state.js';
import { generateWorld } from './mapGen.js';
import { stepSimulation } from './simulation.js';
import { renderGame } from './renderer.js';
import { setupInput } from './input.js';
import { setupUI } from './ui.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

let state = createInitialState(133742);
generateWorld(state);

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
    const fresh = createInitialState(newSeed);
    Object.assign(state, fresh);
    state.muted = prevMuted;
    generateWorld(state);
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

// Expose inspection & deterministic test helper for automated verification
window.__MINIRAIL__ = {
  getState: () => state,
  worldToScreen: (wx, wy) => worldToScreen(state, wx, wy),
  stepFixed: (steps = 1) => {
    for (let i = 0; i < steps; i++) stepSimulation(state, FIXED_DT, ui.hooks);
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
    accumulator -= FIXED_DT;
  }

  renderGame(ctx, state);
  ui.syncUI();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

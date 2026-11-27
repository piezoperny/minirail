import {
  CONFIG,
  getLineColor,
  resetCameraToFit,
  showHint,
  worldToScreen,
  zoomCameraAtScreenPoint,
} from './state.js';
import { clearLine } from './simulation.js';

function createAudioEngine(state) {
  let ctx = null;
  let lastOverflowSoundAt = 0;

  const ensureCtx = () => {
    if (state.muted) return null;
    if (!ctx && typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
      const AC = window.AudioContext || window.webkitAudioContext;
      try {
        ctx = new AC();
      } catch {
        ctx = null;
      }
    }
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  };

  const playTone = (freq, duration = 0.14, gainPeak = 0.05, type = 'sine', delay = 0) => {
    const ac = ensureCtx();
    if (!ac) return;
    const now = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  };

  return {
    unlock: () => ensureCtx(),
    onDelivery(kind) {
      const notes = {
        commuter: 523.25,
        local: 587.33,
        intercity: 659.25,
        raw: 392.0,
        goods: 440.0,
        square: 523.25,
        circle: 659.25,
        triangle: 587.33,
        diamond: 440.0,
      };
      playTone(notes[kind] || 523.25, 0.14, 0.035, 'sine');
    },
    onStationSpawn() {
      playTone(392.0, 0.18, 0.04, 'triangle', 0);
      playTone(523.25, 0.22, 0.04, 'triangle', 0.09);
    },
    onCityGrow() {
      playTone(523.25, 0.22, 0.045, 'triangle', 0);
      playTone(659.25, 0.24, 0.045, 'triangle', 0.075);
      playTone(783.99, 0.26, 0.045, 'triangle', 0.15);
      playTone(1046.5, 0.42, 0.055, 'sine', 0.225);
    },
    onWeekEnd() {
      playTone(440.0, 0.25, 0.045, 'sine', 0);
      playTone(554.37, 0.28, 0.045, 'sine', 0.1);
      playTone(659.25, 0.35, 0.045, 'sine', 0.2);
    },
    onDraftStep(step) {
      if (step === 1) {
        playTone(523.25, 0.14, 0.045, 'triangle', 0);
        playTone(783.99, 0.2, 0.045, 'sine', 0.07);
      } else {
        playTone(587.33, 0.14, 0.045, 'triangle', 0);
        playTone(739.99, 0.16, 0.045, 'triangle', 0.06);
        playTone(880.0, 0.28, 0.05, 'sine', 0.12);
      }
    },
    onOverflowTick(_st, frac = 0.5) {
      const nowMs = performance.now();
      const cooldownMs = Math.max(480, 1250 - frac * 700);
      if (nowMs - lastOverflowSoundAt < cooldownMs) return;
      lastOverflowSoundAt = nowMs;
      const baseFreq = 330 + Math.min(1, Math.max(0, frac)) * 220;
      playTone(baseFreq, 0.09, 0.032, 'triangle', 0);
      playTone(baseFreq * 1.25, 0.08, 0.022, 'sine', 0.055);
    },
    onGameOver() {
      playTone(329.63, 0.28, 0.05, 'triangle', 0);
      playTone(261.63, 0.45, 0.05, 'triangle', 0.18);
    },
  };
}

const DRAFT_LOCOS = [
  {
    id: 'express',
    label: 'Express',
    svg: `
      <svg viewBox="0 0 64 40" width="60" height="38" aria-hidden="true">
        <rect x="4" y="14" width="20" height="14" rx="3" fill="currentColor"/>
        <rect x="8" y="18" width="4.5" height="4.5" rx="1" fill="var(--paper-bg)"/>
        <rect x="15.5" y="18" width="4.5" height="4.5" rx="1" fill="var(--paper-bg)"/>
        <line x1="24" y1="22" x2="29" y2="22" stroke="currentColor" stroke-width="2.6"/>
        <path d="M29,28 L29,12 Q29,9 32,9 L49,9 L59,20 L59,28 Z" fill="currentColor"/>
        <path d="M34,13.5 L47,13.5 L52,18.5 L34,18.5 Z" fill="var(--paper-bg)" opacity="0.9"/>
      </svg>
    `,
  },
  {
    id: 'freight',
    label: 'Freight',
    svg: `
      <svg viewBox="0 0 64 40" width="60" height="38" aria-hidden="true">
        <path d="M4,16 L4,28 L24,28 L24,16 L20,16 L20,23 L8,23 L8,16 Z" fill="currentColor"/>
        <rect x="9" y="13" width="6.5" height="7" rx="1.2" fill="#C2410C"/>
        <rect x="16.5" y="14.5" width="5.5" height="5.5" rx="1.2" fill="#EAB308"/>
        <line x1="24" y1="22" x2="29" y2="22" stroke="currentColor" stroke-width="2.6"/>
        <path d="M29,28 L29,15 L39,15 L39,10 L51,10 L51,16 L59,16 L59,28 Z" fill="currentColor"/>
        <rect x="42" y="13" width="6" height="5" rx="1" fill="var(--paper-bg)" opacity="0.9"/>
      </svg>
    `,
  },
];

function buildDraftPackPool(state) {
  const pool = [
    {
      id: 'extraCars',
      label: '2 Carriages',
      svg: `
        <svg viewBox="0 0 64 40" width="58" height="36" aria-hidden="true">
          <rect x="6" y="12" width="24" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2.8"/>
          <line x1="18" y1="12" x2="18" y2="26" stroke="currentColor" stroke-width="2"/>
          <rect x="34" y="12" width="24" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2.8"/>
          <line x1="46" y1="12" x2="46" y2="26" stroke="currentColor" stroke-width="2"/>
        </svg>
      `,
      apply: () => {
        state.inventory.car += 2;
      },
    },
    {
      id: 'bridges',
      label: '2 Bridges',
      svg: `
        <svg viewBox="0 0 64 40" width="58" height="36" aria-hidden="true">
          <path d="M8,28 Q32,7 56,28" fill="none" stroke="#2B6CB0" stroke-width="4" stroke-linecap="round"/>
          <line x1="6" y1="28" x2="58" y2="28" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>
        </svg>
      `,
      apply: () => {
        state.inventory.bridge += 2;
      },
    },
    {
      id: 'bridgesTunnels',
      label: 'Bridge + Tunnel',
      svg: `
        <svg viewBox="0 0 64 40" width="58" height="36" aria-hidden="true">
          <path d="M4,27 Q16,13 28,27" fill="none" stroke="#2B6CB0" stroke-width="3.2" stroke-linecap="round"/>
          <line x1="3" y1="27" x2="29" y2="27" stroke="currentColor" stroke-width="2.5"/>
          <path d="M36,27 L36,19 A11,11 0 0,1 58,19 L58,27" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>
          <line x1="33" y1="27" x2="61" y2="27" stroke="var(--ink-muted)" stroke-width="2"/>
        </svg>
      `,
      apply: () => {
        state.inventory.bridge += 1;
        state.inventory.tunnel += 1;
      },
    },
    {
      id: 'doubleTrack',
      label: '2 Double-Track',
      svg: `
        <svg viewBox="0 0 64 40" width="58" height="36" aria-hidden="true">
          <line x1="10" y1="14" x2="54" y2="14" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
          <line x1="10" y1="26" x2="54" y2="26" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
        </svg>
      `,
      apply: () => {
        state.inventory.doubleTrack += 2;
      },
    },
    {
      id: 'interchange',
      label: 'Interchange',
      svg: `
        <svg viewBox="0 0 64 40" width="58" height="36" aria-hidden="true">
          <circle cx="32" cy="20" r="14" fill="none" stroke="currentColor" stroke-width="3.2"/>
          <circle cx="32" cy="20" r="7" fill="none" stroke="currentColor" stroke-width="3"/>
        </svg>
      `,
      apply: () => {
        state.inventory.interchange += 1;
      },
    },
  ];

  if (state.unlockedLines < CONFIG.MAX_LINES) {
    const nextColor = getLineColor(state, state.unlockedLines);
    pool.unshift({
      id: 'newLine',
      label: 'New Line',
      svg: `
        <svg viewBox="0 0 64 40" width="58" height="36" aria-hidden="true">
          <circle cx="32" cy="20" r="13" fill="${nextColor}"/>
          <line x1="32" y1="13" x2="32" y2="27" stroke="#FFFDF9" stroke-width="3.2" stroke-linecap="round"/>
          <line x1="25" y1="20" x2="39" y2="20" stroke="#FFFDF9" stroke-width="3.2" stroke-linecap="round"/>
        </svg>
      `,
      apply: () => {
        state.unlockedLines = Math.min(CONFIG.MAX_LINES, state.unlockedLines + 1);
      },
    });
  }

  const copy = [...pool];
  const idx1 = Math.floor(state.rng() * copy.length);
  const first = copy.splice(idx1, 1)[0];
  const idx2 = Math.floor(state.rng() * copy.length);
  const second = copy.splice(idx2, 1)[0];
  return [first, second];
}

export function setupUI(state, callbacks) {
  const audio = createAudioEngine(state);
  window.addEventListener('pointerdown', () => audio.unlock(), { once: true });

  // Load persisted theme
  try {
    const savedTheme = localStorage.getItem('minirail-theme');
    if (savedTheme === 'night' || savedTheme === 'day') {
      state.theme = savedTheme;
    }
  } catch {
    // ignore storage errors
  }
  document.documentElement.dataset.theme = state.theme;

  const dockLines = document.getElementById('dock-lines');
  const scoreEl = document.getElementById('hud-score');
  const goodsEl = document.getElementById('hud-goods');
  const citiesEl = document.getElementById('hud-cities');
  const weekdayEl = document.getElementById('hud-weekday');
  const clockHandEl = document.getElementById('clock-hand-group');
  const hintEl = document.getElementById('hint-banner');
  const edgeAlertsEl = document.getElementById('edge-alerts');

  const speedButtons = Array.from(document.querySelectorAll('.speed-btn'));
  const fitBtn = document.getElementById('btn-fit');
  const themeBtn = document.getElementById('btn-theme');
  const muteBtn = document.getElementById('btn-mute');
  const helpBtn = document.getElementById('btn-help');
  const helpModal = document.getElementById('help-modal');
  const helpCloseBtn = document.getElementById('btn-help-close');

  const gameOverModal = document.getElementById('gameover-modal');
  const finalDaysEl = document.getElementById('final-days');
  const finalDelivEl = document.getElementById('final-deliveries');
  const finalGoodsEl = document.getElementById('final-goods');
  const finalGrownEl = document.getElementById('final-grown');
  const gameOverReasonEl = document.getElementById('gameover-reason');

  const draftModal = document.getElementById('draft-modal');
  const draftWeekEl = document.getElementById('draft-week-num');
  const draftPromptEl = document.getElementById('draft-prompt');
  const draftChoicesEl = document.getElementById('draft-choices');

  const countEls = {
    express: document.getElementById('count-express'),
    freight: document.getElementById('count-freight'),
    car: document.getElementById('count-car'),
    bridge: document.getElementById('count-bridge'),
    doubleTrack: document.getElementById('count-doubleTrack'),
    tunnel: document.getElementById('count-tunnel'),
    interchange: document.getElementById('count-interchange'),
  };

  let activeDraft = null;
  const edgePillMap = new Map();

  function toggleTheme() {
    state.theme = state.theme === 'night' ? 'day' : 'night';
    document.documentElement.dataset.theme = state.theme;
    try {
      localStorage.setItem('minirail-theme', state.theme);
    } catch {
      // ignore storage errors
    }
    syncUI();
  }

  function renderDraftStep() {
    if (!activeDraft) return;
    draftChoicesEl.innerHTML = '';

    if (activeDraft.step === 1) {
      draftPromptEl.textContent = 'Choose a locomotive';
      DRAFT_LOCOS.forEach((loco) => {
        const wrap = document.createElement('div');
        wrap.className = 'draft-circle-item';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'draft-circle-btn';
        btn.dataset.choice = loco.id;
        btn.setAttribute('aria-label', loco.label);
        btn.innerHTML = loco.svg;

        const label = document.createElement('span');
        label.className = 'draft-circle-label';
        label.textContent = loco.label;

        btn.addEventListener('click', () => {
          if (!activeDraft || activeDraft.step !== 1) return;
          state.inventory[loco.id] += 1;
          audio.onDraftStep(1);
          activeDraft.step = 2;
          renderDraftStep();
          syncUI();
        });

        wrap.appendChild(btn);
        wrap.appendChild(label);
        draftChoicesEl.appendChild(wrap);
      });
    } else {
      draftPromptEl.textContent = 'Choose an upgrade';
      activeDraft.packs.forEach((pack) => {
        const wrap = document.createElement('div');
        wrap.className = 'draft-circle-item';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'draft-circle-btn';
        btn.dataset.choice = pack.id;
        btn.setAttribute('aria-label', pack.label);
        btn.innerHTML = pack.svg;

        const label = document.createElement('span');
        label.className = 'draft-circle-label';
        label.textContent = pack.label;

        btn.addEventListener('click', () => {
          if (!activeDraft || activeDraft.step !== 2) return;
          pack.apply();
          audio.onDraftStep(2);
          state.week += 1;
          state.phase = 'playing';
          state.speed = state.savedSpeedBeforeModal || 1;
          activeDraft = null;
          draftModal.classList.add('hidden');
          syncUI();
        });

        wrap.appendChild(btn);
        wrap.appendChild(label);
        draftChoicesEl.appendChild(wrap);
      });
    }
  }

  function openDraftModal() {
    activeDraft = {
      step: 1,
      packs: buildDraftPackPool(state),
    };
    draftWeekEl.textContent = String(state.week + 1);
    renderDraftStep();
    draftModal.classList.remove('hidden');
  }

  // Build line pills
  const linePills = [];
  dockLines.innerHTML = '';
  for (let i = 0; i < CONFIG.MAX_LINES; i++) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'line-pill';
    pill.style.backgroundColor = getLineColor(state, i);
    pill.title = `${CONFIG.LINE_NAMES[i]} Line (Right-click to clear)`;
    pill.dataset.lineId = String(i);
    pill.addEventListener('click', () => {
      if (i >= state.unlockedLines) return;
      state.activeLineId = i;
      syncUI();
    });
    pill.addEventListener('pointerenter', () => {
      if (i < state.unlockedLines && state.lines[i].stations.length >= 2) {
        state.interaction.spotlightLineId = i;
      }
    });
    pill.addEventListener('pointerleave', () => {
      if (state.interaction.spotlightLineId === i) {
        state.interaction.spotlightLineId = null;
      }
    });
    pill.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (i >= state.unlockedLines || state.lines[i].stations.length === 0) return;
      clearLine(state, i);
      if (state.interaction.spotlightLineId === i) {
        state.interaction.spotlightLineId = null;
      }
      showHint(state, `${CONFIG.LINE_NAMES[i]} Line cleared`);
      syncUI();
    });
    dockLines.appendChild(pill);
    linePills.push(pill);
  }

  function setSpeed(spd) {
    if (state.phase !== 'playing') return;
    state.speed = spd;
    syncUI();
  }

  speedButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setSpeed(Number(btn.dataset.speed));
    });
  });

  fitBtn?.addEventListener('click', () => {
    resetCameraToFit(state);
  });

  themeBtn?.addEventListener('click', () => {
    toggleTheme();
  });

  muteBtn.addEventListener('click', () => {
    state.muted = !state.muted;
    syncUI();
  });

  helpBtn.addEventListener('click', () => {
    helpModal.classList.remove('hidden');
  });
  helpCloseBtn.addEventListener('click', () => {
    helpModal.classList.add('hidden');
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat && state.phase === 'playing') {
        setSpeed(state.speed === 0 ? 1 : 0);
      }
    } else if (e.key === '1') {
      setSpeed(1);
    } else if (e.key === '2') {
      setSpeed(2);
    } else if (e.key === '+' || e.key === '=') {
      zoomCameraAtScreenPoint(
        state,
        state.viewport.width * 0.5,
        state.viewport.height * 0.5,
        1.18
      );
    } else if (e.key === '-' || e.key === '_') {
      zoomCameraAtScreenPoint(
        state,
        state.viewport.width * 0.5,
        state.viewport.height * 0.5,
        1 / 1.18
      );
    } else if (e.key === 'f' || e.key === 'F' || e.key === '0') {
      resetCameraToFit(state);
    } else if (e.key === 'n' || e.key === 'N') {
      toggleTheme();
    } else if (e.key === 'm' || e.key === 'M') {
      state.muted = !state.muted;
      syncUI();
    } else if (e.key === 'Escape') {
      helpModal.classList.add('hidden');
      state.interaction.selectedTool = null;
      syncUI();
    }
  });

  document.getElementById('btn-retry-seed')?.addEventListener('click', () => {
    activeDraft = null;
    draftModal.classList.add('hidden');
    callbacks.onRestart?.(state.seed);
  });
  document.getElementById('btn-new-map')?.addEventListener('click', () => {
    activeDraft = null;
    draftModal.classList.add('hidden');
    callbacks.onRestart?.(Math.floor(Math.random() * 0xffffffff));
  });

  function syncEdgeAlerts() {
    if (!edgeAlertsEl) return;
    const w = state.viewport.width || window.innerWidth;
    const h = state.viewport.height || window.innerHeight;
    const cx = w * 0.5;
    const cy = h * 0.5;

    const activeIds = new Set();

    if (state.phase === 'playing') {
      for (const st of state.stations) {
        if (st.pulse <= 0.1 && st.overflowTimer <= 0) continue;
        const scr = worldToScreen(state, st.x, st.y);
        if (scr.x >= 24 && scr.x <= w - 24 && scr.y >= 24 && scr.y <= h - 24) {
          continue;
        }

        activeIds.add(st.id);
        let pill = edgePillMap.get(st.id);
        if (!pill) {
          pill = document.createElement('button');
          pill.type = 'button';
          pill.className = 'edge-alert-pill';
          pill.innerHTML = `<span class="edge-alert-arrow">▶</span><span class="edge-alert-text"></span>`;
          pill.addEventListener('click', () => {
            state.camera.targetX = st.x;
            state.camera.targetY = st.y;
            state.camera.userControlled = true;
          });
          edgeAlertsEl.appendChild(pill);
          edgePillMap.set(st.id, pill);
        }

        const dx = scr.x - cx;
        const dy = scr.y - cy;
        const minX = 48;
        const maxX = Math.max(minX + 1, w - 48);
        const minY = 68;
        const maxY = Math.max(minY + 1, h - 86);

        let t = 1;
        if (dx > 0) t = Math.min(t, (maxX - cx) / dx);
        else if (dx < 0) t = Math.min(t, (minX - cx) / dx);
        if (dy > 0) t = Math.min(t, (maxY - cy) / dy);
        else if (dy < 0) t = Math.min(t, (minY - cy) / dy);

        const px = cx + dx * t;
        const py = cy + dy * t;
        const deg = (Math.atan2(dy, dx) * 180) / Math.PI;

        pill.style.left = `${px}px`;
        pill.style.top = `${py}px`;
        const isOverflow = st.overflowTimer > 0;
        pill.classList.toggle('is-overflow', isOverflow);
        pill.classList.toggle('is-spawn', !isOverflow);

        const arrowEl = pill.querySelector('.edge-alert-arrow');
        const textEl = pill.querySelector('.edge-alert-text');
        if (arrowEl) arrowEl.style.transform = `rotate(${deg}deg)`;
        if (textEl) textEl.textContent = isOverflow ? `${st.name} !` : st.name;
      }
    }

    for (const [id, pill] of edgePillMap.entries()) {
      if (!activeIds.has(id)) {
        pill.remove();
        edgePillMap.delete(id);
      }
    }
  }

  function syncUI() {
    if (document.documentElement.dataset.theme !== state.theme) {
      document.documentElement.dataset.theme = state.theme;
    }

    scoreEl.textContent = String(state.deliveriesTotal);
    goodsEl.textContent = String(state.deliveriesGoods ?? 0);
    citiesEl.textContent = String(
      state.stations.filter((s) => s.kind === 'settlement' && s.tier === 3).length
    );

    const dayIdx = ((state.day - 1) % CONFIG.DAY_NAMES.length + CONFIG.DAY_NAMES.length) % CONFIG.DAY_NAMES.length;
    weekdayEl.textContent = `W${state.week} · ${CONFIG.DAY_NAMES[dayIdx]}`;

    if (clockHandEl) {
      clockHandEl.setAttribute('transform', `rotate(${(state.dayProgress * 360).toFixed(1)} 18 18)`);
    }

    speedButtons.forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.speed) === state.speed);
    });

    if (themeBtn) {
      themeBtn.textContent = state.theme === 'night' ? '☀' : '☾';
    }
    muteBtn.textContent = state.muted ? '🔇' : '🔊';

    linePills.forEach((pill, i) => {
      const unlocked = i < state.unlockedLines;
      const inUse = state.lines[i].stations.length >= 2;
      pill.style.backgroundColor = getLineColor(state, i);
      pill.classList.toggle('locked', !unlocked);
      pill.classList.toggle('in-use', inUse);
      pill.classList.toggle('active', i === state.activeLineId);
    });

    for (const [key, el] of Object.entries(countEls)) {
      if (!el) continue;
      const val = state.inventory[key] ?? 0;
      el.textContent = String(val);
      const tokenEl = el.closest('.dock-token');
      if (tokenEl) {
        tokenEl.classList.toggle('empty', val <= 0);
        tokenEl.classList.toggle('selected-tool', state.interaction.selectedTool === key);
        if (key === 'interchange') {
          tokenEl.classList.toggle('is-hidden', val <= 0);
        }
      }
    }

    if (state.interaction.hintText) {
      hintEl.textContent = state.interaction.hintText;
      hintEl.classList.remove('hidden');
    } else {
      hintEl.classList.add('hidden');
    }

    syncEdgeAlerts();

    if (state.phase === 'draft' && !activeDraft) {
      openDraftModal();
    } else if (state.phase !== 'draft') {
      activeDraft = null;
      draftModal.classList.add('hidden');
    }

    if (state.phase === 'gameover') {
      finalDaysEl.textContent = String(state.day);
      finalDelivEl.textContent = String(state.deliveriesTotal);
      finalGoodsEl.textContent = String(state.deliveriesGoods ?? 0);
      finalGrownEl.textContent = String(state.citiesGrown ?? 0);
      gameOverReasonEl.textContent = state.gameOverReason || 'Network overcrowded.';
      gameOverModal.classList.remove('hidden');
    } else {
      gameOverModal.classList.add('hidden');
    }
  }

  syncUI();
  return {
    syncUI,
    hooks: {
      onDelivery: (kind) => audio.onDelivery(kind),
      onStationSpawn: () => audio.onStationSpawn(),
      onCityGrow: () => audio.onCityGrow(),
      onOverflowTick: (st, frac) => audio.onOverflowTick(st, frac),
      onWeekEnd: () => {
        audio.onWeekEnd();
        syncUI();
      },
      onGameOver: () => {
        audio.onGameOver();
        syncUI();
      },
    },
  };
}

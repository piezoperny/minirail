import { CONFIG } from './state.js';

function createAudioEngine(state) {
  let ctx = null;
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
    onDelivery(shape) {
      const notes = { square: 523.25, circle: 659.25, triangle: 587.33, diamond: 440.0 };
      playTone(notes[shape] || 523.25, 0.14, 0.035, 'sine');
    },
    onStationSpawn() {
      playTone(392.0, 0.18, 0.04, 'triangle', 0);
      playTone(523.25, 0.22, 0.04, 'triangle', 0.09);
    },
    onWeekEnd() {
      playTone(440.0, 0.25, 0.045, 'sine', 0);
      playTone(554.37, 0.28, 0.045, 'sine', 0.1);
      playTone(659.25, 0.35, 0.045, 'sine', 0.2);
    },
    onGameOver() {
      playTone(329.63, 0.28, 0.05, 'triangle', 0);
      playTone(261.63, 0.45, 0.05, 'triangle', 0.18);
    },
  };
}

function buildDraftPackPool(state) {
  const pool = [
    {
      id: 'doubleTrack',
      title: 'Double-Track Kits',
      desc: '+2 Double-Track upgrades for 2-way passing & Express overtaking.',
      apply: () => {
        state.inventory.doubleTrack += 2;
      },
    },
    {
      id: 'bridgesTunnels',
      title: 'Bridges & Tunnels',
      desc: '+1 Bridge and +1 Tunnel to conquer rivers and mountain passes.',
      apply: () => {
        state.inventory.bridge += 1;
        state.inventory.tunnel += 1;
      },
    },
    {
      id: 'extraCars',
      title: 'Extra Railcars',
      desc: '+2 Railcars (+4 capacity each when attached to any locomotive).',
      apply: () => {
        state.inventory.car += 2;
      },
    },
  ];

  if (state.unlockedLines < CONFIG.MAX_LINES) {
    pool.unshift({
      id: 'newLine',
      title: 'New Rail Line',
      desc: `Unlock Line ${state.unlockedLines + 1} (${CONFIG.LINE_NAMES[state.unlockedLines]}) for network expansion.`,
      apply: () => {
        state.unlockedLines = Math.min(CONFIG.MAX_LINES, state.unlockedLines + 1);
      },
    });
  }

  // Deterministic pick of 2 distinct packs using state.rng
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

  const dockLines = document.getElementById('dock-lines');
  const scoreEl = document.getElementById('hud-score');
  const weekEl = document.getElementById('hud-week');
  const dayEl = document.getElementById('hud-day');
  const dayRingEl = document.getElementById('day-ring-fg');
  const hintEl = document.getElementById('hint-banner');

  const speedButtons = Array.from(document.querySelectorAll('.speed-btn'));
  const muteBtn = document.getElementById('btn-mute');
  const helpBtn = document.getElementById('btn-help');
  const helpModal = document.getElementById('help-modal');
  const helpCloseBtn = document.getElementById('btn-help-close');

  const gameOverModal = document.getElementById('gameover-modal');
  const finalDaysEl = document.getElementById('final-days');
  const finalDelivEl = document.getElementById('final-deliveries');
  const finalPassEl = document.getElementById('final-passengers');
  const finalCargoEl = document.getElementById('final-cargo');
  const gameOverReasonEl = document.getElementById('gameover-reason');

  const draftModal = document.getElementById('draft-modal');
  const draftWeekEl = document.getElementById('draft-week-num');
  const draftLocoEl = document.getElementById('draft-loco-choices');
  const draftPackEl = document.getElementById('draft-pack-choices');
  const draftConfirmBtn = document.getElementById('btn-draft-confirm');

  const countEls = {
    express: document.getElementById('count-express'),
    freight: document.getElementById('count-freight'),
    car: document.getElementById('count-car'),
    bridge: document.getElementById('count-bridge'),
    doubleTrack: document.getElementById('count-doubleTrack'),
    tunnel: document.getElementById('count-tunnel'),
  };

  let activeDraft = null;

  function openDraftModal() {
    const packs = buildDraftPackPool(state);
    activeDraft = {
      selectedLoco: null,
      selectedPack: null,
      packs,
    };

    draftWeekEl.textContent = String(state.week);
    draftConfirmBtn.disabled = true;

    const locos = [
      {
        id: 'express',
        title: 'Express Train',
        desc: 'Fast (155 u/s) passenger locomotive. Slows -40% on untunneled hills.',
      },
      {
        id: 'freight',
        title: 'Freight Train',
        desc: 'Heavy (100 u/s) cargo locomotive. Only -10% hill penalty.',
      },
    ];

    draftLocoEl.innerHTML = '';
    locos.forEach((loco) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'draft-card';
      card.dataset.loco = loco.id;
      card.innerHTML = `<div class="draft-card-title">${loco.title}</div><div class="draft-card-desc">${loco.desc}</div>`;
      card.addEventListener('click', () => {
        activeDraft.selectedLoco = loco.id;
        draftLocoEl.querySelectorAll('.draft-card').forEach((c) => {
          c.classList.toggle('selected', c.dataset.loco === loco.id);
        });
        draftConfirmBtn.disabled = !(activeDraft.selectedLoco && activeDraft.selectedPack);
      });
      draftLocoEl.appendChild(card);
    });

    draftPackEl.innerHTML = '';
    packs.forEach((pack) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'draft-card';
      card.dataset.pack = pack.id;
      card.innerHTML = `<div class="draft-card-title">${pack.title}</div><div class="draft-card-desc">${pack.desc}</div>`;
      card.addEventListener('click', () => {
        activeDraft.selectedPack = pack;
        draftPackEl.querySelectorAll('.draft-card').forEach((c) => {
          c.classList.toggle('selected', c.dataset.pack === pack.id);
        });
        draftConfirmBtn.disabled = !(activeDraft.selectedLoco && activeDraft.selectedPack);
      });
      draftPackEl.appendChild(card);
    });

    draftModal.classList.remove('hidden');
  }

  draftConfirmBtn.addEventListener('click', () => {
    if (!activeDraft || !activeDraft.selectedLoco || !activeDraft.selectedPack) return;
    state.inventory[activeDraft.selectedLoco] += 1;
    activeDraft.selectedPack.apply();
    state.week += 1;
    state.phase = 'playing';
    state.speed = state.savedSpeedBeforeModal || 1;
    activeDraft = null;
    draftModal.classList.add('hidden');
    syncUI();
  });

  // Build line pills
  const linePills = [];
  dockLines.innerHTML = '';
  for (let i = 0; i < CONFIG.MAX_LINES; i++) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'line-pill';
    pill.style.backgroundColor = CONFIG.LINE_COLORS[i];
    pill.title = `${CONFIG.LINE_NAMES[i]} Line`;
    pill.dataset.lineId = String(i);
    pill.addEventListener('click', () => {
      if (i >= state.unlockedLines) return;
      state.activeLineId = i;
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
      if (state.phase === 'playing') {
        setSpeed(state.speed === 0 ? 1 : 0);
      }
    } else if (e.key === '1') {
      setSpeed(1);
    } else if (e.key === '2') {
      setSpeed(2);
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

  function syncUI() {
    scoreEl.textContent = String(state.deliveriesTotal);
    weekEl.textContent = String(state.week);
    dayEl.textContent = `DAY ${state.day}`;

    const circ = 87.96;
    dayRingEl.style.strokeDashoffset = String(circ * (1 - state.dayProgress));

    speedButtons.forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.speed) === state.speed);
    });

    muteBtn.textContent = state.muted ? '🔇' : '🔊';

    linePills.forEach((pill, i) => {
      const unlocked = i < state.unlockedLines;
      const inUse = state.lines[i].stations.length >= 2;
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
      }
    }

    if (state.interaction.hintText) {
      hintEl.textContent = state.interaction.hintText;
      hintEl.classList.remove('hidden');
    } else {
      hintEl.classList.add('hidden');
    }

    if (state.phase === 'draft' && !activeDraft) {
      openDraftModal();
    } else if (state.phase !== 'draft') {
      activeDraft = null;
      draftModal.classList.add('hidden');
    }

    if (state.phase === 'gameover') {
      finalDaysEl.textContent = String(state.day);
      finalDelivEl.textContent = String(state.deliveriesTotal);
      finalPassEl.textContent = String(state.deliveriesPassengers);
      finalCargoEl.textContent = String(state.deliveriesCargo);
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
      onDelivery: (shape) => audio.onDelivery(shape),
      onStationSpawn: () => audio.onStationSpawn(),
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

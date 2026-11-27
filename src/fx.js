const MAX_PUFFS = 180;

export function createFXState() {
  return {
    puffs: [],
    hops: [],
    floaters: [],
    pulses: [],
    ripplesOffset: 0,
    onboardingPhase: 0,
    cuePhase: 0,
  };
}

export function spawnPuff(state, x, y, opts = {}) {
  const fx = state?.fx;
  if (!fx) return null;

  const startR = opts.startR ?? 3;
  const endR = opts.endR ?? 12;
  const life = Math.max(0.05, opts.life ?? 0.9);
  const puff = {
    x,
    y,
    vx: opts.vx ?? 0,
    vy: opts.vy ?? -18,
    startR,
    endR,
    r: startR,
    life,
    maxLife: life,
    age: 0,
    color: opts.color ?? 'rgba(240, 236, 226, 0.72)',
    alpha: opts.alpha ?? 0.75,
  };

  fx.puffs.push(puff);
  if (fx.puffs.length > MAX_PUFFS) {
    fx.puffs.splice(0, fx.puffs.length - MAX_PUFFS);
  }
  return puff;
}

export function spawnTokenHop(state, fromX, fromY, toX, toY, tokenKind, color) {
  const fx = state?.fx;
  if (!fx) return null;

  const dist = Math.hypot(toX - fromX, toY - fromY);
  const hop = {
    fromX,
    fromY,
    toX,
    toY,
    x: fromX,
    y: fromY,
    tokenKind,
    color: color ?? '#232629',
    age: 0,
    duration: 0.28,
    arcHeight: Math.min(28, Math.max(12, dist * 0.28)),
  };

  fx.hops.push(hop);
  return hop;
}

export function spawnFloatingToast(state, x, y, text, color) {
  const fx = state?.fx;
  if (!fx) return null;

  const floater = {
    x,
    y,
    startY: y,
    vy: -26,
    text,
    color: color ?? '#232629',
    age: 0,
    duration: 1.5,
  };

  fx.floaters.push(floater);
  return floater;
}

export function spawnWarningPulse(state, x, y, maxR = 38, color = '#D94E34') {
  const fx = state?.fx;
  if (!fx) return null;

  const startR = 16;
  const pulse = {
    x,
    y,
    startR,
    maxR: Math.max(startR + 4, maxR),
    r: startR,
    color: color ?? '#D94E34',
    age: 0,
    life: 0.9,
  };

  if (!Array.isArray(fx.pulses)) {
    fx.pulses = [];
  }
  fx.pulses.push(pulse);
  if (fx.pulses.length > 64) {
    fx.pulses.splice(0, fx.pulses.length - 64);
  }
  return pulse;
}

export function stepFX(state, dt) {
  const fx = state?.fx;
  if (!fx || !Number.isFinite(dt) || dt <= 0) return;

  const clampedDt = Math.min(dt, 0.1);

  // River current ripple phase & wordless onboarding loop timer
  fx.ripplesOffset = (fx.ripplesOffset + clampedDt * 24) % 10000;
  fx.onboardingPhase = ((fx.onboardingPhase || 0) + clampedDt * 0.45) % 1;
  fx.cuePhase = ((fx.cuePhase || 0) + clampedDt * 3.0) % (Math.PI * 2);

  // Exhaust & factory smoke puffs
  for (let i = fx.puffs.length - 1; i >= 0; i--) {
    const p = fx.puffs[i];
    p.age += clampedDt;
    if (p.age >= p.maxLife) {
      fx.puffs.splice(i, 1);
      continue;
    }
    const t = p.age / p.maxLife;
    p.x += p.vx * clampedDt;
    p.y += p.vy * clampedDt;
    p.r = p.startR + (p.endR - p.startR) * t;
  }

  // Parabolic boarding/delivery token hops
  for (let i = fx.hops.length - 1; i >= 0; i--) {
    const h = fx.hops[i];
    h.age += clampedDt;
    if (h.age >= h.duration) {
      fx.hops.splice(i, 1);
      continue;
    }
    const t = h.age / h.duration;
    h.x = h.fromX + (h.toX - h.fromX) * t;
    h.y = h.fromY + (h.toY - h.fromY) * t - 4 * h.arcHeight * t * (1 - t);
  }

  // Rising world-space floating toasts
  for (let i = fx.floaters.length - 1; i >= 0; i--) {
    const f = fx.floaters[i];
    f.age += clampedDt;
    if (f.age >= f.duration) {
      fx.floaters.splice(i, 1);
      continue;
    }
    f.y += f.vy * clampedDt;
  }

  // Expanding overcrowding warning pulses
  if (Array.isArray(fx.pulses)) {
    for (let i = fx.pulses.length - 1; i >= 0; i--) {
      const pl = fx.pulses[i];
      pl.age += clampedDt;
      if (pl.age >= pl.life) {
        fx.pulses.splice(i, 1);
        continue;
      }
      const t = pl.age / pl.life;
      const eased = 1 - (1 - t) * (1 - t);
      pl.r = pl.startR + (pl.maxR - pl.startR) * eased;
    }
  }

  // Station hover springs & pulse decay
  if (Array.isArray(state.stations)) {
    const hoveredId = state.interaction?.hoveredStationId ?? null;
    const k = 260;
    const damping = 22;
    for (const st of state.stations) {
      if (typeof st.hoverScale !== 'number') st.hoverScale = 1.0;
      if (typeof st.hoverVel !== 'number') st.hoverVel = 0;

      const target = st.hoverTarget ?? (hoveredId === st.id ? 1.12 : 1.0);
      const accel = (target - st.hoverScale) * k - st.hoverVel * damping;
      st.hoverVel += accel * clampedDt;
      st.hoverScale += st.hoverVel * clampedDt;

      if (Math.abs(target - st.hoverScale) < 0.0005 && Math.abs(st.hoverVel) < 0.001) {
        st.hoverScale = target;
        st.hoverVel = 0;
      }

      if (typeof st.pulse === 'number' && st.pulse > 0) {
        st.pulse = Math.max(0, st.pulse - clampedDt * 2.2);
      }
    }
  }
}

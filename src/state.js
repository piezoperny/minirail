import { createFXState } from './fx.js';

export const CONFIG = {
  WORLD_WIDTH: 2400,
  WORLD_HEIGHT: 1500,
  BASE_VIEW_WIDTH: 1280,
  BASE_VIEW_HEIGHT: 780,

  LINE_COLORS: [
    '#D94E34', // Vermilion
    '#2B6CB0', // Cobalt
    '#D69E2E', // Amber
    '#2F855A', // Forest
    '#805AD5', // Plum
    '#0987A0', // Teal
  ],
  LINE_NAMES: ['Red', 'Blue', 'Amber', 'Green', 'Plum', 'Teal'],
  MAX_LINES: 6,

  LINE_SPACING: 8,
  FILLET_RADIUS: 28,
  STATION_RADIUS: 16,
  T_BAR_OFFSET: 28,
  MIN_STATION_SPACING: 150,

  DAY_SECONDS: 10.5,
  DAYS_PER_WEEK: 7,
  OVERFLOW_DURATION: 30.0,
  OVERFLOW_DRAIN_RATE: 0.75,

  EXPRESS_SPEED: 155,
  FREIGHT_SPEED: 100,
  EXPRESS_HILL_MULT: 0.60,
  FREIGHT_HILL_MULT: 0.90,
  TRAIN_DWELL_TIME: 0.75,
  TRAIN_ACCEL: 220,
  TRAIN_DECEL: 290,

  TRAIN_DEFAULT_CARS: 2,
  MAX_CARS_PER_TRAIN: 4,
  CAR_CAPACITY: 3,
  CAR_SPACING: 26,
  // Legacy capacity constants preserved for intermediate module compatibility
  TRAIN_BASE_CAPACITY: 0,
  CAR_CAPACITY_BONUS: 3,

  FACTORY_PROCESS_TIME: 3.5,
  FACTORY_INPUT_MAX: 6,

  SETTLEMENT_TIERS: {
    1: { name: 'Hamlet', subtype: 'hamlet', capacity: 6, goodsTarget: 4 },
    2: { name: 'Town', subtype: 'town', capacity: 8, goodsTarget: 6 },
    3: { name: 'City', subtype: 'city', capacity: 10, goodsTarget: null },
  },

  CITY_CREST_PALETTE: ['#B83280', '#2B6CB0', '#2F855A', '#C05621', '#6B46C1', '#0987A0'],

  SETTLEMENT_NAMES: [
    ['Grandhaven', 'GH'],
    ['Oakridge', 'OK'],
    ['Millbrook', 'MB'],
    ['Northport', 'NP'],
    ['Ashford', 'AF'],
    ['Riverbend', 'RB'],
    ['Eastwick', 'EW'],
    ['Pinehurst', 'PH'],
    ['Stonebridge', 'SB'],
    ['Fairview', 'FV'],
    ['Clearwater', 'CW'],
    ['Highgate', 'HG'],
  ],

  INDUSTRY_NAMES: {
    forest: ['Timber Camp', 'Pine Logging', 'Cedar Woods', 'Redwood Mill'],
    mine: ['Iron Ridge', 'Coal Hollow', 'Copper Quarry', 'Granite Pit'],
    factory: ['Millworks', 'Valley Foundry', 'Steam Joinery', 'Ironworks'],
  },

  MIN_HEADWAY: 52,
  SAFE_GAP: 36,
  OVERTAKE_TRIGGER_DIST: 64,
  OVERTAKE_OFFSET: 10,

  COLORS: {
    paper: '#F5F1E6',
    paperGrid: 'rgba(35, 38, 41, 0.035)',
    riverHalo: '#DCE7EB',
    river: '#8FB3C2',
    riverBank: '#769AA9',
    hillFill: 'rgba(182, 169, 142, 0.16)',
    hillStroke: 'rgba(140, 126, 106, 0.38)',
    ink: '#232629',
    stationFill: '#FFFDF9',
    danger: '#D94E34',
    bridgeDeck: '#5F5B52',
    tunnelPortal: '#3B3832',
  },
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function edgeKey(aId, bId) {
  return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
}

export function orderedPair(aId, bId) {
  return aId < bId ? [aId, bId] : [bId, aId];
}

export function createInitialState(seed = Math.floor(Math.random() * 0xffffffff)) {
  const lines = CONFIG.LINE_COLORS.map((color, idx) => ({
    id: idx,
    name: CONFIG.LINE_NAMES[idx],
    color,
    stations: [],
    isLoop: false,
    removingEdges: new Set(),
  }));

  return {
    seed,
    rng: mulberry32(seed),

    // Timing & Speed
    simTime: 0,
    dayProgress: 0, // 0..1 within current day
    day: 1,
    week: 1,
    speed: 1, // 0, 1, 2
    savedSpeedBeforeModal: 1,
    phase: 'playing', // 'playing' | 'draft' | 'gameover'
    gameOverReason: '',
    muted: false,

    // Scoring
    deliveriesTotal: 0,
    deliveriesPassengers: 0,
    deliveriesCargo: 0,
    deliveriesGoods: 0,
    citiesGrown: 0,

    // Camera & Viewport
    viewport: { width: 1280, height: 780, dpr: 1 },
    camera: { x: 0, y: 0, zoom: 1.0, targetZoom: 1.0 },

    // Terrain
    river: { points: [], halfWidth: 26 },
    hills: [], // [{ id, x, y, rx, ry, angle, rings }]

    // Graph & Network
    stations: [],
    stationById: new Map(),
    pendingSpawns: [], // pre-generated future station schedule
    nextSpawnIndex: 0,
    spawnElapsed: 0,
    nextSpawnInterval: 18,
    nextTokenId: 1,

    corridors: new Map(), // edgeKey -> corridor object
    lines,
    activeLineId: 0,
    unlockedLines: 3,

    // Fleet
    trains: [],
    nextTrainId: 1,

    // Inventory Dock
    inventory: {
      express: 1,
      freight: 1,
      car: 1,
      bridge: 2,
      doubleTrack: 1,
      tunnel: 1,
    },

    // Onboarding
    onboarding: {
      freightLineBuilt: false,
      starterIds: { cityId: 1, townId: 2, resourceId: 3, factoryId: 4 },
    },

    // FX
    fx: createFXState(),

    // Interactive State (used by input.js & renderer.js)
    interaction: {
      mode: 'idle', // 'idle' | 'buildLine' | 'insertNode' | 'dragToken' | 'dragTrain' | 'dragUpgrade'
      selectedTool: null, // optional click-to-place tool from dock
      hoveredStationId: null,
      hoveredCorridorKey: null,
      hoveredTrainId: null,
      hoveredTBar: null, // { lineId, end: 'start' | 'end', stationId }
      drag: null,
      hintText: '',
      hintTimer: 0,
      flashMessage: null, // { text, x, y, timer }
    },
  };
}

const MAX_TRAIN_HISTORY_SPAN = CONFIG.MAX_CARS_PER_TRAIN * CONFIG.CAR_SPACING + 96;

export function recordTrainHistory(train, x, y, angle, stepDist = 0) {
  if (!train) return;
  if (!Array.isArray(train.pathHistory)) {
    train.pathHistory = [];
  }
  if (typeof train.totalTraveled !== 'number') {
    train.totalTraveled = 0;
  }

  const distDelta = stepDist > 0 ? stepDist : 0;
  if (train.pathHistory.length === 0) {
    train.totalTraveled += distDelta;
    train.pathHistory.push({ dist: train.totalTraveled, x, y, angle });
    return;
  }

  if (distDelta <= 0) {
    const last = train.pathHistory[train.pathHistory.length - 1];
    last.x = x;
    last.y = y;
    last.angle = angle;
    return;
  }

  train.totalTraveled += distDelta;
  const last = train.pathHistory[train.pathHistory.length - 1];
  if (train.totalTraveled - last.dist >= 2.0) {
    train.pathHistory.push({ dist: train.totalTraveled, x, y, angle });
  } else {
    last.dist = train.totalTraveled;
    last.x = x;
    last.y = y;
    last.angle = angle;
  }

  while (
    train.pathHistory.length > 2 &&
    train.pathHistory[1].dist < train.totalTraveled - MAX_TRAIN_HISTORY_SPAN
  ) {
    train.pathHistory.shift();
  }
}

export function sampleTrainCarriagePose(train, backDistance) {
  if (!train) {
    return { x: 0, y: 0, angle: 0 };
  }
  const hist = train.pathHistory;
  const baseAngle = train.angle || 0;
  if (!Array.isArray(hist) || hist.length === 0) {
    return {
      x: (train.x || 0) - Math.cos(baseAngle) * backDistance,
      y: (train.y || 0) - Math.sin(baseAngle) * backDistance,
      angle: baseAngle,
    };
  }

  const total = typeof train.totalTraveled === 'number'
    ? train.totalTraveled
    : hist[hist.length - 1].dist;
  const targetDist = total - backDistance;

  if (targetDist <= hist[0].dist) {
    const first = hist[0];
    const extra = first.dist - targetDist;
    return {
      x: first.x - Math.cos(first.angle) * extra,
      y: first.y - Math.sin(first.angle) * extra,
      angle: first.angle,
    };
  }

  const last = hist[hist.length - 1];
  if (targetDist >= last.dist) {
    return { x: last.x, y: last.y, angle: last.angle };
  }

  // Binary search for segment [lo, lo + 1] containing targetDist
  let lo = 0;
  let hi = hist.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (hist[mid].dist <= targetDist) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  const a = hist[lo];
  const b = hist[lo + 1];
  const span = b.dist - a.dist;
  const t = span > 1e-6 ? (targetDist - a.dist) / span : 0;

  let angleDiff = b.angle - a.angle;
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    angle: a.angle + angleDiff * t,
  };
}

export function getEffectiveScale(state) {
  const fit = Math.min(
    state.viewport.width / CONFIG.BASE_VIEW_WIDTH,
    state.viewport.height / CONFIG.BASE_VIEW_HEIGHT
  );
  return Math.max(0.45, fit) * state.camera.zoom;
}

export function worldToScreen(state, wx, wy) {
  const scale = getEffectiveScale(state);
  return {
    x: state.viewport.width * 0.5 + (wx - state.camera.x) * scale,
    y: state.viewport.height * 0.5 + (wy - state.camera.y) * scale,
  };
}

export function screenToWorld(state, sx, sy) {
  const scale = getEffectiveScale(state);
  return {
    x: state.camera.x + (sx - state.viewport.width * 0.5) / scale,
    y: state.camera.y + (sy - state.viewport.height * 0.5) / scale,
  };
}

export function showHint(state, text, duration = 2.2) {
  state.interaction.hintText = text;
  state.interaction.hintTimer = duration;
}

import { createFXState } from './fx.js';

export const CONFIG = {
  WORLD_WIDTH: 2400,
  WORLD_HEIGHT: 1500,
  BASE_VIEW_WIDTH: 1280,
  BASE_VIEW_HEIGHT: 780,

  MIN_ZOOM: 0.45,
  MAX_ZOOM: 2.50,

  LINE_COLORS: [
    '#D94E34', // Vermilion
    '#2563EB', // Cobalt
    '#EAB308', // Amber
    '#16A34A', // Forest
    '#9333EA', // Plum
    '#0891B2', // Teal
  ],
  LINE_NAMES: ['Red', 'Blue', 'Amber', 'Green', 'Plum', 'Teal'],
  MAX_LINES: 6,

  LINE_SPACING: 8,
  FILLET_RADIUS: 32,
  STATION_PASS_FILLET: 18,
  STATION_RADIUS: 16,
  T_BAR_OFFSET: 26,
  MIN_STATION_SPACING: 150,

  DAY_SECONDS: 10.5,
  DAYS_PER_WEEK: 7,
  DAY_NAMES: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
  INITIAL_SPAWN_INTERVAL: 34.0,
  OVERFLOW_DURATION: 42.0,
  OVERFLOW_DRAIN_RATE: 1.25,

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
  CAR_SPACING: 23,
  BOGIE_WHEELBASE: 13,
  PASSENGER_UNIT_LEN: 25,
  FREIGHT_UNIT_LEN: 21,
  HEADWAY_BUFFER: 22,
  PLATFORM_PASS_OFFSET: 5.0,
  // Legacy capacity constants preserved for intermediate module compatibility
  TRAIN_BASE_CAPACITY: 0,
  CAR_CAPACITY_BONUS: 3,

  INTERCHANGE_CAPACITY_BONUS: 6,
  INTERCHANGE_DWELL_MULT: 0.4,

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
    ['Alderney', 'AL'],
    ['Bramwell', 'BW'],
    ['Crestview', 'CV'],
    ['Dunmore', 'DM'],
    ['Elmhurst', 'EH'],
    ['Fernwood', 'FW'],
    ['Glenhollow', 'GL'],
    ['Kingsford', 'KF'],
  ],

  INDUSTRY_NAMES: {
    forest: ['Timber Camp', 'Pine Logging', 'Cedar Woods', 'Redwood Mill', 'Birchwood', 'Larch Grove'],
    mine: ['Iron Ridge', 'Coal Hollow', 'Copper Quarry', 'Granite Pit', 'Slate Vein', 'Oakhill Ore'],
    factory: ['Millworks', 'Valley Foundry', 'Steam Joinery', 'Ironworks', 'Brick Kiln', 'Steel Forge'],
  },

  MIN_HEADWAY: 52,
  SAFE_GAP: 36,
  OVERTAKE_TRIGGER_DIST: 64,
  OVERTAKE_OFFSET: 10,

  COLORS: {
    paper: '#F4F1EA',
    paperGrid: 'rgba(35, 38, 41, 0.035)',
    riverHalo: '#DFEAF0',
    river: '#99BFCF',
    riverBank: '#769AA9',
    hillFill: 'rgba(175, 163, 140, 0.14)',
    hillStroke: 'rgba(140, 128, 108, 0.28)',
    ink: '#232629',
    stationFill: '#FFFDF9',
    danger: '#D94E34',
    bridgeDeck: '#F4F1EA',
    tunnelPortal: '#3B3832',
  },
};

export const THEMES = {
  day: {
    bg: '#F4F1EA',
    river: '#99BFCF',
    riverHalo: '#DFEAF0',
    hillFill: 'rgba(175, 163, 140, 0.14)',
    hillStroke: 'rgba(140, 128, 108, 0.28)',
    mountainOuter: 'rgba(120, 113, 108, 0.22)',
    mountainInner: 'rgba(100, 94, 88, 0.32)',
    mountainPeak: 'rgba(87, 83, 78, 0.44)',
    mountainRidge: 'rgba(68, 64, 60, 0.62)',
    freightFrame: '#1E293B',
    ink: '#232629',
    stationFill: '#FFFDF9',
    muted: '#6E6A61',
    danger: '#D94E34',
    bridgeStroke: '#7A7468',
    bridgeDeck: '#F4F1EA',
    queueHalo: 'rgba(244, 241, 234, 0.92)',
    lineColors: ['#D94E34', '#2563EB', '#EAB308', '#16A34A', '#9333EA', '#0891B2'],
  },
  night: {
    bg: '#161A22',
    river: '#0D1117',
    riverHalo: '#1D2430',
    hillFill: 'rgba(255, 255, 255, 0.035)',
    hillStroke: 'rgba(255, 255, 255, 0.10)',
    mountainOuter: 'rgba(148, 163, 184, 0.08)',
    mountainInner: 'rgba(148, 163, 184, 0.14)',
    mountainPeak: 'rgba(203, 213, 225, 0.20)',
    mountainRidge: 'rgba(226, 232, 240, 0.38)',
    freightFrame: '#0F172A',
    ink: '#F1F5F9',
    stationFill: '#1E2430',
    muted: '#94A3B8',
    danger: '#F87171',
    bridgeStroke: '#64748B',
    bridgeDeck: '#161A22',
    queueHalo: 'rgba(22, 26, 34, 0.92)',
    lineColors: ['#FF5A3D', '#3B82F6', '#FACC15', '#22C55E', '#A855F7', '#06B6D4'],
  },
};

export function getThemePalette(state) {
  return THEMES[state?.theme === 'night' ? 'night' : 'day'];
}

export function getLineColor(state, lineId) {
  const pal = getThemePalette(state);
  const idx = Number.isFinite(lineId) ? Math.abs(Math.floor(lineId)) % pal.lineColors.length : 0;
  return pal.lineColors[idx];
}

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
    spine: null,
  }));

  return {
    seed,
    rng: mulberry32(seed),
    theme: 'day',

    // Timing & Speed
    simTime: 0,
    dayProgress: 0, // 0..1 within current day
    day: 1,
    week: 1,
    speed: 1, // 0, 1, 2
    savedSpeedBeforeModal: 1,
    phase: 'playing', // 'playing' | 'draft' | 'gameover'
    endlessMode: false,
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
    camera: {
      x: 0,
      y: 0,
      zoom: 1.0,
      targetX: 0,
      targetY: 0,
      targetZoom: 1.0,
      userControlled: false,
    },

    // Terrain
    mapArchetype: 'confluence', // 'confluence' | 'mountainPass' | 'lakeBay' | 'gorge'
    river: { points: [], halfWidth: 26 },
    rivers: [], // Array<{ points, halfWidth }>
    lakes: [], // Array<{ id, x, y, rx, ry, points, haloPoints }>
    mountains: [], // Array<{ id, x, y, rx, ry, angle, outerPoly, innerPoly, peakPoly, ridgeLine }>
    hills: [], // Array<{ id, x, y, rx, ry, angle, ringsPoly }>

    // Graph & Network
    stations: [],
    stationById: new Map(),
    pendingSpawns: [], // pre-generated future station schedule
    nextSpawnIndex: 0,
    spawnElapsed: 0,
    nextSpawnInterval: CONFIG.INITIAL_SPAWN_INTERVAL,
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
      tunnel: 2,
      interchange: 0,
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
      mode: 'idle', // 'idle' | 'buildLine' | 'detachStation' | 'insertNode' | 'dragToken' | 'dragTrain' | 'dragUpgrade' | 'pan'
      selectedTool: null, // optional click-to-place tool from dock
      hoveredStationId: null,
      hoveredCorridorKey: null,
      hoveredTrainId: null,
      hoveredTBar: null, // { lineId, end: 'start' | 'end', stationId }
      spotlightLineId: null,
      panStart: null,
      drag: null,
      hintText: '',
      hintTimer: 0,
      flashMessage: null, // { text, x, y, timer }
    },
  };
}

export function sampleTrainCarriagePose(train, backDistance) {
  if (!train) {
    return { x: 0, y: 0, angle: 0 };
  }
  if (Array.isArray(train.unitPoses) && train.unitPoses.length > 0) {
    const idx = Math.min(
      train.unitPoses.length - 1,
      Math.max(0, Math.round(backDistance / CONFIG.CAR_SPACING))
    );
    const pose = train.unitPoses[idx];
    return { x: pose.x, y: pose.y, angle: pose.angle };
  }
  const baseAngle = train.angle || 0;
  return {
    x: (train.x || 0) - Math.cos(baseAngle) * backDistance,
    y: (train.y || 0) - Math.sin(baseAngle) * backDistance,
    angle: baseAngle,
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

export function zoomCameraAtScreenPoint(state, screenX, screenY, zoomFactor) {
  const before = screenToWorld(state, screenX, screenY);
  const nextZoom = Math.max(
    CONFIG.MIN_ZOOM,
    Math.min(CONFIG.MAX_ZOOM, state.camera.zoom * zoomFactor)
  );
  state.camera.zoom = nextZoom;
  state.camera.targetZoom = nextZoom;

  const scale = getEffectiveScale(state);
  const newX = before.x - (screenX - state.viewport.width * 0.5) / scale;
  const newY = before.y - (screenY - state.viewport.height * 0.5) / scale;

  state.camera.x = Math.max(-1250, Math.min(1250, newX));
  state.camera.y = Math.max(-780, Math.min(780, newY));
  state.camera.targetX = state.camera.x;
  state.camera.targetY = state.camera.y;
  state.camera.userControlled = true;
}

export function panCameraByScreenDelta(state, dxScreen, dyScreen) {
  const scale = getEffectiveScale(state);
  state.camera.x = Math.max(-1250, Math.min(1250, state.camera.x - dxScreen / scale));
  state.camera.y = Math.max(-780, Math.min(780, state.camera.y - dyScreen / scale));
  state.camera.targetX = state.camera.x;
  state.camera.targetY = state.camera.y;
  state.camera.userControlled = true;
}

export function resetCameraToFit(state) {
  state.camera.userControlled = false;
  if (!state.stations || state.stations.length === 0) {
    state.camera.targetX = 0;
    state.camera.targetY = 0;
    state.camera.targetZoom = 1.0;
    return;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const st of state.stations) {
    if (st.x < minX) minX = st.x;
    if (st.x > maxX) maxX = st.x;
    if (st.y < minY) minY = st.y;
    if (st.y > maxY) maxY = st.y;
  }
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const halfW = Math.max(430, (maxX - minX) * 0.5 + 140);
  const halfH = Math.max(260, (maxY - minY) * 0.5 + 120);
  const zoomX = (CONFIG.BASE_VIEW_WIDTH * 0.46) / halfW;
  const zoomY = (CONFIG.BASE_VIEW_HEIGHT * 0.44) / halfH;

  state.camera.targetX = cx;
  state.camera.targetY = cy;
  state.camera.targetZoom = Math.max(CONFIG.MIN_ZOOM, Math.min(1.0, zoomX, zoomY));
}

export function showHint(state, text, duration = 2.2) {
  state.interaction.hintText = text;
  state.interaction.hintTimer = duration;
}

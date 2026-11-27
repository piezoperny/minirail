import { CONFIG, edgeKey, orderedPair } from './state.js';
import { spawnPuff, spawnTokenHop, spawnFloatingToast, spawnWarningPulse } from './fx.js';
import {
  buildLineSpine,
  buildOctilinearPoints,
  computeHillIntervals,
  computePolylineLengths,
  computeRiverIntervals,
  computeStationQueueAngle,
  computeTrainUnitPoses,
  countRiverCrossings,
  samplePointAlongPolyline,
  spawnNextStation,
} from './mapGen.js';

function markLineSpineDirty(line) {
  if (line) line.spine = null;
}

function ensureLineSpine(state, line) {
  if (!line || !Array.isArray(line.stations) || line.stations.length < 2) {
    if (line) line.spine = null;
    return null;
  }
  const expectedStations = line.stations.length;
  const isLoop = !!line.isLoop;
  if (
    !line.spine ||
    !Array.isArray(line.spine.points) ||
    line.spine.points.length < 2 ||
    !Array.isArray(line.spine.stationU) ||
    line.spine.stationU.length !== expectedStations ||
    !!line.spine.isLoop !== isLoop
  ) {
    line.spine = buildLineSpine(state, line);
  }
  return line.spine;
}

function collectUsedAnglesAtStation(state, stationId) {
  const angles = [];
  if (!state?.corridors) return angles;
  for (const corr of state.corridors.values()) {
    if (!corr || !Array.isArray(corr.points) || corr.points.length < 2) continue;
    if (corr.aId === stationId) {
      angles.push(Math.atan2(corr.points[1].y - corr.points[0].y, corr.points[1].x - corr.points[0].x));
    } else if (corr.bId === stationId) {
      const n = corr.points.length;
      angles.push(
        Math.atan2(corr.points[n - 2].y - corr.points[n - 1].y, corr.points[n - 2].x - corr.points[n - 1].x)
      );
    }
  }
  return angles;
}

function buildCorridorContext(state, aId, bId) {
  return {
    stations: state.stations || [],
    usedAnglesAtA: collectUsedAnglesAtStation(state, aId),
    usedAnglesAtB: collectUsedAnglesAtStation(state, bId),
  };
}

function createToken(state, kind, extra = {}) {
  const service = kind === 'raw' || kind === 'goods' ? 'freight' : 'express';
  return {
    id: state.nextTokenId++,
    kind,
    service,
    targetCityId: extra.targetCityId ?? null,
    cityCode: extra.cityCode ?? null,
    crestColor: extra.crestColor ?? null,
    spawnedAt: state.simTime || 0,
  };
}

export function initStarterLine(state) {
  const starterIds = state.onboarding?.starterIds;
  if (!starterIds) return;
  const { townId, cityId } = starterIds;
  const townSt = state.stationById.get(townId);
  const citySt = state.stationById.get(cityId);
  if (!townSt || !citySt) return;

  const line = state.lines[0];
  if (!line || line.stations.length > 0) return;

  const check = canAddCorridorForLine(state, townId, cityId);
  if (!check.ok) return;

  line.stations = [townId, cityId];
  line.isLoop = false;
  activateCorridorForLine(state, line, townId, cityId);

  if (state.inventory.express > 0) {
    deployTrainOnLine(state, 'express', 0, townId);
  }

  // Seed initial passengers so trains board and move immediately on load
  townSt.queue.push(createToken(state, 'commuter'), createToken(state, 'commuter'));
  citySt.queue.push(createToken(state, 'local'));
}

export function getOrCreateCorridor(state, id1, id2) {
  const [aId, bId] = orderedPair(id1, id2);
  const key = edgeKey(aId, bId);
  if (state.corridors.has(key)) {
    return state.corridors.get(key);
  }
  const stA = state.stationById.get(aId);
  const stB = state.stationById.get(bId);
  const context = buildCorridorContext(state, aId, bId);
  const points = buildOctilinearPoints(stA.x, stA.y, stB.x, stB.y, state.river, state.hills, context);
  const { cumLengths, totalLength } = computePolylineLengths(points);
  const riverCrossings = countRiverCrossings(points, state.river);
  const riverIntervals = computeRiverIntervals(points, cumLengths, totalLength, state.river);
  const hillIntervals = computeHillIntervals(points, cumLengths, totalLength, state.hills);

  const corridor = {
    key,
    aId,
    bId,
    points,
    cumLengths,
    totalLength,
    riverCrossings,
    riverIntervals,
    hasBridge: false,
    hillIntervals,
    hasTunnel: false,
    isDoubleTrack: false,
    activeLineIds: new Set(),
    trains: [],
    lockedDirection: null,
    waitingAtoB: [],
    waitingBtoA: [],
    lastServedDir: null,
  };
  state.corridors.set(key, corridor);
  if (stA) stA.queueAngle = computeStationQueueAngle(state, stA);
  if (stB) stB.queueAngle = computeStationQueueAngle(state, stB);
  return corridor;
}

export function getLineEdges(line) {
  const edges = [];
  const n = line.stations.length;
  if (n < 2) return edges;
  for (let i = 0; i < n - 1; i++) {
    edges.push([line.stations[i], line.stations[i + 1]]);
  }
  if (line.isLoop && n >= 3) {
    edges.push([line.stations[n - 1], line.stations[0]]);
  }
  return edges;
}

export function lineHasEdge(line, id1, id2) {
  const target = edgeKey(id1, id2);
  for (const [u, v] of getLineEdges(line)) {
    if (edgeKey(u, v) === target) return true;
  }
  return false;
}

export function canAddCorridorForLine(state, id1, id2) {
  if (id1 === id2) return { ok: false, reason: 'Same station' };
  const key = edgeKey(id1, id2);
  const existing = state.corridors.get(key);
  if (existing) {
    if (existing.riverCrossings > 0 && !existing.hasBridge && state.inventory.bridge <= 0) {
      return { ok: false, reason: 'No Bridges left!' };
    }
    return { ok: true };
  }
  const [aId, bId] = orderedPair(id1, id2);
  const stA = state.stationById.get(aId);
  const stB = state.stationById.get(bId);
  if (!stA || !stB) return { ok: false, reason: 'Station not found' };
  const context = buildCorridorContext(state, aId, bId);
  const pts = buildOctilinearPoints(stA.x, stA.y, stB.x, stB.y, state.river, state.hills, context);
  const crossings = countRiverCrossings(pts, state.river);
  if (crossings > 0 && state.inventory.bridge <= 0) {
    return { ok: false, reason: 'No Bridges left!' };
  }
  return { ok: true };
}

function activateCorridorForLine(state, line, id1, id2) {
  const corridor = getOrCreateCorridor(state, id1, id2);
  if (corridor.riverCrossings > 0 && !corridor.hasBridge) {
    if (state.inventory.bridge <= 0) return false;
    state.inventory.bridge -= 1;
    corridor.hasBridge = true;
  }
  corridor.activeLineIds.add(line.id);
  line.removingEdges.delete(corridor.key);
  markLineSpineDirty(line);
  return true;
}

function releaseCorridorIfUnused(state, corridor) {
  if (!corridor) return;
  if (corridor.activeLineIds.size === 0 && corridor.trains.length === 0) {
    if (corridor.hasBridge) {
      state.inventory.bridge += 1;
      corridor.hasBridge = false;
    }
    if (corridor.hasTunnel) {
      state.inventory.tunnel += 1;
      corridor.hasTunnel = false;
    }
    if (corridor.isDoubleTrack) {
      state.inventory.doubleTrack += 1;
      corridor.isDoubleTrack = false;
    }
    state.corridors.delete(corridor.key);
    const stA = state.stationById.get(corridor.aId);
    const stB = state.stationById.get(corridor.bId);
    if (stA) stA.queueAngle = computeStationQueueAngle(state, stA);
    if (stB) stB.queueAngle = computeStationQueueAngle(state, stB);
  }
}

function deactivateLineEdge(state, line, id1, id2) {
  const key = edgeKey(id1, id2);
  const corridor = state.corridors.get(key);
  if (!corridor) return;
  const hasActiveTrainOnLine = corridor.trains.some((t) => t.lineId === line.id);
  if (hasActiveTrainOnLine) {
    line.removingEdges.add(key);
  } else {
    corridor.activeLineIds.delete(line.id);
    line.removingEdges.delete(key);
    releaseCorridorIfUnused(state, corridor);
  }
}

function checkFreightOnboarding(state, stationId) {
  const st = state.stationById.get(stationId);
  if (st && (st.kind === 'resource' || st.kind === 'factory')) {
    if (state.onboarding) state.onboarding.freightLineBuilt = true;
  }
}

export function extendOrStartLine(state, lineId, fromId, toId) {
  if (fromId === toId) return { ok: false, reason: 'Cannot connect station to itself' };
  const line = state.lines[lineId];
  if (!line || lineId >= state.unlockedLines) return { ok: false, reason: 'Line locked' };

  if (line.stations.length === 0) {
    const check = canAddCorridorForLine(state, fromId, toId);
    if (!check.ok) return check;
    line.stations = [fromId, toId];
    line.isLoop = false;
    activateCorridorForLine(state, line, fromId, toId);

    const fromSt = state.stationById.get(fromId);
    const toSt = state.stationById.get(toId);
    const isFreightPair =
      (fromSt && (fromSt.kind === 'resource' || fromSt.kind === 'factory')) ||
      (toSt && (toSt.kind === 'resource' || toSt.kind === 'factory'));
    if (isFreightPair && state.onboarding) {
      state.onboarding.freightLineBuilt = true;
    }

    const preferred = isFreightPair ? 'freight' : 'express';
    if (state.inventory[preferred] > 0) {
      const deployed = deployTrainOnLine(state, preferred, lineId, fromId);
      if (deployed.ok && fromSt && toSt) {
        spawnFloatingToast(
          state,
          (fromSt.x + toSt.x) * 0.5,
          (fromSt.y + toSt.y) * 0.5 - 10,
          preferred === 'freight' ? 'Freight Dispatched!' : 'Express Dispatched!',
          line.color
        );
      }
    }

    return { ok: true };
  }

  const firstId = line.stations[0];
  const lastId = line.stations[line.stations.length - 1];

  if (fromId === lastId && !line.isLoop) {
    if (line.stations.length >= 2 && toId === line.stations[line.stations.length - 2]) {
      return trimLineEnd(state, lineId, 'end');
    }
    if (lineHasEdge(line, lastId, toId)) return { ok: false, reason: 'Segment already on line' };
    if (toId === firstId && line.stations.length >= 3) {
      const check = canAddCorridorForLine(state, lastId, firstId);
      if (!check.ok) return check;
      line.isLoop = true;
      activateCorridorForLine(state, line, lastId, firstId);
      return { ok: true };
    }
    if (line.stations.includes(toId)) {
      return { ok: false, reason: 'Line cannot cross itself' };
    }
    const check = canAddCorridorForLine(state, lastId, toId);
    if (!check.ok) return check;
    line.stations.push(toId);
    checkFreightOnboarding(state, toId);
    activateCorridorForLine(state, line, lastId, toId);
    return { ok: true };
  }

  if (fromId === firstId && !line.isLoop) {
    if (line.stations.length >= 2 && toId === line.stations[1]) {
      return trimLineEnd(state, lineId, 'start');
    }
    if (lineHasEdge(line, firstId, toId)) return { ok: false, reason: 'Segment already on line' };
    if (toId === lastId && line.stations.length >= 3) {
      const check = canAddCorridorForLine(state, lastId, firstId);
      if (!check.ok) return check;
      line.isLoop = true;
      activateCorridorForLine(state, line, lastId, firstId);
      return { ok: true };
    }
    if (line.stations.includes(toId)) {
      return { ok: false, reason: 'Line cannot cross itself' };
    }
    const check = canAddCorridorForLine(state, firstId, toId);
    if (!check.ok) return check;
    line.stations.unshift(toId);
    checkFreightOnboarding(state, toId);
    // Shift train station indices on this line by +1
    for (const tr of state.trains) {
      if (tr.lineId === lineId) tr.stationIndex += 1;
    }
    activateCorridorForLine(state, line, firstId, toId);
    return { ok: true };
  }

  return { ok: false, reason: 'Drag from a line end or station' };
}

export function insertStationIntoLine(state, lineId, segAId, segBId, newStationId) {
  const line = state.lines[lineId];
  if (!line || line.stations.length < 2) return { ok: false };
  if (newStationId === segAId || newStationId === segBId) return { ok: false };
  if (line.stations.includes(newStationId)) {
    return { ok: false, reason: 'Station already on this line' };
  }

  const check1 = canAddCorridorForLine(state, segAId, newStationId);
  if (!check1.ok) return check1;
  const check2 = canAddCorridorForLine(state, newStationId, segBId);
  if (!check2.ok) return check2;

  const idxA = line.stations.indexOf(segAId);
  const idxB = line.stations.indexOf(segBId);
  const n = line.stations.length;

  let insertPos = -1;
  if (idxB === idxA + 1) insertPos = idxB;
  else if (idxA === idxB + 1) insertPos = idxA;
  else if (line.isLoop && ((idxA === n - 1 && idxB === 0) || (idxB === n - 1 && idxA === 0))) {
    insertPos = n;
  }

  if (insertPos === -1) return { ok: false };

  line.stations.splice(insertPos, 0, newStationId);
  for (const tr of state.trains) {
    if (tr.lineId === lineId && tr.stationIndex >= insertPos) {
      tr.stationIndex += 1;
    }
  }
  deactivateLineEdge(state, line, segAId, segBId);
  activateCorridorForLine(state, line, segAId, newStationId);
  activateCorridorForLine(state, line, newStationId, segBId);
  markLineSpineDirty(line);
  for (const tr of state.trains) {
    if (tr.lineId === lineId) updateTrainSpinePoses(state, tr);
  }
  return { ok: true };
}

function reconcileTrainsAfterLineShrink(state, lineId) {
  const line = state.lines[lineId];
  if (!line) return;
  if (line.stations.length >= 2) {
    for (const tr of state.trains) {
      if (tr.lineId === lineId) {
        if (tr.state !== 'traversing') {
          tr.stationIndex = Math.max(0, Math.min(line.stations.length - 1, tr.stationIndex));
        }
        updateTrainSpinePoses(state, tr);
      }
    }
    return;
  }
  // Line has < 2 stations: reclaim any trains not currently mid-corridor (mid-corridor trains reclaim on arrival)
  for (let i = state.trains.length - 1; i >= 0; i--) {
    const tr = state.trains[i];
    if (tr.lineId === lineId && tr.state !== 'traversing') {
      reclaimTrainToInventory(state, tr.id);
    }
  }
}

export function trimLineEnd(state, lineId, endSide) {
  const line = state.lines[lineId];
  if (!line || line.stations.length < 2) return { ok: false };

  if (line.isLoop) {
    const firstId = line.stations[0];
    const lastId = line.stations[line.stations.length - 1];
    line.isLoop = false;
    markLineSpineDirty(line);
    deactivateLineEdge(state, line, lastId, firstId);
    reconcileTrainsAfterLineShrink(state, lineId);
    return { ok: true };
  }

  if (line.stations.length === 2) {
    const [a, b] = line.stations;
    line.stations = [];
    markLineSpineDirty(line);
    deactivateLineEdge(state, line, a, b);
    reconcileTrainsAfterLineShrink(state, lineId);
    return { ok: true };
  }

  if (endSide === 'end') {
    const b = line.stations.pop();
    const a = line.stations[line.stations.length - 1];
    markLineSpineDirty(line);
    deactivateLineEdge(state, line, a, b);
  } else {
    const a = line.stations.shift();
    const b = line.stations[0];
    for (const tr of state.trains) {
      if (tr.lineId === lineId && tr.stationIndex > 0) tr.stationIndex -= 1;
    }
    markLineSpineDirty(line);
    deactivateLineEdge(state, line, a, b);
  }
  reconcileTrainsAfterLineShrink(state, lineId);
  return { ok: true };
}

export function removeStationFromLine(state, lineId, stationId) {
  const line = state.lines[lineId];
  if (!line) return { ok: false, reason: 'Line not found' };
  const idx = line.stations.indexOf(stationId);
  if (idx === -1) return { ok: false, reason: 'Station not on line' };

  const n = line.stations.length;
  if (!line.isLoop && n <= 2) {
    return clearLine(state, lineId);
  }

  if (line.isLoop) {
    const prevId = line.stations[(idx - 1 + n) % n];
    const nextId = line.stations[(idx + 1) % n];
    if (n === 3) {
      line.stations.splice(idx, 1);
      line.isLoop = false;
      for (const tr of state.trains) {
        if (tr.lineId === lineId && tr.state !== 'traversing') {
          if (tr.stationIndex > idx) tr.stationIndex -= 1;
          tr.stationIndex = Math.max(0, Math.min(line.stations.length - 1, tr.stationIndex));
        }
      }
      markLineSpineDirty(line);
      deactivateLineEdge(state, line, prevId, stationId);
      deactivateLineEdge(state, line, stationId, nextId);
      reconcileTrainsAfterLineShrink(state, lineId);
      return { ok: true };
    }

    const check = canAddCorridorForLine(state, prevId, nextId);
    if (!check.ok) return check;

    line.stations.splice(idx, 1);
    for (const tr of state.trains) {
      if (tr.lineId === lineId && tr.state !== 'traversing') {
        if (tr.stationIndex > idx) tr.stationIndex -= 1;
        tr.stationIndex = Math.max(0, Math.min(line.stations.length - 1, tr.stationIndex));
      }
    }
    markLineSpineDirty(line);
    deactivateLineEdge(state, line, prevId, stationId);
    deactivateLineEdge(state, line, stationId, nextId);
    activateCorridorForLine(state, line, prevId, nextId);
    reconcileTrainsAfterLineShrink(state, lineId);
    return { ok: true };
  }

  if (idx === 0) return trimLineEnd(state, lineId, 'start');
  if (idx === n - 1) return trimLineEnd(state, lineId, 'end');

  const prevId = line.stations[idx - 1];
  const nextId = line.stations[idx + 1];
  const check = canAddCorridorForLine(state, prevId, nextId);
  if (!check.ok) return check;

  line.stations.splice(idx, 1);
  for (const tr of state.trains) {
    if (tr.lineId === lineId && tr.state !== 'traversing') {
      if (tr.stationIndex > idx) tr.stationIndex -= 1;
      tr.stationIndex = Math.max(0, Math.min(line.stations.length - 1, tr.stationIndex));
    }
  }
  markLineSpineDirty(line);
  deactivateLineEdge(state, line, prevId, stationId);
  deactivateLineEdge(state, line, stationId, nextId);
  activateCorridorForLine(state, line, prevId, nextId);
  reconcileTrainsAfterLineShrink(state, lineId);
  return { ok: true };
}

export function clearLine(state, lineId) {
  const line = state.lines[lineId];
  if (!line) return { ok: false, reason: 'Line not found' };

  for (let i = state.trains.length - 1; i >= 0; i--) {
    if (state.trains[i].lineId === lineId) {
      reclaimTrainToInventory(state, state.trains[i].id);
    }
  }

  const edges = getLineEdges(line);
  line.stations = [];
  line.isLoop = false;
  line.removingEdges.clear();
  markLineSpineDirty(line);

  for (const [u, v] of edges) {
    deactivateLineEdge(state, line, u, v);
  }
  return { ok: true };
}

export function removeSegmentFromLine(state, lineId, id1, id2) {
  const line = state.lines[lineId];
  if (!line || line.stations.length < 2) return { ok: false };
  const n = line.stations.length;
  const idx1 = line.stations.indexOf(id1);
  const idx2 = line.stations.indexOf(id2);
  if (idx1 === -1 || idx2 === -1) return { ok: false, reason: 'Segment not on line' };

  if (line.isLoop) {
    const isClosing = (idx1 === n - 1 && idx2 === 0) || (idx2 === n - 1 && idx1 === 0);
    if (!isClosing && Math.abs(idx1 - idx2) !== 1) {
      return { ok: false, reason: 'Segment not on line' };
    }
    if (isClosing) {
      line.isLoop = false;
      markLineSpineDirty(line);
      deactivateLineEdge(state, line, id1, id2);
      reconcileTrainsAfterLineShrink(state, lineId);
      return { ok: true };
    }
    const cutAfter = (idx1 + 1) % n === idx2 ? idx1 : idx2;
    line.stations = [
      ...line.stations.slice(cutAfter + 1),
      ...line.stations.slice(0, cutAfter + 1),
    ];
    line.isLoop = false;
    markLineSpineDirty(line);
    deactivateLineEdge(state, line, id1, id2);
    reconcileTrainsAfterLineShrink(state, lineId);
    return { ok: true };
  }

  if (Math.abs(idx1 - idx2) !== 1) {
    return { ok: false, reason: 'Segment not on line' };
  }

  const idx = Math.min(idx1, idx2);
  if (n === 2 || idx === n - 2) {
    return trimLineEnd(state, lineId, 'end');
  }
  if (idx === 0) {
    return trimLineEnd(state, lineId, 'start');
  }

  // Interior segment: bypass the station closer to an endpoint so we don't wipe half a chain
  const targetIdx = idx <= (n - 2) / 2 ? idx : idx + 1;
  const bypassRes = removeStationFromLine(state, lineId, line.stations[targetIdx]);
  if (bypassRes.ok) {
    return bypassRes;
  }

  // Fallback if bypass cannot cross a river without a bridge: detach shorter end cleanly
  if (idx + 1 <= n / 2) {
    const trims = idx + 1;
    for (let t = 0; t < trims && line.stations.length >= 2; t++) {
      trimLineEnd(state, lineId, 'start');
    }
  } else {
    const trims = n - (idx + 1);
    for (let t = 0; t < trims && line.stations.length >= 2; t++) {
      trimLineEnd(state, lineId, 'end');
    }
  }
  return { ok: true };
}

// ---------- Fleet & Upgrade Helpers ----------

function updateTrainSpinePoses(state, tr) {
  const line = state.lines[tr.lineId];
  const spine = ensureLineSpine(state, line);
  const unitCount = 1 + (tr.cars ?? CONFIG.TRAIN_DEFAULT_CARS);
  if (!spine || spine.points.length < 2 || spine.totalLength <= 0) {
    const st =
      line && line.stations.length > 0
        ? state.stationById.get(
            line.stations[Math.max(0, Math.min(line.stations.length - 1, tr.stationIndex))]
          )
        : null;
    const x = st ? st.x : tr.x || 0;
    const y = st ? st.y : tr.y || 0;
    const angle = tr.angle || 0;
    tr.consistStartU = 0;
    tr.spineTotalLength = 0;
    tr.unitPoses = Array.from({ length: unitCount }, (_, i) => ({
      x: x - Math.cos(angle) * i * CONFIG.CAR_SPACING,
      y: y - Math.sin(angle) * i * CONFIG.CAR_SPACING,
      angle,
    }));
    tr.x = tr.unitPoses[0].x;
    tr.y = tr.unitPoses[0].y;
    tr.angle = tr.unitPoses[0].angle;
    return;
  }

  const total = spine.totalLength;
  const span = (unitCount - 1) * CONFIG.CAR_SPACING;
  const maxStartU = Math.max(0, total - span);
  const clampOrWrap = (u) => {
    if (spine.isLoop) {
      return ((u % total) + total) % total;
    }
    return Math.max(0, Math.min(maxStartU, u));
  };

  let consistStartU = 0;
  if (tr.state === 'traversing' && tr.corridorKey) {
    const corridor = state.corridors.get(tr.corridorKey);
    const fromIdx = line.stations.indexOf(tr.fromStationId);
    const toIdx = line.stations.indexOf(tr.toStationId);
    if (corridor && fromIdx >= 0 && toIdx >= 0) {
      const uFrom = spine.stationU[fromIdx] ?? 0;
      const uTo = spine.stationU[toIdx] ?? 0;
      const frac =
        corridor.totalLength > 0 ? Math.max(0, Math.min(1, tr.s / corridor.totalLength)) : 0;
      if (spine.isLoop) {
        const deltaU =
          tr.direction >= 0
            ? uTo >= uFrom
              ? uTo - uFrom
              : total - uFrom + uTo
            : -(uFrom >= uTo ? uFrom - uTo : total - uTo + uFrom);
        consistStartU = clampOrWrap(uFrom - span * 0.5 + deltaU * frac);
      } else {
        const startU = clampOrWrap(uFrom - span * 0.5);
        const endU = clampOrWrap(uTo - span * 0.5);
        consistStartU = startU + (endU - startU) * frac;
      }
    } else {
      const idx = Math.max(0, Math.min(line.stations.length - 1, tr.stationIndex));
      const stU = spine.stationU[idx] ?? 0;
      consistStartU = clampOrWrap(stU - span * 0.5);
    }
  } else {
    const idx = Math.max(0, Math.min(line.stations.length - 1, tr.stationIndex));
    const stU = spine.stationU[idx] ?? 0;
    consistStartU = clampOrWrap(stU - span * 0.5);
  }

  tr.consistStartU = consistStartU;
  tr.spineTotalLength = total;
  tr.unitPoses = computeTrainUnitPoses(
    spine,
    consistStartU,
    unitCount,
    tr.direction,
    tr.lateralOffset || 0
  );
  tr.x = tr.unitPoses[0].x;
  tr.y = tr.unitPoses[0].y;
  tr.angle = tr.unitPoses[0].angle;
}

function computeInitialTrainAngle(state, line, stationIndex, direction) {
  const next = getNextStop(line, stationIndex, direction);
  const fromId = line.stations[stationIndex];
  const st = state.stationById.get(fromId);
  if (!next || !st) return 0;
  const toId = line.stations[next.nextIndex];
  const corridor = state.corridors.get(edgeKey(fromId, toId));
  if (corridor && corridor.points.length >= 2) {
    const dir = fromId === corridor.aId ? 'AtoB' : 'BtoA';
    const arcS = dir === 'AtoB' ? 0 : corridor.totalLength;
    const pt = samplePointAlongPolyline(corridor.points, corridor.cumLengths, arcS);
    const sign = dir === 'AtoB' ? 1 : -1;
    return Math.atan2(pt.ty * sign, pt.tx * sign);
  }
  const nextSt = state.stationById.get(toId);
  if (!nextSt) return 0;
  return Math.atan2(nextSt.y - st.y, nextSt.x - st.x);
}

export function deployTrainOnLine(state, type, lineId, stationId = null) {
  const line = state.lines[lineId];
  if (!line || line.stations.length < 2) return { ok: false, reason: 'Line needs 2+ stations' };
  if (state.inventory[type] <= 0) return { ok: false, reason: `No ${type} trains available` };

  state.inventory[type] -= 1;
  let stationIndex = 0;
  if (stationId !== null) {
    const found = line.stations.indexOf(stationId);
    if (found >= 0) stationIndex = found;
  }
  const st = state.stationById.get(line.stations[stationIndex]);
  const direction = stationIndex === line.stations.length - 1 ? -1 : 1;
  const angle = computeInitialTrainAngle(state, line, stationIndex, direction);
  const dwellMult = st?.isInterchange ? CONFIG.INTERCHANGE_DWELL_MULT : 1;
  const train = {
    id: state.nextTrainId++,
    type,
    lineId,
    cars: CONFIG.TRAIN_DEFAULT_CARS,
    cargo: [],
    state: 'atStation',
    stationIndex,
    direction,
    dwellTimer: 0.25 * dwellMult,
    exchangedAtStop: false,
    corridorKey: null,
    corridorDir: 'AtoB',
    fromStationId: null,
    toStationId: null,
    s: 0,
    currentSpeed: 0,
    consistStartU: 0,
    spineTotalLength: 0,
    unitPoses: [],
    exhaustTimer: 0,
    lane: 0,
    lateralOffset: 0,
    x: st.x,
    y: st.y,
    angle,
  };
  updateTrainSpinePoses(state, train);
  state.trains.push(train);
  return { ok: true, train };
}

export function attachCarToTrain(state, trainId) {
  if (state.inventory.car <= 0) return { ok: false, reason: 'No Extra Carriages' };
  const tr = state.trains.find((t) => t.id === trainId);
  if (!tr) return { ok: false };
  if (tr.cars >= CONFIG.MAX_CARS_PER_TRAIN) {
    return { ok: false, reason: `Max ${CONFIG.MAX_CARS_PER_TRAIN} carriages per train` };
  }
  state.inventory.car -= 1;
  tr.cars += 1;
  updateTrainSpinePoses(state, tr);
  return { ok: true };
}

export function reclaimTrainToInventory(state, trainId) {
  const idx = state.trains.findIndex((t) => t.id === trainId);
  if (idx === -1) return false;
  const tr = state.trains[idx];
  removeTrainFromCorridorQueues(state, tr);
  if (tr.corridorKey) {
    const corr = state.corridors.get(tr.corridorKey);
    if (corr) {
      corr.trains = corr.trains.filter((t) => t.id !== tr.id);
      if (corr.trains.length === 0) corr.lockedDirection = null;
      releaseCorridorIfUnused(state, corr);
    }
  }
  state.inventory[tr.type] += 1;
  state.inventory.car += Math.max(0, tr.cars - CONFIG.TRAIN_DEFAULT_CARS);
  state.trains.splice(idx, 1);
  return true;
}

export function moveTrainToLine(state, trainId, targetLineId, stationId = null) {
  const tr = state.trains.find((t) => t.id === trainId);
  const line = state.lines[targetLineId];
  if (!tr || !line || line.stations.length < 2) return { ok: false };
  removeTrainFromCorridorQueues(state, tr);
  if (tr.corridorKey) {
    const corr = state.corridors.get(tr.corridorKey);
    if (corr) {
      corr.trains = corr.trains.filter((t) => t.id !== tr.id);
      if (corr.trains.length === 0) corr.lockedDirection = null;
    }
  }
  tr.lineId = targetLineId;
  tr.corridorKey = null;
  tr.state = 'atStation';
  tr.exchangedAtStop = false;
  tr.lane = 0;
  tr.lateralOffset = 0;
  tr.currentSpeed = 0;
  let sIdx = 0;
  if (stationId !== null) {
    const found = line.stations.indexOf(stationId);
    if (found >= 0) sIdx = found;
  }
  tr.stationIndex = sIdx;
  tr.direction = sIdx === line.stations.length - 1 ? -1 : 1;
  const st = state.stationById.get(line.stations[sIdx]);
  const dwellMult = st?.isInterchange ? CONFIG.INTERCHANGE_DWELL_MULT : 1;
  tr.dwellTimer = 0.25 * dwellMult;
  const angle = computeInitialTrainAngle(state, line, sIdx, tr.direction);
  tr.x = st.x;
  tr.y = st.y;
  tr.angle = angle;
  updateTrainSpinePoses(state, tr);
  return { ok: true };
}

export function applyStationUpgrade(state, stationId, upgradeType) {
  const st = state.stationById.get(stationId);
  if (!st) return { ok: false, reason: 'Station not found' };

  if (upgradeType === 'interchange') {
    if (st.isInterchange) return { ok: false, reason: 'Already an Interchange' };
    if ((state.inventory.interchange ?? 0) <= 0) {
      return { ok: false, reason: 'No Interchange hubs left' };
    }
    state.inventory.interchange -= 1;
    st.isInterchange = true;
    st.capacity += CONFIG.INTERCHANGE_CAPACITY_BONUS;
    st.pulse = 1.0;
    spawnFloatingToast(
      state,
      st.x,
      st.y - 16,
      `${st.name} Interchange (+${CONFIG.INTERCHANGE_CAPACITY_BONUS} cap)`,
      '#2563EB'
    );
    return { ok: true };
  }

  return { ok: false, reason: 'Unknown station upgrade' };
}

export function applyCorridorUpgrade(state, corridorKey, upgradeType) {
  const corridor = state.corridors.get(corridorKey);
  if (!corridor || corridor.activeLineIds.size === 0) return { ok: false };

  if (upgradeType === 'doubleTrack') {
    if (corridor.isDoubleTrack) return { ok: false, reason: 'Already Double-Track' };
    if (state.inventory.doubleTrack <= 0) return { ok: false, reason: 'No Double-Track kits' };
    state.inventory.doubleTrack -= 1;
    corridor.isDoubleTrack = true;
    corridor.lockedDirection = null;
    return { ok: true };
  }

  if (upgradeType === 'tunnel') {
    if (corridor.hasTunnel) return { ok: false, reason: 'Already has Tunnel' };
    if (corridor.hillIntervals.length === 0) return { ok: false, reason: 'No hill on segment' };
    if (state.inventory.tunnel <= 0) return { ok: false, reason: 'No Tunnels left' };
    state.inventory.tunnel -= 1;
    corridor.hasTunnel = true;
    return { ok: true };
  }

  return { ok: false };
}

export function reclaimCorridorUpgrade(state, corridorKey, upgradeType) {
  const corridor = state.corridors.get(corridorKey);
  if (!corridor) return { ok: false };

  if (upgradeType === 'doubleTrack' && corridor.isDoubleTrack) {
    const hasOpposing =
      corridor.trains.some((t) => t.corridorDir === 'AtoB') &&
      corridor.trains.some((t) => t.corridorDir === 'BtoA');
    const hasOvertaking = corridor.trains.some((t) => t.lane === 1);
    if (hasOpposing || hasOvertaking) {
      return { ok: false, reason: 'Wait for trains to clear corridor' };
    }
    corridor.isDoubleTrack = false;
    state.inventory.doubleTrack += 1;
    if (corridor.trains.length > 0) {
      corridor.lockedDirection = corridor.trains[0].corridorDir;
    }
    return { ok: true };
  }

  if (upgradeType === 'tunnel' && corridor.hasTunnel) {
    corridor.hasTunnel = false;
    state.inventory.tunnel += 1;
    return { ok: true };
  }

  return { ok: false };
}

// ---------- Train Movement & Block Signaling ----------

function removeTrainFromCorridorQueues(state, train) {
  for (const corr of state.corridors.values()) {
    corr.waitingAtoB = corr.waitingAtoB.filter((id) => id !== train.id);
    corr.waitingBtoA = corr.waitingBtoA.filter((id) => id !== train.id);
  }
}

function getNextStop(line, stationIndex, direction) {
  const n = line.stations.length;
  if (n < 2) return null;
  if (line.isLoop) {
    const nextIdx = (stationIndex + direction + n) % n;
    return { nextIndex: nextIdx, nextDirection: direction };
  }
  let nextIdx = stationIndex + direction;
  let nextDir = direction;
  if (nextIdx >= n) {
    nextDir = -1;
    nextIdx = n - 2;
  } else if (nextIdx < 0) {
    nextDir = 1;
    nextIdx = 1;
  }
  return { nextIndex: nextIdx, nextDirection: nextDir };
}

function canEnterCorridor(corridor, train, dir) {
  const myQueue = dir === 'AtoB' ? corridor.waitingAtoB : corridor.waitingBtoA;
  const oppQueue = dir === 'AtoB' ? corridor.waitingBtoA : corridor.waitingAtoB;

  if (corridor.isDoubleTrack) {
    // Dedicated directional lane: only check headway against same-dir trains on lane 0
    for (const other of corridor.trains) {
      if (other.corridorDir === dir && other.lane === 0 && other.s < CONFIG.MIN_HEADWAY) {
        return false;
      }
    }
    return true;
  }

  // Single-track block logic
  if (corridor.lockedDirection === null) {
    // Yield if opposing train is waiting and we just served this direction
    if (oppQueue.length > 0 && corridor.lastServedDir === dir) {
      if (!myQueue.includes(train.id)) myQueue.push(train.id);
      return false;
    }
    return true;
  }

  if (corridor.lockedDirection === dir) {
    // Fair turn alternation: don't barge in if opposing train is waiting
    if (oppQueue.length > 0) {
      if (!myQueue.includes(train.id)) myQueue.push(train.id);
      return false;
    }
    for (const other of corridor.trains) {
      if (other.corridorDir === dir && other.s < CONFIG.MIN_HEADWAY) {
        return false;
      }
    }
    return true;
  }

  // Locked by opposing direction
  if (!myQueue.includes(train.id)) myQueue.push(train.id);
  return false;
}

function isArcPosInHill(corridor, arcS) {
  for (const iv of corridor.hillIntervals) {
    if (arcS >= iv.start && arcS <= iv.end) return true;
  }
  return false;
}

// ---------- Demand, BFS Routing & Station Overflow ----------

function getTrainCapacity(train) {
  return train.cars * CONFIG.CAR_CAPACITY;
}

function tokenMatchesStation(tok, st, forRouting = false) {
  if (!tok || !st) return false;
  switch (tok.kind) {
    case 'commuter':
      return st.kind === 'settlement' && st.tier === 3;
    case 'local':
      return st.kind === 'settlement' && st.tier < 3;
    case 'intercity':
      return st.kind === 'settlement' && st.id === tok.targetCityId;
    case 'raw':
      if (st.kind !== 'factory') return false;
      return forRouting ? true : st.inputBuffer < CONFIG.FACTORY_INPUT_MAX;
    case 'goods':
      return st.kind === 'settlement';
    default:
      return false;
  }
}

function lineHasMatchingStation(state, lineId, tok) {
  const line = state.lines[lineId];
  if (!line) return false;
  for (const sId of line.stations) {
    const st = state.stationById.get(sId);
    if (st && tokenMatchesStation(tok, st, true)) return true;
  }
  return false;
}

function findBfsFirstLines(state, startStationId, tok, serviceType) {
  const activeLines = state.lines.filter(
    (l) =>
      l.stations.length >= 2 &&
      state.trains.some((t) => t.lineId === l.id && t.type === serviceType)
  );
  if (activeLines.length === 0) return new Set();

  const adj = new Map();
  const addEdge = (u, v, lineId) => {
    if (!adj.has(u)) adj.set(u, []);
    adj.get(u).push({ to: v, lineId });
  };

  for (const l of activeLines) {
    for (const [u, v] of getLineEdges(l)) {
      if (l.removingEdges.has(edgeKey(u, v))) continue;
      addEdge(u, v, l.id);
      addEdge(v, u, l.id);
    }
  }

  const dist = new Map([[startStationId, 0]]);
  const firstLines = new Map(); // stationId -> Set<lineId>
  const queue = [startStationId];
  let bestTargetDist = Infinity;
  const matchedAtBestDist = [];

  for (let head = 0; head < queue.length; head++) {
    const curr = queue[head];
    const d = dist.get(curr);
    if (d > bestTargetDist) break;

    const st = state.stationById.get(curr);
    if (curr !== startStationId && st && tokenMatchesStation(tok, st, true)) {
      bestTargetDist = d;
      matchedAtBestDist.push(st);
      continue;
    }

    const neighbors = adj.get(curr) || [];
    for (const edge of neighbors) {
      const nd = d + 1;
      if (nd > bestTargetDist) continue;
      if (!dist.has(edge.to)) {
        dist.set(edge.to, nd);
        const set = new Set(curr === startStationId ? [edge.lineId] : firstLines.get(curr));
        firstLines.set(edge.to, set);
        queue.push(edge.to);
      } else if (dist.get(edge.to) === nd) {
        const existing = firstLines.get(edge.to);
        const src = curr === startStationId ? [edge.lineId] : firstLines.get(curr);
        if (src) src.forEach((lid) => existing.add(lid));
      }
    }
  }

  if (matchedAtBestDist.length === 0) return new Set();

  let chosenTargets = matchedAtBestDist;
  if (tok.kind === 'raw') {
    const withSpace = matchedAtBestDist.filter((st) => st.inputBuffer < CONFIG.FACTORY_INPUT_MAX);
    if (withSpace.length > 0) chosenTargets = withSpace;
  } else if (tok.kind === 'goods') {
    const growingTowns = matchedAtBestDist.filter((st) => st.tier < 3);
    if (growingTowns.length > 0) chosenTargets = growingTowns;
  }

  const winningLines = new Set();
  for (const st of chosenTargets) {
    const fl = firstLines.get(st.id);
    if (fl) fl.forEach((lid) => winningLines.add(lid));
  }
  return winningLines;
}

function assignUniqueCityIdentity(state, st) {
  const usedCodes = new Set();
  const usedColors = new Set();
  for (const s of state.stations) {
    if (s.id === st.id) continue;
    if (s.cityCode) usedCodes.add(s.cityCode);
    if (s.crestColor) usedColors.add(s.crestColor);
  }

  if (!st.cityCode) {
    const entry = CONFIG.SETTLEMENT_NAMES.find(([name]) => name === st.name);
    let code = entry ? entry[1] : st.name.slice(0, 2).toUpperCase();
    if (usedCodes.has(code)) {
      const alt = `${st.name[0]}${st.name[st.name.length - 1]}`.toUpperCase();
      code = usedCodes.has(alt) ? `C${st.id}` : alt;
    }
    st.cityCode = code;
  }

  if (!st.crestColor) {
    const freeColor = CONFIG.CITY_CREST_PALETTE.find((c) => !usedColors.has(c));
    st.crestColor =
      freeColor ||
      CONFIG.CITY_CREST_PALETTE[(state.citiesGrown + st.id) % CONFIG.CITY_CREST_PALETTE.length];
  }
}

function handleSettlementGoodsDelivery(state, st, hooks) {
  st.goodsProgress = (st.goodsProgress || 0) + 1;
  if (st.tier < 3 && st.goodsTarget && st.goodsProgress >= st.goodsTarget) {
    st.goodsProgress -= st.goodsTarget;
    st.tier += 1;
    const tierSpec = CONFIG.SETTLEMENT_TIERS[st.tier];
    st.subtype = tierSpec.subtype;
    st.capacity = tierSpec.capacity;
    st.goodsTarget = tierSpec.goodsTarget;
    st.pulse = 1.2;
    state.citiesGrown += 1;

    if (st.tier === 3) {
      assignUniqueCityIdentity(state, st);
    }

    const bonusPool = [
      { key: 'doubleTrack', label: 'DOUBLE-TRACK' },
      { key: 'tunnel', label: 'TUNNEL' },
      { key: 'bridge', label: 'BRIDGE' },
      { key: 'car', label: 'CARRIAGE' },
    ];
    const bonus = bonusPool[(state.citiesGrown - 1) % bonusPool.length];
    state.inventory[bonus.key] = (state.inventory[bonus.key] || 0) + 1;

    hooks?.onCityGrow?.(st);
    spawnFloatingToast(
      state,
      st.x,
      st.y - 14,
      `${st.name} grew into a ${st.tier === 3 ? 'City' : 'Town'}! +1 ${bonus.label}`,
      '#2F855A'
    );
  }
}

function handleStationExchange(state, train, station, hooks) {
  let didActivity = false;
  const line = state.lines[train.lineId];

  // 1. Unload deliveries or transfers
  for (let i = train.cargo.length - 1; i >= 0; i--) {
    const tok = train.cargo[i];
    if (tokenMatchesStation(tok, station, false)) {
      train.cargo.splice(i, 1);
      didActivity = true;

      if (tok.kind === 'raw') {
        station.inputBuffer = (station.inputBuffer || 0) + 1;
        state.deliveriesTotal += 1;
        state.deliveriesCargo += 1;
        spawnTokenHop(state, train.x, train.y, station.x, station.y, 'raw', '#C05621');
        hooks?.onDelivery?.('raw');
      } else if (tok.kind === 'goods') {
        state.deliveriesTotal += 2;
        state.deliveriesCargo += 1;
        state.deliveriesGoods += 1;
        spawnTokenHop(state, train.x, train.y, station.x, station.y, 'goods', '#2B6CB0');
        handleSettlementGoodsDelivery(state, station, hooks);
        hooks?.onDelivery?.('goods');
      } else {
        state.deliveriesTotal += 1;
        state.deliveriesPassengers += 1;
        spawnTokenHop(
          state,
          train.x,
          train.y,
          station.x,
          station.y,
          tok.kind,
          tok.crestColor || '#232629'
        );
        hooks?.onDelivery?.(tok.kind);
      }
    } else if (!lineHasMatchingStation(state, train.lineId, tok)) {
      // Needs transfer at this interchange if another active line can carry it
      const nextLines = findBfsFirstLines(state, station.id, tok, tok.service);
      const hasOtherLine = Array.from(nextLines).some((lid) => lid !== train.lineId);
      if (hasOtherLine) {
        train.cargo.splice(i, 1);
        station.queue.push(tok);
        didActivity = true;
      }
    }
  }

  // 2. Board waiting passengers/cargo matching this train's service & BFS route
  const cap = getTrainCapacity(train);
  if (train.cargo.length < cap && station.queue.length > 0 && line && line.stations.length >= 2) {
    for (let i = 0; i < station.queue.length && train.cargo.length < cap; ) {
      const tok = station.queue[i];
      if (tok.service !== train.type) {
        i++;
        continue;
      }
      const validLines = findBfsFirstLines(state, station.id, tok, train.type);
      if (validLines.has(train.lineId)) {
        station.queue.splice(i, 1);
        train.cargo.push(tok);
        didActivity = true;
        spawnTokenHop(
          state,
          station.x,
          station.y,
          train.x,
          train.y,
          tok.kind,
          tok.crestColor || (tok.service === 'freight' ? '#C05621' : '#232629')
        );
      } else {
        i++;
      }
    }
  }

  return didActivity;
}

function stepDemandAndSpawns(state, simDt, hooks) {
  // Progressive station spawning
  if (state.nextSpawnIndex < state.pendingSpawns.length) {
    state.spawnElapsed += simDt;
    if (state.spawnElapsed >= state.nextSpawnInterval) {
      state.spawnElapsed = 0;
      state.nextSpawnInterval = Math.max(13.5, 23.0 - state.week * 0.95);
      const spawned = spawnNextStation(state);
      if (spawned) hooks?.onStationSpawn?.(spawned);
    }
  }

  // Demand generation, factory processing & overflow timers
  const demandRateMult = 1 + (state.week - 1) * 0.16;

  for (const st of state.stations) {
    if (st.kind === 'resource') {
      st.spawnTimer -= simDt * demandRateMult;
      if (st.spawnTimer <= 0) {
        st.spawnTimer = 8.6 * (0.85 + state.rng() * 0.35);
        st.queue.push(createToken(state, 'raw'));
      }
    } else if (st.kind === 'factory') {
      if ((st.inputBuffer || 0) > 0 && st.queue.length < st.capacity) {
        st.processProgress = (st.processProgress || 0) + simDt / CONFIG.FACTORY_PROCESS_TIME;
        st.smokeTimer = (st.smokeTimer ?? 0) - simDt;
        if (st.smokeTimer <= 0) {
          st.smokeTimer = 0.42 + state.rng() * 0.25;
          spawnPuff(state, st.x + 6, st.y - 16, {
            startR: 3,
            endR: 11,
            vx: 6 + (state.rng() - 0.5) * 6,
            vy: -22,
            life: 0.95,
            color: 'rgba(130, 125, 118, 0.55)',
          });
        }
        if (st.processProgress >= 1) {
          st.processProgress -= 1;
          st.inputBuffer = Math.max(0, st.inputBuffer - 1);
          st.queue.push(createToken(state, 'goods'));
          st.pulse = Math.max(st.pulse || 0, 0.45);
        }
      } else if ((st.inputBuffer || 0) === 0) {
        st.processProgress = 0;
      }
    } else if (st.kind === 'settlement') {
      st.spawnTimer -= simDt * demandRateMult;
      if (st.spawnTimer <= 0) {
        const baseInterval = st.tier === 3 ? 7.0 : 7.8;
        st.spawnTimer = baseInterval * (0.85 + state.rng() * 0.35);

        if (st.tier < 3) {
          st.queue.push(createToken(state, 'commuter'));
        } else {
          const otherCities = state.stations.filter(
            (s) => s.kind === 'settlement' && s.tier === 3 && s.id !== st.id
          );
          if (otherCities.length >= 1 && state.rng() < 0.5) {
            const targetCity = otherCities[Math.floor(state.rng() * otherCities.length)];
            st.queue.push(
              createToken(state, 'intercity', {
                targetCityId: targetCity.id,
                cityCode: targetCity.cityCode,
                crestColor: targetCity.crestColor,
              })
            );
          } else {
            st.queue.push(createToken(state, 'local'));
          }
        }
      }
    }

    if (st.queue.length > st.capacity) {
      st.overflowTimer += simDt;
      if (st.overflowTimer >= CONFIG.OVERFLOW_DURATION) {
        state.phase = 'gameover';
        state.speed = 0;
        const label = st.name || st.subtype || 'Station';
        state.gameOverReason = `${label} exceeded its ${st.capacity}-unit capacity for 30 seconds.`;
        hooks?.onGameOver?.();
        return;
      }
      const frac = Math.min(1, st.overflowTimer / CONFIG.OVERFLOW_DURATION);
      if (st.overflowTimer > CONFIG.OVERFLOW_DURATION * 0.45) {
        st.warningPulseTimer = (st.warningPulseTimer ?? 0) - simDt;
        if (st.warningPulseTimer <= 0) {
          const urgency = (frac - 0.45) / 0.55;
          st.warningPulseTimer = Math.max(0.45, 1.45 - urgency * 1.0);
          spawnWarningPulse(state, st.x, st.y, 42 + urgency * 14, '#D94E34');
          hooks?.onOverflowTick?.(st, frac);
        }
      } else {
        st.warningPulseTimer = 0;
      }
    } else if (st.overflowTimer > 0) {
      st.overflowTimer = Math.max(0, st.overflowTimer - simDt * CONFIG.OVERFLOW_DRAIN_RATE);
      st.warningPulseTimer = 0;
    }
  }
}

function shouldBrakeForStop(state, tr, line, toStation) {
  if (!line || !toStation) return true;
  if (!line.isLoop && (tr.stationIndex === 0 || tr.stationIndex === line.stations.length - 1)) {
    return true;
  }
  if (tr.cargo.some((tok) => tokenMatchesStation(tok, toStation, false))) {
    return true;
  }
  if (
    tr.cargo.length < getTrainCapacity(tr) &&
    toStation.queue.some((tok) => tok.service === tr.type)
  ) {
    return true;
  }
  const next = getNextStop(line, tr.stationIndex, tr.direction);
  if (next) {
    const fromId = line.stations[tr.stationIndex];
    const nextToId = line.stations[next.nextIndex];
    const nextCorr = state.corridors.get(edgeKey(fromId, nextToId));
    if (nextCorr && !nextCorr.isDoubleTrack) {
      const nextDir = fromId === nextCorr.aId ? 'AtoB' : 'BtoA';
      if (nextCorr.lockedDirection && nextCorr.lockedDirection !== nextDir) {
        return true;
      }
    }
  }
  return false;
}

function stepTrains(state, simDt, hooks) {
  for (let i = state.trains.length - 1; i >= 0; i--) {
    const tr = state.trains[i];
    const line = state.lines[tr.lineId];

    if (!line || (line.stations.length < 2 && tr.state !== 'traversing')) {
      reclaimTrainToInventory(state, tr.id);
      continue;
    }

    if (tr.state === 'atStation') {
      tr.currentSpeed = 0;
      if (!tr.exchangedAtStop) {
        const st = state.stationById.get(line.stations[tr.stationIndex]);
        if (st) {
          const did = handleStationExchange(state, tr, st, hooks);
          const dwellMult = st.isInterchange ? CONFIG.INTERCHANGE_DWELL_MULT : 1;
          if (did) tr.dwellTimer = Math.max(tr.dwellTimer, CONFIG.TRAIN_DWELL_TIME * dwellMult);
        }
        tr.exchangedAtStop = true;
      }
      tr.dwellTimer -= simDt;
      if (tr.dwellTimer > 0) {
        updateTrainSpinePoses(state, tr);
        continue;
      }
      tr.state = 'waitingBlock';
    }

    if (tr.state === 'waitingBlock') {
      tr.currentSpeed = 0;
      const next = getNextStop(line, tr.stationIndex, tr.direction);
      if (!next) {
        updateTrainSpinePoses(state, tr);
        continue;
      }
      const fromId = line.stations[tr.stationIndex];
      const toId = line.stations[next.nextIndex];
      const key = edgeKey(fromId, toId);
      const corridor = state.corridors.get(key);
      if (!corridor) {
        reclaimTrainToInventory(state, tr.id);
        continue;
      }

      const dir = fromId === corridor.aId ? 'AtoB' : 'BtoA';
      if (!canEnterCorridor(corridor, tr, dir)) {
        updateTrainSpinePoses(state, tr);
        continue;
      }

      const myQueue = dir === 'AtoB' ? corridor.waitingAtoB : corridor.waitingBtoA;
      const qIdx = myQueue.indexOf(tr.id);
      if (qIdx >= 0) myQueue.splice(qIdx, 1);

      if (!corridor.isDoubleTrack) {
        corridor.lockedDirection = dir;
      }
      tr.state = 'traversing';
      tr.exchangedAtStop = false;
      tr.corridorKey = key;
      tr.corridorDir = dir;
      tr.fromStationId = fromId;
      tr.toStationId = toId;
      tr.direction = next.nextDirection;
      tr.stationIndex = next.nextIndex;
      tr.s = 0;
      tr.lane = 0;
      corridor.trains.push(tr);
    }

    if (tr.state === 'traversing') {
      const corridor = state.corridors.get(tr.corridorKey);
      if (!corridor) {
        reclaimTrainToInventory(state, tr.id);
        continue;
      }

      const total = corridor.totalLength;
      const arcS = tr.corridorDir === 'AtoB' ? tr.s : total - tr.s;
      const baseSpeed = tr.type === 'express' ? CONFIG.EXPRESS_SPEED : CONFIG.FREIGHT_SPEED;
      const inHill = !corridor.hasTunnel && isArcPosInHill(corridor, arcS);
      const hillMult = inHill
        ? tr.type === 'express'
          ? CONFIG.EXPRESS_HILL_MULT
          : CONFIG.FREIGHT_HILL_MULT
        : 1.0;

      const maxSpeed = baseSpeed * hillMult;
      let targetSpeed = maxSpeed;

      let leader = null;
      let minGap = Infinity;
      for (const other of corridor.trains) {
        if (other.id === tr.id) continue;
        if (other.corridorDir === tr.corridorDir && other.lane === tr.lane && other.s > tr.s) {
          const gap = other.s - tr.s;
          if (gap < minGap) {
            minGap = gap;
            leader = other;
          }
        }
      }

      if (
        corridor.isDoubleTrack &&
        tr.type === 'express' &&
        tr.lane === 0 &&
        leader &&
        leader.type === 'freight' &&
        minGap < CONFIG.OVERTAKE_TRIGGER_DIST
      ) {
        const oppBusy = corridor.trains.some((o) => o.corridorDir !== tr.corridorDir);
        if (!oppBusy) {
          tr.lane = 1;
          leader = null;
        }
      } else if (tr.lane === 1) {
        const lane0Blocked = corridor.trains.some(
          (o) =>
            o.id !== tr.id &&
            o.corridorDir === tr.corridorDir &&
            o.lane === 0 &&
            Math.abs(o.s - tr.s) < CONFIG.SAFE_GAP + 14
        );
        if (!lane0Blocked) {
          tr.lane = 0;
        }
      }

      const distRemaining = total - tr.s;
      const toStation = state.stationById.get(tr.toStationId);
      if (distRemaining < 45 && shouldBrakeForStop(state, tr, line, toStation)) {
        const brakeTarget = Math.max(26, maxSpeed * (distRemaining / 45));
        targetSpeed = Math.min(targetSpeed, brakeTarget);
      }

      if (leader && minGap < CONFIG.SAFE_GAP + 28) {
        const leaderSpeed = leader.currentSpeed ?? maxSpeed;
        const followTarget =
          minGap <= CONFIG.SAFE_GAP
            ? 0
            : leaderSpeed * ((minGap - CONFIG.SAFE_GAP) / 28);
        targetSpeed = Math.min(targetSpeed, followTarget);
      }

      if (typeof tr.currentSpeed !== 'number') tr.currentSpeed = 0;
      if (tr.currentSpeed < targetSpeed) {
        tr.currentSpeed = Math.min(targetSpeed, tr.currentSpeed + CONFIG.TRAIN_ACCEL * simDt);
      } else if (tr.currentSpeed > targetSpeed) {
        tr.currentSpeed = Math.max(targetSpeed, tr.currentSpeed - CONFIG.TRAIN_DECEL * simDt);
      }

      let nextS = tr.s + tr.currentSpeed * simDt;
      if (leader && nextS > leader.s - CONFIG.SAFE_GAP) {
        nextS = Math.max(tr.s, leader.s - CONFIG.SAFE_GAP);
      }
      if (nextS > total) {
        nextS = total;
      }

      tr.s = nextS;

      if (tr.s >= total) {
        corridor.trains = corridor.trains.filter((t) => t.id !== tr.id);
        if (corridor.trains.length === 0) {
          corridor.lockedDirection = null;
          corridor.lastServedDir = tr.corridorDir;
        }

        if (line && line.removingEdges.has(corridor.key)) {
          const moreOnLine = corridor.trains.some((t) => t.lineId === line.id);
          if (!moreOnLine) {
            corridor.activeLineIds.delete(line.id);
            line.removingEdges.delete(corridor.key);
            releaseCorridorIfUnused(state, corridor);
          }
        }

        const arrivedStation = state.stationById.get(tr.toStationId);
        tr.corridorKey = null;
        tr.lane = 0;
        tr.lateralOffset = 0;
        tr.currentSpeed = 0;

        if (!line || line.stations.length < 2) {
          reclaimTrainToInventory(state, tr.id);
          continue;
        }

        const idx = line.stations.indexOf(tr.toStationId);
        if (idx >= 0) tr.stationIndex = idx;

        tr.state = 'atStation';
        tr.exchangedAtStop = false;
        const dwellMult = arrivedStation?.isInterchange ? CONFIG.INTERCHANGE_DWELL_MULT : 1;
        tr.dwellTimer = 0.2 * dwellMult;
        updateTrainSpinePoses(state, tr);
        if (arrivedStation) {
          const did = handleStationExchange(state, tr, arrivedStation, hooks);
          if (did) tr.dwellTimer = CONFIG.TRAIN_DWELL_TIME * dwellMult;
          tr.exchangedAtStop = true;
        }
      } else {
        const targetLateral = corridor.isDoubleTrack
          ? tr.lane === 1
            ? -CONFIG.OVERTAKE_OFFSET
            : 4.5
          : 0;
        tr.lateralOffset += (targetLateral - tr.lateralOffset) * 0.2;
        updateTrainSpinePoses(state, tr);

        tr.exhaustTimer = (tr.exhaustTimer ?? 0) - simDt;
        if (tr.exhaustTimer <= 0) {
          const interval = inHill ? 0.12 : tr.type === 'freight' ? 0.22 : 0.34;
          tr.exhaustTimer = interval * (0.8 + state.rng() * 0.4);
          const stackX = tr.x + Math.cos(tr.angle) * 6;
          const stackY = tr.y + Math.sin(tr.angle) * 6;
          spawnPuff(state, stackX, stackY, {
            startR: inHill ? 3 : 2,
            endR: inHill ? 11 : 8,
            vx: -Math.cos(tr.angle) * 10,
            vy: -16,
            life: inHill ? 0.85 : 0.65,
            color: inHill ? 'rgba(95, 90, 82, 0.55)' : 'rgba(225, 220, 210, 0.5)',
          });
        }
      }
    }
  }
}

export function stepSimulation(state, dt, hooks = null) {
  const zoomDiff = state.camera.targetZoom - state.camera.zoom;
  if (Math.abs(zoomDiff) > 0.0005) {
    state.camera.zoom += zoomDiff * Math.min(1, dt * 4.5);
  }

  for (const st of state.stations) {
    if (st.pulse > 0) {
      st.pulse = Math.max(0, st.pulse - dt * 2.2);
    }
  }

  if (state.interaction.hintTimer > 0) {
    state.interaction.hintTimer = Math.max(0, state.interaction.hintTimer - dt);
    if (state.interaction.hintTimer === 0) {
      state.interaction.hintText = '';
    }
  }
  if (state.interaction.flashMessage) {
    state.interaction.flashMessage.timer -= dt;
    if (state.interaction.flashMessage.timer <= 0) {
      state.interaction.flashMessage = null;
    }
  }

  if (state.phase !== 'playing' || state.speed === 0) return;

  const simDt = dt * state.speed;
  state.simTime += simDt;
  state.dayProgress += simDt / CONFIG.DAY_SECONDS;
  if (state.dayProgress >= 1) {
    state.dayProgress -= 1;
    state.day += 1;
    if ((state.day - 1) % CONFIG.DAYS_PER_WEEK === 0) {
      state.savedSpeedBeforeModal = state.speed;
      state.speed = 0;
      state.phase = 'draft';
      hooks?.onWeekEnd?.(state.week);
      return;
    }
  }

  stepDemandAndSpawns(state, simDt, hooks);
  if (state.phase !== 'playing') return;
  stepTrains(state, simDt, hooks);
}

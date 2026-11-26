import { CONFIG, edgeKey, orderedPair } from './state.js';
import {
  buildOctilinearPoints,
  computeHillIntervals,
  computePolylineLengths,
  countRiverCrossings,
  samplePointAlongPolyline,
  spawnNextStation,
} from './mapGen.js';

export function getOrCreateCorridor(state, id1, id2) {
  const [aId, bId] = orderedPair(id1, id2);
  const key = edgeKey(aId, bId);
  if (state.corridors.has(key)) {
    return state.corridors.get(key);
  }
  const stA = state.stationById.get(aId);
  const stB = state.stationById.get(bId);
  const points = buildOctilinearPoints(stA.x, stA.y, stB.x, stB.y, state.river, state.hills);
  const { cumLengths, totalLength } = computePolylineLengths(points);
  const riverCrossings = countRiverCrossings(points, state.river);
  const hillIntervals = computeHillIntervals(points, cumLengths, totalLength, state.hills);

  const corridor = {
    key,
    aId,
    bId,
    points,
    cumLengths,
    totalLength,
    riverCrossings,
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
  const stA = state.stationById.get(id1);
  const stB = state.stationById.get(id2);
  const pts = buildOctilinearPoints(stA.x, stA.y, stB.x, stB.y, state.river, state.hills);
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
  return { ok: true };
}

function reconcileTrainsAfterLineShrink(state, lineId) {
  const line = state.lines[lineId];
  if (line.stations.length >= 2) {
    for (const tr of state.trains) {
      if (tr.lineId === lineId && tr.state !== 'traversing') {
        tr.stationIndex = Math.max(0, Math.min(line.stations.length - 1, tr.stationIndex));
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
    deactivateLineEdge(state, line, lastId, firstId);
    reconcileTrainsAfterLineShrink(state, lineId);
    return { ok: true };
  }

  if (line.stations.length === 2) {
    const [a, b] = line.stations;
    line.stations = [];
    deactivateLineEdge(state, line, a, b);
    reconcileTrainsAfterLineShrink(state, lineId);
    return { ok: true };
  }

  if (endSide === 'end') {
    const b = line.stations.pop();
    const a = line.stations[line.stations.length - 1];
    deactivateLineEdge(state, line, a, b);
  } else {
    const a = line.stations.shift();
    const b = line.stations[0];
    for (const tr of state.trains) {
      if (tr.lineId === lineId && tr.stationIndex > 0) tr.stationIndex -= 1;
    }
    deactivateLineEdge(state, line, a, b);
  }
  reconcileTrainsAfterLineShrink(state, lineId);
  return { ok: true };
}

export function removeSegmentFromLine(state, lineId, id1, id2) {
  const line = state.lines[lineId];
  if (!line || line.stations.length < 2) return { ok: false };
  const n = line.stations.length;
  const firstId = line.stations[0];
  const lastId = line.stations[n - 1];

  if (line.isLoop) {
    const idx1 = line.stations.indexOf(id1);
    const idx2 = line.stations.indexOf(id2);
    if (idx1 === -1 || idx2 === -1) return { ok: false };
    if ((idx1 === n - 1 && idx2 === 0) || (idx2 === n - 1 && idx1 === 0)) {
      line.isLoop = false;
      deactivateLineEdge(state, line, id1, id2);
      return { ok: true };
    }
    const cutAfter = (idx1 + 1) % n === idx2 ? idx1 : idx2;
    line.stations = [
      ...line.stations.slice(cutAfter + 1),
      ...line.stations.slice(0, cutAfter + 1),
    ];
    line.isLoop = false;
    deactivateLineEdge(state, line, id1, id2);
    reconcileTrainsAfterLineShrink(state, lineId);
    return { ok: true };
  }

  if (n === 2 || edgeKey(id1, id2) === edgeKey(line.stations[n - 2], lastId)) {
    return trimLineEnd(state, lineId, 'end');
  }
  if (edgeKey(id1, id2) === edgeKey(firstId, line.stations[1])) {
    return trimLineEnd(state, lineId, 'start');
  }

  const idx = Math.min(line.stations.indexOf(id1), line.stations.indexOf(id2));
  if (idx < 0) return { ok: false };
  if (idx + 1 <= n / 2) {
    while (line.stations.length > n - (idx + 1)) {
      trimLineEnd(state, lineId, 'start');
    }
  } else {
    while (line.stations.length > idx + 1) {
      trimLineEnd(state, lineId, 'end');
    }
  }
  return { ok: true };
}

// ---------- Fleet & Upgrade Helpers ----------

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
  const train = {
    id: state.nextTrainId++,
    type,
    lineId,
    cars: 0,
    cargo: [],
    state: 'atStation',
    stationIndex,
    direction: stationIndex === line.stations.length - 1 ? -1 : 1,
    dwellTimer: 0.25,
    corridorKey: null,
    corridorDir: 'AtoB',
    fromStationId: null,
    toStationId: null,
    s: 0,
    lane: 0,
    lateralOffset: 0,
    x: st.x,
    y: st.y,
    angle: 0,
  };
  state.trains.push(train);
  return { ok: true, train };
}

export function attachCarToTrain(state, trainId) {
  if (state.inventory.car <= 0) return { ok: false, reason: 'No Extra Railcars' };
  const tr = state.trains.find((t) => t.id === trainId);
  if (!tr) return { ok: false };
  if (tr.cars >= CONFIG.MAX_CARS_PER_TRAIN) {
    return { ok: false, reason: 'Max 2 railcars per train' };
  }
  state.inventory.car -= 1;
  tr.cars += 1;
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
  state.inventory.car += tr.cars;
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
  tr.lane = 0;
  tr.lateralOffset = 0;
  let sIdx = 0;
  if (stationId !== null) {
    const found = line.stations.indexOf(stationId);
    if (found >= 0) sIdx = found;
  }
  tr.stationIndex = sIdx;
  tr.direction = sIdx === line.stations.length - 1 ? -1 : 1;
  tr.dwellTimer = 0.25;
  const st = state.stationById.get(line.stations[sIdx]);
  tr.x = st.x;
  tr.y = st.y;
  return { ok: true };
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

function updateTrainPoseOnCorridor(state, train, corridor) {
  const total = corridor.totalLength;
  const arcS = train.corridorDir === 'AtoB' ? train.s : total - train.s;
  const pt = samplePointAlongPolyline(corridor.points, corridor.cumLengths, arcS);
  const sign = train.corridorDir === 'AtoB' ? 1 : -1;
  const tx = pt.tx * sign;
  const ty = pt.ty * sign;
  const nx = -ty;
  const ny = tx;

  // Lateral offset for double-track & overtaking
  let targetLateral = 0;
  if (corridor.isDoubleTrack) {
    targetLateral = train.lane === 1 ? -CONFIG.OVERTAKE_OFFSET : 4.5;
  }
  train.lateralOffset += (targetLateral - train.lateralOffset) * 0.2;

  train.x = pt.x + nx * train.lateralOffset;
  train.y = pt.y + ny * train.lateralOffset;
  train.angle = Math.atan2(ty, tx);
}

// ---------- Demand, BFS Routing & Station Overflow ----------

function getTrainCapacity(train) {
  return CONFIG.TRAIN_BASE_CAPACITY + train.cars * CONFIG.CAR_CAPACITY_BONUS;
}

function getServiceTypeForShape(shape) {
  return shape === 'diamond' ? 'freight' : 'express';
}

function getLineDirectShapes(state, lineId) {
  const line = state.lines[lineId];
  const shapes = new Set();
  if (!line) return shapes;
  for (const sId of line.stations) {
    const st = state.stationById.get(sId);
    if (st) shapes.add(st.shape);
  }
  return shapes;
}

function findBfsFirstLines(state, startStationId, targetShape, serviceType) {
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
  const winningLines = new Set();

  for (let head = 0; head < queue.length; head++) {
    const curr = queue[head];
    const d = dist.get(curr);
    if (d > bestTargetDist) break;

    const st = state.stationById.get(curr);
    if (curr !== startStationId && st && st.shape === targetShape) {
      bestTargetDist = d;
      const fl = firstLines.get(curr);
      if (fl) fl.forEach((lid) => winningLines.add(lid));
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

  return winningLines;
}

function handleStationExchange(state, train, station, hooks) {
  let didActivity = false;
  const line = state.lines[train.lineId];
  const directShapes = getLineDirectShapes(state, train.lineId);

  // 1. Unload deliveries or transfers
  for (let i = train.cargo.length - 1; i >= 0; i--) {
    const tok = train.cargo[i];
    if (tok.targetShape === station.shape) {
      train.cargo.splice(i, 1);
      state.deliveriesTotal += 1;
      if (tok.targetShape === 'diamond') state.deliveriesCargo += 1;
      else state.deliveriesPassengers += 1;
      didActivity = true;
      hooks?.onDelivery?.(tok.targetShape);
    } else if (!directShapes.has(tok.targetShape)) {
      // Needs transfer at this interchange if another active line can carry it
      const service = getServiceTypeForShape(tok.targetShape);
      const nextLines = findBfsFirstLines(state, station.id, tok.targetShape, service);
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
      if (getServiceTypeForShape(tok.targetShape) !== train.type) {
        i++;
        continue;
      }
      const validLines = findBfsFirstLines(state, station.id, tok.targetShape, train.type);
      if (validLines.has(train.lineId)) {
        station.queue.splice(i, 1);
        train.cargo.push(tok);
        didActivity = true;
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

  // Demand generation & overflow timers
  const demandRateMult = 1 + (state.week - 1) * 0.16;

  for (const st of state.stations) {
    if (st.shape !== 'diamond') {
      st.spawnTimer -= simDt * demandRateMult;
      if (st.spawnTimer <= 0) {
        const baseInterval = st.shape === 'triangle' ? 8.6 : 7.4;
        st.spawnTimer = baseInterval * (0.85 + state.rng() * 0.35);

        let targetShape = 'circle';
        if (st.shape === 'square') targetShape = 'circle';
        else if (st.shape === 'circle') targetShape = 'square';
        else if (st.shape === 'triangle') targetShape = 'diamond';

        st.queue.push({ targetShape, spawnedAt: state.simTime });
      }
    }

    if (st.queue.length > st.capacity) {
      st.overflowTimer += simDt;
      if (st.overflowTimer >= CONFIG.OVERFLOW_DURATION) {
        state.phase = 'gameover';
        state.speed = 0;
        const labelMap = {
          square: 'Village',
          circle: 'City',
          triangle: 'Resource Site',
          diamond: 'Industrial Port',
        };
        state.gameOverReason = `A ${labelMap[st.shape] || 'station'} exceeded its ${st.capacity}-unit capacity for 30 seconds.`;
        hooks?.onGameOver?.();
        return;
      }
    } else if (st.overflowTimer > 0) {
      st.overflowTimer = Math.max(0, st.overflowTimer - simDt * CONFIG.OVERFLOW_DRAIN_RATE);
    }
  }
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
      if (!tr.exchangedAtStop) {
        const st = state.stationById.get(line.stations[tr.stationIndex]);
        if (st) {
          const did = handleStationExchange(state, tr, st, hooks);
          if (did) tr.dwellTimer = Math.max(tr.dwellTimer, CONFIG.TRAIN_DWELL_TIME);
        }
        tr.exchangedAtStop = true;
      }
      tr.dwellTimer -= simDt;
      if (tr.dwellTimer > 0) continue;
      tr.state = 'waitingBlock';
    }

    if (tr.state === 'waitingBlock') {
      const next = getNextStop(line, tr.stationIndex, tr.direction);
      if (!next) continue;
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

      let speed = baseSpeed * hillMult;

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

      let nextS = tr.s + speed * simDt;
      if (leader && nextS > leader.s - CONFIG.SAFE_GAP) {
        nextS = Math.max(tr.s, leader.s - CONFIG.SAFE_GAP);
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

        if (!line || line.stations.length < 2) {
          reclaimTrainToInventory(state, tr.id);
          continue;
        }

        const idx = line.stations.indexOf(tr.toStationId);
        if (idx >= 0) tr.stationIndex = idx;

        tr.state = 'atStation';
        tr.exchangedAtStop = false;
        tr.dwellTimer = 0.2;
        if (arrivedStation) {
          tr.x = arrivedStation.x;
          tr.y = arrivedStation.y;
          const did = handleStationExchange(state, tr, arrivedStation, hooks);
          if (did) tr.dwellTimer = CONFIG.TRAIN_DWELL_TIME;
          tr.exchangedAtStop = true;
        }
      } else {
        updateTrainPoseOnCorridor(state, tr, corridor);
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

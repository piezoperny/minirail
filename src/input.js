import {
  CONFIG,
  panCameraByScreenDelta,
  sampleTrainCarriagePose,
  screenToWorld,
  showHint,
  zoomCameraAtScreenPoint,
} from './state.js';
import { getLineTBarPose } from './mapGen.js';
import {
  applyCorridorUpgrade,
  applyStationUpgrade,
  attachCarToTrain,
  deployTrainOnLine,
  extendOrStartLine,
  getLineEdges,
  insertStationIntoLine,
  moveTrainToLine,
  reclaimCorridorUpgrade,
  reclaimTrainToInventory,
  removeSegmentFromLine,
  removeStationFromLine,
} from './simulation.js';

function syncStationHoverTargets(state) {
  const hoveredId = state.interaction.hoveredStationId;
  for (const st of state.stations) {
    st.hoverTarget = st.id === hoveredId ? 1.12 : 1.0;
  }
}

function distToPolyline(points, wx, wy) {
  let minDist = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const ax = points[i].x;
    const ay = points[i].y;
    const bx = points[i + 1].x;
    const by = points[i + 1].y;
    const vx = bx - ax;
    const vy = by - ay;
    const lenSq = vx * vx + vy * vy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((wx - ax) * vx + (wy - ay) * vy) / lenSq));
    const dx = wx - (ax + t * vx);
    const dy = wy - (ay + t * vy);
    const d = Math.hypot(dx, dy);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

export function hitTestStation(state, wx, wy, radius = 26) {
  let best = null;
  let bestD = radius;
  for (const st of state.stations) {
    const d = Math.hypot(st.x - wx, st.y - wy);
    if (d < bestD) {
      bestD = d;
      best = st;
    }
  }
  return best;
}

export function hitTestTrain(state, wx, wy, radius = 22) {
  let best = null;
  let bestD = radius;
  for (const tr of state.trains) {
    if (Array.isArray(tr.unitPoses) && tr.unitPoses.length > 0) {
      for (const pose of tr.unitPoses) {
        const d = Math.hypot(pose.x - wx, pose.y - wy);
        if (d < bestD) {
          bestD = d;
          best = tr;
        }
      }
      continue;
    }

    const d = Math.hypot(tr.x - wx, tr.y - wy);
    if (d < bestD) {
      bestD = d;
      best = tr;
    }
    const carCount = tr.cars || 0;
    for (let c = 1; c <= carCount; c++) {
      const pose = sampleTrainCarriagePose(tr, c * CONFIG.CAR_SPACING);
      const dc = Math.hypot(pose.x - wx, pose.y - wy);
      if (dc < bestD) {
        bestD = dc;
        best = tr;
      }
    }
  }
  return best;
}

export function hitTestTBar(state, wx, wy) {
  for (const line of state.lines) {
    if (line.stations.length < 2 || line.isLoop) continue;
    for (const end of ['start', 'end']) {
      const pose = getLineTBarPose(state, line, end);
      if (!pose) continue;
      if (Math.hypot(wx - pose.x, wy - pose.y) <= 18) {
        return { lineId: line.id, end, stationId: pose.stationId };
      }
    }
  }
  return null;
}

export function hitTestCorridor(state, wx, wy, maxDist = 16) {
  let best = null;
  let bestDist = maxDist;
  for (const corridor of state.corridors.values()) {
    if (corridor.activeLineIds.size === 0) continue;
    const d = distToPolyline(corridor.points, wx, wy);
    if (d < bestDist) {
      bestDist = d;
      best = corridor;
    }
  }
  return best;
}

function chooseLineForStationDrag(state, stationId) {
  const active = state.lines[state.activeLineId];
  if (active && active.id < state.unlockedLines) {
    if (active.stations.length === 0) return active.id;
    if (
      !active.isLoop &&
      (active.stations[0] === stationId || active.stations[active.stations.length - 1] === stationId)
    ) {
      return active.id;
    }
  }

  for (let i = 0; i < state.unlockedLines; i++) {
    const l = state.lines[i];
    if (
      l.stations.length >= 2 &&
      !l.isLoop &&
      (l.stations[0] === stationId || l.stations[l.stations.length - 1] === stationId)
    ) {
      return l.id;
    }
  }

  for (let i = 0; i < state.unlockedLines; i++) {
    if (state.lines[i].stations.length === 0) return i;
  }

  return null;
}

function applyToolAtWorldPos(state, tool, wx, wy) {
  if (tool === 'express' || tool === 'freight') {
    const corridor = hitTestCorridor(state, wx, wy);
    if (corridor) {
      const ids = Array.from(corridor.activeLineIds);
      const lineId = ids.includes(state.activeLineId) ? state.activeLineId : ids[0];
      return deployTrainOnLine(state, tool, lineId, corridor.aId);
    }
    const st = hitTestStation(state, wx, wy);
    if (st) {
      const line = state.lines.find((l) => l.stations.includes(st.id) && l.stations.length >= 2);
      if (line) return deployTrainOnLine(state, tool, line.id, st.id);
    }
    return { ok: false, reason: 'Drop on an active rail line' };
  }

  if (tool === 'car') {
    const tr = hitTestTrain(state, wx, wy, 28);
    if (tr) return attachCarToTrain(state, tr.id);
    return { ok: false, reason: 'Drop on a train' };
  }

  if (tool === 'doubleTrack' || tool === 'tunnel') {
    const corridor = hitTestCorridor(state, wx, wy);
    if (corridor) return applyCorridorUpgrade(state, corridor.key, tool);
    return { ok: false, reason: 'Drop on a track segment' };
  }

  if (tool === 'interchange') {
    const st = hitTestStation(state, wx, wy);
    if (st) return applyStationUpgrade(state, st.id, 'interchange');
    return { ok: false, reason: 'Drop on a station' };
  }

  return { ok: false };
}

export function setupInput(canvas, state, callbacks) {
  const dockEl = document.getElementById('bottom-dock');
  let spaceHeld = false;
  const activeTouchPointers = new Map();
  let pinchPrev = null;

  const getWorldPosFromClient = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    return screenToWorld(state, clientX - rect.left, clientY - rect.top);
  };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') spaceHeld = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') spaceHeld = false;
  });
  window.addEventListener('blur', () => {
    spaceHeld = false;
    activeTouchPointers.clear();
    pinchPrev = null;
  });

  // Wheel zoom (cursor-anchored)
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (state.phase === 'gameover') return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const zoomFactor = Math.max(0.75, Math.min(1.35, Math.exp(-delta * 0.0015)));
      zoomCameraAtScreenPoint(state, sx, sy, zoomFactor);
    },
    { passive: false }
  );

  // Prevent browser middle-click autoscroll
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 1) e.preventDefault();
  });

  // Dock token drag & click-to-select
  document.querySelectorAll('#bottom-dock .dock-token:not(.static-token)').forEach((el) => {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || state.phase !== 'playing') return;
      const tool = el.dataset.tool;
      if (!tool || (state.inventory[tool] ?? 0) <= 0) return;

      const { x, y } = getWorldPosFromClient(e.clientX, e.clientY);
      state.interaction.mode = 'dragToken';
      state.interaction.drag = {
        tool,
        startClientX: e.clientX,
        startClientY: e.clientY,
        worldX: x,
        worldY: y,
        moved: false,
      };
    });
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (state.phase !== 'playing') return;
    const { x, y } = getWorldPosFromClient(e.clientX, e.clientY);

    // Right-click train to reclaim to dock
    const tr = hitTestTrain(state, x, y);
    if (tr) {
      reclaimTrainToInventory(state, tr.id);
      callbacks.onNetworkChanged?.();
      return;
    }

    // Right-click station to bypass/remove it from active line (or top line passing through)
    const st = hitTestStation(state, x, y);
    if (st) {
      let targetLine = null;
      const active = state.lines[state.activeLineId];
      if (active && active.id < state.unlockedLines && active.stations.includes(st.id)) {
        targetLine = active;
      } else {
        for (let i = state.unlockedLines - 1; i >= 0; i--) {
          if (state.lines[i].stations.includes(st.id)) {
            targetLine = state.lines[i];
            break;
          }
        }
      }
      if (targetLine) {
        const res = removeStationFromLine(state, targetLine.id, st.id);
        if (!res.ok && res.reason) {
          showHint(state, res.reason);
        }
        callbacks.onNetworkChanged?.();
        return;
      }
    }

    const corridor = hitTestCorridor(state, x, y);
    if (corridor) {
      const midPt = corridor.points[Math.floor(corridor.points.length / 2)];
      if (Math.hypot(x - midPt.x, y - midPt.y) < 14 && (corridor.isDoubleTrack || corridor.hasTunnel)) {
        if (corridor.isDoubleTrack) {
          const res = reclaimCorridorUpgrade(state, corridor.key, 'doubleTrack');
          if (!res.ok && res.reason) showHint(state, res.reason);
        } else if (corridor.hasTunnel) {
          reclaimCorridorUpgrade(state, corridor.key, 'tunnel');
        }
        callbacks.onNetworkChanged?.();
        return;
      }

      const activeIds = Array.from(corridor.activeLineIds);
      const targetLineId = activeIds.includes(state.activeLineId)
        ? state.activeLineId
        : activeIds[activeIds.length - 1];
      if (targetLineId !== undefined) {
        removeSegmentFromLine(state, targetLineId, corridor.aId, corridor.bId);
        callbacks.onNetworkChanged?.();
      }
    }
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') {
      activeTouchPointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
      if (activeTouchPointers.size === 2) {
        const pts = Array.from(activeTouchPointers.values());
        pinchPrev = {
          midX: (pts[0].clientX + pts[1].clientX) * 0.5,
          midY: (pts[0].clientY + pts[1].clientY) * 0.5,
          dist: Math.hypot(pts[1].clientX - pts[0].clientX, pts[1].clientY - pts[0].clientY),
        };
        state.interaction.mode = 'pan';
        state.interaction.drag = null;
        return;
      }
    }

    // Middle-mouse pan anywhere
    if (e.button === 1) {
      e.preventDefault();
      state.interaction.mode = 'pan';
      state.interaction.panStart = { clientX: e.clientX, clientY: e.clientY };
      state.interaction.drag = { lastClientX: e.clientX, lastClientY: e.clientY };
      canvas.style.cursor = 'grabbing';
      return;
    }

    if (e.button !== 0 || state.phase !== 'playing') return;

    // Space + left-drag pans anywhere
    if (spaceHeld) {
      state.interaction.mode = 'pan';
      state.interaction.panStart = { clientX: e.clientX, clientY: e.clientY };
      state.interaction.drag = { lastClientX: e.clientX, lastClientY: e.clientY };
      canvas.style.cursor = 'grabbing';
      return;
    }

    const { x, y } = getWorldPosFromClient(e.clientX, e.clientY);

    // If a dock tool is selected (click-to-place mode), apply it here
    if (state.interaction.selectedTool) {
      const res = applyToolAtWorldPos(state, state.interaction.selectedTool, x, y);
      if (res.ok) {
        if ((state.inventory[state.interaction.selectedTool] ?? 0) <= 0) {
          state.interaction.selectedTool = null;
        }
        callbacks.onNetworkChanged?.();
        return;
      } else if (res.reason) {
        state.interaction.flashMessage = { text: res.reason, x, y, timer: 1.3 };
        state.interaction.selectedTool = null;
        callbacks.onNetworkChanged?.();
        return;
      }
      state.interaction.selectedTool = null;
    }

    // 1. Check train drag for redeployment
    const tr = hitTestTrain(state, x, y);
    if (tr) {
      state.interaction.mode = 'dragTrain';
      state.interaction.drag = {
        trainId: tr.id,
        tool: tr.type,
        worldX: x,
        worldY: y,
      };
      return;
    }

    // 2. Check T-bar extension/pullback
    const tbar = hitTestTBar(state, x, y);
    if (tbar) {
      state.activeLineId = tbar.lineId;
      state.interaction.mode = 'buildLine';
      state.interaction.drag = {
        lineId: tbar.lineId,
        fromStationId: tbar.stationId,
        snapStationId: null,
        worldX: x,
        worldY: y,
      };
      callbacks.onNetworkChanged?.();
      return;
    }

    // 3. Check station drag to start/extend line
    const st = hitTestStation(state, x, y);
    if (st) {
      const lineId = chooseLineForStationDrag(state, st.id);
      if (lineId === null) {
        showHint(state, 'All unlocked lines are in use — extend an existing line end.');
        return;
      }
      state.activeLineId = lineId;
      state.interaction.mode = 'buildLine';
      state.interaction.drag = {
        lineId,
        fromStationId: st.id,
        snapStationId: null,
        worldX: x,
        worldY: y,
      };
      callbacks.onNetworkChanged?.();
      return;
    }

    // 4. Check corridor drag to insert a station mid-segment
    const corridor = hitTestCorridor(state, x, y);
    if (corridor) {
      if (e.shiftKey && (corridor.isDoubleTrack || corridor.hasTunnel)) {
        if (corridor.isDoubleTrack) reclaimCorridorUpgrade(state, corridor.key, 'doubleTrack');
        if (corridor.hasTunnel) reclaimCorridorUpgrade(state, corridor.key, 'tunnel');
        callbacks.onNetworkChanged?.();
        return;
      }

      const activeIds = Array.from(corridor.activeLineIds);
      const lineId = activeIds.includes(state.activeLineId)
        ? state.activeLineId
        : activeIds[0];
      if (lineId !== undefined) {
        const line = state.lines[lineId];
        const seg = getLineEdges(line).find(
          ([u, v]) =>
            (u === corridor.aId && v === corridor.bId) ||
            (u === corridor.bId && v === corridor.aId)
        );
        if (seg) {
          state.activeLineId = lineId;
          state.interaction.mode = 'insertNode';
          state.interaction.drag = {
            lineId,
            segAId: seg[0],
            segBId: seg[1],
            fromStationId: seg[0],
            snapStationId: null,
            worldX: x,
            worldY: y,
          };
          return;
        }
      }
    }

    // 5. Empty paper drag -> Pan camera
    state.interaction.mode = 'pan';
    state.interaction.panStart = { clientX: e.clientX, clientY: e.clientY };
    state.interaction.drag = { lastClientX: e.clientX, lastClientY: e.clientY };
    canvas.style.cursor = 'grabbing';
  });

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' && activeTouchPointers.has(e.pointerId)) {
      activeTouchPointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
      if (activeTouchPointers.size === 2 && pinchPrev) {
        const pts = Array.from(activeTouchPointers.values());
        const midX = (pts[0].clientX + pts[1].clientX) * 0.5;
        const midY = (pts[0].clientY + pts[1].clientY) * 0.5;
        const dist = Math.hypot(pts[1].clientX - pts[0].clientX, pts[1].clientY - pts[0].clientY);

        panCameraByScreenDelta(state, midX - pinchPrev.midX, midY - pinchPrev.midY);
        if (pinchPrev.dist > 10 && dist > 10) {
          const rect = canvas.getBoundingClientRect();
          zoomCameraAtScreenPoint(state, midX - rect.left, midY - rect.top, dist / pinchPrev.dist);
        }
        pinchPrev = { midX, midY, dist };
        return;
      }
    }

    const mode = state.interaction.mode;
    const drag = state.interaction.drag;

    if (mode === 'pan' && drag) {
      const dx = e.clientX - drag.lastClientX;
      const dy = e.clientY - drag.lastClientY;
      drag.lastClientX = e.clientX;
      drag.lastClientY = e.clientY;
      panCameraByScreenDelta(state, dx, dy);
      canvas.style.cursor = 'grabbing';
      return;
    }

    const { x, y } = getWorldPosFromClient(e.clientX, e.clientY);

    if (mode === 'buildLine' || mode === 'insertNode') {
      drag.worldX = x;
      drag.worldY = y;
      const snap = hitTestStation(state, x, y, 30);
      drag.snapStationId = snap && snap.id !== drag.fromStationId ? snap.id : null;
      state.interaction.hoveredStationId = drag.snapStationId;
      syncStationHoverTargets(state);
      canvas.style.cursor = 'grabbing';
      return;
    }

    if (mode === 'dragToken' || mode === 'dragTrain') {
      drag.worldX = x;
      drag.worldY = y;
      if (mode === 'dragToken') {
        const distPx = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY);
        if (distPx > 8) drag.moved = true;
      }
      canvas.style.cursor = 'grabbing';
      return;
    }

    // Idle hover
    const tr = hitTestTrain(state, x, y);
    const st = tr ? null : hitTestStation(state, x, y);
    const tbar = tr || st ? null : hitTestTBar(state, x, y);
    const corridor = tr || st || tbar ? null : hitTestCorridor(state, x, y);

    state.interaction.hoveredTrainId = tr ? tr.id : null;
    state.interaction.hoveredStationId = st ? st.id : null;
    syncStationHoverTargets(state);
    state.interaction.hoveredTBar = tbar;
    state.interaction.hoveredCorridorKey = corridor ? corridor.key : null;

    canvas.style.cursor = spaceHeld
      ? 'grab'
      : tr || st || tbar
      ? 'pointer'
      : corridor
      ? 'grab'
      : 'default';
  });

  const endPointer = (e) => {
    if (e.pointerType === 'touch') {
      activeTouchPointers.delete(e.pointerId);
      if (activeTouchPointers.size < 2) {
        pinchPrev = null;
      }
    }

    const mode = state.interaction.mode;
    const drag = state.interaction.drag;
    if (mode === 'idle') return;

    state.interaction.mode = 'idle';
    state.interaction.drag = null;
    state.interaction.panStart = null;
    if (mode === 'pan') {
      canvas.style.cursor = spaceHeld ? 'grab' : 'default';
      return;
    }
    if (!drag) return;

    if (mode === 'buildLine' || mode === 'insertNode') {
      state.interaction.hoveredStationId = null;
      syncStationHoverTargets(state);
    }

    if (state.phase !== 'playing') return;
    const { x, y } = getWorldPosFromClient(e.clientX, e.clientY);

    if (mode === 'buildLine' && drag.snapStationId) {
      const res = extendOrStartLine(state, drag.lineId, drag.fromStationId, drag.snapStationId);
      if (!res.ok && res.reason) {
        const target = state.stationById.get(drag.snapStationId);
        if (target) {
          state.interaction.flashMessage = { text: res.reason, x: target.x, y: target.y, timer: 1.4 };
        }
      }
      callbacks.onNetworkChanged?.();
    } else if (mode === 'insertNode' && drag.snapStationId) {
      const res = insertStationIntoLine(
        state,
        drag.lineId,
        drag.segAId,
        drag.segBId,
        drag.snapStationId
      );
      if (!res.ok && res.reason) {
        const target = state.stationById.get(drag.snapStationId);
        if (target) {
          state.interaction.flashMessage = { text: res.reason, x: target.x, y: target.y, timer: 1.4 };
        }
      }
      callbacks.onNetworkChanged?.();
    } else if (mode === 'dragToken') {
      if (!drag.moved) {
        state.interaction.selectedTool =
          state.interaction.selectedTool === drag.tool ? null : drag.tool;
        callbacks.onNetworkChanged?.();
        return;
      }
      const dockRect = dockEl.getBoundingClientRect();
      if (e.clientY >= dockRect.top) return;

      const res = applyToolAtWorldPos(state, drag.tool, x, y);
      if (!res.ok && res.reason) {
        state.interaction.flashMessage = { text: res.reason, x, y, timer: 1.4 };
      }
      callbacks.onNetworkChanged?.();
    } else if (mode === 'dragTrain') {
      const dockRect = dockEl.getBoundingClientRect();
      if (e.clientY >= dockRect.top) {
        reclaimTrainToInventory(state, drag.trainId);
        callbacks.onNetworkChanged?.();
        return;
      }
      const corridor = hitTestCorridor(state, x, y);
      if (corridor) {
        const ids = Array.from(corridor.activeLineIds);
        const lineId = ids.includes(state.activeLineId) ? state.activeLineId : ids[0];
        moveTrainToLine(state, drag.trainId, lineId, corridor.aId);
        callbacks.onNetworkChanged?.();
        return;
      }
      const st = hitTestStation(state, x, y);
      if (st) {
        const line = state.lines.find((l) => l.stations.includes(st.id) && l.stations.length >= 2);
        if (line) {
          moveTrainToLine(state, drag.trainId, line.id, st.id);
          callbacks.onNetworkChanged?.();
        }
      }
    }
  };

  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);
}

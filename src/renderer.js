import { CONFIG, edgeKey, getEffectiveScale } from './state.js';
import { buildOctilinearPoints, countRiverCrossings } from './mapGen.js';

function offsetPolyline(points, offset) {
  if (Math.abs(offset) < 0.01) return points;
  const result = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const pPrev = points[Math.max(0, i - 1)];
    const pNext = points[Math.min(n - 1, i + 1)];
    const dx = pNext.x - pPrev.x;
    const dy = pNext.y - pPrev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    result.push({ x: points[i].x + nx * offset, y: points[i].y + ny * offset });
  }
  return result;
}

function strokePolyline(ctx, points) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
}

export function drawShape(ctx, shape, x, y, r, fill, stroke, lineWidth = 2.6) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.arc(0, 0, r, 0, Math.PI * 2);
  } else if (shape === 'square') {
    const s = r * 0.88;
    ctx.rect(-s, -s, s * 2, s * 2);
  } else if (shape === 'triangle') {
    const h = r * 1.12;
    ctx.moveTo(0, -h);
    ctx.lineTo(h * 0.94, h * 0.72);
    ctx.lineTo(-h * 0.94, h * 0.72);
    ctx.closePath();
  } else if (shape === 'diamond') {
    const d = r * 1.15;
    ctx.moveTo(0, -d);
    ctx.lineTo(d, 0);
    ctx.lineTo(0, d);
    ctx.lineTo(-d, 0);
    ctx.closePath();
  }
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ctx.restore();
}

function drawGrid(ctx, state) {
  const step = 120;
  ctx.save();
  ctx.strokeStyle = CONFIG.COLORS.paperGrid;
  ctx.lineWidth = 1;
  for (let x = -1440; x <= 1440; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, -900);
    ctx.lineTo(x, 900);
    ctx.stroke();
  }
  for (let y = -900; y <= 900; y += step) {
    ctx.beginPath();
    ctx.moveTo(-1440, y);
    ctx.lineTo(1440, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHills(ctx, hills) {
  ctx.save();
  for (const h of hills) {
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.angle);
    const scales = [1.0, 0.72, 0.44];
    for (let i = 0; i < scales.length; i++) {
      const s = scales[i];
      ctx.beginPath();
      ctx.ellipse(0, 0, h.rx * s, h.ry * s, 0, 0, Math.PI * 2);
      ctx.fillStyle = CONFIG.COLORS.hillFill;
      ctx.fill();
      ctx.strokeStyle = CONFIG.COLORS.hillStroke;
      ctx.lineWidth = i === 0 ? 1.5 : 1.1;
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawRiver(ctx, river) {
  const pts = river.points;
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Soft valley bank halo
  ctx.strokeStyle = CONFIG.COLORS.riverHalo;
  ctx.lineWidth = river.halfWidth * 2 + 12;
  strokePolyline(ctx, pts);

  // Main river body
  ctx.strokeStyle = CONFIG.COLORS.river;
  ctx.lineWidth = river.halfWidth * 2;
  strokePolyline(ctx, pts);

  // Subtle center sheen
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = river.halfWidth * 0.45;
  strokePolyline(ctx, pts);
  ctx.restore();
}

function drawCorridors(ctx, state) {
  const hoveredKey = state.interaction.hoveredCorridorKey;

  for (const corridor of state.corridors.values()) {
    const activeIds = Array.from(corridor.activeLineIds).sort((a, b) => a - b);
    if (activeIds.length === 0) continue;

    const isHovered = hoveredKey === corridor.key;
    const bundleWidth = (activeIds.length - 1) * CONFIG.LINE_SPACING + 12;

    // Bridge deck under-layer
    if (corridor.hasBridge) {
      ctx.save();
      ctx.strokeStyle = CONFIG.COLORS.bridgeDeck;
      ctx.lineWidth = bundleWidth + 8;
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';
      strokePolyline(ctx, corridor.points);

      ctx.strokeStyle = '#EDE5D5';
      ctx.lineWidth = bundleWidth + 2;
      strokePolyline(ctx, corridor.points);
      ctx.restore();
    }

    // Double-track sleeper ties indicator
    if (corridor.isDoubleTrack) {
      ctx.save();
      ctx.strokeStyle = 'rgba(35, 38, 41, 0.28)';
      ctx.lineWidth = bundleWidth + 9;
      ctx.setLineDash([3, 7]);
      strokePolyline(ctx, corridor.points);
      ctx.restore();
    }

    // Tunnel bore indicator
    if (corridor.hasTunnel) {
      ctx.save();
      ctx.strokeStyle = 'rgba(35, 38, 41, 0.35)';
      ctx.lineWidth = bundleWidth + 10;
      ctx.lineCap = 'round';
      strokePolyline(ctx, corridor.points);
      ctx.restore();
    }

    // Hover highlight
    if (isHovered) {
      ctx.save();
      ctx.strokeStyle = 'rgba(35, 38, 41, 0.16)';
      ctx.lineWidth = bundleWidth + 10;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      strokePolyline(ctx, corridor.points);
      ctx.restore();
    }

    // Draw each parallel colored line
    const n = activeIds.length;
    for (let i = 0; i < n; i++) {
      const lineId = activeIds[i];
      const line = state.lines[lineId];
      const offset = (i - (n - 1) * 0.5) * CONFIG.LINE_SPACING;
      const pts = offsetPolyline(corridor.points, offset);
      const isRemoving = line.removingEdges.has(corridor.key);

      ctx.save();
      ctx.strokeStyle = line.color;
      ctx.lineWidth = corridor.isDoubleTrack ? 5.5 : 4.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (isRemoving) {
        ctx.globalAlpha = 0.35;
        ctx.setLineDash([8, 8]);
      }
      strokePolyline(ctx, pts);

      // Subtle center groove on double-track
      if (corridor.isDoubleTrack && !isRemoving) {
        ctx.strokeStyle = CONFIG.COLORS.paper;
        ctx.lineWidth = 1.4;
        strokePolyline(ctx, pts);
      }
      ctx.restore();
    }

    // Upgrade badges at corridor midpoint
    if (corridor.isDoubleTrack || corridor.hasTunnel) {
      const midPt = corridor.points[Math.floor(corridor.points.length / 2)];
      ctx.save();
      ctx.fillStyle = CONFIG.COLORS.ink;
      ctx.strokeStyle = CONFIG.COLORS.stationFill;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(midPt.x, midPt.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#FFFDF9';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = corridor.hasTunnel && corridor.isDoubleTrack ? '2T' : corridor.hasTunnel ? 'T' : '2×';
      ctx.fillText(label, midPt.x, midPt.y + 0.5);
      ctx.restore();
    }
  }
}

function drawTBars(ctx, state) {
  for (const line of state.lines) {
    if (line.stations.length < 2 || line.isLoop) continue;
    const ends = [
      { stationId: line.stations[0], neighborId: line.stations[1], end: 'start' },
      {
        stationId: line.stations[line.stations.length - 1],
        neighborId: line.stations[line.stations.length - 2],
        end: 'end',
      },
    ];

    for (const item of ends) {
      const st = state.stationById.get(item.stationId);
      const nb = state.stationById.get(item.neighborId);
      if (!st || !nb) continue;
      const dx = st.x - nb.x;
      const dy = st.y - nb.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const px = -uy;
      const py = ux;

      const tipX = st.x + ux * CONFIG.T_BAR_OFFSET;
      const tipY = st.y + uy * CONFIG.T_BAR_OFFSET;
      const isHovered =
        state.interaction.hoveredTBar &&
        state.interaction.hoveredTBar.lineId === line.id &&
        state.interaction.hoveredTBar.end === item.end;

      ctx.save();
      ctx.strokeStyle = line.color;
      ctx.lineWidth = isHovered ? 6 : 4.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(st.x, st.y);
      ctx.lineTo(tipX, tipY);
      ctx.moveTo(tipX - px * 9, tipY - py * 9);
      ctx.lineTo(tipX + px * 9, tipY + py * 9);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawTrainCarBody(ctx, x, y, angle, color, isFreight, isLoco, cargoSlice, hovered) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  const w = 24;
  const h = 14;

  if (hovered) {
    ctx.strokeStyle = 'rgba(43, 108, 176, 0.7)';
    ctx.lineWidth = 4;
    ctx.strokeRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4);
  }

  ctx.fillStyle = isLoco ? (isFreight ? '#5D473A' : '#232629') : color;
  ctx.strokeStyle = '#FFFDF9';
  ctx.lineWidth = 1.6;

  ctx.beginPath();
  if (isLoco && !isFreight) {
    // Sleek Express nose
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(w / 2 - 5, -h / 2);
    ctx.lineTo(w / 2 + 2, 0);
    ctx.lineTo(w / 2 - 5, h / 2);
    ctx.lineTo(-w / 2, h / 2);
    ctx.closePath();
  } else {
    ctx.roundRect(-w / 2, -h / 2, w, h, 3);
  }
  ctx.fill();
  ctx.stroke();

  // Line-color stripe on loco
  if (isLoco) {
    ctx.fillStyle = color;
    ctx.fillRect(-w / 2 + 2, -h / 2 + 1.5, 5, h - 3);
  }

  // 2x2 cargo slots
  const slotPositions = [
    [-2, -3],
    [4, -3],
    [-2, 3],
    [4, 3],
  ];
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = slotPositions[i];
    if (i < cargoSlice.length) {
      drawShape(ctx, cargoSlice[i].targetShape, sx, sy, 2.3, '#FFFDF9', null, 1);
    } else {
      ctx.fillStyle = 'rgba(255, 253, 249, 0.18)';
      ctx.beginPath();
      ctx.arc(sx, sy, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawTrains(ctx, state) {
  for (const tr of state.trains) {
    const line = state.lines[tr.lineId];
    if (!line) continue;
    const isFreight = tr.type === 'freight';
    const isHovered = state.interaction.hoveredTrainId === tr.id;

    // Draw trailing railcars first
    for (let c = tr.cars; c >= 1; c--) {
      const distBack = c * 27;
      const cx = tr.x - Math.cos(tr.angle) * distBack;
      const cy = tr.y - Math.sin(tr.angle) * distBack;
      const carCargo = tr.cargo.slice(c * 4, c * 4 + 4);
      drawTrainCarBody(ctx, cx, cy, tr.angle, line.color, isFreight, false, carCargo, isHovered);
    }

    // Draw locomotive
    const locoCargo = tr.cargo.slice(0, 4);
    drawTrainCarBody(ctx, tr.x, tr.y, tr.angle, line.color, isFreight, true, locoCargo, isHovered);

    // Waiting-at-siding amber signal dot
    if (tr.state === 'waitingBlock') {
      ctx.save();
      ctx.fillStyle = '#D69E2E';
      ctx.strokeStyle = '#FFFDF9';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(tr.x, tr.y - 14, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawDragPreview(ctx, state) {
  const drag = state.interaction.drag;
  if (!drag) return;

  if (state.interaction.mode === 'buildLine' || state.interaction.mode === 'insertNode') {
    const line = state.lines[drag.lineId];
    const fromSt = state.stationById.get(drag.fromStationId);
    if (!line || !fromSt) return;

    const targetSt = drag.snapStationId ? state.stationById.get(drag.snapStationId) : null;
    const tx = targetSt ? targetSt.x : drag.worldX;
    const ty = targetSt ? targetSt.y : drag.worldY;

    const pts = buildOctilinearPoints(fromSt.x, fromSt.y, tx, ty, state.river, state.hills);
    const crossings = countRiverCrossings(pts, state.river);
    const existing = targetSt ? state.corridors.get(edgeKey(fromSt.id, targetSt.id)) : null;
    const needsBridge = crossings > 0 && !(existing && existing.hasBridge);
    const blocked = needsBridge && state.inventory.bridge <= 0;

    ctx.save();
    ctx.strokeStyle = blocked ? CONFIG.COLORS.danger : line.color;
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.72;
    ctx.setLineDash(blocked ? [6, 6] : [10, 6]);
    strokePolyline(ctx, pts);

    if (needsBridge) {
      const mid = pts[Math.floor(pts.length / 2)];
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = blocked ? CONFIG.COLORS.danger : CONFIG.COLORS.ink;
      ctx.beginPath();
      ctx.roundRect(mid.x - 36, mid.y - 11, 72, 22, 11);
      ctx.fill();
      ctx.fillStyle = '#FFFDF9';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(blocked ? 'NO BRIDGE' : 'BRIDGE -1', mid.x, mid.y + 0.5);
    }
    ctx.restore();
  } else if (state.interaction.mode === 'dragToken' || state.interaction.mode === 'dragTrain') {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = CONFIG.COLORS.ink;
    ctx.beginPath();
    ctx.arc(drag.worldX, drag.worldY, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFDF9';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelMap = {
      express: 'EXP',
      freight: 'FRT',
      car: '+CAR',
      doubleTrack: '2×',
      tunnel: 'TUN',
    };
    ctx.fillText(labelMap[drag.tool] || 'TRN', drag.worldX, drag.worldY + 0.5);
    ctx.restore();
  }
}

function drawStations(ctx, state) {
  const hoveredId = state.interaction.hoveredStationId;

  for (const st of state.stations) {
    const isHovered = st.id === hoveredId;
    const popScale = 1 + st.pulse * 0.35 + (isHovered ? 0.12 : 0);
    const r = CONFIG.STATION_RADIUS * popScale;

    // Overflow radial warning ring
    if (st.overflowTimer > 0) {
      const frac = Math.min(1, st.overflowTimer / CONFIG.OVERFLOW_DURATION);
      ctx.save();
      ctx.beginPath();
      ctx.arc(st.x, st.y, r + 9, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(217, 78, 52, 0.2)';
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(st.x, st.y, r + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.strokeStyle = CONFIG.COLORS.danger;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // Hover halo
    if (isHovered) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(st.x, st.y, r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(35, 38, 41, 0.25)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    drawShape(ctx, st.shape, st.x, st.y, r, CONFIG.COLORS.stationFill, CONFIG.COLORS.ink, 3);

    // Waiting tokens around station
    if (st.queue.length > 0) {
      const cols = 4;
      const startX = st.x + r + 10;
      const startY = st.y - 8;
      for (let i = 0; i < st.queue.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const tx = startX + col * 11;
        const ty = startY + row * 11;
        const tok = st.queue[i];
        drawShape(ctx, tok.targetShape, tx, ty, 3.8, CONFIG.COLORS.ink, null, 1);
      }
    }
  }
}

export function renderGame(ctx, state) {
  const { width, height, dpr } = state.viewport;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Paper background
  ctx.fillStyle = CONFIG.COLORS.paper;
  ctx.fillRect(0, 0, width, height);

  const scale = getEffectiveScale(state);
  ctx.save();
  ctx.translate(width * 0.5, height * 0.5);
  ctx.scale(scale, scale);
  ctx.translate(-state.camera.x, -state.camera.y);

  drawGrid(ctx, state);
  drawHills(ctx, state.hills);
  drawRiver(ctx, state.river);
  drawCorridors(ctx, state);
  drawTBars(ctx, state);
  drawStations(ctx, state);
  drawTrains(ctx, state);
  drawDragPreview(ctx, state);

  // Flash message in world space
  if (state.interaction.flashMessage) {
    const fm = state.interaction.flashMessage;
    ctx.save();
    ctx.globalAlpha = Math.min(1, fm.timer * 1.5);
    ctx.fillStyle = CONFIG.COLORS.danger;
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(fm.text, fm.x, fm.y - 28);
    ctx.restore();
  }

  ctx.restore();
}

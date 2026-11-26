import {
  CONFIG,
  edgeKey,
  getEffectiveScale,
  sampleTrainCarriagePose,
} from './state.js';
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
  } else {
    ctx.arc(0, 0, r, 0, Math.PI * 2);
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

function drawGrid(ctx) {
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

function drawRiver(ctx, state) {
  const river = state.river;
  const pts = river.points;
  if (pts.length < 2) return;
  const ripplesOffset = state.fx?.ripplesOffset || 0;

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
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = river.halfWidth * 0.45;
  strokePolyline(ctx, pts);

  // Animated drifting current ripples
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
  ctx.lineWidth = 2.2;
  ctx.setLineDash([16, 28]);
  ctx.lineDashOffset = -ripplesOffset;
  strokePolyline(ctx, pts);

  const upperStream = offsetPolyline(pts, river.halfWidth * 0.36);
  const lowerStream = offsetPolyline(pts, -river.halfWidth * 0.36);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 1.6;
  ctx.setLineDash([10, 34]);
  ctx.lineDashOffset = -(ripplesOffset * 0.8 + 14);
  strokePolyline(ctx, upperStream);
  ctx.lineDashOffset = -(ripplesOffset * 0.65 + 26);
  strokePolyline(ctx, lowerStream);

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

    // Subtle perpendicular wooden railway sleepers / cross-ties under every active corridor
    ctx.save();
    ctx.strokeStyle = corridor.isDoubleTrack
      ? 'rgba(74, 59, 50, 0.32)'
      : 'rgba(93, 71, 58, 0.24)';
    ctx.lineWidth = bundleWidth + (corridor.isDoubleTrack ? 9 : 5);
    ctx.lineCap = 'butt';
    ctx.setLineDash([2, 8]);
    strokePolyline(ctx, corridor.points);
    ctx.restore();

    // Tunnel bore indicator
    if (corridor.hasTunnel) {
      ctx.save();
      ctx.strokeStyle = 'rgba(35, 38, 41, 0.34)';
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
      const label =
        corridor.hasTunnel && corridor.isDoubleTrack
          ? '2T'
          : corridor.hasTunnel
          ? 'T'
          : '2×';
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

function drawOnboardingGuide(ctx, state) {
  if (state.onboarding?.freightLineBuilt || state.week !== 1) return;
  const ids = state.onboarding?.starterIds;
  if (!ids) return;

  const resSt = state.stationById.get(ids.resourceId);
  const facSt = state.stationById.get(ids.factoryId);
  const citySt = state.stationById.get(ids.cityId);
  if (!resSt || !facSt || !citySt) return;

  const leg1 = buildOctilinearPoints(resSt.x, resSt.y, facSt.x, facSt.y, state.river, state.hills);
  const leg2 = buildOctilinearPoints(facSt.x, facSt.y, citySt.x, citySt.y, state.river, state.hills);
  const phase = (state.fx?.ripplesOffset || 0) * 0.7;

  ctx.save();
  ctx.strokeStyle = 'rgba(192, 86, 33, 0.44)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([8, 8]);
  ctx.lineDashOffset = -phase;
  strokePolyline(ctx, leg1);
  strokePolyline(ctx, leg2);

  // Subtle directional arrowhead near factory entry
  if (leg1.length >= 2) {
    const pA = leg1[leg1.length - 2];
    const pB = leg1[leg1.length - 1];
    const ang = Math.atan2(pB.y - pA.y, pB.x - pA.x);
    const ax = pB.x - Math.cos(ang) * 26;
    const ay = pB.y - Math.sin(ang) * 26;
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(192, 86, 33, 0.65)';
    ctx.beginPath();
    ctx.moveTo(ax + Math.cos(ang) * 6, ay + Math.sin(ang) * 6);
    ctx.lineTo(ax + Math.cos(ang + 2.4) * 6, ay + Math.sin(ang + 2.4) * 6);
    ctx.lineTo(ax + Math.cos(ang - 2.4) * 6, ay + Math.sin(ang - 2.4) * 6);
    ctx.closePath();
    ctx.fill();
  }

  // Floating instruction pill
  const label = `Drag from ${resSt.name || 'Timber Camp'} → ${facSt.name || 'Millworks'} → ${citySt.name || 'Grandhaven'} to start Freight!`;
  ctx.font = 'bold 11px sans-serif';
  const textW = ctx.measureText(label).width;
  const pillW = textW + 22;
  const pillH = 24;
  const midX = (resSt.x + facSt.x + citySt.x) / 3;
  const midY = Math.min(resSt.y, facSt.y, citySt.y) - 34;

  ctx.fillStyle = 'rgba(255, 253, 249, 0.94)';
  ctx.strokeStyle = 'rgba(192, 86, 33, 0.65)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.roundRect(midX - pillW / 2, midY - pillH / 2, pillW, pillH, 12);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#8C3B14';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, midX, midY + 0.5);
  ctx.restore();
}

function drawNameplate(ctx, x, y, text, accentColor = null) {
  if (!text) return;
  ctx.save();
  ctx.font = 'bold 10px sans-serif';
  const w = ctx.measureText(text).width + (accentColor ? 18 : 14);
  const h = 17;

  ctx.fillStyle = 'rgba(255, 253, 249, 0.92)';
  ctx.strokeStyle = 'rgba(35, 38, 41, 0.24)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 8.5);
  ctx.fill();
  ctx.stroke();

  if (accentColor) {
    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.arc(x - w / 2 + 7, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = CONFIG.COLORS.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + (accentColor ? 3 : 0), y + 0.5);
  ctx.restore();
}

function drawTokenIcon(ctx, tok, x, y, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  const kind = tok?.kind;

  if (kind === 'commuter' || kind === 'local') {
    // Clean person silhouette + dark city dot (commuter) or warm cottage dot (local)
    ctx.fillStyle = CONFIG.COLORS.ink;
    ctx.beginPath();
    ctx.arc(0, -2.5, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-3.4, 4.2);
    ctx.quadraticCurveTo(-3.4, 0.2, 0, 0.2);
    ctx.quadraticCurveTo(3.4, 0.2, 3.4, 4.2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = kind === 'commuter' ? '#232629' : '#D97706';
    ctx.strokeStyle = '#FFFDF9';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(3.4, -2.8, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (kind === 'intercity') {
    // Rounded colored ticket pill in tok.crestColor with white cityCode
    const code = tok.cityCode || 'IC';
    const w = code.length > 2 ? 18 : 15;
    const h = 11;
    ctx.fillStyle = tok.crestColor || '#2B6CB0';
    ctx.strokeStyle = '#FFFDF9';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#FFFDF9';
    ctx.font = 'bold 7px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(code, 0, 0.6);
  } else if (kind === 'raw') {
    // Warm rust/amber raw-material log/ingot icon
    ctx.fillStyle = '#C05621';
    ctx.strokeStyle = '#5D473A';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-4.5, -3.2, 9, 6.4, 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#F6AD55';
    ctx.beginPath();
    ctx.arc(2.6, 0, 1.8, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'goods') {
    // Crisp stenciled crate box (#2B6CB0 / #5D473A banded crate)
    ctx.fillStyle = '#2B6CB0';
    ctx.strokeStyle = '#5D473A';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.roundRect(-4.3, -4.3, 8.6, 8.6, 1.5);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#EBF8FF';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-3.2, -3.2);
    ctx.lineTo(3.2, 3.2);
    ctx.moveTo(-3.2, 3.2);
    ctx.lineTo(3.2, -3.2);
    ctx.stroke();
  } else {
    drawShape(ctx, tok?.targetShape || 'circle', 0, 0, 3.8, CONFIG.COLORS.ink, null, 1);
  }

  ctx.restore();
}

function drawSettlementLandmark(ctx, st, r) {
  const tier = st.tier || (st.subtype === 'city' ? 3 : st.subtype === 'town' ? 2 : 1);
  const tierCount = tier >= 3 ? 10 : tier === 2 ? 6 : 3;
  const seeds = Array.isArray(st.buildingSeeds) ? st.buildingSeeds.slice(0, tierCount) : [];
  const roofColors = ['#C05621', '#64748B', '#B7791F', '#8C5A3C'];

  // Architectural building cluster framing the station pad
  for (let i = 0; i < seeds.length; i++) {
    const b = seeds[i];
    const bx = st.x + b.dx;
    const by = st.y + b.dy;
    const bw = b.w || 9;
    const bh = b.h || 8;
    const roofColor = roofColors[(b.roof || i) % roofColors.length];

    ctx.save();
    ctx.fillStyle = '#EFE9DC';
    ctx.strokeStyle = 'rgba(35, 38, 41, 0.42)';
    ctx.lineWidth = 1;
    ctx.fillRect(bx - bw / 2, by - bh / 2, bw, bh);
    ctx.strokeRect(bx - bw / 2, by - bh / 2, bw, bh);

    // Pitched roof cap
    ctx.fillStyle = roofColor;
    ctx.beginPath();
    ctx.moveTo(bx - bw / 2 - 1, by - bh / 2);
    ctx.lineTo(bx, by - bh / 2 - 4);
    ctx.lineTo(bx + bw / 2 + 1, by - bh / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Central crisp station hub
  ctx.save();
  if (tier >= 3) {
    const hubR = r * 1.12;
    const crest = st.crestColor || '#2B6CB0';
    ctx.fillStyle = CONFIG.COLORS.stationFill;
    ctx.strokeStyle = CONFIG.COLORS.ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(st.x, st.y, hubR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = crest;
    ctx.beginPath();
    ctx.arc(st.x, st.y, hubR - 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFFDF9';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(st.cityCode || 'CT', st.x, st.y + 0.5);
  } else if (tier === 2) {
    const s = r * 0.94;
    ctx.fillStyle = CONFIG.COLORS.stationFill;
    ctx.strokeStyle = CONFIG.COLORS.ink;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.roundRect(st.x - s, st.y - s, s * 2, s * 2, 6);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#B7791F';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(st.x - s + 4, st.y - s + 4, (s - 4) * 2, (s - 4) * 2, 3.5);
    ctx.stroke();
  } else {
    const hubR = r * 0.88;
    ctx.fillStyle = CONFIG.COLORS.stationFill;
    ctx.strokeStyle = CONFIG.COLORS.ink;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(st.x, st.y, hubR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#C05621';
    ctx.beginPath();
    ctx.arc(st.x, st.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Nameplate pill
  const labelY = st.y + r + 14;
  drawNameplate(ctx, st.x, labelY, st.name, tier >= 3 ? st.crestColor : null);

  // Compact Goods progress pips for growing Hamlet / Town
  if (typeof st.goodsTarget === 'number' && st.goodsTarget > 0) {
    const total = st.goodsTarget;
    const filled = Math.min(total, st.goodsProgress || 0);
    const pipSize = 5;
    const gap = 2.5;
    const rowW = total * pipSize + (total - 1) * gap;
    const startX = st.x - rowW / 2;
    const pipY = labelY + 11;

    ctx.save();
    for (let i = 0; i < total; i++) {
      const px = startX + i * (pipSize + gap);
      ctx.fillStyle = i < filled ? '#2B6CB0' : 'rgba(255, 253, 249, 0.9)';
      ctx.strokeStyle = i < filled ? '#1A365D' : 'rgba(35, 38, 41, 0.38)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(px, pipY, pipSize, pipSize, 1.2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawResourceLandmark(ctx, st, r) {
  const isMine = st.subtype === 'mine';

  // Station pad
  ctx.save();
  ctx.fillStyle = isMine ? '#EDE7DA' : '#EFF4EA';
  ctx.strokeStyle = isMine ? '#4A5568' : '#2F855A';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(st.x, st.y, r * 0.98, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (isMine) {
    // Twin mountain + mine portal silhouette
    ctx.fillStyle = '#64748B';
    ctx.beginPath();
    ctx.moveTo(st.x - 11, st.y + 7);
    ctx.lineTo(st.x - 3, st.y - 8);
    ctx.lineTo(st.x + 4, st.y + 7);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.moveTo(st.x - 1, st.y + 7);
    ctx.lineTo(st.x + 6, st.y - 6);
    ctx.lineTo(st.x + 12, st.y + 7);
    ctx.closePath();
    ctx.fill();

    // Mine portal arch
    ctx.fillStyle = '#232629';
    ctx.beginPath();
    ctx.arc(st.x + 1, st.y + 7, 3.8, Math.PI, 0);
    ctx.fill();
  } else {
    // Stylized pine trio
    const trees = [
      { dx: -6, dy: 2, s: 0.82, col: '#276749' },
      { dx: 6, dy: 2, s: 0.82, col: '#276749' },
      { dx: 0, dy: -1, s: 1.05, col: '#2F855A' },
    ];
    for (const t of trees) {
      const tx = st.x + t.dx;
      const ty = st.y + t.dy;
      ctx.fillStyle = '#5D473A';
      ctx.fillRect(tx - 1, ty + 3 * t.s, 2, 4 * t.s);

      ctx.fillStyle = t.col;
      ctx.beginPath();
      ctx.moveTo(tx, ty - 9 * t.s);
      ctx.lineTo(tx + 5.5 * t.s, ty + 3.5 * t.s);
      ctx.lineTo(tx - 5.5 * t.s, ty + 3.5 * t.s);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();

  drawNameplate(ctx, st.x, st.y + r + 14, st.name, isMine ? '#64748B' : '#2F855A');
}

function drawFactoryLandmark(ctx, st, r) {
  ctx.save();
  const s = r * 1.04;

  // Industrial pad
  ctx.fillStyle = '#EFE9DC';
  ctx.strokeStyle = '#5D473A';
  ctx.lineWidth = 2.8;
  ctx.beginPath();
  ctx.roundRect(st.x - s, st.y - s, s * 2, s * 2, 5);
  ctx.fill();
  ctx.stroke();

  // Twin smokestacks
  ctx.fillStyle = '#4A5568';
  ctx.fillRect(st.x - 8, st.y - 12, 3.5, 9);
  ctx.fillRect(st.x - 2, st.y - 12, 3.5, 9);

  // Sawtooth industrial roof
  ctx.fillStyle = '#9C4221';
  ctx.beginPath();
  ctx.moveTo(st.x - 10, st.y + 6);
  ctx.lineTo(st.x - 10, st.y - 4);
  ctx.lineTo(st.x - 3, st.y + 1);
  ctx.lineTo(st.x - 3, st.y - 4);
  ctx.lineTo(st.x + 4, st.y + 1);
  ctx.lineTo(st.x + 4, st.y - 4);
  ctx.lineTo(st.x + 10, st.y + 1);
  ctx.lineTo(st.x + 10, st.y + 6);
  ctx.closePath();
  ctx.fill();

  // Animated processProgress bar on factory fascia
  if ((st.processProgress || 0) > 0) {
    const barW = 18;
    const frac = Math.max(0, Math.min(1, st.processProgress));
    ctx.fillStyle = 'rgba(35, 38, 41, 0.25)';
    ctx.fillRect(st.x - barW / 2, st.y + 7.5, barW, 3);
    ctx.fillStyle = '#D69E2E';
    ctx.fillRect(st.x - barW / 2, st.y + 7.5, barW * frac, 3);
  }

  // inputBuffer raw-material pips along top of pad
  const maxInput = CONFIG.FACTORY_INPUT_MAX || 6;
  const filledInput = Math.min(maxInput, st.inputBuffer || 0);
  const pipSize = 3.5;
  const gap = 1.5;
  const rowW = maxInput * pipSize + (maxInput - 1) * gap;
  const startX = st.x - rowW / 2;
  for (let i = 0; i < maxInput; i++) {
    const px = startX + i * (pipSize + gap);
    ctx.fillStyle = i < filledInput ? '#C05621' : 'rgba(255, 253, 249, 0.85)';
    ctx.strokeStyle = i < filledInput ? '#7B341E' : 'rgba(35, 38, 41, 0.32)';
    ctx.lineWidth = 0.8;
    ctx.fillRect(px, st.y - s - 6, pipSize, pipSize);
    ctx.strokeRect(px, st.y - s - 6, pipSize, pipSize);
  }
  ctx.restore();

  const labelY = st.y + r + 14;
  drawNameplate(ctx, st.x, labelY, st.name, '#C05621');

  // Crisp [Raw -> Goods] recipe tag below nameplate
  ctx.save();
  const tagY = labelY + 15;
  const tagW = 46;
  const tagH = 14;
  ctx.fillStyle = 'rgba(255, 253, 249, 0.92)';
  ctx.strokeStyle = 'rgba(93, 71, 58, 0.38)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(st.x - tagW / 2, tagY - tagH / 2, tagW, tagH, 7);
  ctx.fill();
  ctx.stroke();

  drawTokenIcon(ctx, { kind: 'raw' }, st.x - 12, tagY, 0.72);
  ctx.fillStyle = CONFIG.COLORS.ink;
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('→', st.x, tagY + 0.5);
  drawTokenIcon(ctx, { kind: 'goods' }, st.x + 12, tagY, 0.72);
  ctx.restore();
}

function drawStations(ctx, state) {
  const hoveredId = state.interaction.hoveredStationId;

  for (const st of state.stations) {
    const isHovered = st.id === hoveredId;
    const hoverScale =
      typeof st.hoverScale === 'number' ? st.hoverScale : isHovered ? 1.12 : 1.0;
    const popScale = hoverScale + (st.pulse || 0) * 0.32;
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

    if (st.kind === 'settlement') {
      drawSettlementLandmark(ctx, st, r);
    } else if (st.kind === 'resource') {
      drawResourceLandmark(ctx, st, r);
    } else if (st.kind === 'factory') {
      drawFactoryLandmark(ctx, st, r);
    } else {
      drawShape(ctx, st.shape, st.x, st.y, r, CONFIG.COLORS.stationFill, CONFIG.COLORS.ink, 3);
    }

    // Waiting tokens around station
    if (st.queue && st.queue.length > 0) {
      const cols = st.capacity >= 10 ? 5 : 4;
      const startX = st.x + r + 11;
      const startY = st.y - 8;
      for (let i = 0; i < st.queue.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const tx = startX + col * 14;
        const ty = startY + row * 13;
        drawTokenIcon(ctx, st.queue[i], tx, ty, 1.0);
      }
    }
  }
}

function drawExpressLoco(ctx, x, y, angle, lineColor, hovered) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const w = 24;
  const h = 13;

  if (hovered) {
    ctx.strokeStyle = 'rgba(43, 108, 176, 0.72)';
    ctx.lineWidth = 4;
    ctx.strokeRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4);
  }

  ctx.fillStyle = '#232629';
  ctx.strokeStyle = '#FFFDF9';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2 - 6, -h / 2);
  ctx.quadraticCurveTo(w / 2 + 2, -h / 2, w / 2 + 3, 0);
  ctx.quadraticCurveTo(w / 2 + 2, h / 2, w / 2 - 6, h / 2);
  ctx.lineTo(-w / 2, h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Line-color nose & side accent
  ctx.fillStyle = lineColor;
  ctx.fillRect(-w / 2 + 2, -h / 2 + 2, 7, h - 4);
  ctx.fillStyle = '#E2E8F0';
  ctx.fillRect(w / 2 - 7, -3.5, 4, 7);
  ctx.restore();
}

function drawExpressCoach(ctx, x, y, angle, lineColor, cargoSlice, hovered) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const w = 22;
  const h = 12;

  if (hovered) {
    ctx.strokeStyle = 'rgba(43, 108, 176, 0.72)';
    ctx.lineWidth = 3.5;
    ctx.strokeRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4);
  }

  ctx.fillStyle = lineColor;
  ctx.strokeStyle = '#FFFDF9';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 3);
  ctx.fill();
  ctx.stroke();

  // 3 illuminated window bays (fill as passengers board)
  const bayXs = [-6, 0, 6];
  for (let i = 0; i < 3; i++) {
    const occupied = i < cargoSlice.length;
    ctx.fillStyle = occupied ? '#FEF08A' : 'rgba(255, 253, 249, 0.22)';
    ctx.strokeStyle = occupied ? '#FFFDF9' : 'rgba(255, 253, 249, 0.35)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.roundRect(bayXs[i] - 2.2, -3.2, 4.4, 6.4, 1);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawFreightLoco(ctx, x, y, angle, lineColor, hovered) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const w = 24;
  const h = 14;

  if (hovered) {
    ctx.strokeStyle = 'rgba(43, 108, 176, 0.72)';
    ctx.lineWidth = 4;
    ctx.strokeRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4);
  }

  // Heavy cab-forward / hood diesel body
  ctx.fillStyle = '#5D473A';
  ctx.strokeStyle = '#FFFDF9';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 2.5);
  ctx.fill();
  ctx.stroke();

  // Line-color side stripe & cab roof
  ctx.fillStyle = lineColor;
  ctx.fillRect(-w / 2 + 2, -h / 2 + 1.5, w - 9, h - 3);
  ctx.fillStyle = '#3B3832';
  ctx.fillRect(w / 2 - 8, -h / 2 + 2, 6, h - 4);
  ctx.restore();
}

function drawFreightWagon(ctx, x, y, angle, lineColor, cargoSlice, hovered) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const w = 22;
  const h = 13;

  if (hovered) {
    ctx.strokeStyle = 'rgba(43, 108, 176, 0.72)';
    ctx.lineWidth = 3.5;
    ctx.strokeRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4);
  }

  // Open-top flatbed/hopper wagon
  ctx.fillStyle = '#4A3B32';
  ctx.strokeStyle = '#FFFDF9';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 2);
  ctx.fill();
  ctx.stroke();

  // Line-colored side rails
  ctx.fillStyle = lineColor;
  ctx.fillRect(-w / 2 + 1, -h / 2 + 1, w - 2, 2);
  ctx.fillRect(-w / 2 + 1, h / 2 - 3, w - 2, 2);

  // 3 visible cargo slots inside wagon
  const slotXs = [-6, 0, 6];
  for (let i = 0; i < 3; i++) {
    const tok = cargoSlice[i];
    if (!tok) {
      ctx.fillStyle = 'rgba(255, 253, 249, 0.14)';
      ctx.fillRect(slotXs[i] - 2, -2.5, 4, 5);
    } else if (tok.kind === 'raw') {
      ctx.fillStyle = '#C05621';
      ctx.strokeStyle = '#F6AD55';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.roundRect(slotXs[i] - 2.4, -3.2, 4.8, 6.4, 1.2);
      ctx.fill();
      ctx.stroke();
    } else {
      // Stenciled goods crate
      ctx.fillStyle = '#2B6CB0';
      ctx.strokeStyle = '#EBF8FF';
      ctx.lineWidth = 0.8;
      ctx.fillRect(slotXs[i] - 2.5, -3, 5, 6);
      ctx.strokeRect(slotXs[i] - 2.5, -3, 5, 6);
    }
  }
  ctx.restore();
}

function drawTrains(ctx, state) {
  const carCap = CONFIG.CAR_CAPACITY || 3;
  const carSpacing = CONFIG.CAR_SPACING || 26;

  for (const tr of state.trains) {
    const line = state.lines[tr.lineId];
    if (!line) continue;
    const isFreight = tr.type === 'freight';
    const isHovered = state.interaction.hoveredTrainId === tr.id;
    const cars = tr.cars || CONFIG.TRAIN_DEFAULT_CARS || 2;

    const poses = [{ x: tr.x, y: tr.y, angle: tr.angle }];
    for (let c = 1; c <= cars; c++) {
      poses.push(sampleTrainCarriagePose(tr, c * carSpacing));
    }

    // Coupler bars between locomotive and each carriage
    ctx.save();
    ctx.strokeStyle = '#232629';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    for (let c = 1; c < poses.length; c++) {
      ctx.beginPath();
      ctx.moveTo(poses[c - 1].x, poses[c - 1].y);
      ctx.lineTo(poses[c].x, poses[c].y);
      ctx.stroke();
    }
    ctx.restore();

    // Draw trailing carriages back-to-front
    for (let c = cars; c >= 1; c--) {
      const pose = poses[c];
      const startIdx = (c - 1) * carCap;
      const carCargo = tr.cargo.slice(startIdx, startIdx + carCap);
      if (isFreight) {
        drawFreightWagon(ctx, pose.x, pose.y, pose.angle, line.color, carCargo, isHovered);
      } else {
        drawExpressCoach(ctx, pose.x, pose.y, pose.angle, line.color, carCargo, isHovered);
      }
    }

    // Draw locomotive
    if (isFreight) {
      drawFreightLoco(ctx, tr.x, tr.y, tr.angle, line.color, isHovered);
    } else {
      drawExpressLoco(ctx, tr.x, tr.y, tr.angle, line.color, isHovered);
    }

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

function drawFX(ctx, state) {
  const fx = state.fx;
  if (!fx) return;

  // Smoke & exhaust puffs
  if (fx.puffs && fx.puffs.length > 0) {
    ctx.save();
    for (const p of fx.puffs) {
      const t = Math.min(1, p.age / (p.maxLife || 1));
      const alpha = Math.max(0, (p.alpha ?? 0.7) * (1 - t));
      if (alpha <= 0.01) continue;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color || 'rgba(240, 236, 226, 0.72)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Parabolic boarding/delivery token hops
  if (fx.hops && fx.hops.length > 0) {
    for (const h of fx.hops) {
      drawTokenIcon(ctx, { kind: h.tokenKind, crestColor: h.color }, h.x, h.y, 1.05);
    }
  }

  // Rising world-space floating toasts
  if (fx.floaters && fx.floaters.length > 0) {
    ctx.save();
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of fx.floaters) {
      const t = Math.min(1, f.age / (f.duration || 1.5));
      const alpha = t > 0.65 ? Math.max(0, 1 - (t - 0.65) / 0.35) : 1;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(255, 253, 249, 0.92)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color || CONFIG.COLORS.ink;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
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
  } else if (
    state.interaction.mode === 'dragToken' ||
    state.interaction.mode === 'dragTrain'
  ) {
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

  drawGrid(ctx);
  drawHills(ctx, state.hills);
  drawRiver(ctx, state);
  drawOnboardingGuide(ctx, state);
  drawCorridors(ctx, state);
  drawTBars(ctx, state);
  drawStations(ctx, state);
  drawTrains(ctx, state);
  drawFX(ctx, state);
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

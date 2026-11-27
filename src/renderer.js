import {
  CONFIG,
  edgeKey,
  getEffectiveScale,
  getLineColor,
  getThemePalette,
  sampleTrainCarriagePose,
} from './state.js';
import {
  buildLineSpine,
  buildOctilinearPoints,
  computePolylineLengths,
  computeStationQueueAngle,
  countMountainCrossings,
  countRiverCrossings,
  extractSubPolyline,
  getLineTBarPose,
  samplePointAlongPolyline,
} from './mapGen.js';

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
  if (!points || points.length < 2) return;
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

function fillPolygon(ctx, poly) {
  if (!poly || poly.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) {
    ctx.lineTo(poly[i].x, poly[i].y);
  }
  ctx.closePath();
  ctx.fill();
}

function strokePolygon(ctx, poly) {
  if (!poly || poly.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) {
    ctx.lineTo(poly[i].x, poly[i].y);
  }
  ctx.closePath();
  ctx.stroke();
}

function drawHills(ctx, hills, pal) {
  if (!hills || hills.length === 0) return;
  ctx.save();
  ctx.lineJoin = 'round';
  for (const h of hills) {
    if (Array.isArray(h.ringsPoly) && h.ringsPoly.length > 0) {
      for (let i = 0; i < h.ringsPoly.length; i++) {
        const ring = h.ringsPoly[i];
        if (!ring || ring.length < 3) continue;
        ctx.fillStyle = pal.hillFill;
        fillPolygon(ctx, ring);
        ctx.strokeStyle = pal.hillStroke;
        ctx.lineWidth = i === 0 ? 1.4 : 1.0;
        strokePolygon(ctx, ring);
      }
      continue;
    }
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.angle);
    const scales = [1.0, 0.72, 0.44];
    for (let i = 0; i < scales.length; i++) {
      const s = scales[i];
      ctx.beginPath();
      ctx.ellipse(0, 0, h.rx * s, h.ry * s, 0, 0, Math.PI * 2);
      ctx.fillStyle = pal.hillFill;
      ctx.fill();
      ctx.strokeStyle = pal.hillStroke;
      ctx.lineWidth = i === 0 ? 1.4 : 1.0;
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawMountains(ctx, mountains, pal, isNight) {
  if (!mountains || mountains.length === 0) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const m of mountains) {
    // 1. Outer massif footprint
    if (Array.isArray(m.outerPoly) && m.outerPoly.length >= 3) {
      ctx.fillStyle = pal.mountainOuter;
      fillPolygon(ctx, m.outerPoly);
      ctx.strokeStyle = isNight ? 'rgba(148, 163, 184, 0.24)' : 'rgba(68, 64, 60, 0.28)';
      ctx.lineWidth = 1.3;
      strokePolygon(ctx, m.outerPoly);
    }

    // 2. Mid-elevation stone tier
    if (Array.isArray(m.innerPoly) && m.innerPoly.length >= 3) {
      ctx.fillStyle = pal.mountainInner;
      fillPolygon(ctx, m.innerPoly);
      ctx.strokeStyle = isNight ? 'rgba(203, 213, 225, 0.14)' : 'rgba(68, 64, 60, 0.18)';
      ctx.lineWidth = 1.0;
      strokePolygon(ctx, m.innerPoly);
    }

    // 3. Upper summit polygon
    if (Array.isArray(m.peakPoly) && m.peakPoly.length >= 3) {
      ctx.fillStyle = pal.mountainPeak;
      fillPolygon(ctx, m.peakPoly);
    }

    // 4. Subtle facet shading along one flank of the ridgeline
    if (Array.isArray(m.ridgeLine) && m.ridgeLine.length >= 2 && Array.isArray(m.innerPoly) && m.innerPoly.length >= 4) {
      const rStart = m.ridgeLine[0];
      const rMid = m.ridgeLine[Math.floor(m.ridgeLine.length / 2)];
      const rEnd = m.ridgeLine[m.ridgeLine.length - 1];
      ctx.save();
      ctx.strokeStyle = isNight ? 'rgba(226, 232, 240, 0.14)' : 'rgba(68, 64, 60, 0.16)';
      ctx.lineWidth = 1.0;
      for (let i = 0; i < m.innerPoly.length; i += 3) {
        const anchor = i < m.innerPoly.length * 0.33 ? rStart : i < m.innerPoly.length * 0.66 ? rMid : rEnd;
        ctx.beginPath();
        ctx.moveTo(anchor.x, anchor.y);
        ctx.lineTo(m.innerPoly[i].x, m.innerPoly[i].y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 5. Crisp geometric ridgeline spine
    if (Array.isArray(m.ridgeLine) && m.ridgeLine.length >= 2) {
      ctx.strokeStyle = pal.mountainRidge;
      ctx.lineWidth = 2.4;
      strokePolyline(ctx, m.ridgeLine);

      // Summit diamond marker on central ridge peak
      const crest = m.ridgeLine[Math.floor(m.ridgeLine.length / 2)];
      ctx.fillStyle = pal.mountainRidge;
      ctx.beginPath();
      ctx.moveTo(crest.x, crest.y - 3.6);
      ctx.lineTo(crest.x + 3.6, crest.y);
      ctx.lineTo(crest.x, crest.y + 3.6);
      ctx.lineTo(crest.x - 3.6, crest.y);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawLakes(ctx, lakes, fillStyle, useHalo = false) {
  if (!lakes || lakes.length === 0) return;
  ctx.save();
  ctx.fillStyle = fillStyle;
  for (const l of lakes) {
    const poly = useHalo ? l.haloPoints || l.points : l.points;
    fillPolygon(ctx, poly);
  }
  ctx.restore();
}

function drawRivers(ctx, rivers, strokeStyle, haloPad = 0) {
  if (!rivers || rivers.length === 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = strokeStyle;
  for (const r of rivers) {
    const pts = r?.points;
    if (!pts || pts.length < 2) continue;
    ctx.lineWidth = (r.halfWidth || 25) * 2 + haloPad;
    strokePolyline(ctx, pts);
  }
  ctx.restore();
}

function getCorridorCumLengths(corridor) {
  if (Array.isArray(corridor.cumLengths) && corridor.cumLengths.length === corridor.points.length) {
    return corridor.cumLengths;
  }
  return computePolylineLengths(corridor.points).cumLengths;
}

function drawCorridors(ctx, state, pal) {
  const hoveredKey = state.interaction.hoveredCorridorKey;
  const spotlightId = state.interaction.spotlightLineId;
  const hasSpotlight = spotlightId !== null && spotlightId !== undefined;
  const isNight = state.theme === 'night';

  // Pass 1: Water-only bridges, hill-only tunnels, and corridor hover highlights
  for (const corridor of state.corridors.values()) {
    const activeIds = Array.from(corridor.activeLineIds).sort((a, b) => a - b);
    if (activeIds.length === 0) continue;

    const isHovered = hoveredKey === corridor.key;
    const bundleWidth = (activeIds.length - 1) * CONFIG.LINE_SPACING + 12;
    const cumLengths = getCorridorCumLengths(corridor);

    // Water-only bridges
    if (corridor.hasBridge && Array.isArray(corridor.riverIntervals) && corridor.riverIntervals.length > 0) {
      for (const iv of corridor.riverIntervals) {
        const sub = extractSubPolyline(corridor.points, cumLengths, iv.start, iv.end);
        if (sub.length < 2) continue;
        ctx.save();
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'round';

        ctx.strokeStyle = pal.bridgeStroke;
        ctx.lineWidth = bundleWidth + 8;
        strokePolyline(ctx, sub);

        ctx.strokeStyle = pal.bridgeDeck;
        ctx.lineWidth = bundleWidth + 2;
        strokePolyline(ctx, sub);
        ctx.restore();
      }
    }

    // Mountain & hill tunnel portal sleeves with crisp stone portal caps [ ]
    const tunnelIntervals = [];
    if (
      (corridor.hasTunnel || corridor.hasMountainTunnel) &&
      Array.isArray(corridor.mountainIntervals) &&
      corridor.mountainIntervals.length > 0
    ) {
      tunnelIntervals.push(...corridor.mountainIntervals);
    }
    if (corridor.hasTunnel && Array.isArray(corridor.hillIntervals) && corridor.hillIntervals.length > 0) {
      tunnelIntervals.push(...corridor.hillIntervals);
    }

    if (tunnelIntervals.length > 0) {
      const portalColor = isNight ? '#CBD5E1' : '#3B3832';
      const sleeveColor = isNight ? 'rgba(226, 232, 240, 0.26)' : 'rgba(59, 56, 50, 0.32)';
      const hw = bundleWidth * 0.5 + 4.5;
      const lip = 5.0;

      for (const iv of tunnelIntervals) {
        const sub = extractSubPolyline(corridor.points, cumLengths, iv.start, iv.end);
        if (sub.length < 2) continue;

        ctx.save();
        ctx.strokeStyle = sleeveColor;
        ctx.lineWidth = bundleWidth + 8;
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'round';
        ctx.setLineDash([6, 5]);
        strokePolyline(ctx, sub);

        // Stone portal caps [ ] at tunnel entrance and exit
        ctx.setLineDash([]);
        ctx.strokeStyle = portalColor;
        ctx.lineWidth = 2.6;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const pStart = samplePointAlongPolyline(corridor.points, cumLengths, iv.start);
        const sNx = -pStart.ty;
        const sNy = pStart.tx;
        ctx.beginPath();
        ctx.moveTo(pStart.x + sNx * hw + pStart.tx * lip, pStart.y + sNy * hw + pStart.ty * lip);
        ctx.lineTo(pStart.x + sNx * hw, pStart.y + sNy * hw);
        ctx.lineTo(pStart.x - sNx * hw, pStart.y - sNy * hw);
        ctx.lineTo(pStart.x - sNx * hw + pStart.tx * lip, pStart.y - sNy * hw + pStart.ty * lip);
        ctx.stroke();

        const pEnd = samplePointAlongPolyline(corridor.points, cumLengths, iv.end);
        const eNx = -pEnd.ty;
        const eNy = pEnd.tx;
        ctx.beginPath();
        ctx.moveTo(pEnd.x + eNx * hw - pEnd.tx * lip, pEnd.y + eNy * hw - pEnd.ty * lip);
        ctx.lineTo(pEnd.x + eNx * hw, pEnd.y + eNy * hw);
        ctx.lineTo(pEnd.x - eNx * hw, pEnd.y - eNy * hw);
        ctx.lineTo(pEnd.x - eNx * hw - pEnd.tx * lip, pEnd.y - eNy * hw - pEnd.ty * lip);
        ctx.stroke();

        ctx.restore();
      }
    }

    // Hover highlight
    if (isHovered) {
      ctx.save();
      ctx.strokeStyle = isNight ? 'rgba(241, 245, 249, 0.16)' : 'rgba(35, 38, 41, 0.14)';
      ctx.lineWidth = bundleWidth + 10;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      strokePolyline(ctx, corridor.points);
      ctx.restore();
    }
  }

  // Pass 2: Smooth active transit lines (along spine when unshared, parallel offset when shared)
  for (const line of state.lines) {
    if (!line.stations || line.stations.length < 2) continue;

    const lineColor = getLineColor(state, line.id);
    const isDimmed = hasSpotlight && spotlightId !== line.id;
    const baseAlpha = isDimmed ? 0.18 : 1.0;

    const n = line.stations.length;
    const legCount = line.isLoop ? n : n - 1;
    let hasSharedOrRemoving = line.removingEdges && line.removingEdges.size > 0;
    let hasAnyDoubleTrack = false;

    if (!hasSharedOrRemoving) {
      for (let i = 0; i < legCount; i++) {
        const aId = line.stations[i];
        const bId = line.stations[(i + 1) % n];
        const corr = state.corridors.get(edgeKey(aId, bId));
        if (!corr) continue;
        if (corr.activeLineIds.size > 1) {
          hasSharedOrRemoving = true;
          break;
        }
        if (corr.isDoubleTrack) hasAnyDoubleTrack = true;
      }
    }

    if (!hasSharedOrRemoving) {
      const spine = line.spine && line.spine.points?.length >= 2 ? line.spine : buildLineSpine(state, line);
      if (spine && spine.points.length >= 2) {
        ctx.save();
        ctx.globalAlpha = baseAlpha;
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 4.8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        strokePolyline(ctx, spine.points);
        ctx.restore();
      }

      if (hasAnyDoubleTrack) {
        for (let i = 0; i < legCount; i++) {
          const aId = line.stations[i];
          const bId = line.stations[(i + 1) % n];
          const corr = state.corridors.get(edgeKey(aId, bId));
          if (!corr || !corr.isDoubleTrack) continue;
          ctx.save();
          ctx.globalAlpha = baseAlpha;
          ctx.strokeStyle = lineColor;
          ctx.lineWidth = 5.6;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          strokePolyline(ctx, corr.points);

          ctx.strokeStyle = pal.bg;
          ctx.lineWidth = 1.4;
          strokePolyline(ctx, corr.points);
          ctx.restore();
        }
      }
    } else {
      for (let i = 0; i < legCount; i++) {
        const aId = line.stations[i];
        const bId = line.stations[(i + 1) % n];
        const key = edgeKey(aId, bId);
        const corr = state.corridors.get(key);
        if (!corr || !corr.points || corr.points.length < 2) continue;

        const activeIds = Array.from(corr.activeLineIds).sort((a, b) => a - b);
        const idx = activeIds.indexOf(line.id);
        const count = activeIds.length;
        const offset = idx >= 0 && count > 1 ? (idx - (count - 1) * 0.5) * CONFIG.LINE_SPACING : 0;
        const pts = offsetPolyline(corr.points, offset);
        const isRemoving = line.removingEdges?.has(key);

        ctx.save();
        ctx.globalAlpha = isRemoving ? baseAlpha * 0.35 : baseAlpha;
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = corr.isDoubleTrack ? 5.6 : 4.8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (isRemoving) {
          ctx.setLineDash([8, 8]);
        }
        strokePolyline(ctx, pts);

        if (corr.isDoubleTrack && !isRemoving) {
          ctx.strokeStyle = pal.bg;
          ctx.lineWidth = 1.4;
          strokePolyline(ctx, pts);
        }
        ctx.restore();
      }
    }
  }

  // Pass 3: Upgrade badges at corridor midpoint
  for (const corridor of state.corridors.values()) {
    if (corridor.activeLineIds.size === 0) continue;
    if (!corridor.isDoubleTrack && !corridor.hasTunnel) continue;

    const midPt = corridor.points[Math.floor(corridor.points.length / 2)];
    if (!midPt) continue;

    ctx.save();
    ctx.fillStyle = pal.ink;
    ctx.strokeStyle = pal.stationFill;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(midPt.x, midPt.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = pal.stationFill;
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

function drawTBars(ctx, state, pal) {
  const spotlightId = state.interaction.spotlightLineId;
  const hasSpotlight = spotlightId !== null && spotlightId !== undefined;

  for (const line of state.lines) {
    if (!line.stations || line.stations.length < 2 || line.isLoop) continue;
    const lineColor = getLineColor(state, line.id);
    const isDimmed = hasSpotlight && spotlightId !== line.id;

    for (const end of ['start', 'end']) {
      const pose = getLineTBarPose(state, line, end);
      if (!pose) continue;
      const st = state.stationById.get(pose.stationId);
      if (!st) continue;

      const isHovered =
        state.interaction.hoveredTBar &&
        state.interaction.hoveredTBar.lineId === line.id &&
        state.interaction.hoveredTBar.end === end;

      ctx.save();
      if (isDimmed) ctx.globalAlpha = 0.18;
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = isHovered ? 6 : 4.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(st.x, st.y);
      ctx.lineTo(pose.x, pose.y);
      ctx.moveTo(pose.x - pose.px * 9, pose.y - pose.py * 9);
      ctx.lineTo(pose.x + pose.px * 9, pose.y + pose.py * 9);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawOnboardingGuide(ctx, state, pal) {
  if (state.onboarding?.freightLineBuilt || state.week !== 1) return;
  const ids = state.onboarding?.starterIds;
  if (!ids) return;

  const resSt = state.stationById.get(ids.resourceId);
  const facSt = state.stationById.get(ids.factoryId);
  const citySt = state.stationById.get(ids.cityId);
  if (!resSt || !facSt || !citySt) return;

  const water = { rivers: state.rivers, lakes: state.lakes, river: state.river };
  const ctxOpts = { stations: state.stations, mountains: state.mountains };
  const leg1 = buildOctilinearPoints(resSt.x, resSt.y, facSt.x, facSt.y, water, state.hills, ctxOpts);
  const leg2 = buildOctilinearPoints(facSt.x, facSt.y, citySt.x, citySt.y, water, state.hills, ctxOpts);
  const combined = leg1.concat(leg2.slice(1));
  if (combined.length < 2) return;

  const { cumLengths, totalLength } = computePolylineLengths(combined);
  if (totalLength <= 0) return;

  const phase = ((state.fx?.onboardingPhase ?? 0) % 1 + 1) % 1;
  const cursorPt = samplePointAlongPolyline(combined, cumLengths, phase * totalLength);

  ctx.save();
  // Wordless animated ghost line
  ctx.strokeStyle = state.theme === 'night' ? 'rgba(255, 90, 61, 0.36)' : 'rgba(217, 78, 52, 0.34)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([8, 8]);
  ctx.lineDashOffset = -phase * 48;
  strokePolyline(ctx, combined);
  ctx.setLineDash([]);

  // Subtle origin pulse at Timber Camp at start of cycle
  if (phase < 0.25) {
    const pFrac = phase / 0.25;
    ctx.globalAlpha = (1 - pFrac) * 0.6;
    ctx.strokeStyle = pal.danger;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(resSt.x, resSt.y, CONFIG.STATION_RADIUS + 4 + pFrac * 14, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Gliding finger / circle pulse along Timber Camp -> Millworks -> Grandhaven
  const pulseScale = 1 + Math.sin(phase * Math.PI * 6) * 0.12;
  ctx.globalAlpha = 0.26;
  ctx.fillStyle = pal.danger;
  ctx.beginPath();
  ctx.arc(cursorPt.x, cursorPt.y, 14 * pulseScale, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.95;
  ctx.fillStyle = pal.stationFill;
  ctx.strokeStyle = pal.danger;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(cursorPt.x, cursorPt.y, 7.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawMeeple(ctx, fill, stroke, lineWidth = 1.6) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';

  // Chubby rounded body
  ctx.beginPath();
  ctx.roundRect(-5, -1.2, 10, 7.6, 3.6);
  ctx.fill();
  ctx.stroke();

  // Plump head
  ctx.beginPath();
  ctx.arc(0, -4.4, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawTokenIcon(ctx, tok, x, y, scale = 1, pal = null) {
  const theme = pal || getThemePalette(null);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  const kind = tok?.kind;

  if (kind === 'goods') {
    // Plump rounded Parcel Box (13x12, rx=3) with Freight dark-steel frame pairing
    const w = 13;
    const h = 12;
    ctx.fillStyle = '#EAB308';
    ctx.strokeStyle = theme.freightFrame || theme.ink;
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 3);
    ctx.fill();
    ctx.stroke();

    // Crisp cream parcel tape cross
    ctx.strokeStyle = '#FFFBEB';
    ctx.lineWidth = 1.7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -h / 2 + 2);
    ctx.lineTo(0, h / 2 - 2);
    ctx.moveTo(-w / 2 + 2, 0);
    ctx.lineTo(w / 2 - 2, 0);
    ctx.stroke();
  } else if (kind === 'raw') {
    // Plump rounded Timber/Ingot Cylinder (14x10, rx=4.5) with Freight dark-steel frame pairing
    const w = 14;
    const h = 10;
    ctx.fillStyle = '#C2410C';
    ctx.strokeStyle = theme.freightFrame || theme.ink;
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 4.5);
    ctx.fill();
    ctx.stroke();

    // Bright circular end-grain cap
    ctx.fillStyle = '#FDBA74';
    ctx.beginPath();
    ctx.arc(3.2, 0, 2.7, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'commuter') {
    // Plump rounded Meeple in pal.ink with crisp contrast outline
    drawMeeple(ctx, theme.ink, theme.stationFill, 1.5);
  } else if (kind === 'local') {
    // Plump rounded Meeple in #EA580C with crisp white inner dot
    drawMeeple(ctx, '#EA580C', theme.stationFill, 1.5);
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(0, 2.5, 1.7, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'intercity') {
    // Plump rounded Meeple in tok.crestColor with crisp white outline
    drawMeeple(ctx, tok.crestColor || '#2563EB', '#FFFFFF', 1.6);
  } else {
    drawShape(ctx, tok?.targetShape || 'circle', 0, 0, 4.5, theme.ink, null, 1);
  }

  ctx.restore();
}

function drawRoundedTriangle(ctx, x, y, r) {
  const pts = [];
  for (let i = 0; i < 3; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI * 2) / 3;
    pts.push({ x: x + Math.cos(ang) * r, y: y + Math.sin(ang) * r });
  }
  const cr = 0.18;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const pPrev = pts[(i + 2) % 3];
    const pCurr = pts[i];
    const pNext = pts[(i + 1) % 3];
    const aX = pCurr.x + (pPrev.x - pCurr.x) * cr;
    const aY = pCurr.y + (pPrev.y - pCurr.y) * cr;
    const bX = pCurr.x + (pNext.x - pCurr.x) * cr;
    const bY = pCurr.y + (pNext.y - pCurr.y) * cr;
    if (i === 0) ctx.moveTo(aX, aY);
    else ctx.lineTo(aX, aY);
    ctx.quadraticCurveTo(pCurr.x, pCurr.y, bX, bY);
  }
  ctx.closePath();
}

function drawRimProgress(ctx, st, r, pal, isNight) {
  const rimR = r + (st.isInterchange ? 7.5 : 4.5);

  // Hamlet / Town segmented amber/gold goodsProgress arc
  if (st.kind === 'settlement' && typeof st.goodsTarget === 'number' && st.goodsTarget > 0) {
    const total = st.goodsTarget;
    const filled = Math.min(total, st.goodsProgress || 0);
    const gap = 0.16;
    const segSpan = (Math.PI * 2 - total * gap) / total;
    const startBase = -Math.PI / 2 + gap * 0.5;

    ctx.save();
    ctx.lineWidth = 3.0;
    ctx.lineCap = 'round';
    for (let i = 0; i < total; i++) {
      const a0 = startBase + i * (segSpan + gap);
      const a1 = a0 + segSpan;
      ctx.beginPath();
      ctx.arc(st.x, st.y, rimR, a0, a1);
      ctx.strokeStyle =
        i < filled
          ? isNight
            ? '#FACC15'
            : '#D97706'
          : isNight
          ? 'rgba(148, 163, 184, 0.22)'
          : 'rgba(110, 106, 97, 0.22)';
      ctx.stroke();
    }
    ctx.restore();
  }

  // Factory segmented terracotta input dots + smooth radial conversion arc
  if (st.kind === 'factory') {
    const maxInput = CONFIG.FACTORY_INPUT_MAX || 6;
    const filledInput = Math.min(maxInput, st.inputBuffer || 0);
    const frac = Math.max(0, Math.min(1, st.processProgress || 0));

    ctx.save();
    // Smooth conversion progress arc
    if (frac > 0.01) {
      ctx.beginPath();
      ctx.arc(st.x, st.y, rimR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.strokeStyle = isNight ? '#FACC15' : '#D97706';
      ctx.lineWidth = 2.8;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Segmented terracotta input dots around upper arc
    const dotSpread = Math.PI * 0.9;
    const dotStart = -Math.PI / 2 - dotSpread * 0.5;
    for (let i = 0; i < maxInput; i++) {
      const ang = dotStart + (i / (maxInput - 1)) * dotSpread;
      const dx = st.x + Math.cos(ang) * (rimR + 4.5);
      const dy = st.y + Math.sin(ang) * (rimR + 4.5);
      ctx.beginPath();
      ctx.arc(dx, dy, 2.3, 0, Math.PI * 2);
      ctx.fillStyle =
        i < filledInput
          ? '#EA580C'
          : isNight
          ? 'rgba(148, 163, 184, 0.28)'
          : 'rgba(110, 106, 97, 0.25)';
      ctx.fill();
      if (i < filledInput) {
        ctx.strokeStyle = pal.stationFill;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

function getStationSubtitle(st) {
  if (st.kind === 'settlement') {
    const tier = st.tier || (st.subtype === 'city' ? 3 : st.subtype === 'town' ? 2 : 1);
    if (tier >= 3) return 'City';
    const role = tier === 2 ? 'Town' : 'Hamlet';
    if (typeof st.goodsTarget === 'number' && st.goodsTarget > 0) {
      return `${role} · ${st.goodsProgress || 0}/${st.goodsTarget} Goods`;
    }
    return role;
  }
  if (st.kind === 'resource') {
    return st.subtype === 'mine' ? 'Mine' : 'Forest';
  }
  if (st.kind === 'factory') {
    return 'Factory';
  }
  return '';
}

function drawHoverLabel(ctx, st, r, pal, isNight) {
  const title = st.name || '';
  if (!title) return;
  let sub = getStationSubtitle(st);
  if (st.needsFreightCue) {
    sub = sub ? `${sub} · Needs Freight Train` : 'Needs Freight Train';
  }

  ctx.save();
  ctx.font = 'bold 10.5px sans-serif';
  const titleW = ctx.measureText(title).width;
  ctx.font = '600 8.5px sans-serif';
  const subW = sub ? ctx.measureText(sub).width : 0;
  const w = Math.max(titleW, subW) + 18;
  const h = sub ? 27 : 18;
  const x = st.x;
  const y = st.y + r + 22;

  ctx.fillStyle = pal.stationFill;
  ctx.strokeStyle = isNight ? 'rgba(241, 245, 249, 0.25)' : 'rgba(35, 38, 41, 0.22)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 8);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = pal.ink;
  ctx.font = 'bold 10.5px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, x, sub ? y - 4.5 : y + 0.5);

  if (sub) {
    ctx.fillStyle = pal.muted;
    ctx.font = '600 8.5px sans-serif';
    ctx.fillText(sub, x, y + 6.5);
  }
  ctx.restore();
}

function drawStations(ctx, state, pal) {
  const hoveredId = state.interaction.hoveredStationId;
  const isNight = state.theme === 'night';
  const showAllLabels = state.camera.zoom >= 1.45;

  for (const st of state.stations) {
    const isHovered = st.id === hoveredId;
    const hoverScale =
      typeof st.hoverScale === 'number' ? st.hoverScale : isHovered ? 1.12 : 1.0;
    const popScale = hoverScale + (st.pulse || 0) * 0.32;
    const r = CONFIG.STATION_RADIUS * popScale;

    // Overflow radial warning ring
    if (st.overflowTimer > 0) {
      const frac = Math.min(1, st.overflowTimer / CONFIG.OVERFLOW_DURATION);
      const warnR = r + (st.isInterchange ? 12 : 9);
      ctx.save();
      ctx.beginPath();
      ctx.arc(st.x, st.y, warnR, 0, Math.PI * 2);
      ctx.strokeStyle = isNight ? 'rgba(248, 113, 113, 0.22)' : 'rgba(217, 78, 52, 0.22)';
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(st.x, st.y, warnR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.strokeStyle = pal.danger;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // Hover halo
    if (isHovered) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(st.x, st.y, r + 7, 0, Math.PI * 2);
      ctx.strokeStyle = isNight ? 'rgba(241, 245, 249, 0.28)' : 'rgba(35, 38, 41, 0.24)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    // Interchange outer crisp ring
    if (st.isInterchange) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(st.x, st.y, r + 4.2, 0, Math.PI * 2);
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.restore();
    }

    // Bold Geometric Station Node
    ctx.save();
    ctx.fillStyle = pal.stationFill;
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 3.2;
    ctx.lineJoin = 'round';

    if (st.kind === 'settlement') {
      const tier = st.tier || (st.subtype === 'city' ? 3 : st.subtype === 'town' ? 2 : 1);
      if (tier >= 3) {
        // City: Bold Double-Ring Hub (r * 1.18) with thick inner crestColor ring (lineWidth = 4.2)
        const hubR = r * 1.18;
        ctx.beginPath();
        ctx.arc(st.x, st.y, hubR, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(st.x, st.y, Math.max(4, hubR - 5.5), 0, Math.PI * 2);
        ctx.strokeStyle = st.crestColor || '#2563EB';
        ctx.lineWidth = 4.2;
        ctx.stroke();
      } else if (tier === 2) {
        // Town: Crisp Rounded Square (r * 1.02, rx = 5)
        const s = r * 1.02;
        ctx.beginPath();
        ctx.roundRect(st.x - s, st.y - s, s * 2, s * 2, 5);
        ctx.fill();
        ctx.stroke();
      } else {
        // Hamlet: Crisp Circle (r)
        ctx.beginPath();
        ctx.arc(st.x, st.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else if (st.kind === 'resource') {
      // Resource Site: Bold Equilateral Rounded Triangle
      drawRoundedTriangle(ctx, st.x, st.y + 1, r * 1.16);
      ctx.fill();
      ctx.stroke();

      if (st.subtype === 'mine') {
        // Slate inner diamond/pick emblem
        ctx.fillStyle = '#64748B';
        ctx.beginPath();
        ctx.moveTo(st.x, st.y - 4.5);
        ctx.lineTo(st.x + 5, st.y + 1.5);
        ctx.lineTo(st.x, st.y + 6.5);
        ctx.lineTo(st.x - 5, st.y + 1.5);
        ctx.closePath();
        ctx.fill();
      } else {
        // Forest deep green inner emblem
        ctx.fillStyle = '#16A34A';
        drawRoundedTriangle(ctx, st.x, st.y + 2, r * 0.46);
        ctx.fill();
      }
    } else if (st.kind === 'factory') {
      // Factory: Bold Sawtooth-Top Square silhouette (r * 1.08) in pal.ink + terracotta accent
      const s = r * 1.08;
      ctx.beginPath();
      ctx.roundRect(st.x - s, st.y - s, s * 2, s * 2, 4);
      ctx.fill();
      ctx.stroke();

      // Sawtooth silhouette inside
      ctx.fillStyle = pal.ink;
      ctx.beginPath();
      ctx.moveTo(st.x - s * 0.62, st.y + s * 0.46);
      ctx.lineTo(st.x - s * 0.62, st.y - s * 0.36);
      ctx.lineTo(st.x - s * 0.18, st.y - s * 0.04);
      ctx.lineTo(st.x - s * 0.18, st.y - s * 0.36);
      ctx.lineTo(st.x + s * 0.26, st.y - s * 0.04);
      ctx.lineTo(st.x + s * 0.26, st.y - s * 0.36);
      ctx.lineTo(st.x + s * 0.62, st.y - s * 0.04);
      ctx.lineTo(st.x + s * 0.62, st.y + s * 0.46);
      ctx.closePath();
      ctx.fill();

      // Warm industrial terracotta accent bar
      ctx.fillStyle = '#EA580C';
      ctx.fillRect(st.x - s * 0.62, st.y + s * 0.28, s * 1.24, s * 0.22);
    } else {
      drawShape(ctx, st.shape, st.x, st.y, r, pal.stationFill, pal.ink, 3.2);
    }
    ctx.restore();

    // Rim progress arcs & factory input dots
    drawRimProgress(ctx, st, r, pal, isNight);

    // Dynamic track-free waiting queue
    if (st.queue && st.queue.length > 0) {
      const qAngle =
        typeof st.queueAngle === 'number' ? st.queueAngle : computeStationQueueAngle(state, st);
      const ux = Math.cos(qAngle);
      const uy = Math.sin(qAngle);
      const px = -uy;
      const py = ux;
      const cols = 4;
      const spacing = 17;
      const startDist = r + 16;
      const rowCount = Math.ceil(st.queue.length / cols);

      for (let i = 0; i < st.queue.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const distAlong = startDist + col * spacing;
        const rowOffset = (row - (rowCount - 1) * 0.5) * spacing;
        const tx = st.x + ux * distAlong + px * rowOffset;
        const ty = st.y + uy * distAlong + py * rowOffset;

        ctx.save();
        ctx.fillStyle = pal.queueHalo;
        ctx.beginPath();
        ctx.arc(tx, ty, 9.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        drawTokenIcon(ctx, st.queue[i], tx, ty, 1.0, pal);
      }
    }

    // Subtle bobbing/pulsing mini Freight Hopper cue when station needs Freight service
    if (st.needsFreightCue) {
      const phase = state.fx?.cuePhase ?? (state.simTime || 0) * 3.0;
      const bobY = Math.sin(phase) * 2.4;
      const pulse = 1 + Math.cos(phase) * 0.05;
      const bx = st.x;
      const by = st.y - r - 17 + bobY;

      ctx.save();
      ctx.translate(bx, by);
      ctx.scale(pulse, pulse);

      // Badge backing pill
      ctx.fillStyle = pal.stationFill;
      ctx.strokeStyle = pal.freightFrame || pal.ink;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(-12, -7.5, 24, 15, 4);
      ctx.fill();
      ctx.stroke();

      // Mini dark-framed Freight Hopper silhouette
      ctx.fillStyle = pal.freightFrame || '#1E293B';
      ctx.beginPath();
      ctx.roundRect(-8.5, -4.5, 17, 9, 1.8);
      ctx.fill();

      // Amber side-girders + ribs
      ctx.fillStyle = '#F59E0B';
      ctx.fillRect(-7.5, -3.5, 15, 1.8);
      ctx.fillRect(-7.5, 1.7, 15, 1.8);
      ctx.fillStyle = pal.freightFrame || '#1E293B';
      ctx.fillRect(-2.8, -4, 1.4, 8);
      ctx.fillRect(1.4, -4, 1.4, 8);
      ctx.restore();
    }

    // Minimalist hover / high-zoom label
    if (isHovered || showAllLabels) {
      drawHoverLabel(ctx, st, r, pal, isNight);
    }
  }
}

function drawExpressUnit(ctx, x, y, angle, lineColor, isLead, cargoSlice, hovered, pal) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const w = 25;
  const h = 10.8;

  if (hovered) {
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 3.6;
    ctx.beginPath();
    ctx.roundRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4, 7.4);
    ctx.stroke();
  }

  // Sleek 25x10.8 stadium pill (rx = 5.4) in lineColor
  ctx.fillStyle = lineColor;
  ctx.strokeStyle = pal.stationFill;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 5.4);
  ctx.fill();
  ctx.stroke();

  if (isLead) {
    // Curved panoramic white windshield arc at the nose (+x)
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(w / 2 - 6.2, -3.6);
    ctx.quadraticCurveTo(w / 2 - 0.8, 0, w / 2 - 6.2, 3.6);
    ctx.quadraticCurveTo(w / 2 - 3.6, 0, w / 2 - 6.2, -3.6);
    ctx.closePath();
    ctx.fill();
  } else {
    // 3 crisp circular passenger windows
    const pipXs = [-6.5, 0, 6.5];
    for (let i = 0; i < 3; i++) {
      const occupied = i < cargoSlice.length;
      ctx.beginPath();
      ctx.arc(pipXs[i], 0, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = occupied ? '#FFFFFF' : 'rgba(255, 255, 255, 0.28)';
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawFreightUnit(ctx, x, y, angle, lineColor, isLead, cargoSlice, hovered, pal) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const w = 21;
  const h = 14.2;
  const frameColor = pal.freightFrame || '#1E293B';

  if (hovered) {
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 3.6;
    ctx.beginPath();
    ctx.roundRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4, 3.6);
    ctx.stroke();
  }

  // Bold dark-steel structural chassis (21x14.2, rx = 2.2)
  ctx.fillStyle = frameColor;
  ctx.strokeStyle = pal.stationFill;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 2.2);
  ctx.fill();
  ctx.stroke();

  // Thick lineColor side-girders along both flanks
  ctx.fillStyle = lineColor;
  ctx.fillRect(-w / 2 + 1.4, -h / 2 + 1.1, w - 2.8, 2.5);
  ctx.fillRect(-w / 2 + 1.4, h / 2 - 3.6, w - 2.8, 2.5);

  if (isLead) {
    // Twin-hood industrial diesel cab + nose chevrons
    ctx.fillStyle = lineColor;
    ctx.beginPath();
    ctx.roundRect(-w / 2 + 2.2, -4.0, 9.5, 8.0, 1.4);
    ctx.fill();

    // Cab roof / windshield visor
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(-w / 2 + 8.8, -3.1, 2.2, 6.2);

    // Nose chevron stripes at +x
    ctx.strokeStyle = '#FACC15';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(w / 2 - 5.2, -3.4);
    ctx.lineTo(w / 2 - 2.6, 0);
    ctx.lineTo(w / 2 - 5.2, 3.4);
    ctx.stroke();
  } else {
    // 3 recessed cargo compartments separated by 2 dark cross-ribs
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.beginPath();
    ctx.roundRect(-w / 2 + 2.0, -h / 2 + 3.6, w - 4.0, h - 7.2, 1.2);
    ctx.fill();

    // 2 dark cross-ribs dividing the 3 cargo bays
    ctx.fillStyle = frameColor;
    ctx.fillRect(-3.4, -h / 2 + 3.4, 1.6, h - 6.8);
    ctx.fillRect(1.8, -h / 2 + 3.4, 1.6, h - 6.8);

    const slotXs = [-5.5, 0, 5.5];
    for (let i = 0; i < 3; i++) {
      const tok = cargoSlice[i];
      if (tok) {
        drawTokenIcon(ctx, tok, slotXs[i], 0, 0.36, pal);
      }
    }
  }
  ctx.restore();
}

function drawTrains(ctx, state, pal) {
  const carCap = CONFIG.CAR_CAPACITY || 3;
  const carSpacing = CONFIG.CAR_SPACING || 23;
  const spotlightId = state.interaction.spotlightLineId;
  const hasSpotlight = spotlightId !== null && spotlightId !== undefined;

  for (const tr of state.trains) {
    const line = state.lines[tr.lineId];
    if (!line) continue;

    const lineColor = getLineColor(state, tr.lineId);
    const isFreight = tr.type === 'freight';
    const isHovered = state.interaction.hoveredTrainId === tr.id;
    const isDimmed = hasSpotlight && spotlightId !== tr.lineId;
    const cars = tr.cars || CONFIG.TRAIN_DEFAULT_CARS || 2;

    let poses = Array.isArray(tr.unitPoses) && tr.unitPoses.length > 0 ? tr.unitPoses : null;
    if (!poses) {
      poses = [{ x: tr.x, y: tr.y, angle: tr.angle }];
      for (let c = 1; c <= cars; c++) {
        poses.push(sampleTrainCarriagePose(tr, c * carSpacing));
      }
    }

    ctx.save();
    if (isDimmed) ctx.globalAlpha = 0.18;

    // Coupler bars between articulated units
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    for (let c = 1; c < poses.length; c++) {
      ctx.beginPath();
      ctx.moveTo(poses[c - 1].x, poses[c - 1].y);
      ctx.lineTo(poses[c].x, poses[c].y);
      ctx.stroke();
    }

    // Draw trailing cars back-to-front, then lead unit (poses[0])
    for (let c = poses.length - 1; c >= 0; c--) {
      const pose = poses[c];
      const isLead = c === 0;
      const startIdx = (c - 1) * carCap;
      const carCargo = isLead ? [] : tr.cargo.slice(startIdx, startIdx + carCap);

      if (isFreight) {
        drawFreightUnit(ctx, pose.x, pose.y, pose.angle, lineColor, isLead, carCargo, isHovered, pal);
      } else {
        drawExpressUnit(ctx, pose.x, pose.y, pose.angle, lineColor, isLead, carCargo, isHovered, pal);
      }
    }

    // Waiting-at-siding amber signal dot
    if (tr.state === 'waitingBlock') {
      const lead = poses[0];
      ctx.fillStyle = '#EAB308';
      ctx.strokeStyle = pal.stationFill;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(lead.x, lead.y - 14, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }
}

function drawFX(ctx, state, pal) {
  const fx = state.fx;
  if (!fx) return;

  // Overcrowding warning pulse rings
  if (fx.pulses && fx.pulses.length > 0) {
    ctx.save();
    for (const pl of fx.pulses) {
      const t = Math.min(1, pl.age / (pl.life || 0.9));
      const alpha = Math.max(0, (1 - t) * 0.78);
      if (alpha <= 0.01) continue;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = pl.color || pal.danger;
      ctx.lineWidth = 3.2 * (1 - t * 0.45);
      ctx.beginPath();
      ctx.arc(pl.x, pl.y, pl.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

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
      drawTokenIcon(ctx, { kind: h.tokenKind, crestColor: h.color }, h.x, h.y, 1.0, pal);
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
      ctx.strokeStyle = pal.stationFill;
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color || pal.ink;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }
}

function drawDragPill(ctx, x, y, text, bgColor, textColor) {
  const w = Math.max(72, text.length * 7 + 16);
  ctx.save();
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 11, w, 22, 11);
  ctx.fill();
  ctx.fillStyle = textColor;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}

function drawDragPreview(ctx, state, pal) {
  const drag = state.interaction.drag;
  if (!drag) return;

  const water = { rivers: state.rivers, lakes: state.lakes, river: state.river };

  if (state.interaction.mode === 'buildLine' || state.interaction.mode === 'insertNode') {
    const line = state.lines[drag.lineId];
    const fromSt = state.stationById.get(drag.fromStationId);
    if (!line || !fromSt) return;

    const lineColor = getLineColor(state, line.id);
    const targetSt = drag.snapStationId ? state.stationById.get(drag.snapStationId) : null;
    const tx = targetSt ? targetSt.x : drag.worldX;
    const ty = targetSt ? targetSt.y : drag.worldY;

    const pts = buildOctilinearPoints(fromSt.x, fromSt.y, tx, ty, water, state.hills, {
      stations: state.stations,
      mountains: state.mountains,
    });
    const crossings = countRiverCrossings(pts, water);
    const mCrossings = countMountainCrossings(pts, state.mountains);
    const existing = targetSt ? state.corridors.get(edgeKey(fromSt.id, targetSt.id)) : null;

    const needsBridge = crossings > 0 && !(existing && existing.hasBridge);
    const needsTunnel = mCrossings > 0 && !(existing && existing.hasMountainTunnel);
    const blockedBridge = needsBridge && state.inventory.bridge <= 0;
    const blockedTunnel = needsTunnel && state.inventory.tunnel <= 0;
    const blocked = blockedBridge || blockedTunnel;

    ctx.save();
    ctx.strokeStyle = blocked ? pal.danger : lineColor;
    ctx.lineWidth = 4.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.72;
    ctx.setLineDash(blocked ? [6, 6] : [10, 6]);
    strokePolyline(ctx, pts);
    ctx.restore();

    if (needsBridge && needsTunnel) {
      const p1 = pts[Math.max(0, Math.floor(pts.length / 3))];
      const p2 = pts[Math.min(pts.length - 1, Math.floor((pts.length * 2) / 3))];
      drawDragPill(
        ctx,
        p1.x,
        p1.y - 12,
        blockedBridge ? 'NO BRIDGE' : 'BRIDGE -1',
        blockedBridge ? pal.danger : pal.ink,
        pal.stationFill
      );
      drawDragPill(
        ctx,
        p2.x,
        p2.y + 12,
        blockedTunnel ? 'NO TUNNEL' : 'TUNNEL -1',
        blockedTunnel ? pal.danger : pal.ink,
        pal.stationFill
      );
    } else if (needsBridge) {
      const mid = pts[Math.floor(pts.length / 2)];
      drawDragPill(
        ctx,
        mid.x,
        mid.y,
        blockedBridge ? 'NO BRIDGE' : 'BRIDGE -1',
        blockedBridge ? pal.danger : pal.ink,
        pal.stationFill
      );
    } else if (needsTunnel) {
      const mid = pts[Math.floor(pts.length / 2)];
      drawDragPill(
        ctx,
        mid.x,
        mid.y,
        blockedTunnel ? 'NO TUNNEL' : 'TUNNEL -1',
        blockedTunnel ? pal.danger : pal.ink,
        pal.stationFill
      );
    }
  } else if (state.interaction.mode === 'detachStation') {
    const line = state.lines[drag.lineId];
    if (!line) return;
    const lineColor = getLineColor(state, line.id);
    const prevSt = drag.prevId != null ? state.stationById.get(drag.prevId) : null;
    const nextSt = drag.nextId != null ? state.stationById.get(drag.nextId) : null;
    const snapSt =
      drag.snapStationId && drag.snapStationId !== drag.stationId
        ? state.stationById.get(drag.snapStationId)
        : null;
    const ctxOpts = { stations: state.stations, mountains: state.mountains };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (snapSt) {
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 4.6;
      ctx.globalAlpha = 0.78;
      ctx.setLineDash([10, 6]);
      if (prevSt) {
        const pts1 = buildOctilinearPoints(prevSt.x, prevSt.y, snapSt.x, snapSt.y, water, state.hills, ctxOpts);
        strokePolyline(ctx, pts1);
      }
      if (nextSt) {
        const pts2 = buildOctilinearPoints(snapSt.x, snapSt.y, nextSt.x, nextSt.y, water, state.hills, ctxOpts);
        strokePolyline(ctx, pts2);
      }
    } else if (drag.detached) {
      // Subtle elastic tether from pulled-out cursor to neighbors
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2.4;
      ctx.globalAlpha = 0.3;
      ctx.setLineDash([5, 5]);
      if (prevSt) {
        ctx.beginPath();
        ctx.moveTo(prevSt.x, prevSt.y);
        ctx.lineTo(drag.worldX, drag.worldY);
        ctx.stroke();
      }
      if (nextSt) {
        ctx.beginPath();
        ctx.moveTo(drag.worldX, drag.worldY);
        ctx.lineTo(nextSt.x, nextSt.y);
        ctx.stroke();
      }

      // Live bypassed prevSt <-> nextSt preview
      if (prevSt && nextSt) {
        const bypassPts = buildOctilinearPoints(
          prevSt.x,
          prevSt.y,
          nextSt.x,
          nextSt.y,
          water,
          state.hills,
          ctxOpts
        );
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 4.6;
        ctx.globalAlpha = 0.82;
        ctx.setLineDash([10, 6]);
        strokePolyline(ctx, bypassPts);
      }
    }
    ctx.restore();
  } else if (
    state.interaction.mode === 'dragToken' ||
    state.interaction.mode === 'dragTrain' ||
    state.interaction.mode === 'dragUpgrade'
  ) {
    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = pal.ink;
    ctx.beginPath();
    ctx.arc(drag.worldX, drag.worldY, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pal.stationFill;
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelMap = {
      express: 'PAX',
      freight: 'FRT',
      car: '+CAR',
      doubleTrack: '2×',
      tunnel: 'TUN',
      interchange: 'INT',
    };
    ctx.fillText(labelMap[drag.tool] || 'TRN', drag.worldX, drag.worldY + 0.5);
    ctx.restore();
  }
}

export function renderGame(ctx, state) {
  const pal = getThemePalette(state);
  const isNight = state.theme === 'night';
  const { width, height, dpr } = state.viewport;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Flat Mini Metro paper / night background
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, width, height);

  const scale = getEffectiveScale(state);
  ctx.save();
  ctx.translate(width * 0.5, height * 0.5);
  ctx.scale(scale, scale);
  ctx.translate(-state.camera.x, -state.camera.y);

  drawHills(ctx, state.hills, pal);
  drawMountains(ctx, state.mountains, pal, isNight);

  const rivers = state.rivers?.length
    ? state.rivers
    : state.river?.points?.length
    ? [state.river]
    : [];
  // Two-pass water rendering so river confluences & lake mouths merge seamlessly
  drawLakes(ctx, state.lakes, pal.riverHalo, true);
  drawRivers(ctx, rivers, pal.riverHalo, 12);
  drawLakes(ctx, state.lakes, pal.river, false);
  drawRivers(ctx, rivers, pal.river, 0);

  drawOnboardingGuide(ctx, state, pal);
  drawCorridors(ctx, state, pal);
  drawTBars(ctx, state, pal);
  drawStations(ctx, state, pal);
  drawTrains(ctx, state, pal);
  drawFX(ctx, state, pal);
  drawDragPreview(ctx, state, pal);

  // Touch long-press reclaim progress ring
  if (state.interaction.longPressVisual && state.interaction.longPressVisual.progress > 0.08) {
    const lp = state.interaction.longPressVisual;
    ctx.save();
    ctx.beginPath();
    ctx.arc(lp.x, lp.y, 24, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(217, 78, 52, 0.25)';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(
      lp.x,
      lp.y,
      24,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * Math.min(1, lp.progress)
    );
    ctx.strokeStyle = pal.danger;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  // Flash message in world space
  if (state.interaction.flashMessage) {
    const fm = state.interaction.flashMessage;
    ctx.save();
    ctx.globalAlpha = Math.min(1, fm.timer * 1.5);
    ctx.fillStyle = pal.danger;
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(fm.text, fm.x, fm.y - 28);
    ctx.restore();
  }

  ctx.restore();
}

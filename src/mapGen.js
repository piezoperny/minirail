import { CONFIG, edgeKey } from './state.js';

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function pointToSegmentDistSq(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const lenSq = vx * vx + vy * vy;
  if (lenSq === 0) return dist2(px, py, ax, ay);
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / lenSq));
  const projX = ax + t * vx;
  const projY = ay + t * vy;
  return dist2(px, py, projX, projY);
}

export function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const ccw = (p1x, p1y, p2x, p2y, p3x, p3y) =>
    (p3y - p1y) * (p2x - p1x) > (p2y - p1y) * (p3x - p1x);
  return (
    ccw(ax, ay, cx, cy, dx, dy) !== ccw(bx, by, cx, cy, dx, dy) &&
    ccw(ax, ay, bx, by, cx, cy) !== ccw(ax, ay, bx, by, dx, dy)
  );
}

export function distanceToRiver(river, px, py) {
  const pts = river.points;
  let minSq = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const dSq = pointToSegmentDistSq(px, py, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    if (dSq < minSq) minSq = dSq;
  }
  return Math.sqrt(minSq);
}

export function countRiverCrossings(points, river) {
  const rPts = river.points;
  let crossings = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    for (let j = 0; j < rPts.length - 1; j++) {
      if (segmentsIntersect(a.x, a.y, b.x, b.y, rPts[j].x, rPts[j].y, rPts[j + 1].x, rPts[j + 1].y)) {
        crossings++;
      }
    }
  }
  return crossings;
}

export function isPointInHill(hills, px, py) {
  for (const h of hills) {
    const dx = px - h.x;
    const dy = py - h.y;
    const cos = Math.cos(-h.angle);
    const sin = Math.sin(-h.angle);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    const norm = (lx * lx) / (h.rx * h.rx) + (ly * ly) / (h.ry * h.ry);
    if (norm <= 1.0) return true;
  }
  return false;
}

export function computePolylineLengths(points) {
  const cumLengths = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    cumLengths.push(total);
  }
  return { cumLengths, totalLength: total };
}

export function samplePointAlongPolyline(points, cumLengths, s) {
  const total = cumLengths[cumLengths.length - 1];
  if (s <= 0) {
    const dx = points[1].x - points[0].x;
    const dy = points[1].y - points[0].y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: points[0].x, y: points[0].y, tx: dx / len, ty: dy / len };
  }
  if (s >= total) {
    const n = points.length;
    const dx = points[n - 1].x - points[n - 2].x;
    const dy = points[n - 1].y - points[n - 2].y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: points[n - 1].x, y: points[n - 1].y, tx: dx / len, ty: dy / len };
  }
  let lo = 0;
  let hi = cumLengths.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cumLengths[mid] <= s) lo = mid;
    else hi = mid;
  }
  const segLen = cumLengths[lo + 1] - cumLengths[lo] || 1;
  const t = (s - cumLengths[lo]) / segLen;
  const p0 = points[lo];
  const p1 = points[lo + 1];
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: p0.x + dx * t,
    y: p0.y + dy * t,
    tx: dx / len,
    ty: dy / len,
  };
}

export function computeHillIntervals(points, cumLengths, totalLength, hills) {
  const intervals = [];
  const step = 6;
  let inHill = false;
  let startS = 0;
  for (let s = 0; s <= totalLength; s += step) {
    const pt = samplePointAlongPolyline(points, cumLengths, s);
    const inside = isPointInHill(hills, pt.x, pt.y);
    if (inside && !inHill) {
      inHill = true;
      startS = s;
    } else if (!inside && inHill) {
      inHill = false;
      intervals.push({ start: startS, end: s });
    }
  }
  if (inHill) {
    intervals.push({ start: startS, end: totalLength });
  }
  return intervals;
}

export function computeRiverIntervals(points, cumLengths, totalLength, river) {
  if (!river?.points?.length || !points || points.length < 2) return [];
  const minS = CONFIG.STATION_RADIUS + 2;
  const maxS = totalLength - (CONFIG.STATION_RADIUS + 2);
  if (maxS <= minS) return [];

  const threshold = (river.halfWidth || 25) + 9;
  const step = 4;
  const raw = [];
  let inWater = false;
  let startS = minS;

  for (let s = minS; s <= maxS; s += step) {
    const pt = samplePointAlongPolyline(points, cumLengths, s);
    const overWater = distanceToRiver(river, pt.x, pt.y) <= threshold;
    if (overWater && !inWater) {
      inWater = true;
      startS = s;
    } else if (!overWater && inWater) {
      inWater = false;
      raw.push({ start: Math.max(minS, startS), end: Math.min(maxS, s) });
    }
  }
  if (inWater) {
    raw.push({ start: Math.max(minS, startS), end: maxS });
  }

  const merged = [];
  for (const iv of raw) {
    if (iv.end - iv.start < 2) continue;
    const prev = merged[merged.length - 1];
    if (prev && iv.start - prev.end < 8) {
      prev.end = iv.end;
    } else {
      merged.push({ start: iv.start, end: iv.end });
    }
  }
  return merged;
}

export function extractSubPolyline(points, cumLengths, startS, endS) {
  if (!points || points.length < 2 || !cumLengths || cumLengths.length < 2) return [];
  const total = cumLengths[cumLengths.length - 1];
  const s0 = Math.max(0, startS);
  const s1 = Math.min(total, endS);
  if (s1 <= s0 + 0.5) return [];

  const p0 = samplePointAlongPolyline(points, cumLengths, s0);
  const out = [{ x: p0.x, y: p0.y }];

  for (let i = 1; i < points.length - 1; i++) {
    const ci = cumLengths[i];
    if (ci > s0 + 0.01 && ci < s1 - 0.01) {
      out.push({ x: points[i].x, y: points[i].y });
    }
  }

  const p1 = samplePointAlongPolyline(points, cumLengths, s1);
  out.push({ x: p1.x, y: p1.y });
  return out;
}

function buildFilletedElbow(ax, ay, mx, my, bx, by) {
  const d1 = Math.hypot(mx - ax, my - ay);
  const d2 = Math.hypot(bx - mx, by - my);
  if (d1 < 6 || d2 < 6) {
    return [{ x: ax, y: ay }, { x: bx, y: by }];
  }
  const fillet = Math.min(CONFIG.FILLET_RADIUS, d1 * 0.42, d2 * 0.42);
  const u1x = (ax - mx) / d1;
  const u1y = (ay - my) / d1;
  const u2x = (bx - mx) / d2;
  const u2y = (by - my) / d2;

  const pStart = { x: mx + u1x * fillet, y: my + u1y * fillet };
  const pEnd = { x: mx + u2x * fillet, y: my + u2y * fillet };

  const pts = [{ x: ax, y: ay }];
  const arcSteps = 8;
  for (let i = 0; i <= arcSteps; i++) {
    const t = i / arcSteps;
    const omt = 1 - t;
    pts.push({
      x: omt * omt * pStart.x + 2 * omt * t * mx + t * t * pEnd.x,
      y: omt * omt * pStart.y + 2 * omt * t * my + t * t * pEnd.y,
    });
  }
  pts.push({ x: bx, y: by });
  return pts;
}

function angleDiffRad(a, b) {
  let d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

export function buildOctilinearPoints(ax, ay, bx, by, river, hills, context = null) {
  const dx = bx - ax;
  const dy = by - ay;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (absX < 10 || absY < 10 || Math.abs(absX - absY) < 10) {
    return [{ x: ax, y: ay }, { x: bx, y: by }];
  }

  const diag = Math.min(absX, absY);
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);

  const m1 = { x: ax + sx * diag, y: ay + sy * diag };
  const m2 = { x: bx - sx * diag, y: by - sy * diag };

  const cand1 = buildFilletedElbow(ax, ay, m1.x, m1.y, bx, by);
  const cand2 = buildFilletedElbow(ax, ay, m2.x, m2.y, bx, by);

  const clearanceSq = (CONFIG.STATION_RADIUS + 14) * (CONFIG.STATION_RADIUS + 14);
  const portSpreadRad = (22 * Math.PI) / 180;

  const scoreCandidate = (pts) => {
    const cross = countRiverCrossings(pts, river);
    const { cumLengths, totalLength } = computePolylineLengths(pts);
    const intervals = computeHillIntervals(pts, cumLengths, totalLength, hills);
    const hillLen = intervals.reduce((acc, iv) => acc + (iv.end - iv.start), 0);
    let score = cross * 10000 + hillLen;

    if (context) {
      if (Array.isArray(context.stations)) {
        for (const st of context.stations) {
          if (Math.hypot(st.x - ax, st.y - ay) < 5) continue;
          if (Math.hypot(st.x - bx, st.y - by) < 5) continue;
          let minSq = Infinity;
          for (let i = 0; i < pts.length - 1; i++) {
            const dSq = pointToSegmentDistSq(
              st.x,
              st.y,
              pts[i].x,
              pts[i].y,
              pts[i + 1].x,
              pts[i + 1].y
            );
            if (dSq < minSq) minSq = dSq;
          }
          if (minSq < clearanceSq) {
            score += 6500;
          }
        }
      }

      const n = pts.length;
      const outAx = pts[1].x - pts[0].x;
      const outAy = pts[1].y - pts[0].y;
      const lenA = Math.hypot(outAx, outAy) || 1;
      const txA = outAx / lenA;
      const tyA = outAy / lenA;

      const inBx = pts[n - 1].x - pts[n - 2].x;
      const inBy = pts[n - 1].y - pts[n - 2].y;
      const lenB = Math.hypot(inBx, inBy) || 1;
      const txB = inBx / lenB;
      const tyB = inBy / lenB;

      if (context.inTangentAtA) {
        const dotA = context.inTangentAtA.x * txA + context.inTangentAtA.y * tyA;
        if (dotA < -0.05) {
          score += 4500;
        }
      }
      if (context.outTangentAtB) {
        const dotB = txB * context.outTangentAtB.x + tyB * context.outTangentAtB.y;
        if (dotB < -0.05) {
          score += 4500;
        }
      }

      if (Array.isArray(context.usedAnglesAtA)) {
        const angA = Math.atan2(tyA, txA);
        for (const ua of context.usedAnglesAtA) {
          if (angleDiffRad(angA, ua) < portSpreadRad) {
            score += 900;
          }
        }
      }
      if (Array.isArray(context.usedAnglesAtB)) {
        const angB = Math.atan2(-tyB, -txB);
        for (const ub of context.usedAnglesAtB) {
          if (angleDiffRad(angB, ub) < portSpreadRad) {
            score += 900;
          }
        }
      }
    }

    return score;
  };

  return scoreCandidate(cand1) <= scoreCandidate(cand2) ? cand1 : cand2;
}

function generateRiver(rng) {
  // Meandering river running roughly left-to-right with gentle valley curves
  const control = [];
  const xStart = -1350;
  const xEnd = 1350;
  const segments = 9;
  const baseTilt = (rng() - 0.5) * 260;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = xStart + (xEnd - xStart) * t;
    const wave = Math.sin(t * Math.PI * 2.2 + rng() * 1.4) * (95 + rng() * 55);
    const y = baseTilt * (t - 0.5) + wave + (rng() - 0.5) * 45;
    control.push({ x, y });
  }

  // Catmull-Rom interpolation
  const points = [];
  const stepsPerSeg = 14;
  for (let i = 0; i < control.length - 1; i++) {
    const p0 = control[Math.max(0, i - 1)];
    const p1 = control[i];
    const p2 = control[i + 1];
    const p3 = control[Math.min(control.length - 1, i + 2)];
    for (let s = 0; s < stepsPerSeg; s++) {
      const t = s / stepsPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y =
        0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      points.push({ x, y });
    }
  }
  points.push(control[control.length - 1]);
  return { points, halfWidth: 25 };
}

function generateHills(rng, river) {
  const hills = [];
  // 1 inner-valley hill + 2-3 outer-valley hills
  const specs = [
    { minR: 130, maxR: 280, rxMin: 130, rxMax: 185, ryMin: 95, ryMax: 140 },
    { minR: 420, maxR: 680, rxMin: 170, rxMax: 240, ryMin: 120, ryMax: 175 },
    { minR: 500, maxR: 820, rxMin: 180, rxMax: 250, ryMin: 130, ryMax: 185 },
    { minR: 620, maxR: 920, rxMin: 160, rxMax: 220, ryMin: 115, ryMax: 165 },
  ];

  const count = 3 + (rng() > 0.4 ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const spec = specs[i];
    let best = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const angle = rng() * Math.PI * 2;
      const r = spec.minR + rng() * (spec.maxR - spec.minR);
      const x = Math.cos(angle) * r * 1.25;
      const y = Math.sin(angle) * r * 0.8;
      if (distanceToRiver(river, x, y) < 110) continue;
      const overlaps = hills.some((h) => Math.hypot(h.x - x, h.y - y) < 280);
      if (overlaps) continue;
      best = {
        id: i + 1,
        x,
        y,
        rx: spec.rxMin + rng() * (spec.rxMax - spec.rxMin),
        ry: spec.ryMin + rng() * (spec.ryMax - spec.ryMin),
        angle: rng() * Math.PI,
        rings: 3,
      };
      break;
    }
    if (best) hills.push(best);
  }
  return hills;
}

function createStation(id, x, y, spec) {
  const { kind, subtype, name, tier = 1, cityCode = null, crestColor = null } = spec;

  let capacity = 6;
  let goodsTarget = null;
  if (kind === 'settlement') {
    const tierCfg = CONFIG.SETTLEMENT_TIERS[tier] || CONFIG.SETTLEMENT_TIERS[1];
    capacity = tierCfg.capacity;
    goodsTarget = tierCfg.goodsTarget;
  } else if (kind === 'factory') {
    capacity = 8;
  } else if (kind === 'resource') {
    capacity = 6;
  }

  return {
    id,
    x,
    y,
    kind,
    subtype,
    name,
    tier,
    cityCode,
    crestColor,
    goodsProgress: 0,
    goodsTarget,
    buildingSeeds: [],
    isInterchange: false,
    queueAngle: 0,
    inputBuffer: 0,
    processProgress: 0,
    capacity,
    queue: [],
    overflowTimer: 0,
    spawnTimer: 2.5 + (id % 3) * 1.1,
    pulse: 0,
    hoverScale: 1.0,
    hoverVel: 0,
  };
}

function riverSideSign(river, x, y) {
  let closest = river.points[0];
  let bestDx = Infinity;
  for (const pt of river.points) {
    const dx = Math.abs(pt.x - x);
    if (dx < bestDx) {
      bestDx = dx;
      closest = pt;
    }
  }
  return y >= closest.y ? 1 : -1;
}

export function generateWorld(state) {
  const rng = state.rng;
  state.river = generateRiver(rng);
  state.hills = generateHills(rng, state.river);
  state.stations = [];
  state.stationById = new Map();
  state.pendingSpawns = [];
  state.nextSpawnIndex = 0;

  const placed = [];
  const canPlace = (x, y, minDist) => {
    if (distanceToRiver(state.river, x, y) < state.river.halfWidth + 30) return false;
    return placed.every((p) => Math.hypot(p.x - x, p.y - y) >= minDist);
  };

  // --- Starter Valley Layout (4 readable landmarks inside initial zoom = 1.0 viewport) ---
  // Station 1: Starter City (Grandhaven GH, Tier 3)
  let s1Pos = null;
  let s2Pos = null;
  const starterSide = rng() > 0.5 ? 1 : -1;

  for (let outer = 0; outer < 40 && !s2Pos; outer++) {
    const c1x = (rng() * 2 - 1) * 350;
    const c1y = (rng() * 2 - 1) * 195;
    if (riverSideSign(state.river, c1x, c1y) !== starterSide) continue;
    if (!canPlace(c1x, c1y, 175)) continue;

    // Station 2: Starter Hamlet (Oakridge, Tier 1) on same river side, 200..310u from Station 1
    for (let inner = 0; inner < 60; inner++) {
      const ang = rng() * Math.PI * 2;
      const dist = 205 + rng() * 100; // 205..305 units
      const c2x = c1x + Math.cos(ang) * dist;
      const c2y = c1y + Math.sin(ang) * dist;
      if (Math.abs(c2x) > 405 || Math.abs(c2y) > 215) continue;
      if (riverSideSign(state.river, c2x, c2y) !== starterSide) continue;
      if (distanceToRiver(state.river, c2x, c2y) < state.river.halfWidth + 30) continue;
      if (Math.hypot(c2x - c1x, c2y - c1y) < 200) continue;

      const pts = buildOctilinearPoints(c1x, c1y, c2x, c2y, state.river, state.hills);
      if (countRiverCrossings(pts, state.river) === 0) {
        s1Pos = { x: c1x, y: c1y };
        s2Pos = { x: c2x, y: c2y };
        break;
      }
    }
  }

  // Fallback if river geometry made strict same-side search tight
  if (!s1Pos || !s2Pos) {
    s1Pos = s1Pos || { x: -160, y: starterSide * 130 };
    s2Pos = { x: 95, y: starterSide * 135 };
  }

  const s1 = createStation(
    1,
    s1Pos.x,
    s1Pos.y,
    {
      kind: 'settlement',
      subtype: 'city',
      name: CONFIG.SETTLEMENT_NAMES[0][0], // Grandhaven
      tier: 3,
      cityCode: CONFIG.SETTLEMENT_NAMES[0][1], // GH
      crestColor: CONFIG.CITY_CREST_PALETTE[0],
    },
    rng
  );
  placed.push(s1);
  state.stations.push(s1);
  state.stationById.set(s1.id, s1);

  const s2 = createStation(
    2,
    s2Pos.x,
    s2Pos.y,
    {
      kind: 'settlement',
      subtype: 'hamlet',
      name: CONFIG.SETTLEMENT_NAMES[1][0], // Oakridge
      tier: 1,
    },
    rng
  );
  placed.push(s2);
  state.stations.push(s2);
  state.stationById.set(s2.id, s2);

  // Station 3: Starter Resource Site (Timber Camp, forest) on opposite side of river
  let s3Pos = null;
  for (let attempt = 0; attempt < 120; attempt++) {
    const x = (rng() * 2 - 1) * 390;
    const y = (rng() * 2 - 1) * 210;
    if (riverSideSign(state.river, x, y) === starterSide && attempt < 95) continue;
    if (canPlace(x, y, 185)) {
      s3Pos = { x, y };
      break;
    }
  }
  if (!s3Pos) {
    s3Pos = { x: -240, y: -starterSide * 145 };
  }

  const s3 = createStation(
    3,
    s3Pos.x,
    s3Pos.y,
    {
      kind: 'resource',
      subtype: 'forest',
      name: CONFIG.INDUSTRY_NAMES.forest[0], // Timber Camp
    },
    rng
  );
  placed.push(s3);
  state.stations.push(s3);
  state.stationById.set(s3.id, s3);

  // Station 4: Starter Factory (Millworks) positioned between Timber Camp and Grandhaven/Oakridge
  // Ensure at least one river or hill interaction across the freight corridor (3 -> 4 -> 1/2)
  let s4Pos = null;
  let bestScore = Infinity;
  const midTargetX = (s3.x + (s1.x + s2.x) * 0.5) * 0.5;
  const midTargetY = (s3.y + (s1.y + s2.y) * 0.5) * 0.5;

  for (let attempt = 0; attempt < 140; attempt++) {
    const x = (rng() * 2 - 1) * 395;
    const y = (rng() * 2 - 1) * 210;
    if (!canPlace(x, y, 175)) continue;

    const legA = buildOctilinearPoints(s3.x, s3.y, x, y, state.river, state.hills);
    const legB = buildOctilinearPoints(x, y, s1.x, s1.y, state.river, state.hills);
    const lenA = computePolylineLengths(legA);
    const lenB = computePolylineLengths(legB);
    const crossings =
      countRiverCrossings(legA, state.river) + countRiverCrossings(legB, state.river);
    const hillHits =
      computeHillIntervals(legA, lenA.cumLengths, lenA.totalLength, state.hills).length +
      computeHillIntervals(legB, lenB.cumLengths, lenB.totalLength, state.hills).length;

    if (crossings + hillHits === 0 && attempt < 100) continue;

    const distToMid = Math.hypot(x - midTargetX, y - midTargetY);
    const balancePenalty = Math.abs(lenA.totalLength - lenB.totalLength) * 0.35;
    const score = distToMid + balancePenalty;
    if (score < bestScore) {
      bestScore = score;
      s4Pos = { x, y };
    }
  }
  if (!s4Pos) {
    s4Pos = { x: 240, y: -starterSide * 140 };
  }

  const s4 = createStation(
    4,
    s4Pos.x,
    s4Pos.y,
    {
      kind: 'factory',
      subtype: 'factory',
      name: CONFIG.INDUSTRY_NAMES.factory[0], // Millworks
    },
    rng
  );
  placed.push(s4);
  state.stations.push(s4);
  state.stationById.set(s4.id, s4);

  if (state.onboarding) {
    state.onboarding.starterIds = { cityId: 1, townId: 2, resourceId: 3, factoryId: 4 };
    state.onboarding.freightLineBuilt = false;
  }

  // --- Progressive 18-Node Regional Expansion Schedule ---
  // Spawn #5 is Northport (NP) City so Intercity Tickets activate smoothly mid-game.
  const expansionSchedule = [
    { kind: 'settlement', subtype: 'hamlet', tier: 1 }, // #1
    { kind: 'resource', subtype: 'mine' },               // #2
    { kind: 'factory', subtype: 'factory' },             // #3
    { kind: 'settlement', subtype: 'hamlet', tier: 1 }, // #4
    { kind: 'settlement', subtype: 'city', tier: 3 },   // #5 (Northport NP)
    { kind: 'resource', subtype: 'forest' },             // #6
    { kind: 'settlement', subtype: 'hamlet', tier: 1 }, // #7
    { kind: 'factory', subtype: 'factory' },             // #8
    { kind: 'resource', subtype: 'mine' },               // #9
    { kind: 'settlement', subtype: 'hamlet', tier: 1 }, // #10
    { kind: 'resource', subtype: 'forest' },             // #11
    { kind: 'settlement', subtype: 'hamlet', tier: 1 }, // #12
    { kind: 'factory', subtype: 'factory' },             // #13
    { kind: 'resource', subtype: 'mine' },               // #14
    { kind: 'settlement', subtype: 'hamlet', tier: 1 }, // #15
    { kind: 'settlement', subtype: 'hamlet', tier: 1 }, // #16
    { kind: 'resource', subtype: 'forest' },             // #17
    { kind: 'settlement', subtype: 'hamlet', tier: 1 }, // #18
  ];

  // Track next unused name indices (starters claimed Grandhaven, Oakridge, Timber Camp, Millworks;
  // Northport NP is reserved for the mid-game city at spawn #5)
  const hamletPool = CONFIG.SETTLEMENT_NAMES.filter(
    ([name]) => name !== 'Grandhaven' && name !== 'Oakridge' && name !== 'Northport'
  );
  let hamletIdx = 0;
  let crestIdx = 1;
  const industryIdx = { forest: 1, mine: 0, factory: 1 };

  for (let i = 0; i < expansionSchedule.length; i++) {
    const entry = expansionSchedule[i];
    const t = i / (expansionSchedule.length - 1);
    const minRadius = 240 + t * 380;
    const maxRadius = 460 + t * 560;
    let chosen = null;

    for (let attempt = 0; attempt < 120; attempt++) {
      const ang = rng() * Math.PI * 2;
      const rad = minRadius + rng() * (maxRadius - minRadius);
      const x = Math.max(-1080, Math.min(1080, Math.cos(ang) * rad * 1.28));
      const y = Math.max(-620, Math.min(620, Math.sin(ang) * rad * 0.78));
      if (canPlace(x, y, CONFIG.MIN_STATION_SPACING)) {
        chosen = { x, y };
        break;
      }
    }

    if (chosen) {
      const id = placed.length + 1;
      let spec;
      if (entry.kind === 'settlement') {
        const isCity = entry.tier === 3;
        const pair = isCity
          ? CONFIG.SETTLEMENT_NAMES.find(([n]) => n === 'Northport') || ['Northport', 'NP']
          : hamletPool[hamletIdx++ % hamletPool.length];
        spec = {
          kind: 'settlement',
          subtype: entry.subtype,
          name: pair[0],
          tier: entry.tier,
          cityCode: isCity ? pair[1] : null,
          crestColor: isCity
            ? CONFIG.CITY_CREST_PALETTE[crestIdx++ % CONFIG.CITY_CREST_PALETTE.length]
            : null,
        };
      } else {
        const pool = CONFIG.INDUSTRY_NAMES[entry.subtype];
        const idx = industryIdx[entry.subtype]++;
        spec = {
          kind: entry.kind,
          subtype: entry.subtype,
          name: pool[idx % pool.length],
        };
      }

      const st = createStation(id, chosen.x, chosen.y, spec, rng);
      placed.push(st);
      state.pendingSpawns.push(st);
    }
  }

  updateTargetCameraZoom(state);
  state.camera.zoom = state.camera.targetZoom;
}

export function spawnNextStation(state) {
  if (state.nextSpawnIndex >= state.pendingSpawns.length) return null;
  const st = state.pendingSpawns[state.nextSpawnIndex++];
  st.pulse = 1.0;
  state.stations.push(st);
  state.stationById.set(st.id, st);
  updateTargetCameraZoom(state);
  return st;
}

export function updateTargetCameraZoom(state) {
  if (state.camera?.userControlled) return;
  if (state.stations.length === 0) {
    state.camera.targetX = 0;
    state.camera.targetY = 0;
    state.camera.targetZoom = 1.0;
    return;
  }
  let maxAbsX = 430;
  let maxAbsY = 260;
  for (const st of state.stations) {
    maxAbsX = Math.max(maxAbsX, Math.abs(st.x) + 140);
    maxAbsY = Math.max(maxAbsY, Math.abs(st.y) + 120);
  }
  const zoomX = (CONFIG.BASE_VIEW_WIDTH * 0.46) / maxAbsX;
  const zoomY = (CONFIG.BASE_VIEW_HEIGHT * 0.44) / maxAbsY;
  state.camera.targetX = 0;
  state.camera.targetY = 0;
  state.camera.targetZoom = Math.max(CONFIG.MIN_ZOOM, Math.min(1.0, zoomX, zoomY));
}

function computeStationPassFillet(prevLeg, nextLeg) {
  if (prevLeg.length < 2 || nextLeg.length < 2) return null;
  const S = prevLeg[prevLeg.length - 1];
  const pBefore = prevLeg[prevLeg.length - 2];
  const pAfter = nextLeg[1];

  const d1 = Math.hypot(S.x - pBefore.x, S.y - pBefore.y);
  const d2 = Math.hypot(pAfter.x - S.x, pAfter.y - S.y);
  if (d1 < 8 || d2 < 8) return null;

  const u1x = (S.x - pBefore.x) / d1;
  const u1y = (S.y - pBefore.y) / d1;
  const u2x = (pAfter.x - S.x) / d2;
  const u2y = (pAfter.y - S.y) / d2;

  const cosTheta = u1x * u2x + u1y * u2y;
  // Apply smooth corner fillet on 45°–135° bends (~23° to ~148°)
  if (cosTheta <= -0.85 || cosTheta >= 0.92) return null;

  const r = Math.min(CONFIG.STATION_PASS_FILLET, d1 * 0.42, d2 * 0.42);
  if (r < 4) return null;

  const pStart = { x: S.x - u1x * r, y: S.y - u1y * r };
  const pEnd = { x: S.x + u2x * r, y: S.y + u2y * r };
  const steps = 6;
  const curve = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const omt = 1 - t;
    curve.push({
      x: omt * omt * pStart.x + 2 * omt * t * S.x + t * t * pEnd.x,
      y: omt * omt * pStart.y + 2 * omt * t * S.y + t * t * pEnd.y,
    });
  }
  return { curve, midIdx: steps >> 1 };
}

export function buildLineSpine(state, line) {
  const isLoop = !!line?.isLoop;
  if (!line || !Array.isArray(line.stations) || line.stations.length < 2) {
    return { points: [], cumLengths: [0], totalLength: 0, stationU: [], isLoop };
  }

  const n = line.stations.length;
  const legCount = isLoop ? n : n - 1;
  const legs = [];

  for (let i = 0; i < legCount; i++) {
    const aId = line.stations[i];
    const bId = line.stations[(i + 1) % n];
    const corr = state.corridors?.get(edgeKey(aId, bId));
    if (corr && Array.isArray(corr.points) && corr.points.length >= 2) {
      const ordered = corr.aId === aId ? corr.points : corr.points.slice().reverse();
      legs.push(ordered.map((p) => ({ x: p.x, y: p.y })));
    } else {
      const stA = state.stationById?.get(aId);
      const stB = state.stationById?.get(bId);
      if (!stA || !stB) {
        return { points: [], cumLengths: [0], totalLength: 0, stationU: [], isLoop };
      }
      legs.push([
        { x: stA.x, y: stA.y },
        { x: stB.x, y: stB.y },
      ]);
    }
  }

  const junctions = new Array(n).fill(null);
  const startJ = isLoop ? 0 : 1;
  const endJ = isLoop ? n : n - 1;
  for (let j = startJ; j < endJ; j++) {
    const prevLeg = legs[(j - 1 + legCount) % legCount];
    const nextLeg = legs[j];
    junctions[j] = computeStationPassFillet(prevLeg, nextLeg);
  }

  const points = [];
  const stationPointIndices = new Array(n).fill(0);

  const pushUnique = (pt) => {
    const last = points[points.length - 1];
    if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) > 0.01) {
      points.push({ x: pt.x, y: pt.y });
    }
  };

  if (isLoop && junctions[0]) {
    const f0 = junctions[0];
    stationPointIndices[0] = 0;
    for (let k = f0.midIdx; k < f0.curve.length; k++) {
      pushUnique(f0.curve[k]);
    }
  } else {
    pushUnique(legs[0][0]);
    stationPointIndices[0] = 0;
  }

  for (let i = 0; i < legCount; i++) {
    const leg = legs[i];
    const hasStartFillet = i === 0 ? isLoop && !!junctions[0] : !!junctions[i];
    const nextJ = (i + 1) % n;
    const hasEndFillet = nextJ === 0 ? isLoop && !!junctions[0] : !!junctions[nextJ];

    const innerStart = 1;
    const innerEnd = leg.length - 1;
    for (let k = innerStart; k < innerEnd; k++) {
      if (hasStartFillet && k === 1 && Math.hypot(leg[k].x - leg[0].x, leg[k].y - leg[0].y) < 1) {
        continue;
      }
      pushUnique(leg[k]);
    }

    if (nextJ === 0) {
      if (isLoop && junctions[0]) {
        const f0 = junctions[0];
        for (let k = 0; k <= f0.midIdx; k++) {
          pushUnique(f0.curve[k]);
        }
      } else {
        pushUnique(leg[leg.length - 1]);
      }
    } else if (hasEndFillet) {
      const f = junctions[nextJ];
      for (let k = 0; k < f.curve.length; k++) {
        pushUnique(f.curve[k]);
        if (k === f.midIdx) {
          stationPointIndices[nextJ] = points.length - 1;
        }
      }
    } else {
      pushUnique(leg[leg.length - 1]);
      stationPointIndices[nextJ] = points.length - 1;
    }
  }

  const { cumLengths, totalLength } = computePolylineLengths(points);
  const stationU = stationPointIndices.map((idx) => cumLengths[idx] ?? 0);

  return { points, cumLengths, totalLength, stationU, isLoop };
}

export function samplePoseOnSpine(
  spine,
  u,
  wheelbase = CONFIG.BOGIE_WHEELBASE,
  lateralOffset = 0
) {
  if (!spine || !spine.points || spine.points.length < 2 || spine.totalLength <= 0) {
    return { x: 0, y: 0, angle: 0, tx: 1, ty: 0, nx: 0, ny: 1 };
  }

  const total = spine.totalLength;
  const wrapOrClamp = (s) => {
    if (spine.isLoop) {
      return ((s % total) + total) % total;
    }
    return Math.max(0, Math.min(total, s));
  };

  const half = wheelbase * 0.5;
  const uFront = wrapOrClamp(u + half);
  const uRear = wrapOrClamp(u - half);

  const pFront = samplePointAlongPolyline(spine.points, spine.cumLengths, uFront);
  const pRear = samplePointAlongPolyline(spine.points, spine.cumLengths, uRear);

  let dx = pFront.x - pRear.x;
  let dy = pFront.y - pRear.y;
  let len = Math.hypot(dx, dy);

  if (len < 1e-4) {
    const pCenter = samplePointAlongPolyline(spine.points, spine.cumLengths, wrapOrClamp(u));
    dx = pCenter.tx;
    dy = pCenter.ty;
    len = 1;
  }

  const tx = dx / len;
  const ty = dy / len;
  const nx = -ty;
  const ny = tx;

  const cx = (pFront.x + pRear.x) * 0.5 + nx * lateralOffset;
  const cy = (pFront.y + pRear.y) * 0.5 + ny * lateralOffset;

  return {
    x: cx,
    y: cy,
    angle: Math.atan2(ty, tx),
    tx,
    ty,
    nx,
    ny,
  };
}

export function computeTrainUnitPoses(
  spine,
  consistStartU,
  unitCount,
  direction,
  lateralOffset = 0
) {
  const count = Math.max(1, unitCount | 0);
  const poses = [];
  const forward = direction >= 0;

  for (let i = 0; i < count; i++) {
    const k = forward ? count - 1 - i : i;
    const u = consistStartU + k * CONFIG.CAR_SPACING;
    const pose = samplePoseOnSpine(spine, u, CONFIG.BOGIE_WHEELBASE, lateralOffset);
    const angle = forward ? pose.angle : Math.atan2(-pose.ty, -pose.tx);
    poses.push({ x: pose.x, y: pose.y, angle });
  }

  return poses;
}

export function getLineTBarPose(state, line, endSide) {
  if (!line || !Array.isArray(line.stations) || line.stations.length < 2 || line.isLoop) {
    return null;
  }
  const spine = line.spine && line.spine.points?.length >= 2
    ? line.spine
    : buildLineSpine(state, line);
  if (!spine || spine.points.length < 2 || spine.totalLength <= 0) {
    return null;
  }

  const isStart = endSide === 'start';
  const stationId = isStart
    ? line.stations[0]
    : line.stations[line.stations.length - 1];
  const st = state.stationById?.get(stationId);
  if (!st) return null;

  const sample = samplePointAlongPolyline(
    spine.points,
    spine.cumLengths,
    isStart ? 0 : spine.totalLength
  );
  const ux = isStart ? -sample.tx : sample.tx;
  const uy = isStart ? -sample.ty : sample.ty;
  const px = -uy;
  const py = ux;

  return {
    x: st.x + ux * CONFIG.T_BAR_OFFSET,
    y: st.y + uy * CONFIG.T_BAR_OFFSET,
    ux,
    uy,
    px,
    py,
    stationId,
  };
}

export function computeStationQueueAngle(state, station) {
  if (!station) return 0;

  const incidentAngles = [];
  if (state?.corridors) {
    for (const corr of state.corridors.values()) {
      if (!corr || !Array.isArray(corr.points) || corr.points.length < 2) continue;
      if (corr.aId === station.id) {
        const dx = corr.points[1].x - corr.points[0].x;
        const dy = corr.points[1].y - corr.points[0].y;
        incidentAngles.push(Math.atan2(dy, dx));
      } else if (corr.bId === station.id) {
        const n = corr.points.length;
        const dx = corr.points[n - 2].x - corr.points[n - 1].x;
        const dy = corr.points[n - 2].y - corr.points[n - 1].y;
        incidentAngles.push(Math.atan2(dy, dx));
      }
    }
  }

  const probeDist = CONFIG.STATION_RADIUS + 28;
  const clearAngleRad = (55 * Math.PI) / 180;
  let bestAngle = 0;
  let bestScore = Infinity;

  for (let k = 0; k < 8; k++) {
    const ang = (k * Math.PI) / 4;
    const px = station.x + Math.cos(ang) * probeDist;
    const py = station.y + Math.sin(ang) * probeDist;

    let score = k === 0 ? 0 : k === 1 || k === 7 ? 5 : 12;

    for (const inc of incidentAngles) {
      const diff = angleDiffRad(ang, inc);
      if (diff < clearAngleRad) {
        score += 1000 * (1 - diff / clearAngleRad);
      }
    }

    if (state?.river?.points?.length) {
      const dRiver = distanceToRiver(state.river, px, py);
      if (dRiver < (state.river.halfWidth || 25) + 24) {
        score += 800;
      }
    }

    if (Math.abs(px) > 1050 || Math.abs(py) > 600) {
      score += 400;
    }

    if (score < bestScore) {
      bestScore = score;
      bestAngle = ang;
    }
  }

  return bestAngle;
}

// Plain JavaScript that runs inside the map page (see mapHtml.js), kept as text
// because the app itself can't hand real functions to the web page.
//
// shapeFromLoop turns a finger-drawn loop into a tidy territory. It keeps the
// overall shape you drew (draw a rectangle, get a rectangle), pulls each corner
// onto a nearby road junction, and lets an edge follow a road only when that
// road runs right alongside it. Otherwise the edge stays straight, bridging the
// gap, so shapes never duck in and out of side streets.

export const outlineScript = `
const M_PER_DEG_LAT = 110540;

function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

// Flat x/y in metres around an origin. Plenty accurate at neighbourhood size.
function projector(origin) {
  const kx = 111320 * Math.cos((origin[1] * Math.PI) / 180);
  return {
    to: (c) => [(c[0] - origin[0]) * kx, (c[1] - origin[1]) * M_PER_DEG_LAT],
    from: (p) => [origin[0] + p[0] / kx, origin[1] + p[1] / M_PER_DEG_LAT],
  };
}

function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

function pathLength(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  return total;
}

function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

function segmentDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, 0, 1) : 0;
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}

// Douglas-Peucker: keep only the points that matter for the shape.
function simplifyOpen(pts, tolerance) {
  if (pts.length < 3) return pts.slice();
  let worst = 0;
  let index = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segmentDistance(pts[i], pts[0], pts[pts.length - 1]);
    if (d > worst) { worst = d; index = i; }
  }
  if (worst <= tolerance) return [pts[0], pts[pts.length - 1]];
  const left = simplifyOpen(pts.slice(0, index + 1), tolerance);
  return left.slice(0, -1).concat(simplifyOpen(pts.slice(index), tolerance));
}

// Simplify a closed loop by splitting it at its two most distant points.
function simplifyClosed(pts, tolerance) {
  let far = 0;
  for (let i = 1; i < pts.length; i++) if (dist(pts[0], pts[i]) > dist(pts[0], pts[far])) far = i;
  const a = simplifyOpen(pts.slice(0, far + 1), tolerance);
  const b = simplifyOpen(pts.slice(far).concat([pts[0]]), tolerance);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

// Road, path and field-edge points, bucketed on a grid for quick nearest lookups.
function roadIndex(features, proj, spacing, cellSize) {
  const points = [];
  const junctions = [];
  const owners = new Map();
  const seenFeatures = new Set();

  function addLine(coords, owner) {
    for (let i = 0; i < coords.length; i++) {
      const key = coords[i][0].toFixed(6) + ',' + coords[i][1].toFixed(6);
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key).add(owner);
      if (i === 0) continue;
      const a = proj.to(coords[i - 1]);
      const b = proj.to(coords[i]);
      const steps = Math.max(1, Math.ceil(dist(a, b) / spacing));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
      points.push(b);
    }
  }

  for (const f of features) {
    const g = f.geometry;
    // The same road comes back once per map layer that draws it; count it once.
    const signature = JSON.stringify(g.coordinates);
    if (seenFeatures.has(signature)) continue;
    seenFeatures.add(signature);
    const owner = f.sourceLayer + ':' + (f.id !== undefined ? f.id : signature.slice(0, 80));
    const isRoad = f.sourceLayer === 'road';
    const lines =
      g.type === 'LineString' ? [g.coordinates]
      : g.type === 'MultiLineString' || g.type === 'Polygon' ? g.coordinates
      : g.type === 'MultiPolygon' ? g.coordinates.flat()
      : [];
    lines.forEach((line) => addLine(line, isRoad ? owner : 'land'));
  }

  // Where two different roads share a point, that's a junction.
  for (const [key, set] of owners) {
    const roads = [...set].filter((o) => o !== 'land');
    if (roads.length >= 2) {
      const [lng, lat] = key.split(',').map(Number);
      junctions.push(proj.to([lng, lat]));
    }
  }

  function grid(list) {
    const cells = new Map();
    for (const p of list) {
      const k = Math.floor(p[0] / cellSize) + ',' + Math.floor(p[1] / cellSize);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(p);
    }
    return function nearest(p, radius) {
      const reach = Math.ceil(radius / cellSize);
      const cx = Math.floor(p[0] / cellSize);
      const cy = Math.floor(p[1] / cellSize);
      let best = null;
      let bestD = radius;
      for (let dx = -reach; dx <= reach; dx++) {
        for (let dy = -reach; dy <= reach; dy++) {
          const bucket = cells.get(cx + dx + ',' + (cy + dy));
          if (!bucket) continue;
          for (const q of bucket) {
            const d = dist(p, q);
            if (d < bestD) { bestD = d; best = q; }
          }
        }
      }
      return best;
    };
  }

  return { nearestPoint: grid(points), nearestJunction: grid(junctions), count: points.length };
}

// loop: [lng, lat] points (closed or not). features: map features near it.
function shapeFromLoop(loop, features, prepared) {
  const pts = loop.slice();
  if (dist(pts[0], pts[pts.length - 1]) === 0) pts.pop();
  const origin = pts[0];
  const proj = prepared ? prepared.proj : projector(origin);
  const xy = pts.map(proj.to);
  const size = Math.sqrt(polygonArea(xy)) || pathLength(xy) / 4;

  const roads = prepared ? prepared.roads
    : roadIndex(features, proj, clamp(size / 40, 3, 40), clamp(size / 5, 10, 80));

  // 1. The shape you meant: a handful of corners.
  let corners = simplifyClosed(xy, 0.08 * size);
  if (corners.length < 3) corners = simplifyClosed(xy, 0.03 * size);
  if (corners.length < 3) corners = xy.slice(0, 3);

  // 2. Pull each corner onto a junction, or failing that a road, if one is close.
  const snapR = clamp(0.15 * size, 8, 80);
  let onRoads = 0;
  corners = corners.map((c) => {
    const j = roads.nearestJunction(c, snapR);
    if (j) { onRoads++; return j; }
    const r = roads.nearestPoint(c, snapR * 0.6);
    if (r) { onRoads++; return r; }
    return c;
  });

  // 3. Each edge follows a road only if one runs right alongside it.
  const edgeR = clamp(0.06 * size, 5, 30);
  const step = clamp(size / 30, 4, 25);
  const outline = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const n = Math.max(2, Math.round(dist(a, b) / step));
    const samples = [];
    let hits = 0;
    for (let s = 1; s < n; s++) {
      const t = s / n;
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const r = roads.nearestPoint(p, edgeR);
      if (r) hits++;
      samples.push(r || p);
    }
    const roadPath = simplifyOpen([a].concat(samples, [b]), edgeR / 3);
    // A road that zig-zags (a staircase of side streets) doesn't count.
    const followsRoad = samples.length > 0 && hits / samples.length >= 0.7 &&
      pathLength(roadPath) <= dist(a, b) * 1.1;
    const edge = followsRoad ? roadPath : [a, b];
    outline.push(...edge.slice(0, -1));
  }
  outline.push(outline[0]);

  return {
    coords: outline.map(proj.from),
    perimeterMetres: Math.round(pathLength(outline)),
    fromMap: roads.count > 0 && onRoads > 0,
  };
}

// Squares near the centre, resized until the outline matches the target length.
function suggestShapes(center, targetPerimeter, features) {
  const proj = projector(center);
  const side = targetPerimeter / 4;
  const roads = roadIndex(features, proj, clamp(side / 40, 3, 40), clamp(side / 5, 10, 80));
  const prepared = { proj, roads };
  const gap = side * 1.3;
  const centres = [[0, 0], [0, gap], [gap, 0], [0, -gap], [-gap, 0]];
  const results = [];
  for (const [cx, cy] of centres) {
    let s = side;
    let best = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const h = s / 2;
      const square = [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]].map(proj.from);
      const shape = shapeFromLoop(square, null, prepared);
      if (!best || Math.abs(shape.perimeterMetres - targetPerimeter) < Math.abs(best.perimeterMetres - targetPerimeter)) best = shape;
      if (Math.abs(shape.perimeterMetres - targetPerimeter) / targetPerimeter < 0.05) break;
      s *= targetPerimeter / shape.perimeterMetres;
    }
    results.push(best);
  }
  return results;
}
`;

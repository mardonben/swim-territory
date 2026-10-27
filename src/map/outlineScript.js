// Plain JavaScript that runs inside the map page (see mapHtml.js), kept as text
// because the app itself can't hand real functions to the web page.
//
// Territory shapes ignore roads. A drawn loop is tidied into the shape you
// meant (draw a rectangle, get a rectangle) with rounded corners; the swim
// picker makes a circle. Either way the shape is then trimmed to the land, so
// it never runs out to sea or up a river; only lakes inside land are kept.

export const outlineScript = `
const M_PER_DEG_LAT = 110540;
// Thrown when a shape has no land in it. Territory is only ever on land.
const SEA = 'That area is all sea. Territory has to be on land.';

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

// Softens every corner with a curve.
function roundCorners(pts, radius) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const p = pts[i];
    const next = pts[(i + 1) % n];
    const lenIn = dist(prev, p);
    const lenOut = dist(p, next);
    const cut = Math.min(radius, lenIn * 0.45, lenOut * 0.45);
    if (cut < 0.5) { out.push(p); continue; }
    const a = [p[0] + ((prev[0] - p[0]) * cut) / lenIn, p[1] + ((prev[1] - p[1]) * cut) / lenIn];
    const b = [p[0] + ((next[0] - p[0]) * cut) / lenOut, p[1] + ((next[1] - p[1]) * cut) / lenOut];
    for (let s = 0; s <= 6; s++) {
      const t = s / 6;
      out.push([
        (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * p[0] + t * t * b[0],
        (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * p[1] + t * t * b[1],
      ]);
    }
  }
  return out;
}

function closeRing(coords) {
  return coords.concat([coords[0]]);
}

// The biggest piece of a (multi)polygon, as its outer ring only. Lakes inside
// a territory still count as territory.
function largestOuterRing(feature) {
  const g = feature.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let best = null;
  let bestArea = -1;
  for (const poly of polys) {
    const area = turf.area(turf.polygon([poly[0]]));
    if (area > bestArea) { bestArea = area; best = poly[0]; }
  }
  return best;
}

// Joins the water pieces drawn on screen (the map hands them over tile by
// tile) into whole seas, rivers and lakes.
function joinWater(water) {
  let joined = null;
  for (const w of water) {
    try {
      joined = joined ? turf.union(turf.featureCollection([joined, w])) || joined : w;
    } catch (e) {
      // Skip a piece turf can't handle rather than failing the shape.
    }
  }
  if (!joined) return [];
  const g = joined.geometry;
  return (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((c) => turf.polygon(c));
}

// How far inland water has to run, compared with how wide its mouth is, for
// the shape to cut straight across the mouth instead of following it in.
// Rivers and estuaries run far inland; coves and bays are about as deep as
// they are wide, so they're followed. 0 means always follow the water. The
// app can change it (see swimMap.setInletRatio).
let inletRatio = 1.5;

function polygonsOf(feature) {
  const g = feature.geometry;
  return (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((c) => turf.polygon(c));
}

// A piece of water that the land closes around. Its edge is bank (land), the
// edge of the screen, or its mouth (open to the sea). If it runs far enough
// inland for its mouth, returns it with the mouth straightened; otherwise null.
function inletWithStraightMouth(piece, nearLand, inner) {
  const area = turf.area(piece);
  if (area < 200) return null;
  const edge = turf.lineString(piece.geometry.coordinates[0]);
  const lengthKm = turf.length(edge, { units: 'kilometers' });
  const n = 160;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const p = turf.along(edge, (lengthKm * i) / n, { units: 'kilometers' });
    const mouth = !turf.booleanPointInPolygon(p, nearLand) && turf.booleanPointInPolygon(p, inner);
    pts.push({ p, mouth });
  }
  const mouthPts = pts.filter((x) => x.mouth);
  if (mouthPts.length === 0) return null;
  // The mouth should be one stretch of the edge, not several.
  let runs = 0;
  for (let i = 0; i < n; i++) if (pts[i].mouth && !pts[(i + n - 1) % n].mouth) runs++;
  if (runs > 1) return null;
  const hull = mouthPts.length >= 3 ? turf.convex(turf.featureCollection(mouthPts.map((x) => x.p))) : null;
  const ends = [mouthPts[0].p, mouthPts[mouthPts.length - 1].p];
  const mouthWidth = Math.max(turf.distance(ends[0], ends[1], { units: 'meters' }), (lengthKm * 1000) / n);
  // How far the water reaches from its mouth.
  let depth = 0;
  for (const x of pts) {
    if (x.mouth) continue;
    let nearest = Infinity;
    for (const m of mouthPts) nearest = Math.min(nearest, turf.distance(x.p, m.p, { units: 'meters' }));
    depth = Math.max(depth, nearest);
  }
  if (depth < inletRatio * mouthWidth) return null;
  // Bridging leaves the mouth curved; fill it out to a straight line.
  try {
    return hull ? turf.union(turf.featureCollection([piece, hull])) || piece : piece;
  } catch (e) {
    return piece;
  }
}

// Cut the water out of a shape (throwing SEA if nothing is left), so its
// outline runs along the land and never out into the sea. Two exceptions:
// water completely surrounded by land, like a lake or pond, counts as part of
// the territory; and a river, estuary or creek that runs well inland is cut
// straight across its mouth, in line with the coast. Coves and bays are
// followed. Water that runs off the edge of the screen isn't surrounded, so
// it's always cut out. view is the part of the map on screen.
function trimToLand(ring, water, sizeMetres, view) {
  const shape = turf.polygon([ring]);
  const reachKm = clamp(sizeMetres * 2, 50, 5000) / 1000;
  // Look well past the shape, so a river is judged by its whole length on
  // screen, not just the part inside the shape.
  let area = inletRatio > 0 ? turf.buffer(shape, reachKm, { units: 'kilometers', steps: 4 }) : shape;
  if (view && inletRatio > 0) {
    try {
      area = turf.intersect(turf.featureCollection([area, view])) || area;
    } catch (e) {
      // Keep the unclipped area.
    }
  }
  const screenEdge = view ? turf.polygonToLine(view) : null;
  const toCut = joinWater(water).filter((w) => {
    try {
      if (!turf.booleanIntersects(shape, w)) return false;
      // Within 20 m of the screen edge means it carries on off screen.
      const enclosed = screenEdge && !turf.booleanIntersects(turf.buffer(w, 0.02, { units: 'kilometers', steps: 2 }), screenEdge);
      return !enclosed;
    } catch (e) {
      return true;
    }
  });
  if (toCut.length === 0) return { ring, trimmed: false };

  let land = area;
  for (const w of toCut) {
    let next;
    try {
      next = turf.difference(turf.featureCollection([land, w]));
    } catch (e) {
      continue;
    }
    if (!next) throw new Error(SEA); // nothing but water
    land = next;
  }

  if (inletRatio > 0) {
    // Close up water at several sizes, biggest first. At each size, the water
    // that closes over is a candidate inlet: keep it as land only if it runs
    // far inland for the width of its mouth. Going from big to small finds an
    // estuary's outer mouth first, and a river at the back of a bay later.
    const inner = turf.buffer(area, -0.015, { units: 'kilometers', steps: 2 });
    for (let r = reachKm; r >= 0.03; r /= 3) {
      try {
        const grown = turf.buffer(land, r, { units: 'kilometers', steps: 8 });
        let closed = turf.buffer(grown, -r, { units: 'kilometers', steps: 8 });
        closed = closed && turf.intersect(turf.featureCollection([closed, area]));
        const filled = closed && turf.difference(turf.featureCollection([closed, land]));
        if (!filled) continue;
        const nearLand = turf.buffer(land, 0.015, { units: 'kilometers', steps: 2 });
        for (const piece of polygonsOf(filled)) {
          const inlet = inletWithStraightMouth(piece, nearLand, inner);
          if (inlet) land = turf.union(turf.featureCollection([land, inlet])) || land;
        }
      } catch (e) {
        // Bridging is a nicety; the trimmed land is still right.
      }
    }
  }

  // Never reach outside the shape you drew.
  const kept = turf.intersect(turf.featureCollection([land, shape]));
  // Too little land to swim for: just a sliver of beach or a jetty.
  if (!kept || turf.area(kept) < turf.area(shape) * 0.02) throw new Error(SEA);

  const outer = largestOuterRing(kept);
  return outer ? { ring: outer, trimmed: true } : { ring, trimmed: false };
}

function finish(ring, water, sizeMetres, view) {
  const result = trimToLand(ring, water, sizeMetres, view);
  const perimeterKm = turf.length(turf.lineString(result.ring), { units: 'kilometers' });
  return { coords: result.ring, perimeterMetres: Math.round(perimeterKm * 1000), trimmed: result.trimmed };
}

// loop: finger-drawn [lng, lat] points. water: water polygons on screen.
// view: the on-screen area as a polygon.
function shapeFromLoop(loop, water, view) {
  const pts = loop.slice();
  if (dist(pts[0], pts[pts.length - 1]) === 0) pts.pop();
  const proj = projector(pts[0]);
  const xy = pts.map(proj.to);
  const size = Math.sqrt(polygonArea(xy)) || 50;

  let corners = simplifyClosed(xy, 0.08 * size);
  if (corners.length < 3) corners = simplifyClosed(xy, 0.03 * size);
  if (corners.length < 3) corners = xy.slice(0, 3);
  const rounded = roundCorners(corners, clamp(0.1 * size, 5, 150));
  return finish(closeRing(rounded.map(proj.from)), water, size, view);
}

// A circle round the centre whose land boundary matches the target length.
function circleShape(center, targetPerimeter, water, view) {
  const proj = projector(center);
  let radius = targetPerimeter / (2 * Math.PI);
  let best = null;
  // Trimming off the sea changes the boundary length, so adjust and retry.
  for (let attempt = 0; attempt < 6; attempt++) {
    const ring = [];
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * 2 * Math.PI;
      ring.push(proj.from([radius * Math.cos(a), radius * Math.sin(a)]));
    }
    let shape;
    try {
      shape = finish(closeRing(ring), water, radius * 1.8, view);
    } catch (e) {
      // A resized circle can miss the land; keep the best one found so far.
      if (best) break;
      throw e;
    }
    const error = Math.abs(shape.perimeterMetres - targetPerimeter);
    if (!best || error < Math.abs(best.perimeterMetres - targetPerimeter)) best = shape;
    if (error / targetPerimeter < 0.03 || !shape.trimmed) break;
    radius *= Math.pow(targetPerimeter / shape.perimeterMetres, 0.8);
  }
  return best;
}
`;

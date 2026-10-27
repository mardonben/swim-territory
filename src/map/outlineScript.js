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

// Cut the water out of a shape (throwing SEA if nothing is left), so its
// outline always runs along land and never out into the sea or up a river.
// The one exception is water completely surrounded by land, like a lake or
// pond: that counts as part of the territory. Water that runs off the edge of
// the screen isn't surrounded, so it's always cut out. view is the part of the
// map on screen.
function trimToLand(ring, water, view) {
  const shape = turf.polygon([ring]);
  const edge = view ? turf.polygonToLine(view) : null;
  const toCut = joinWater(water).filter((w) => {
    try {
      if (!turf.booleanIntersects(shape, w)) return false;
      // Within 20 m of the screen edge means it carries on off screen.
      const enclosed = edge && !turf.booleanIntersects(turf.buffer(w, 0.02, { units: 'kilometers', steps: 2 }), edge);
      return !enclosed;
    } catch (e) {
      return true;
    }
  });
  if (toCut.length === 0) return { ring, trimmed: false };

  let land = shape;
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
  // Too little land to swim for: just a sliver of beach or a jetty.
  if (turf.area(land) < turf.area(shape) * 0.02) throw new Error(SEA);

  const outer = largestOuterRing(land);
  return outer ? { ring: outer, trimmed: true } : { ring, trimmed: false };
}

function finish(ring, water, sizeMetres, view) {
  const result = trimToLand(ring, water, view);
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

// Plain JavaScript that runs inside the map page (see mapHtml.js), kept as text
// because the app itself can't hand real functions to the web page.
//
// buildOutline turns a finger-drawn loop into a blocky territory: it gathers
// the roads, paths and field edges inside the loop, then wraps the tightest
// outline around them. Where there's no road, the outline joins the ends with
// a straight edge.

export const outlineScript = `
function buildOutline(loop, geometries) {
  const traced = turf.polygon([loop]);
  const sizeKm = Math.sqrt(turf.area(traced)) / 1000;
  // Roads drawn right along your finger line still count.
  const catchArea = turf.buffer(traced, 0.03, { units: 'kilometers' });
  const spacingKm = Math.min(Math.max(sizeKm / 40, 0.01), 0.05);

  const points = [];
  const seen = new Set();
  function addPoint(p) {
    const key = p[0].toFixed(6) + ',' + p[1].toFixed(6);
    if (seen.has(key)) return;
    seen.add(key);
    points.push(turf.point(p));
  }

  // Only whole stretches of road count, so a road poking out of your loop is
  // trimmed back to its last junction or bend inside it. That gives square ends.
  function addLine(coords) {
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1];
      const b = coords[i];
      if (!turf.booleanPointInPolygon(a, catchArea) || !turf.booleanPointInPolygon(b, catchArea)) continue;
      const lengthKm = turf.distance(a, b, { units: 'kilometers' });
      const steps = Math.max(1, Math.ceil(lengthKm / spacingKm));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        addPoint([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
  }
  for (const g of geometries) {
    if (g.type === 'LineString') addLine(g.coordinates);
    else if (g.type === 'MultiLineString' || g.type === 'Polygon') g.coordinates.forEach(addLine);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach((poly) => poly.forEach(addLine));
  }

  let hull = null;
  if (points.length >= 8) {
    const cloud = turf.featureCollection(points);
    for (const factor of [0.15, 0.25, 0.4, 0.6, 1]) {
      const candidate = turf.concave(cloud, { maxEdge: sizeKm * factor, units: 'kilometers' });
      if (candidate && candidate.geometry.type === 'Polygon') {
        hull = candidate;
        break;
      }
    }
    if (!hull) hull = turf.convex(cloud);
  }
  const fromMap = !!hull;
  if (!hull) hull = traced;

  // Straighten wobbles so edges read as clean blocks.
  const tidy = turf.simplify(hull, { tolerance: spacingKm / 111, highQuality: true });
  const coords = tidy.geometry.coordinates[0];
  const perimeterKm = turf.length(turf.lineString(coords), { units: 'kilometers' });
  return { coords, perimeterMetres: Math.round(perimeterKm * 1000), fromMap };
}
`;

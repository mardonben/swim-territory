// The map runs as a small web page inside the app (a WebView). That keeps it
// working in Expo Go, because the native Mapbox library would need a custom build.
// The page and the app talk to each other with short JSON messages.

const MAPBOX_GL_VERSION = '3.9.4';

export function buildMapHtml({ token, center }) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link href="https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_GL_VERSION}/mapbox-gl.css" rel="stylesheet" />
<script src="https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_GL_VERSION}/mapbox-gl.js"></script>
<style>
  html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; }
  body { background: #0B3D5C; }
</style>
</head>
<body>
<div id="map"></div>
<script>
  const TOKEN = ${JSON.stringify(token)};
  const MAX_MATCH_POINTS = 90;     // Mapbox Map Matching accepts up to 100 points
  const SNAP_RADIUS_METRES = 35;   // how far a traced point may be from a road

  function send(message) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
    }
  }

  window.onerror = function (msg) { send({ type: 'error', message: String(msg) }); };

  mapboxgl.accessToken = TOKEN;
  const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: ${JSON.stringify(center)},
    zoom: 15,
    attributionControl: true,
  });

  let drawMode = false;
  let traced = [];

  function haversine(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b[1] - a[1]);
    const dLng = toRad(b[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function lineLength(coords) {
    let total = 0;
    for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1], coords[i]);
    return total;
  }

  // Pick evenly spaced points along the trace so we stay under the API limit.
  function resample(coords, maxPoints) {
    if (coords.length <= maxPoints) return coords;
    const total = lineLength(coords);
    const step = total / (maxPoints - 1);
    const out = [coords[0]];
    let travelled = 0;
    let next = step;
    for (let i = 1; i < coords.length; i++) {
      travelled += haversine(coords[i - 1], coords[i]);
      if (travelled >= next) {
        out.push(coords[i]);
        next += step;
      }
    }
    out[out.length - 1] = coords[coords.length - 1];
    return out.slice(0, maxPoints);
  }

  function setLine(sourceId, coords) {
    map.getSource(sourceId).setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
    });
  }

  function setShape(coords) {
    map.getSource('shape').setData(coords.length < 3 ? emptyFeature() : {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [coords] },
    });
  }

  function emptyFeature() {
    return { type: 'FeatureCollection', features: [] };
  }

  async function snapToRoads(coords) {
    const points = resample(coords, MAX_MATCH_POINTS);
    const path = points.map((c) => c[0].toFixed(6) + ',' + c[1].toFixed(6)).join(';');
    const radiuses = points.map(() => SNAP_RADIUS_METRES).join(';');
    const url = 'https://api.mapbox.com/matching/v5/mapbox/walking/' + path +
      '?geometries=geojson&overview=full&tidy=true&radiuses=' + radiuses +
      '&access_token=' + TOKEN;
    const response = await fetch(url);
    const data = await response.json();
    if (data.code !== 'Ok' || !data.matchings || data.matchings.length === 0) {
      throw new Error(data.message || data.code || 'No match');
    }
    let snapped = [];
    for (const m of data.matchings) snapped = snapped.concat(m.geometry.coordinates);
    return snapped;
  }

  async function finishTrace() {
    if (traced.length < 5) {
      traced = [];
      setLine('trace', []);
      return;
    }
    const loop = traced.concat([traced[0]]);
    send({ type: 'snapping' });

    let shape = loop;
    let snapped = false;
    try {
      shape = await snapToRoads(loop);
      const first = shape[0];
      const last = shape[shape.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) shape = shape.concat([first]);
      snapped = true;
    } catch (e) {
      send({ type: 'snapFailed', message: String(e.message || e) });
    }

    setLine('trace', []);
    setShape(shape);
    traced = [];
    send({ type: 'shape', distanceMetres: Math.round(lineLength(shape)), snapped, coordinates: shape });
  }

  function pointFromEvent(e) {
    const touch = e.touches ? e.touches[0] : e;
    const rect = map.getCanvasContainer().getBoundingClientRect();
    const lngLat = map.unproject([touch.clientX - rect.left, touch.clientY - rect.top]);
    return [lngLat.lng, lngLat.lat];
  }

  function onStart(e) {
    if (!drawMode) return;
    e.preventDefault();
    traced = [pointFromEvent(e)];
    setShape([]);
    setLine('trace', traced);
  }

  function onMove(e) {
    if (!drawMode || traced.length === 0) return;
    e.preventDefault();
    traced.push(pointFromEvent(e));
    setLine('trace', traced);
  }

  function onEnd() {
    if (!drawMode || traced.length === 0) return;
    finishTrace();
  }

  // Commands the app sends in.
  window.swimMap = {
    setDrawMode(on) {
      drawMode = on;
      if (on) {
        map.dragPan.disable();
        map.touchZoomRotate.disable();
        map.doubleClickZoom.disable();
      } else {
        map.dragPan.enable();
        map.touchZoomRotate.enable();
        map.doubleClickZoom.enable();
      }
    },
    clear() {
      traced = [];
      setLine('trace', []);
      setShape([]);
    },
    flyTo(lng, lat) {
      map.flyTo({ center: [lng, lat], zoom: 15 });
    },
  };

  map.on('load', () => {
    map.addSource('trace', { type: 'geojson', data: emptyFeature() });
    map.addSource('shape', { type: 'geojson', data: emptyFeature() });
    map.addLayer({
      id: 'shape-fill', type: 'fill', source: 'shape',
      paint: { 'fill-color': '#1E90FF', 'fill-opacity': 0.25 },
    });
    map.addLayer({
      id: 'shape-outline', type: 'line', source: 'shape',
      paint: { 'line-color': '#0B3D5C', 'line-width': 4 },
    });
    map.addLayer({
      id: 'trace-line', type: 'line', source: 'trace',
      paint: { 'line-color': '#FF6B35', 'line-width': 3, 'line-dasharray': [2, 1] },
    });

    const container = map.getCanvasContainer();
    container.addEventListener('touchstart', onStart, { passive: false });
    container.addEventListener('touchmove', onMove, { passive: false });
    container.addEventListener('touchend', onEnd);
    container.addEventListener('mousedown', onStart);
    container.addEventListener('mousemove', (e) => { if (e.buttons === 1) onMove(e); });
    container.addEventListener('mouseup', onEnd);

    send({ type: 'ready' });
  });

  map.on('error', (e) => {
    send({ type: 'error', message: (e.error && e.error.message) || 'Map error' });
  });
</script>
</body>
</html>`;
}

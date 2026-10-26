// The map runs as a small web page inside the app (a WebView). That keeps it
// working in Expo Go, because the native Mapbox library would need a custom build.
// The page and the app talk to each other with short JSON messages.

import { outlineScript } from './outlineScript';

const MAPBOX_GL_VERSION = '3.9.4';
const TURF_VERSION = '7.2.0';

export function buildMapHtml({ token, center }) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link href="https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_GL_VERSION}/mapbox-gl.css" rel="stylesheet" />
<script src="https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_GL_VERSION}/mapbox-gl.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@turf/turf@${TURF_VERSION}/turf.min.js"></script>
<style>
  html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; }
  body { background: #0B3D5C; }
</style>
</head>
<body>
<div id="map"></div>
<script>
  const TOKEN = ${JSON.stringify(token)};
  // Map layers whose lines can form a territory edge: roads and paths, and the
  // edges of fields, parks and other land.
  const EDGE_SOURCE_LAYERS = ['road', 'landuse', 'landuse_overlay'];
  const SKIP_CLASSES = ['ferry', 'aerialway'];

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

${outlineScript}

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

  // Everything drawn on screen under the loop that could be a territory edge.
  function edgeGeometries(loop) {
    const pixels = loop.map((c) => map.project(c));
    const xs = pixels.map((p) => p.x);
    const ys = pixels.map((p) => p.y);
    const pad = 40;
    const box = [
      [Math.min(...xs) - pad, Math.min(...ys) - pad],
      [Math.max(...xs) + pad, Math.max(...ys) + pad],
    ];
    return map.queryRenderedFeatures(box)
      .filter((f) => EDGE_SOURCE_LAYERS.includes(f.sourceLayer))
      .filter((f) => !SKIP_CLASSES.includes(f.properties && f.properties.class))
      .map((f) => f.geometry);
  }

  function finishTrace() {
    if (traced.length < 5) {
      traced = [];
      setLine('trace', []);
      return;
    }
    const loop = traced.concat([traced[0]]);
    traced = [];
    setLine('trace', []);
    try {
      const outline = buildOutline(loop, edgeGeometries(loop));
      setShape(outline.coords);
      send({ type: 'shape', perimeterMetres: outline.perimeterMetres, fromMap: outline.fromMap, coordinates: outline.coords });
    } catch (e) {
      send({ type: 'error', message: 'Could not make a shape from that loop. Try drawing it again.' });
    }
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
      paint: { 'fill-color': '#1E90FF', 'fill-opacity': 0.3 },
    });
    map.addLayer({
      id: 'shape-outline', type: 'line', source: 'shape',
      layout: { 'line-join': 'miter' },
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

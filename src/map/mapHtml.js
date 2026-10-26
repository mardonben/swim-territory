// The map runs as a small web page inside the app (a WebView). That keeps it
// working in Expo Go, because the native Mapbox library would need a custom build.
// The page and the app talk to each other with short JSON messages.

import { outlineScript } from './outlineScript';

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
  /* Hide the "use two fingers" hint: one finger draws here on purpose. */
  .mapboxgl-touch-pan-blocker, .mapboxgl-scroll-zoom-blocker { display: none !important; }
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
    // Two fingers move and zoom the map, which leaves one finger free to draw.
    cooperativeGestures: true,
    doubleClickZoom: false,
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();

  let traced = [];
  let suggestions = [];

${outlineScript}

  function emptyFeature() {
    return { type: 'FeatureCollection', features: [] };
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

  function setSuggestions(list) {
    suggestions = list;
    map.getSource('suggestions').setData({
      type: 'FeatureCollection',
      features: list.map((s, i) => ({
        type: 'Feature',
        id: i,
        properties: { index: i },
        geometry: { type: 'Polygon', coordinates: [s.coords] },
      })),
    });
  }

  // Everything drawn on screen (or in a box of it) that could be a territory edge.
  function edgeFeatures(box) {
    return map.queryRenderedFeatures(box)
      .filter((f) => EDGE_SOURCE_LAYERS.includes(f.sourceLayer))
      .filter((f) => !SKIP_CLASSES.includes(f.properties && f.properties.class));
  }

  function boxAround(loop) {
    const pixels = loop.map((c) => map.project(c));
    const xs = pixels.map((p) => p.x);
    const ys = pixels.map((p) => p.y);
    const pad = 60;
    return [
      [Math.min(...xs) - pad, Math.min(...ys) - pad],
      [Math.max(...xs) + pad, Math.max(...ys) + pad],
    ];
  }

  function sendShape(shape) {
    setShape(shape.coords);
    send({ type: 'shape', perimeterMetres: shape.perimeterMetres, fromMap: shape.fromMap, coordinates: shape.coords });
  }

  function finishTrace() {
    const loop = traced.concat([traced[0]]);
    traced = [];
    setLine('trace', []);
    try {
      setSuggestions([]);
      sendShape(shapeFromLoop(loop, edgeFeatures(boxAround(loop))));
    } catch (e) {
      send({ type: 'error', message: 'Could not make a shape from that loop. Try drawing it again.' });
    }
  }

  // A quick tap on a suggested area picks it.
  function handleTap(point) {
    const hit = map.queryRenderedFeatures(point, { layers: ['suggestion-fill'] })[0];
    if (!hit) return;
    const chosen = suggestions[hit.properties.index];
    setSuggestions([]);
    sendShape(chosen);
  }

  function screenPoint(touch) {
    const rect = map.getCanvasContainer().getBoundingClientRect();
    return [touch.clientX - rect.left, touch.clientY - rect.top];
  }

  function lngLatAt(point) {
    const ll = map.unproject(point);
    return [ll.lng, ll.lat];
  }

  let tapStart = null;

  function onTouchStart(e) {
    if (e.touches.length > 1) {
      // A second finger means move/zoom, so drop whatever was being drawn.
      traced = [];
      tapStart = null;
      setLine('trace', []);
      return;
    }
    e.preventDefault();
    const p = screenPoint(e.touches[0]);
    tapStart = p;
    traced = [lngLatAt(p)];
  }

  function onTouchMove(e) {
    if (e.touches.length > 1 || traced.length === 0) return;
    e.preventDefault();
    traced.push(lngLatAt(screenPoint(e.touches[0])));
    setLine('trace', traced);
  }

  function onTouchEnd(e) {
    if (traced.length === 0) return;
    if (traced.length < 5) {
      const p = tapStart;
      traced = [];
      setLine('trace', []);
      if (p) handleTap(p);
      return;
    }
    finishTrace();
  }

  // Commands the app sends in.
  window.swimMap = {
    clear() {
      traced = [];
      setLine('trace', []);
      setShape([]);
      setSuggestions([]);
    },
    flyTo(lng, lat) {
      map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 15) });
    },
    showMe(lng, lat) {
      map.getSource('me').setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] } });
    },
    suggest(targetPerimeterMetres) {
      setShape([]);
      setSuggestions([]);
      const center = map.getCenter().toArray();
      // Zoom so all the suggested areas fit on screen, then read the roads there.
      const reach = (targetPerimeterMetres / 4) * 2.2;
      const dLat = reach / 110540;
      const dLng = reach / (111320 * Math.cos((center[1] * Math.PI) / 180));
      map.fitBounds([[center[0] - dLng, center[1] - dLat], [center[0] + dLng, center[1] + dLat]], { duration: 0, padding: 10 });
      map.once('idle', () => {
        try {
          const list = suggestShapes(center, targetPerimeterMetres, edgeFeatures());
          setSuggestions(list);
          send({ type: 'suggestions', count: list.length });
        } catch (e) {
          send({ type: 'error', message: 'Could not find areas to suggest here.' });
        }
      });
    },
  };

  map.on('load', () => {
    map.addSource('trace', { type: 'geojson', data: emptyFeature() });
    map.addSource('shape', { type: 'geojson', data: emptyFeature() });
    map.addSource('suggestions', { type: 'geojson', data: emptyFeature() });
    map.addSource('me', { type: 'geojson', data: emptyFeature() });
    map.addLayer({
      id: 'suggestion-fill', type: 'fill', source: 'suggestions',
      paint: { 'fill-color': '#2ECC71', 'fill-opacity': 0.18 },
    });
    map.addLayer({
      id: 'suggestion-outline', type: 'line', source: 'suggestions',
      layout: { 'line-join': 'miter' },
      paint: { 'line-color': '#1E8449', 'line-width': 3, 'line-dasharray': [2, 1.5] },
    });
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
    map.addLayer({
      id: 'me-dot', type: 'circle', source: 'me',
      paint: {
        'circle-radius': 8, 'circle-color': '#1E90FF',
        'circle-stroke-width': 3, 'circle-stroke-color': '#FFFFFF',
      },
    });

    const container = map.getCanvasContainer();
    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd);

    send({ type: 'ready' });
  });

  map.on('error', (e) => {
    send({ type: 'error', message: (e.error && e.error.message) || 'Map error' });
  });
</script>
</body>
</html>`;
}

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
  /* Hide the "use two fingers" hint: one finger draws here on purpose. */
  .mapboxgl-touch-pan-blocker, .mapboxgl-scroll-zoom-blocker { display: none !important; }
</style>
</head>
<body>
<div id="map"></div>
<script>
  const TOKEN = ${JSON.stringify(token)};

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

  // Sea, rivers and lakes drawn on screen (or in a box of it), as polygons.
  function waterFeatures(box) {
    return map.queryRenderedFeatures(box)
      .filter((f) => f.sourceLayer === 'water')
      .filter((f) => f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
      .map((f) => ({ type: 'Feature', properties: {}, geometry: f.geometry }));
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

  function sendShape(shape, suggested) {
    setShape(shape.coords);
    send({ type: 'shape', perimeterMetres: shape.perimeterMetres, trimmed: shape.trimmed, suggested: !!suggested, coordinates: shape.coords });
  }

  function finishTrace() {
    const loop = traced.concat([traced[0]]);
    traced = [];
    setLine('trace', []);
    try {
      sendShape(shapeFromLoop(loop, waterFeatures(boxAround(loop))));
    } catch (e) {
      send({ type: 'error', message: 'Could not make a shape from that loop. Try drawing it again.' });
    }
  }

  function screenPoint(touch) {
    const rect = map.getCanvasContainer().getBoundingClientRect();
    return [touch.clientX - rect.left, touch.clientY - rect.top];
  }

  function lngLatAt(point) {
    const ll = map.unproject(point);
    return [ll.lng, ll.lat];
  }

  function onTouchStart(e) {
    if (e.touches.length > 1) {
      // A second finger means move/zoom, so drop whatever was being drawn.
      traced = [];
      setLine('trace', []);
      return;
    }
    e.preventDefault();
    traced = [lngLatAt(screenPoint(e.touches[0]))];
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
      traced = [];
      setLine('trace', []);
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
    },
    flyTo(lng, lat) {
      map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 15) });
    },
    // Areas the swimmer has claimed: a list of boundary rings.
    showTerritory(rings) {
      map.getSource('territory').setData({
        type: 'FeatureCollection',
        features: rings.map((coords) => ({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [coords] },
        })),
      });
    },
    // The locked-in challenge waiting for its swim, or null to remove it.
    showPending(coords) {
      map.getSource('pending').setData(coords ? {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
      } : emptyFeature());
    },
    showMe(lng, lat) {
      map.getSource('me').setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] } });
    },
    suggest(targetPerimeterMetres) {
      setShape([]);
      const center = map.getCenter().toArray();
      // Zoom so the area fits on screen, then read the roads there.
      const reach = (targetPerimeterMetres / (2 * Math.PI)) * 1.2;
      const dLat = reach / 110540;
      const dLng = reach / (111320 * Math.cos((center[1] * Math.PI) / 180));
      map.fitBounds([[center[0] - dLng, center[1] - dLat], [center[0] + dLng, center[1] + dLat]], { duration: 0, padding: 10 });
      map.once('idle', () => {
        try {
          sendShape(circleShape(center, targetPerimeterMetres, waterFeatures()), true);
        } catch (e) {
          send({ type: 'error', message: 'Could not find an area to suggest here.' });
        }
      });
    },
  };

  map.on('load', () => {
    map.addSource('trace', { type: 'geojson', data: emptyFeature() });
    map.addSource('shape', { type: 'geojson', data: emptyFeature() });
    map.addSource('me', { type: 'geojson', data: emptyFeature() });
    map.addSource('pending', { type: 'geojson', data: emptyFeature() });
    map.addSource('territory', { type: 'geojson', data: emptyFeature() });
    map.addLayer({
      id: 'territory-fill', type: 'fill', source: 'territory',
      paint: { 'fill-color': '#00A79D', 'fill-opacity': 0.45 },
    });
    map.addLayer({
      id: 'territory-outline', type: 'line', source: 'territory',
      paint: { 'line-color': '#00796B', 'line-width': 3 },
    });
    map.addLayer({
      id: 'pending-fill', type: 'fill', source: 'pending',
      paint: { 'fill-color': '#FF6B35', 'fill-opacity': 0.15 },
    });
    map.addLayer({
      id: 'pending-outline', type: 'line', source: 'pending',
      paint: { 'line-color': '#FF6B35', 'line-width': 3, 'line-dasharray': [3, 2] },
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

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { buildMapHtml } from '../map/mapHtml';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
const LONDON = [-0.1276, 51.5072];
// Every 1 km you swim claims 4 km of territory outline.
const OUTLINE_PER_SWIM = 4;

function formatDistance(metres) {
  if (metres < 1000) return `${metres} m`;
  return `${(metres / 1000).toFixed(2)} km`;
}

export default function TraceScreen() {
  const webview = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [shape, setShape] = useState(null);
  const [status, setStatus] = useState('Loading map…');

  const swimMetres = shape ? Math.round(shape.perimeterMetres / OUTLINE_PER_SWIM) : 0;

  const html = useMemo(() => buildMapHtml({ token: MAPBOX_TOKEN, center: LONDON }), []);

  function run(js) {
    webview.current?.injectJavaScript(`${js}; true;`);
  }

  // Once the map is up, jump to where the phone is.
  useEffect(() => {
    if (!mapReady) return;
    (async () => {
      const { status: permission } = await Location.requestForegroundPermissionsAsync();
      if (permission !== 'granted') return;
      const position =
        (await Location.getLastKnownPositionAsync()) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      if (position) {
        run(`window.swimMap.flyTo(${position.coords.longitude}, ${position.coords.latitude})`);
      }
    })().catch(() => {});
  }, [mapReady]);

  function onMessage(event) {
    const message = JSON.parse(event.nativeEvent.data);
    switch (message.type) {
      case 'ready':
        setMapReady(true);
        setStatus('Tap ✏️ Draw, then trace a loop with your finger.');
        break;
      case 'shape':
        setShape(message);
        setStatus(
          message.fromMap
            ? 'Outline follows the roads, paths and fields inside your loop. Draw again to replace it.'
            : 'No roads or paths found inside, so this is your hand-drawn shape.'
        );
        break;
      case 'error':
        setStatus(`Map problem: ${message.message}`);
        break;
    }
  }

  function toggleDrawing() {
    const next = !drawing;
    setDrawing(next);
    run(`window.swimMap.setDrawMode(${next})`);
  }

  function clear() {
    setShape(null);
    run('window.swimMap.clear()');
    setStatus(drawing ? 'Trace a loop with your finger.' : 'Tap ✏️ Draw, then trace a loop with your finger.');
  }

  if (!MAPBOX_TOKEN) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.title}>Map key missing</Text>
        <Text style={styles.help}>
          Add your Mapbox public token to a file called .env.local in the project folder, then
          restart with npx expo start. See the README for the exact steps.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>🦈 Swim Territory</Text>
      </View>

      <WebView
        ref={webview}
        style={styles.map}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://localhost' }}
        onMessage={onMessage}
        javaScriptEnabled
      />

      <View style={styles.panel}>
        {shape ? (
          <>
            <Text style={styles.label}>Swim to claim it</Text>
            <Text style={styles.distance}>{formatDistance(swimMetres)}</Text>
            <Text style={styles.lengths}>
              about {Math.round(swimMetres / 25)} lengths of a 25 m pool · outline{' '}
              {formatDistance(shape.perimeterMetres)}
            </Text>
          </>
        ) : null}
        <Text style={styles.status}>{status}</Text>
        <View style={styles.buttons}>
          <Pressable
            style={[styles.button, drawing && styles.buttonActive]}
            onPress={toggleDrawing}
            disabled={!mapReady}
          >
            <Text style={styles.buttonText}>{drawing ? '✋ Move map' : '✏️ Draw'}</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={clear} disabled={!mapReady}>
            <Text style={styles.buttonText}>🗑️ Clear</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B3D5C',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    paddingTop: 48,
    paddingBottom: 12,
    alignItems: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: 'bold',
  },
  help: {
    color: '#9FD3F0',
    fontSize: 16,
    marginTop: 12,
    textAlign: 'center',
  },
  map: {
    flex: 1,
  },
  panel: {
    padding: 16,
    paddingBottom: 32,
    alignItems: 'center',
  },
  label: {
    color: '#9FD3F0',
    fontSize: 14,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  distance: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: 'bold',
  },
  lengths: {
    color: '#9FD3F0',
    fontSize: 14,
  },
  status: {
    color: '#9FD3F0',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  button: {
    backgroundColor: '#145A86',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 24,
  },
  buttonActive: {
    backgroundColor: '#FF6B35',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

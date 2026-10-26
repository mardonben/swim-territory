import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { buildMapHtml } from '../map/mapHtml';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
const LONDON = [-0.1276, 51.5072];
// Every 1 km you swim claims 4 km of territory outline.
const OUTLINE_PER_SWIM = 4;
const SWIM_DISTANCES = [25, 50, 100, 200, 400, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000, 7500, 10000];
const DRAW_HINT = 'Draw a loop with one finger. Use two fingers to move and zoom.';

function formatDistance(metres) {
  if (metres < 1000) return `${metres} m`;
  return `${(metres / 1000).toFixed(2).replace(/\.?0+$/, '')} km`;
}

export default function TraceScreen() {
  const webview = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [shape, setShape] = useState(null);
  const [status, setStatus] = useState('Loading map…');
  const [target, setTarget] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const swimMetres = shape ? Math.round(shape.perimeterMetres / OUTLINE_PER_SWIM) : 0;

  const html = useMemo(() => buildMapHtml({ token: MAPBOX_TOKEN, center: LONDON }), []);

  function run(js) {
    webview.current?.injectJavaScript(`${js}; true;`);
  }

  async function goToMe() {
    const { status: permission } = await Location.requestForegroundPermissionsAsync();
    if (permission !== 'granted') {
      setStatus('Location is off for Expo Go. Turn it on in your phone settings to use 📍.');
      return;
    }
    const position =
      (await Location.getLastKnownPositionAsync()) ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    if (position) {
      const { longitude, latitude } = position.coords;
      run(`window.swimMap.showMe(${longitude}, ${latitude})`);
      run(`window.swimMap.flyTo(${longitude}, ${latitude})`);
    }
  }

  // Once the map is up, jump to where the phone is.
  useEffect(() => {
    if (mapReady) goToMe().catch(() => {});
  }, [mapReady]);

  function onMessage(event) {
    const message = JSON.parse(event.nativeEvent.data);
    switch (message.type) {
      case 'ready':
        setMapReady(true);
        setStatus(DRAW_HINT);
        break;
      case 'shape':
        setShape(message);
        setStatus(
          message.suggested
            ? 'Here’s an area sized for that swim, around the middle of the map. Draw your own to replace it.'
            : message.fromMap
              ? 'Corners and edges follow the roads where they can. Draw again to replace it.'
              : 'No roads nearby, so your shape is kept as drawn.'
        );
        break;
      case 'error':
        setStatus(`Map problem: ${message.message}`);
        break;
    }
  }

  function chooseTarget(metres) {
    setPickerOpen(false);
    setTarget(metres);
    setShape(null);
    setStatus('Finding an area to claim…');
    run(`window.swimMap.suggest(${metres * OUTLINE_PER_SWIM})`);
  }

  function clear() {
    setShape(null);
    run('window.swimMap.clear()');
    setStatus(DRAW_HINT);
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
        <Text style={styles.title}>🦈 Sharked</Text>
      </View>

      <View style={styles.mapWrap}>
        <WebView
          ref={webview}
          style={styles.map}
          originWhitelist={['*']}
          source={{ html, baseUrl: 'https://localhost' }}
          onMessage={onMessage}
          javaScriptEnabled
        />
        <Pressable style={styles.locate} onPress={() => goToMe().catch(() => {})} disabled={!mapReady}>
          <Text style={styles.locateText}>📍</Text>
        </Pressable>
      </View>

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
          <Pressable style={styles.button} onPress={() => setPickerOpen(true)} disabled={!mapReady}>
            <Text style={styles.buttonText}>
              🏊 {target ? formatDistance(target) : 'Pick a swim'} ▾
            </Text>
          </Pressable>
          <Pressable style={styles.button} onPress={clear} disabled={!mapReady}>
            <Text style={styles.buttonText}>🗑️ Clear</Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPickerOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>How far do you want to swim?</Text>
            <FlatList
              data={SWIM_DISTANCES}
              keyExtractor={(d) => String(d)}
              renderItem={({ item }) => (
                <Pressable style={styles.option} onPress={() => chooseTarget(item)}>
                  <Text style={[styles.optionText, item === target && styles.optionChosen]}>
                    {formatDistance(item)}
                  </Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
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
  mapWrap: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  locate: {
    position: 'absolute',
    left: 12,
    // Sits above the Mapbox logo, which has to stay visible.
    bottom: 40,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  locateText: {
    fontSize: 22,
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
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '60%',
    paddingTop: 16,
    paddingBottom: 24,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
    color: '#0B3D5C',
  },
  option: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  optionText: {
    fontSize: 18,
    color: '#0B3D5C',
  },
  optionChosen: {
    fontWeight: 'bold',
    color: '#FF6B35',
  },
});

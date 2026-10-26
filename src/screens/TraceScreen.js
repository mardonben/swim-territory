import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { buildMapHtml } from '../map/mapHtml';
import {
  cancelChallenge,
  completeChallenge,
  getPendingChallenge,
  getTerritory,
  lockInChallenge,
} from '../lib/challenges';
import { getMyProfile, isValidNickname, NICKNAME_RULE, saveMyProfile, SWIMMER_COLOURS } from '../lib/profile';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
const LONDON = [-0.1276, 51.5072];
// Every 1 km you swim claims 4 km of territory outline.
const OUTLINE_PER_SWIM = 4;
const SWIM_DISTANCES = [25, 50, 100, 200, 400, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000, 7500, 10000];
const DRAW_HINT = 'Draw a loop with one finger. Use two fingers to move and zoom.';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

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
  const [pending, setPending] = useState(null);
  const [territory, setTerritory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [nickname, setNickname] = useState('');
  const [colour, setColour] = useState(SWIMMER_COLOURS[0]);
  const [profileError, setProfileError] = useState(null);

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

  function showPending(challenge) {
    setPending(challenge);
    const coords = challenge ? challenge.boundary.coordinates[0] : null;
    run(`window.swimMap.showPending(${JSON.stringify(coords)})`);
  }

  function showTerritory(areas) {
    setTerritory(areas);
    const forMap = areas.map((a) => ({
      geometry: a.boundary,
      mine: a.mine,
      nickname: a.nickname,
      colour: a.colour,
      claimedAt: a.claimed_at,
    }));
    run(`window.swimMap.showTerritory(${JSON.stringify(forMap)})`);
  }

  const myAreas = territory.filter((a) => a.mine).length;

  // Once the map is up, jump to where the phone is and load your challenge and territory.
  useEffect(() => {
    if (!mapReady) return;
    goToMe().catch(() => {});
    getPendingChallenge()
      .then(showPending)
      .catch(() => {});
    getTerritory()
      .then(showTerritory)
      .catch(() => {});
    // First time on this phone: pick a nickname before anything else.
    getMyProfile()
      .then((mine) => (mine ? setProfile(mine) : editProfile(null)))
      .catch(() => {});
  }, [mapReady]);

  function editProfile(current) {
    setNickname(current?.nickname ?? '');
    setColour(current?.colour ?? SWIMMER_COLOURS[Math.floor(Math.random() * SWIMMER_COLOURS.length)]);
    setProfileError(null);
    setProfileOpen(true);
  }

  async function saveProfile() {
    const name = nickname.trim();
    if (!isValidNickname(name)) {
      setProfileError(`Nicknames can be ${NICKNAME_RULE}.`);
      return;
    }
    setSaving(true);
    try {
      setProfile(await saveMyProfile({ nickname: name, colour }));
      setProfileOpen(false);
      showTerritory(await getTerritory());
    } catch (e) {
      setProfileError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function markSwum() {
    setSaving(true);
    try {
      await completeChallenge(pending.id);
      showPending(null);
      showTerritory(await getTerritory());
      setStatus('🦈 Sharked it! That area is yours now, including any bits you took from others.');
    } catch (e) {
      setStatus(`Couldn't claim it: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function lockIn() {
    setSaving(true);
    try {
      const challenge = await lockInChallenge({
        coordinates: shape.coordinates,
        boundaryMetres: shape.perimeterMetres,
        swimMetres,
      });
      setShape(null);
      run('window.swimMap.clear()');
      showPending(challenge);
      setStatus(`Locked in! Swim ${formatDistance(challenge.swim_metres)} in one go to claim it.`);
    } catch (e) {
      setStatus(`Couldn't save: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function cancelPending() {
    setSaving(true);
    try {
      await cancelChallenge(pending.id);
      showPending(null);
      setStatus('Challenge cancelled. ' + DRAW_HINT);
    } catch (e) {
      setStatus(`Couldn't cancel: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

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
          (message.suggested
            ? 'A circle sized for that swim, from the middle of the map.'
            : 'Your territory. Draw again to replace it.') +
            (message.trimmed ? ' Trimmed to the coastline.' : '')
        );
        break;
      case 'areaTapped':
        if (message.nickname) {
          const since = message.claimedAt ? ` since ${formatDate(message.claimedAt)}` : '';
          setStatus(message.mine ? `That's your area${since}.` : `Held by ${message.nickname}${since}.`);
        }
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
        {profile ? (
          <Pressable style={styles.me} onPress={() => editProfile(profile)}>
            <View style={[styles.swatch, { backgroundColor: profile.colour }]} />
            <Text style={styles.subtitle}>
              {profile.nickname}
              {myAreas > 0 ? ` · ${myAreas} ${myAreas === 1 ? 'area' : 'areas'} held` : ''} ✏️
            </Text>
          </Pressable>
        ) : myAreas > 0 ? (
          <Text style={styles.subtitle}>
            {myAreas} {myAreas === 1 ? 'area' : 'areas'} held
          </Text>
        ) : null}
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
        {pending ? (
          <View style={styles.pending}>
            <Text style={styles.pendingText}>
              🦈 Pending: swim {formatDistance(pending.swim_metres)} in one go
            </Text>
            <Pressable onPress={cancelPending} disabled={saving}>
              <Text style={styles.pendingCancel}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}
        {pending ? (
          <Pressable style={[styles.button, styles.swum]} onPress={markSwum} disabled={saving}>
            <Text style={styles.buttonText}>{saving ? 'Saving…' : '✅ I swam it (test)'}</Text>
          </Pressable>
        ) : null}
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
        {shape && !pending ? (
          <Pressable style={[styles.button, styles.lockIn]} onPress={lockIn} disabled={saving}>
            <Text style={styles.buttonText}>{saving ? 'Saving…' : '🔒 Lock in this challenge'}</Text>
          </Pressable>
        ) : null}
        {shape && pending ? (
          <Text style={styles.status}>Finish or cancel your pending challenge to lock in a new one.</Text>
        ) : null}
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

      <Modal
        visible={profileOpen}
        transparent
        animationType="fade"
        onRequestClose={() => profile && setProfileOpen(false)}
      >
        <View style={[styles.backdrop, styles.centeredBackdrop]}>
          <View style={styles.card}>
            <Text style={styles.sheetTitle}>{profile ? 'Your nickname' : 'Pick a nickname'}</Text>
            <Text style={styles.cardHelp}>
              Other swimmers see this on your areas. Don't use your real name.
            </Text>
            <TextInput
              style={styles.input}
              value={nickname}
              onChangeText={setNickname}
              placeholder="e.g. Jaws"
              maxLength={20}
              autoCorrect={false}
            />
            <Text style={styles.cardHelp}>Your colour on the map</Text>
            <View style={styles.colours}>
              {SWIMMER_COLOURS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setColour(c)}
                  style={[styles.colour, { backgroundColor: c }, c === colour && styles.colourChosen]}
                />
              ))}
            </View>
            {profileError ? <Text style={styles.error}>{profileError}</Text> : null}
            <View style={styles.buttons}>
              {profile ? (
                <Pressable style={[styles.button, styles.secondary]} onPress={() => setProfileOpen(false)}>
                  <Text style={[styles.buttonText, styles.secondaryText]}>Cancel</Text>
                </Pressable>
              ) : null}
              <Pressable style={[styles.button, styles.lockIn, styles.flat]} onPress={saveProfile} disabled={saving}>
                <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
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
  subtitle: {
    color: '#9FD3F0',
    fontSize: 13,
    marginTop: 2,
  },
  me: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  centeredBackdrop: {
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  cardHelp: {
    color: '#0B3D5C',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  input: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: '#9FD3F0',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontSize: 18,
    color: '#0B3D5C',
    marginTop: 12,
  },
  colours: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    marginTop: 10,
  },
  colour: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  colourChosen: {
    borderWidth: 4,
    borderColor: '#0B3D5C',
  },
  error: {
    color: '#E74C3C',
    fontSize: 14,
    marginTop: 10,
    textAlign: 'center',
  },
  secondary: {
    backgroundColor: '#E8F4FB',
  },
  secondaryText: {
    color: '#0B3D5C',
  },
  flat: {
    marginTop: 0,
  },
  swum: {
    backgroundColor: '#00A79D',
    marginBottom: 4,
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
  pending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FF6B35',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    marginBottom: 8,
  },
  pendingText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  pendingCancel: {
    color: '#FFFFFF',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  lockIn: {
    backgroundColor: '#FF6B35',
    marginTop: 12,
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

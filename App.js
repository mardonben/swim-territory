import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.fin}>🦈</Text>
      <Text style={styles.title}>Swim Territory</Text>
      <Text style={styles.subtitle}>Swim it. Claim it. Defend it.</Text>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B3D5C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fin: {
    fontSize: 72,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: 'bold',
    marginTop: 12,
  },
  subtitle: {
    color: '#9FD3F0',
    fontSize: 16,
    marginTop: 8,
  },
});

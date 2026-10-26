import { StatusBar } from 'expo-status-bar';
import TraceScreen from './src/screens/TraceScreen';

export default function App() {
  return (
    <>
      <TraceScreen />
      <StatusBar style="light" />
    </>
  );
}

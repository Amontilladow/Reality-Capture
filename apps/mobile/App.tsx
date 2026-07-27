import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { initDatabase } from './src/lib/db';
import { RootNavigator } from './src/navigation/RootNavigator';
import { colors } from './src/theme/colors';
// Registers the background sync TaskManager task as a side effect of import.
import './src/lib/sync';

export default function App() {
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    try {
      initDatabase();
      setDbReady(true);
    } catch (err) {
      // A failure here means captures can't be queued at all — surfacing it loudly
      // is more useful than silently degrading into a broken capture flow.
      console.error('Failed to initialise local database', err);
      setDbReady(true);
    }
  }, []);

  if (!dbReady) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.blueprint} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <RootNavigator />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.base950 },
});

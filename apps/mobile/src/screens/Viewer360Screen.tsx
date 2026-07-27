import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Capture } from '@engineeringos/types';
import { colors } from '../theme/colors';
import { getViewerData, getCapture } from '../lib/captures.api';
import { buildPanoramaHtml } from '../lib/panoramaHtml';
import type { ProjectsStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<ProjectsStackParamList, 'Viewer360'>;

export default function Viewer360Screen({ route }: Props) {
  const { projectId, locationId } = route.params;
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [active, setActive] = useState<Capture | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getViewerData(projectId, locationId);
        if (cancelled) return;
        setCaptures(list);
        if (list[0]) {
          const detail = await getCapture(projectId, list[0].id);
          if (!cancelled) setActive(detail);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load captures.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, locationId]);

  const html = useMemo(() => {
    const url = active?.previewUrl ?? active?.thumbnailUrl;
    return url ? buildPanoramaHtml(url) : null;
  }, [active]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.blueprint} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (captures.length === 0 || !html) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>No 360° captures registered at this location yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        style={styles.webview}
        allowsInlineMediaPlayback
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        renderLoading={() => (
          <View style={styles.center}>
            <ActivityIndicator color={colors.blueprint} />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base950 },
  webview: { flex: 1, backgroundColor: colors.base950 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.base950, padding: 24 },
  errorText: { color: colors.danger, fontSize: 13, textAlign: 'center' },
  emptyText: { color: colors.ink500, fontSize: 13, textAlign: 'center' },
});

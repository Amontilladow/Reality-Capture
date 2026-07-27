import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { StatusBadge } from '../components/StatusBadge';
import { useSyncQueue } from '../hooks/useSyncQueue';

const TYPE_LABEL: Record<string, string> = {
  photo_360: '360° Photo',
  photo_standard: 'Photo',
  video: 'Video',
};

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CaptureHistoryScreen() {
  const { items, refresh } = useSyncQueue();

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={colors.blueprint} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No captures yet. Take your first capture from a project.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowHeader}>
              <Text style={styles.typeLabel}>{TYPE_LABEL[item.captureType] ?? item.captureType}</Text>
              <StatusBadge status={item.status} />
            </View>
            <Text style={styles.title}>{item.title || 'Untitled capture'}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.meta}>{new Date(item.capturedAt).toLocaleString()}</Text>
              <Text style={styles.meta}>{formatSize(item.sizeBytes)}</Text>
              {item.gpsLat !== null && <Text style={styles.meta}>GPS ✓</Text>}
            </View>
            {item.status === 'failed' && item.lastError && (
              <Text style={styles.errorText} numberOfLines={2}>{item.lastError}</Text>
            )}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.base950 },
  list: { padding: 16 },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { color: colors.ink500, fontSize: 13, textAlign: 'center' },
  row: {
    backgroundColor: colors.base800, borderWidth: 1, borderColor: colors.base600, borderRadius: 6, padding: 14, marginBottom: 10,
  },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  typeLabel: { color: colors.blueprint, fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },
  title: { color: colors.ink100, fontSize: 14, fontWeight: '600', marginBottom: 6 },
  metaRow: { flexDirection: 'row', gap: 12 },
  meta: { color: colors.ink500, fontSize: 11, fontFamily: 'monospace' },
  errorText: { color: colors.danger, fontSize: 11, marginTop: 6 },
});

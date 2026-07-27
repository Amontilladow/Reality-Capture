import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { useSyncQueue } from '../hooks/useSyncQueue';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { updateQueueStatus } from '../lib/db';

export default function SyncStatusScreen() {
  const { counts, items, isSyncing, syncNow, refresh } = useSyncQueue();
  const isOnline = useNetworkStatus();

  const actionable = items.filter((i) => i.status === 'pending' || i.status === 'failed' || i.status === 'uploading');

  function retryItem(id: string) {
    updateQueueStatus(id, 'pending');
    refresh();
    syncNow();
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <View style={styles.summaryRow}>
        <SummaryCard label="Pending" value={counts.pending} color={colors.warn} />
        <SummaryCard label="Uploading" value={counts.uploading} color={colors.blueprint} />
        <SummaryCard label="Synced" value={counts.uploaded} color={colors.ok} />
        <SummaryCard label="Failed" value={counts.failed} color={colors.danger} />
      </View>

      <View style={styles.networkRow}>
        <View style={[styles.dot, { backgroundColor: isOnline ? colors.ok : colors.danger }]} />
        <Text style={styles.networkText}>{isOnline ? 'Online' : 'Offline — queue will sync when reconnected'}</Text>
      </View>

      <View style={styles.syncButtonWrap}>
        <Button
          label={isSyncing ? 'Syncing…' : 'Sync now'}
          onPress={syncNow}
          loading={isSyncing}
          disabled={!isOnline || actionable.length === 0}
        />
      </View>

      <FlatList
        data={actionable}
        keyExtractor={(i) => i.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Nothing to sync — everything is up to date.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.title || 'Untitled capture'}</Text>
              <Text style={styles.meta}>
                {item.attempts > 0 ? `${item.attempts} attempt${item.attempts === 1 ? '' : 's'} · ` : ''}
                {new Date(item.createdAt).toLocaleTimeString()}
              </Text>
              {item.lastError && <Text style={styles.errorText} numberOfLines={1}>{item.lastError}</Text>}
            </View>
            <StatusBadge status={item.status} />
            {item.status === 'failed' && (
              <Button label="Retry" variant="secondary" onPress={() => retryItem(item.id)} style={styles.retryButton} />
            )}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.base950 },
  summaryRow: { flexDirection: 'row', padding: 16, gap: 8 },
  summaryCard: {
    flex: 1, backgroundColor: colors.base800, borderWidth: 1, borderColor: colors.base600, borderRadius: 6,
    paddingVertical: 12, alignItems: 'center',
  },
  summaryValue: { fontSize: 20, fontWeight: '700', fontFamily: 'monospace' },
  summaryLabel: { color: colors.ink500, fontSize: 10, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  networkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  networkText: { color: colors.ink500, fontSize: 12 },
  syncButtonWrap: { paddingHorizontal: 16, marginBottom: 16 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { color: colors.ink500, fontSize: 13, textAlign: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.base800, borderWidth: 1,
    borderColor: colors.base600, borderRadius: 6, padding: 12, marginBottom: 8,
  },
  title: { color: colors.ink100, fontSize: 13, fontWeight: '600' },
  meta: { color: colors.ink500, fontSize: 11, marginTop: 2, fontFamily: 'monospace' },
  errorText: { color: colors.danger, fontSize: 11, marginTop: 2 },
  retryButton: { paddingVertical: 8, paddingHorizontal: 12 },
});

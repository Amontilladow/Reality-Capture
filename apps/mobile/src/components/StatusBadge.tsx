import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import type { QueueStatus } from '../lib/db';

const CONFIG: Record<QueueStatus, { label: string; color: string; bg: string }> = {
  pending: { label: 'PENDING', color: colors.warn, bg: 'rgba(251,191,36,0.15)' },
  uploading: { label: 'UPLOADING', color: colors.blueprint, bg: 'rgba(79,182,232,0.15)' },
  uploaded: { label: 'SYNCED', color: colors.ok, bg: 'rgba(74,222,128,0.15)' },
  failed: { label: 'FAILED', color: colors.danger, bg: 'rgba(248,113,113,0.15)' },
};

export function StatusBadge({ status }: { status: QueueStatus }) {
  const cfg = CONFIG[status];
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.text, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 3, alignSelf: 'flex-start' },
  text: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, fontFamily: 'monospace' },
});

import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Project } from '@engineeringos/types';
import { colors } from '../theme/colors';
import { listProjects } from '../lib/projects.api';
import { apiErrorMessage } from '../lib/api';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import type { ProjectsStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<ProjectsStackParamList, 'ProjectsList'>;

const STATUS_COLOR: Record<string, string> = {
  active: colors.ok,
  on_hold: colors.warn,
  completed: colors.blueprint,
  archived: colors.ink500,
};

export default function ProjectsScreen({ navigation }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOnline = useNetworkStatus();

  const load = useCallback(async () => {
    try {
      const res = await listProjects({ perPage: 50 });
      setProjects(res.data);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      {!isOnline && (
        <View style={styles.offlineBar}>
          <Text style={styles.offlineText}>Offline — showing last loaded projects</Text>
        </View>
      )}

      {error && !loading && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <FlatList
        data={projects}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.blueprint}
          />
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No projects yet.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => navigation.navigate('ProjectDetail', { projectId: item.id, projectName: item.name })}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.code}>{item.code ?? '—'}</Text>
              <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[item.status] ?? colors.ink500 }]} />
            </View>
            <Text style={styles.name}>{item.name}</Text>
            {(item.city || item.country) && (
              <Text style={styles.location}>{[item.city, item.country].filter(Boolean).join(', ')}</Text>
            )}
            <View style={styles.statsRow}>
              <Text style={styles.stat}>{item.captureCount ?? 0} captures</Text>
              <Text style={styles.stat}>{item.openIssueCount ?? 0} open issues</Text>
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.base950 },
  list: { padding: 16, gap: 12 },
  offlineBar: { backgroundColor: 'rgba(251,191,36,0.15)', paddingVertical: 6, alignItems: 'center' },
  offlineText: { color: colors.warn, fontSize: 12, fontWeight: '600' },
  errorBox: { margin: 16, padding: 12, backgroundColor: 'rgba(248,113,113,0.1)', borderRadius: 4 },
  errorText: { color: colors.danger, fontSize: 13 },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { color: colors.ink500, fontSize: 14 },
  card: {
    backgroundColor: colors.base800, borderWidth: 1, borderColor: colors.base600, borderRadius: 6, padding: 16, marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  code: { color: colors.ink500, fontSize: 10, fontFamily: 'monospace', letterSpacing: 0.5 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  name: { color: colors.ink100, fontSize: 16, fontWeight: '600', marginBottom: 4 },
  location: { color: colors.ink500, fontSize: 12, marginBottom: 10 },
  statsRow: { flexDirection: 'row', gap: 16, borderTopWidth: 1, borderTopColor: colors.base600, paddingTop: 10 },
  stat: { color: colors.ink300, fontSize: 11, fontFamily: 'monospace' },
});

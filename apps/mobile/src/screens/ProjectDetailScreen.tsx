import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import { getHierarchy, type ProjectHierarchy } from '../lib/projects.api';
import { apiErrorMessage } from '../lib/api';
import { Button } from '../components/Button';
import type { ProjectsStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<ProjectsStackParamList, 'ProjectDetail'>;

export default function ProjectDetailScreen({ route, navigation }: Props) {
  const { projectId, projectName } = route.params;
  const [buildings, setBuildings] = useState<ProjectHierarchy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openBuildings, setOpenBuildings] = useState<Set<string>>(new Set());
  const [openLevels, setOpenLevels] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const data = await getHierarchy(projectId);
      setBuildings(data);
      setOpenBuildings(new Set(data.map((b) => b.id)));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  function toggleBuilding(id: string) {
    setOpenBuildings((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleLevel(id: string) {
    setOpenLevels((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function goCapture(locationId?: string, locationLabel?: string) {
    navigation.navigate('CaptureSession', { projectId, projectName, locationId, locationLabel });
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.blueprint} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Button label="Quick capture (unassigned location)" onPress={() => goCapture()} style={styles.quickCapture} />

        {buildings.length === 0 && !error && (
          <Text style={styles.empty}>No buildings set up for this project yet.</Text>
        )}

        {buildings.map((building) => (
          <View key={building.id} style={styles.buildingBlock}>
            <Pressable style={styles.row} onPress={() => toggleBuilding(building.id)}>
              <Text style={styles.chevron}>{openBuildings.has(building.id) ? '▾' : '▸'}</Text>
              <Text style={styles.buildingName}>{building.name}</Text>
            </Pressable>

            {openBuildings.has(building.id) &&
              (building.levels ?? []).map((level) => (
                <View key={level.id} style={styles.levelBlock}>
                  <Pressable style={[styles.row, styles.levelRow]} onPress={() => toggleLevel(level.id)}>
                    <Text style={styles.chevron}>{openLevels.has(level.id) ? '▾' : '▸'}</Text>
                    <Text style={styles.levelName}>{level.name}</Text>
                  </Pressable>

                  {openLevels.has(level.id) &&
                    (level.locations ?? []).map((location) => (
                      <View key={location.id} style={styles.locationRow}>
                        <Pressable
                          style={styles.locationTouchArea}
                          onPress={() => goCapture(location.id, `${building.name} · ${level.name} · ${location.name}`)}
                        >
                          <View style={styles.locationDot} />
                          <Text style={styles.locationName}>{location.name}</Text>
                        </Pressable>
                        {(location.captureCount ?? 0) > 0 && (
                          <Pressable
                            onPress={() => navigation.navigate('Viewer360', { projectId, locationId: location.id })}
                            style={styles.viewButton}
                          >
                            <Text style={styles.locationCount}>{location.captureCount} view →</Text>
                          </Pressable>
                        )}
                      </View>
                    ))}
                  {openLevels.has(level.id) && (level.locations ?? []).length === 0 && (
                    <Text style={styles.emptySub}>No locations yet</Text>
                  )}
                </View>
              ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.base950 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.base950 },
  scroll: { padding: 16 },
  errorBox: { padding: 12, backgroundColor: 'rgba(248,113,113,0.1)', borderRadius: 4, marginBottom: 12 },
  errorText: { color: colors.danger, fontSize: 13 },
  quickCapture: { marginBottom: 20 },
  empty: { color: colors.ink500, fontSize: 13, textAlign: 'center', marginTop: 20 },
  emptySub: { color: colors.ink500, fontSize: 12, paddingVertical: 6, paddingLeft: 36 },
  buildingBlock: { marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 8 },
  levelRow: { paddingLeft: 20 },
  chevron: { color: colors.ink500, fontSize: 12, width: 14 },
  buildingName: { color: colors.blueprint, fontSize: 15, fontWeight: '600' },
  levelBlock: { marginLeft: 4, borderLeftWidth: 1, borderLeftColor: colors.base600, paddingLeft: 8 },
  levelName: { color: colors.ink100, fontSize: 14, fontWeight: '500' },
  locationRow: {
    flexDirection: 'row', alignItems: 'center', paddingLeft: 40, paddingRight: 8,
    borderBottomWidth: 1, borderBottomColor: colors.base800,
  },
  locationTouchArea: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  viewButton: { paddingVertical: 10, paddingHorizontal: 8 },
  locationDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.signal },
  locationName: { color: colors.ink300, fontSize: 13, flex: 1 },
  locationCount: { color: colors.blueprint, fontSize: 11, fontFamily: 'monospace' },
});

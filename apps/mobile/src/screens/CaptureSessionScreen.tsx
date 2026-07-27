import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { PROJECT_PHASES, PROJECT_PHASE_LABELS, type CaptureType, type ProjectPhase } from '@engineeringos/types';
import { colors } from '../theme/colors';
import { TextField } from '../components/TextField';
import { Button } from '../components/Button';
import { enqueueCapture } from '../lib/queue';
import type { ProjectsStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<ProjectsStackParamList, 'CaptureSession'>;

const CAPTURE_TYPES: { value: CaptureType; label: string; hint: string }[] = [
  { value: 'photo_360', label: '360° Photo', hint: 'From a dedicated 360° camera, or import an equirectangular image' },
  { value: 'photo_standard', label: 'Standard Photo', hint: 'Phone camera photo' },
  { value: 'video', label: 'Video', hint: 'Phone camera video' },
];

export default function CaptureSessionScreen({ route, navigation }: Props) {
  const { projectId, projectName, locationId, locationLabel } = route.params;
  const [captureType, setCaptureType] = useState<CaptureType>('photo_standard');
  const [phase, setPhase] = useState<ProjectPhase | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  function openCamera() {
    navigation.navigate('Camera', {
      projectId,
      captureType,
      locationId,
      phase,
      title: title || null,
      description: description || null,
    });
  }

  /**
   * 360° cameras (Ricoh Theta, Insta360, etc.) aren't addressable through Expo's
   * managed camera API — the standard field workflow is: shoot on the dedicated
   * camera, sync the equirectangular JPEG to the phone's photo library, then
   * import it here. This is that import path.
   */
  async function importFromLibrary() {
    setImportError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setImportError('Photo library permission is required to import a 360° capture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]) return;

    setImporting(true);
    try {
      const asset = result.assets[0];
      await enqueueCapture({
        sourceUri: asset.uri,
        projectId,
        locationId: locationId ?? null,
        captureType: 'photo_360',
        phase,
        title: title || null,
        description: description || null,
        mimeType: asset.mimeType ?? 'image/jpeg',
      });
      navigation.goBack();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.locationBanner}>
          <Text style={styles.locationLabel}>{locationLabel ?? 'Unassigned location'}</Text>
          <Text style={styles.projectLabel}>{projectName}</Text>
        </View>

        <Text style={styles.sectionTitle}>Capture type</Text>
        <View style={styles.typeGrid}>
          {CAPTURE_TYPES.map((t) => (
            <Pressable
              key={t.value}
              onPress={() => setCaptureType(t.value)}
              style={[styles.typeCard, captureType === t.value && styles.typeCardActive]}
            >
              <Text style={[styles.typeLabel, captureType === t.value && styles.typeLabelActive]}>{t.label}</Text>
              <Text style={styles.typeHint}>{t.hint}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Construction phase</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.phaseScroll}>
          <Pressable onPress={() => setPhase(null)} style={[styles.phaseChip, phase === null && styles.phaseChipActive]}>
            <Text style={[styles.phaseChipText, phase === null && styles.phaseChipTextActive]}>None</Text>
          </Pressable>
          {PROJECT_PHASES.map((p) => (
            <Pressable key={p} onPress={() => setPhase(p)} style={[styles.phaseChip, phase === p && styles.phaseChipActive]}>
              <Text style={[styles.phaseChipText, phase === p && styles.phaseChipTextActive]}>{PROJECT_PHASE_LABELS[p]}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <TextField label="Title (optional)" value={title} onChangeText={setTitle} placeholder="e.g. North stairwell, Level 4" />
        <TextField
          label="Description (optional)"
          value={description}
          onChangeText={setDescription}
          placeholder="Notes about this capture"
          multiline
          numberOfLines={3}
          style={{ height: 80, textAlignVertical: 'top' }}
        />

        {importError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{importError}</Text>
          </View>
        )}

        {captureType === 'photo_360' ? (
          <Button label={importing ? 'Importing…' : 'Import 360° photo from library'} onPress={importFromLibrary} loading={importing} />
        ) : (
          <Button label={captureType === 'video' ? 'Open camera — record video' : 'Open camera — take photo'} onPress={openCamera} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.base950 },
  scroll: { padding: 16, paddingBottom: 40 },
  locationBanner: {
    backgroundColor: colors.base800, borderWidth: 1, borderColor: colors.base600, borderRadius: 6, padding: 14, marginBottom: 20,
  },
  locationLabel: { color: colors.signal, fontSize: 14, fontWeight: '700' },
  projectLabel: { color: colors.ink500, fontSize: 12, marginTop: 2 },
  sectionTitle: { color: colors.ink500, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  typeGrid: { gap: 8, marginBottom: 20 },
  typeCard: { borderWidth: 1, borderColor: colors.base600, borderRadius: 6, padding: 12, backgroundColor: colors.base900 },
  typeCardActive: { borderColor: colors.signal, backgroundColor: 'rgba(255,122,41,0.08)' },
  typeLabel: { color: colors.ink100, fontSize: 14, fontWeight: '600' },
  typeLabelActive: { color: colors.signal },
  typeHint: { color: colors.ink500, fontSize: 11, marginTop: 2 },
  phaseScroll: { marginBottom: 20 },
  phaseChip: {
    borderWidth: 1, borderColor: colors.base600, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, marginRight: 8,
  },
  phaseChipActive: { borderColor: colors.blueprint, backgroundColor: 'rgba(79,182,232,0.12)' },
  phaseChipText: { color: colors.ink300, fontSize: 12 },
  phaseChipTextActive: { color: colors.blueprint, fontWeight: '600' },
  errorBox: { padding: 12, backgroundColor: 'rgba(248,113,113,0.1)', borderRadius: 4, marginBottom: 16 },
  errorText: { color: colors.danger, fontSize: 13 },
});

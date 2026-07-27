import { useRef, useState } from 'react';
import { StyleSheet, Text, View, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import { Button } from '../components/Button';
import { enqueueCapture } from '../lib/queue';
import type { ProjectsStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<ProjectsStackParamList, 'Camera'>;

export default function CameraScreen({ route, navigation }: Props) {
  const { projectId, captureType, locationId, phase, title, description } = route.params;
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [facing] = useState<'back' | 'front'>('back');
  const [isRecording, setIsRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(uri: string, mimeType: string) {
    setSaving(true);
    try {
      await enqueueCapture({
        sourceUri: uri,
        projectId,
        locationId: locationId ?? null,
        captureType,
        phase: (phase as any) ?? null,
        title: title ?? null,
        description: description ?? null,
        mimeType,
      });
      // Pop back past both Camera and CaptureSession to the location the user started from.
      navigation.pop(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this capture.');
      setSaving(false);
    }
  }

  async function takePhoto() {
    if (!cameraRef.current) return;
    setError(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) await handleSave(photo.uri, 'image/jpeg');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not take photo.');
    }
  }

  async function toggleVideo() {
    if (!cameraRef.current) return;
    setError(null);
    if (isRecording) {
      cameraRef.current.stopRecording();
      return;
    }
    setIsRecording(true);
    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: 120 });
      setIsRecording(false);
      if (video?.uri) await handleSave(video.uri, 'video/mp4');
    } catch (err) {
      setIsRecording(false);
      setError(err instanceof Error ? err.message : 'Could not record video.');
    }
  }

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.blueprint} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permissionScreen}>
        <Text style={styles.permissionTitle}>Camera access needed</Text>
        <Text style={styles.permissionBody}>
          EngineeringOS needs your camera to capture site photos and video.
        </Text>
        <Button label="Grant camera access" onPress={requestPermission} style={{ marginTop: 20 }} />
        <Button label="Cancel" variant="ghost" onPress={() => navigation.goBack()} style={{ marginTop: 8 }} />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} mode={captureType === 'video' ? 'video' : 'picture'} />

      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.topBar}>
          <Pressable onPress={() => navigation.goBack()} style={styles.closeButton}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
          <Text style={styles.typeLabel}>{captureType === 'video' ? 'VIDEO' : 'PHOTO'}</Text>
        </View>

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.bottomBar}>
          {saving ? (
            <ActivityIndicator color={colors.ink100} />
          ) : captureType === 'video' ? (
            <Pressable onPress={toggleVideo} style={[styles.shutter, isRecording && styles.shutterRecording]}>
              <View style={[styles.shutterInner, isRecording ? styles.shutterInnerSquare : styles.shutterInnerCircle]} />
            </Pressable>
          ) : (
            <Pressable onPress={takePhoto} style={styles.shutter}>
              <View style={[styles.shutterInner, styles.shutterInnerCircle]} />
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.base950 },
  overlay: { flex: 1, justifyContent: 'space-between' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  closeButton: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(10,20,28,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  closeText: { color: '#fff', fontSize: 16 },
  typeLabel: {
    color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 1, backgroundColor: 'rgba(10,20,28,0.6)',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4,
  },
  errorBanner: { marginHorizontal: 16, backgroundColor: 'rgba(248,113,113,0.9)', padding: 10, borderRadius: 6 },
  errorText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  bottomBar: { alignItems: 'center', paddingBottom: 36 },
  shutter: {
    width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: 'rgba(255,255,255,0.8)',
    alignItems: 'center', justifyContent: 'center',
  },
  shutterRecording: { borderColor: colors.danger },
  shutterInner: { backgroundColor: '#fff' },
  shutterInnerCircle: { width: 58, height: 58, borderRadius: 29 },
  shutterInnerSquare: { width: 30, height: 30, borderRadius: 6, backgroundColor: colors.danger },
  permissionScreen: { flex: 1, backgroundColor: colors.base950, padding: 24, justifyContent: 'center' },
  permissionTitle: { color: colors.ink100, fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  permissionBody: { color: colors.ink500, fontSize: 13, textAlign: 'center' },
});

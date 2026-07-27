import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { Button } from '../components/Button';
import { useAuthStore } from '../store/auth.store';
import { logout as apiLogout } from '../lib/auth.api';
import { useSyncQueue } from '../hooks/useSyncQueue';

export default function ProfileScreen() {
  const user = useAuthStore((s) => s.user);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const clear = useAuthStore((s) => s.clear);
  const { counts } = useSyncQueue();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      if (refreshToken) await apiLogout(refreshToken).catch(() => {});
    } finally {
      await clear();
      setLoggingOut(false);
    }
  }

  const pendingTotal = counts.pending + counts.uploading + counts.failed;

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(user?.firstName?.[0] ?? '') + (user?.lastName?.[0] ?? '')}
          </Text>
        </View>
        <Text style={styles.name}>{user?.firstName} {user?.lastName}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <Text style={styles.role}>{(user?.companyRole ?? '').replace(/_/g, ' ')}</Text>

        {pendingTotal > 0 && (
          <View style={styles.warningBox}>
            <Text style={styles.warningText}>
              {pendingTotal} capture{pendingTotal === 1 ? '' : 's'} still syncing. Signing out won't lose them —
              they'll finish uploading next time you're signed in and online.
            </Text>
          </View>
        )}

        <Button
          label={loggingOut ? 'Signing out…' : 'Sign out'}
          variant="danger"
          onPress={handleLogout}
          loading={loggingOut}
          style={styles.logoutButton}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.base950 },
  scroll: { padding: 24, alignItems: 'center' },
  avatar: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(79,182,232,0.15)', borderWidth: 1,
    borderColor: colors.blueprint, alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  avatarText: { color: colors.blueprint, fontSize: 24, fontWeight: '700', fontFamily: 'monospace' },
  name: { color: colors.ink100, fontSize: 18, fontWeight: '700' },
  email: { color: colors.ink500, fontSize: 13, marginTop: 4 },
  role: { color: colors.ink300, fontSize: 11, marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  warningBox: {
    marginTop: 28, backgroundColor: 'rgba(251,191,36,0.1)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.3)',
    borderRadius: 6, padding: 14,
  },
  warningText: { color: colors.warn, fontSize: 12, lineHeight: 18 },
  logoutButton: { marginTop: 32, alignSelf: 'stretch' },
});

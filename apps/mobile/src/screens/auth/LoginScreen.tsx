import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../theme/colors';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { login } from '../../lib/auth.api';
import { apiErrorMessage } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

export default function LoginScreen() {
  const setSession = useAuthStore((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!email || !password) {
      setError('Enter your email and password.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await login(email.trim(), password);
      await setSession(result.tokens, result.user);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <View style={styles.mark} />
            <Text style={styles.brandText}>EngineeringOS</Text>
            <Text style={styles.brandSub}>REALITY CAPTURE — FIELD APP</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>Sign in</Text>
            <Text style={styles.subtitle}>Access your company's capture workspace.</Text>

            <TextField
              label="Work email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              placeholder="you@company.com"
            />
            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              placeholder="••••••••"
            />

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Button label={loading ? 'Signing in…' : 'Sign in'} onPress={handleSubmit} loading={loading} />

            <Text style={styles.hint} onPress={() => Linking.openURL('https://app.engineeringos.com/forgot-password')}>
              Forgot password? Reset it on the web app.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.base950 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  brand: { alignItems: 'center', marginBottom: 32 },
  mark: {
    width: 40, height: 40, borderRadius: 6, borderWidth: 2, borderColor: colors.signal, marginBottom: 12,
  },
  brandText: { color: colors.ink100, fontSize: 18, fontWeight: '700' },
  brandSub: { color: colors.ink500, fontSize: 10, letterSpacing: 1.5, marginTop: 2, fontFamily: 'monospace' },
  card: {
    backgroundColor: colors.base800, borderWidth: 1, borderColor: colors.base600, borderRadius: 6, padding: 20,
  },
  title: { color: colors.ink100, fontSize: 20, fontWeight: '700', marginBottom: 4 },
  subtitle: { color: colors.ink500, fontSize: 13, marginBottom: 20 },
  errorBox: {
    backgroundColor: 'rgba(248,113,113,0.1)', borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)',
    borderRadius: 4, padding: 10, marginBottom: 16,
  },
  errorText: { color: colors.danger, fontSize: 13 },
  hint: { color: colors.blueprint, fontSize: 12, textAlign: 'center', marginTop: 16 },
});

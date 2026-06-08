import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import ScreenShell, { colors } from '../components/ScreenShell';
import { loginSubcontractor, normalizePortalUrl, validatePortalUrl } from '../api/subcontractorApi';
import { loadPortalUrl, savePortalUrl, saveSession } from '../utils/storage';

export default function LoginScreen({ onLogin }) {
  const [portalUrl, setPortalUrl] = useState('fnsportal.com');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkingPortal, setCheckingPortal] = useState(false);

  useEffect(() => {
    loadPortalUrl().then((saved) => {
      if (saved) setPortalUrl(saved);
    });
  }, []);

  async function handleValidatePortal() {
    setCheckingPortal(true);
    try {
      const result = await validatePortalUrl(portalUrl);
      setPortalUrl(result.portalUrl);
      await savePortalUrl(result.portalUrl);
      Alert.alert('Portal Connected', 'This URL is ready for the subcontractor mobile app.');
    } catch (error) {
      Alert.alert('Portal Error', error?.message || 'Unable to validate that portal URL.');
    } finally {
      setCheckingPortal(false);
    }
  }

  async function handleLogin() {
    const url = normalizePortalUrl(portalUrl);
    const cleanEmail = email.trim().toLowerCase();
    if (!url) {
      Alert.alert('Portal Required', 'Please enter the company portal URL first.');
      return;
    }
    if (!cleanEmail || !password) {
      Alert.alert('Login Required', 'Please enter your subcontractor email and password.');
      return;
    }
    setBusy(true);
    try {
      await validatePortalUrl(url);
      const session = await loginSubcontractor(url, { email: cleanEmail, password });
      const fullSession = { ...session, portalUrl: url };
      await savePortalUrl(url);
      await saveSession(fullSession);
      onLogin(fullSession);
    } catch (error) {
      Alert.alert('Login Failed', error?.message || 'Please check your email and password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenShell title="FNS Subcontractor Portal" subtitle="Subcontractor mobile access">
      <StatusBar style="light" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.heading}>Sign in</Text>
            <Text style={styles.copy}>Use the same subcontractor login managed inside the IHA/FNS ERP.</Text>

            <Text style={styles.label}>Company Portal URL</Text>
            <View style={styles.portalRow}>
              <TextInput
                value={portalUrl}
                onChangeText={setPortalUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="fnsportal.com"
                placeholderTextColor="#94a3b8"
                style={[styles.input, styles.portalInput]}
              />
              <Pressable style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]} onPress={handleValidatePortal} disabled={checkingPortal || busy}>
                {checkingPortal ? <ActivityIndicator color="#fff" /> : <Text style={styles.smallButtonText}>Check</Text>}
              </Pressable>
            </View>

            <Text style={styles.label}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              placeholder="name@subcontractor.com"
              placeholderTextColor="#94a3b8"
              style={styles.input}
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              placeholder="Password"
              placeholderTextColor="#94a3b8"
              style={styles.input}
            />

            <Pressable style={({ pressed }) => [styles.loginButton, pressed && styles.pressed]} onPress={handleLogin} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.loginText}>Log In</Text>}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  card: { backgroundColor: '#fff', borderRadius: 26, padding: 22, borderWidth: 1, borderColor: colors.line, shadowColor: '#0f172a', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
  heading: { fontSize: 30, fontWeight: '900', color: colors.text },
  copy: { color: colors.muted, lineHeight: 21, marginTop: 8, marginBottom: 12, fontWeight: '600' },
  label: { marginTop: 16, marginBottom: 7, color: '#334155', fontSize: 13, fontWeight: '900' },
  input: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, color: colors.text, fontSize: 16, fontWeight: '700' },
  portalRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  portalInput: { flex: 1 },
  smallButton: { minWidth: 76, height: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a', borderRadius: 14 },
  smallButtonText: { color: '#fff', fontWeight: '900' },
  loginButton: { marginTop: 24, backgroundColor: colors.blue, paddingVertical: 15, borderRadius: 16, alignItems: 'center' },
  loginText: { color: '#fff', fontWeight: '900', fontSize: 16 },
  pressed: { opacity: 0.72 },
});

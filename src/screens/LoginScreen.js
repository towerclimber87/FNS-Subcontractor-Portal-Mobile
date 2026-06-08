import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { loginSubcontractor } from '../api/subcontractorApi';
import { savePortalUrl, saveSession } from '../utils/storage';

export default function LoginScreen({ portalUrl, onChangePortal, onLogin }) {
  const { width } = useWindowDimensions();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const isTablet = width >= 768;

  const logoUrl = useMemo(() => {
    if (!portalUrl) return '';
    return `${portalUrl.replace(/\/+$/g, '')}/static/Logo/Logo/Logo.png`;
  }, [portalUrl]);

  function showLoginError(message) {
    const clean = String(message || '').trim();
    if (/csrf/i.test(clean)) {
      setErrorMessage('The subcontractor mobile login route is not fully enabled on the ERP yet. Please update the ERP backend files, restart the ERP, and try again.');
      return;
    }
    setErrorMessage(clean || 'Please check your email and password.');
  }

  async function handleLogin() {
    const cleanEmail = email.trim().toLowerCase();
    setErrorMessage('');

    if (!portalUrl) {
      setErrorMessage('Please set the company portal first.');
      return;
    }

    if (!cleanEmail || !password) {
      setErrorMessage('Please enter your subcontractor email and password.');
      return;
    }

    setBusy(true);
    try {
      const session = await loginSubcontractor(portalUrl, { email: cleanEmail, password });
      const fullSession = { ...session, portalUrl };
      await savePortalUrl(portalUrl);
      await saveSession(fullSession);
      onLogin(fullSession);
    } catch (error) {
      showLoginError(error?.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.erpBackground}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.keyboardWrap}
          behavior="height"
          keyboardVerticalOffset={0}
        >
          <ScrollView
            contentContainerStyle={[
              styles.erpContent,
              {
                paddingHorizontal: isTablet ? 48 : 24,
                paddingTop: isTablet ? 58 : 24,
                paddingBottom: isTablet ? 90 : 64,
              },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          >
            <View
              style={[
                styles.loginCard,
                {
                  maxWidth: isTablet ? 540 : 460,
                  paddingHorizontal: isTablet ? 48 : 30,
                  paddingTop: isTablet ? 56 : 42,
                  paddingBottom: isTablet ? 48 : 34,
                },
              ]}
            >
              {!!logoUrl && (
                <Image
                  source={{ uri: logoUrl }}
                  style={[styles.companyLogo, { width: isTablet ? 240 : 220 }]}
                  resizeMode="contain"
                />
              )}

              <Text style={styles.loginTitle}>Subcontractor Login</Text>

              {!!errorMessage && (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
              )}

              <View style={styles.formGroup}>
                <Text style={styles.erpLabel}>Email</Text>
                <TextInput
                  style={styles.erpInput}
                  placeholder="Enter your email"
                  placeholderTextColor="#8b90a5"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="username"
                  value={email}
                  onChangeText={(value) => {
                    setEmail(value);
                    if (errorMessage) setErrorMessage('');
                  }}
                  returnKeyType="next"
                  editable={!busy}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.erpLabel}>Password</Text>
                <TextInput
                  style={styles.erpInput}
                  placeholder="Enter your password"
                  placeholderTextColor="#8b90a5"
                  secureTextEntry
                  textContentType="password"
                  value={password}
                  onChangeText={(value) => {
                    setPassword(value);
                    if (errorMessage) setErrorMessage('');
                  }}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  editable={!busy}
                />
              </View>

              <Pressable style={[styles.erpPrimaryButton, busy && styles.disabledButton]} onPress={handleLogin} disabled={busy}>
                {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.erpPrimaryButtonText}>Login</Text>}
              </Pressable>

              <Pressable style={styles.changePortalWrap} onPress={onChangePortal} disabled={busy}>
                <Text style={[styles.changePortalText, busy && styles.disabledText]}>Change Company Portal</Text>
              </Pressable>
            </View>
          </ScrollView>

          <StatusBar style="dark" />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  keyboardWrap: { flex: 1 },
  erpBackground: { flex: 1, backgroundColor: '#f4f6ff' },
  erpContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f4f6ff' },
  loginCard: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
    alignItems: 'center',
  },
  companyLogo: { height: 120, marginBottom: 28 },
  loginTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1c1c29',
    marginBottom: 28,
    textAlign: 'center',
  },
  errorBanner: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginTop: -12,
    marginBottom: 18,
  },
  errorText: { color: '#991b1b', fontSize: 13, fontWeight: '800', lineHeight: 19, textAlign: 'center' },
  formGroup: { width: '100%', marginBottom: 18 },
  erpLabel: { color: '#33334d', fontSize: 14, fontWeight: '700', marginBottom: 7 },
  erpInput: {
    width: '100%',
    height: 54,
    borderWidth: 1,
    borderColor: '#cfd3ea',
    borderRadius: 16,
    backgroundColor: '#f7f9ff',
    paddingHorizontal: 16,
    color: '#1c1c29',
    fontSize: 16,
  },
  erpPrimaryButton: {
    width: '100%',
    height: 58,
    borderRadius: 16,
    backgroundColor: '#3360ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  disabledButton: { opacity: 0.7 },
  erpPrimaryButtonText: { color: '#ffffff', fontSize: 17, fontWeight: '800' },
  changePortalWrap: { marginTop: 24 },
  changePortalText: { color: '#6b7280', fontSize: 13, fontWeight: '700' },
  disabledText: { opacity: 0.55 },
});

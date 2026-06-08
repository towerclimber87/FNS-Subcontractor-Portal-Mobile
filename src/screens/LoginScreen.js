import * as LocalAuthentication from 'expo-local-authentication';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

import { forgotPasswordSubcontractor, loginSubcontractor, normalizePortalUrl } from '../api/subcontractorApi';
import {
  clearBiometricLogin,
  loadBiometricLogin,
  loadSession,
  saveBiometricLogin,
  savePortalUrl,
  saveSession,
} from '../utils/storage';

function cleanPortal(value) {
  return normalizePortalUrl(value).replace(/\/+$/g, '').toLowerCase();
}

function buildSession(portalUrl, response) {
  return {
    ...response,
    portalUrl,
    access_token: response.access_token,
    token_type: response.token_type || 'bearer',
    user: response.user || {},
    loginTime: new Date().toISOString(),
  };
}

export default function LoginScreen({ portalUrl, onChangePortal, onLogin }) {
  const { width } = useWindowDimensions();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('error');
  const [hasSavedLogin, setHasSavedLogin] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState('Face ID');
  const [biometricPromptOpen, setBiometricPromptOpen] = useState(false);

  const isTablet = width >= 768;

  const logoUrl = useMemo(() => {
    if (!portalUrl) return '';
    return `${portalUrl.replace(/\/+$/g, '')}/static/Logo/Logo/Logo.png`;
  }, [portalUrl]);

  useEffect(() => {
    checkSavedLogin();
  }, [portalUrl]);

  function setInlineError(text) {
    setMessageTone('error');
    setMessage(text || 'Something went wrong.');
  }

  function setInlineSuccess(text) {
    setMessageTone('success');
    setMessage(text || 'Success.');
  }

  async function checkSavedLogin() {
    try {
      const [savedSession, savedBiometricLogin] = await Promise.all([
        loadSession(),
        loadBiometricLogin(),
      ]);
      const savedPortal = savedSession?.portalUrl || savedBiometricLogin?.portalUrl || '';
      const matchesPortal = !savedPortal || cleanPortal(savedPortal) === cleanPortal(portalUrl);
      setHasSavedLogin(Boolean(matchesPortal && (savedSession?.access_token || savedBiometricLogin?.email)));

      const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();
      if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        setBiometricLabel('Face ID');
      } else if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        setBiometricLabel('Touch ID');
      } else {
        setBiometricLabel('Biometric Login');
      }
    } catch (error) {
      console.warn('Failed to check subcontractor saved login:', error);
    }
  }

  async function saveSessionWithBiometrics(nextSession, credentials = null) {
    await savePortalUrl(nextSession.portalUrl || portalUrl);
    await saveSession(nextSession);
    if (credentials?.email && credentials?.password) {
      await saveBiometricLogin({
        portalUrl: nextSession.portalUrl || portalUrl,
        email: credentials.email,
        password: credentials.password,
        savedAt: new Date().toISOString(),
      });
    }
    setHasSavedLogin(true);
    onLogin(nextSession);
  }

  async function unlockWithBiometrics() {
    if (biometricPromptOpen || busy || !hasSavedLogin) return;
    setBiometricPromptOpen(true);
    setMessage('');

    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (!hasHardware || !isEnrolled) {
        setInlineError('Face ID or Touch ID is not set up on this device.');
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: `Sign in with ${biometricLabel}`,
        fallbackLabel: 'Use Passcode',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });

      if (!result.success) return;

      const savedSession = await loadSession();
      if (savedSession?.access_token && cleanPortal(savedSession.portalUrl) === cleanPortal(portalUrl)) {
        onLogin(savedSession);
        return;
      }

      const savedLogin = await loadBiometricLogin();
      if (!savedLogin?.email || !savedLogin?.password || cleanPortal(savedLogin.portalUrl) !== cleanPortal(portalUrl)) {
        setHasSavedLogin(false);
        setInlineError('Saved login not found. Please log in again.');
        return;
      }

      setBusy(true);
      const response = await loginSubcontractor(portalUrl, {
        email: savedLogin.email,
        password: savedLogin.password,
      });
      await saveSessionWithBiometrics(buildSession(portalUrl, response), savedLogin);
    } catch (error) {
      setInlineError(error?.message || 'Unable to unlock the saved login session.');
      console.warn('Subcontractor biometric unlock failed:', error);
    } finally {
      setBusy(false);
      setBiometricPromptOpen(false);
    }
  }

  function handleEmailFocus() {
    if (hasSavedLogin) unlockWithBiometrics();
  }

  async function handleLogin() {
    const cleanEmail = email.trim().toLowerCase();
    setMessage('');

    if (!portalUrl) {
      setInlineError('Please enter the company portal URL first.');
      return;
    }

    if (!cleanEmail || !password) {
      setInlineError('Please enter your subcontractor email and password.');
      return;
    }

    setBusy(true);
    try {
      const response = await loginSubcontractor(portalUrl, { email: cleanEmail, password });
      await saveSessionWithBiometrics(buildSession(portalUrl, response), { email: cleanEmail, password });
    } catch (error) {
      setInlineError(error?.message || 'Please check your email and password.');
    } finally {
      setBusy(false);
    }
  }

  async function handleForgotPassword() {
    const resetEmail = String(email || '').trim().toLowerCase();
    setMessage('');

    if (!resetEmail) {
      setInlineError('Please enter email address first, then press Forgot Password.');
      return;
    }

    setBusy(true);
    try {
      await forgotPasswordSubcontractor(portalUrl, { email: resetEmail });
      setInlineSuccess('Please check your email for the password reset link.');
    } catch (error) {
      setInlineError(error?.message || 'Unable to send the password reset email.');
    } finally {
      setBusy(false);
    }
  }

  async function clearSavedLogin() {
    try {
      await clearBiometricLogin();
      setHasSavedLogin(false);
      setInlineSuccess('The saved Face ID / Touch ID login was removed from this device.');
    } catch (error) {
      setInlineError('The saved login could not be removed.');
      console.warn('Failed to clear subcontractor saved login:', error);
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
                  paddingBottom: isTablet ? 42 : 32,
                },
              ]}
            >
              {!!logoUrl && <Image source={{ uri: logoUrl }} style={[styles.companyLogo, { width: isTablet ? 240 : 220 }]} resizeMode="contain" />}

              <Text style={styles.loginTitle}>Subcontractor Login</Text>

              {hasSavedLogin ? (
                <Text style={styles.savedLoginHint}>Tap the email field to sign in with {biometricLabel}.</Text>
              ) : null}

              {!!message && (
                <View style={[styles.messageBox, messageTone === 'success' && styles.successBox]}>
                  <Text style={[styles.messageText, messageTone === 'success' && styles.successText]}>{message}</Text>
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
                  onChangeText={setEmail}
                  onFocus={handleEmailFocus}
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
                  onChangeText={setPassword}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  editable={!busy}
                />
              </View>

              <Pressable style={styles.forgotPasswordWrap} onPress={handleForgotPassword} disabled={busy}>
                <Text style={[styles.forgotPasswordText, busy && styles.disabledText]}>Forgot Password?</Text>
              </Pressable>

              <Pressable style={[styles.erpPrimaryButton, busy && styles.disabledButton]} onPress={handleLogin} disabled={busy}>
                {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.erpPrimaryButtonText}>Login</Text>}
              </Pressable>

              {hasSavedLogin ? (
                <Pressable onPress={clearSavedLogin} disabled={busy}>
                  <Text style={[styles.removeSavedLoginText, busy && styles.disabledText]}>Remove saved login</Text>
                </Pressable>
              ) : null}

              <Pressable style={styles.changePortalWrap} onPress={onChangePortal} disabled={busy}>
                <Text style={[styles.changePortalText, busy && styles.disabledText]}>Change Company Portal</Text>
              </Pressable>
            </View>
          </ScrollView>

          <StatusBar style="dark" backgroundColor="#f4f6ff" translucent={false} />
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
  loginCard: { width: '100%', backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 28, shadowOffset: { width: 0, height: 12 }, elevation: 8, alignItems: 'center' },
  companyLogo: { height: 120, marginBottom: 24 },
  loginTitle: { fontSize: 26, fontWeight: '700', color: '#1c1c29', marginBottom: 18, textAlign: 'center' },
  savedLoginHint: { color: '#6b7280', fontSize: 13, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  messageBox: { width: '100%', borderRadius: 14, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16 },
  messageText: { color: '#b91c1c', fontSize: 13, fontWeight: '800', textAlign: 'center', lineHeight: 18 },
  successBox: { backgroundColor: '#ecfdf5', borderColor: '#bbf7d0' },
  successText: { color: '#047857' },
  formGroup: { width: '100%', marginBottom: 18 },
  erpLabel: { color: '#33334d', fontSize: 14, fontWeight: '700', marginBottom: 7 },
  erpInput: { width: '100%', height: 54, borderWidth: 1, borderColor: '#cfd3ea', borderRadius: 16, backgroundColor: '#f7f9ff', paddingHorizontal: 16, color: '#1c1c29', fontSize: 16 },
  erpPrimaryButton: { width: '100%', height: 58, borderRadius: 16, backgroundColor: '#3360ff', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  disabledButton: { opacity: 0.7 },
  erpPrimaryButtonText: { color: '#ffffff', fontSize: 17, fontWeight: '800' },
  forgotPasswordWrap: { alignSelf: 'flex-end', marginTop: -6, marginBottom: 10, paddingVertical: 6, paddingHorizontal: 2 },
  forgotPasswordText: { color: '#3360ff', fontSize: 13, fontWeight: '800' },
  disabledText: { opacity: 0.55 },
  removeSavedLoginText: { color: '#ef4444', fontSize: 13, fontWeight: '700', marginTop: 16 },
  changePortalWrap: { marginTop: 24 },
  changePortalText: { color: '#6b7280', fontSize: 13, fontWeight: '700' },
});

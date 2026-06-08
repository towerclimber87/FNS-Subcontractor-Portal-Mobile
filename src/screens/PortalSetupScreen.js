import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
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

import { normalizePortalUrl, validatePortalUrl } from '../api/subcontractorApi';

function buildPortalUrl(value) {
  const raw = String(value || '').trim().replace(/\s+/g, '');
  if (!raw) return '';
  return normalizePortalUrl(raw);
}

export default function PortalSetupScreen({ onPortalSaved }) {
  const { width, height } = useWindowDimensions();
  const [domain, setDomain] = useState('');
  const [validatingPortal, setValidatingPortal] = useState(false);

  const isTablet = width >= 768;
  const isLandscape = width > height;

  const backgroundSource = useMemo(() => require('../../assets/stock_image.jpg'), []);

  async function handleSavePortal() {
    const fullUrl = buildPortalUrl(domain);

    if (!fullUrl) {
      Alert.alert('Company Portal URL Required', 'Please enter your company portal URL.');
      return;
    }

    setValidatingPortal(true);
    try {
      await validatePortalUrl(fullUrl);
      onPortalSaved(fullUrl);
      setDomain('');
    } catch (error) {
      Alert.alert(
        'Invalid URL',
        'That URL did not respond as a valid FNS subcontractor mobile server. Please check the company portal URL and try again.'
      );
      console.warn('Subcontractor portal URL validation failed:', error?.message || error);
    } finally {
      setValidatingPortal(false);
    }
  }

  return (
    <ImageBackground source={backgroundSource} style={styles.stockBackground} resizeMode="cover">
      <View style={styles.stockOverlay}>
        <SafeAreaView style={styles.safeArea}>
          <KeyboardAvoidingView
            style={styles.keyboardWrap}
            behavior="height"
            keyboardVerticalOffset={0}
          >
            <ScrollView
              contentContainerStyle={[
                styles.setupContent,
                {
                  paddingHorizontal: isTablet ? 48 : 24,
                  paddingTop: isTablet ? 72 : 36,
                  paddingBottom: isTablet ? 96 : 64,
                  justifyContent: isLandscape ? 'center' : 'flex-end',
                  alignItems: isTablet || isLandscape ? 'center' : 'stretch',
                },
              ]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            >
              <View
                style={[
                  styles.setupCard,
                  {
                    maxWidth: isTablet ? 620 : 430,
                    width: '100%',
                    padding: isTablet ? 34 : 22,
                  },
                ]}
              >
                <Text style={[styles.setupTitle, { fontSize: isTablet ? 40 : 30 }]}>
                  Welcome to FNS Subcontractor Portal
                </Text>
                <Text style={[styles.setupSubtitle, { fontSize: isTablet ? 19 : 16 }]}>
                  Enter your company portal URL to connect this device to the subcontractor portal system.
                </Text>

                <View style={styles.formGroup}>
                  <Text style={styles.setupLabel}>Company Portal URL</Text>
                  <View style={styles.urlInputWrap}>
                    <Text style={styles.urlPrefix}>https://</Text>
                    <TextInput
                      style={styles.urlInput}
                      placeholder="fnsportal.com"
                      placeholderTextColor="rgba(255,255,255,0.45)"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      textContentType="URL"
                      value={domain}
                      onChangeText={setDomain}
                      returnKeyType="done"
                      onSubmitEditing={validatingPortal ? undefined : handleSavePortal}
                      editable={!validatingPortal}
                    />
                  </View>
                </View>

                <Pressable
                  style={[styles.setupButton, validatingPortal ? styles.setupButtonDisabled : null]}
                  onPress={validatingPortal ? undefined : handleSavePortal}
                  disabled={validatingPortal}
                >
                  {validatingPortal ? <ActivityIndicator size="small" color="#ffffff" /> : null}
                  <Text style={styles.setupButtonText}>
                    {validatingPortal ? 'Checking Server...' : 'Continue'}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
            <StatusBar style="light" />
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  keyboardWrap: { flex: 1 },
  stockBackground: { flex: 1, backgroundColor: '#02070a', width: '100%', height: '100%' },
  stockOverlay: { flex: 1, backgroundColor: 'rgba(0, 8, 12, 0.32)' },
  setupContent: { flexGrow: 1 },
  setupCard: {
    borderWidth: 1,
    borderColor: 'rgba(56, 232, 245, 0.35)',
    backgroundColor: 'rgba(3, 12, 18, 0.80)',
    borderRadius: 24,
  },
  setupTitle: { color: '#ffffff', fontWeight: '800', marginBottom: 10 },
  setupSubtitle: { color: 'rgba(255,255,255,0.72)', lineHeight: 24, marginBottom: 26 },
  formGroup: { width: '100%', marginBottom: 24 },
  setupLabel: {
    color: '#51eaf5',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 9,
  },
  urlInputWrap: {
    height: 56,
    borderWidth: 1,
    borderColor: 'rgba(81, 234, 245, 0.72)',
    borderRadius: 14,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.28)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  urlPrefix: { color: '#ffffff', fontSize: 16, fontWeight: '700', marginRight: 2 },
  urlInput: { flex: 1, color: '#ffffff', fontSize: 16, paddingVertical: 0 },
  setupButton: {
    height: 58,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(56, 232, 245, 0.28)',
    borderWidth: 1,
    borderColor: 'rgba(81, 234, 245, 0.85)',
    marginTop: 4,
    flexDirection: 'row',
    gap: 10,
  },
  setupButtonDisabled: { opacity: 0.72 },
  setupButtonText: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
});

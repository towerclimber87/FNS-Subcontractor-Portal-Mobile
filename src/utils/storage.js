import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

export const PORTAL_URL_KEY = 'fns_subcontractor_portal_url_v1';
export const SESSION_KEY = 'fns_subcontractor_session_v1';
export const BIOMETRIC_LOGIN_KEY = 'fns_subcontractor_biometric_login_v1';

export const secureStoreOptions = SecureStore.AFTER_FIRST_UNLOCK
  ? { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }
  : undefined;

export async function savePortalUrl(portalUrl) {
  await AsyncStorage.setItem(PORTAL_URL_KEY, portalUrl || '');
}

export async function loadPortalUrl() {
  return AsyncStorage.getItem(PORTAL_URL_KEY);
}

export async function saveSession(session) {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session || {}), secureStoreOptions);
}

export async function loadSession() {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

export async function clearSession() {
  try {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  } catch (_error) {}
}

export async function saveBiometricLogin(login) {
  await SecureStore.setItemAsync(BIOMETRIC_LOGIN_KEY, JSON.stringify(login || {}), secureStoreOptions);
}

export async function loadBiometricLogin() {
  try {
    const raw = await SecureStore.getItemAsync(BIOMETRIC_LOGIN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

export async function clearBiometricLogin() {
  try {
    await SecureStore.deleteItemAsync(BIOMETRIC_LOGIN_KEY);
  } catch (_error) {}
}

export async function clearPortalUrl() {
  try {
    await AsyncStorage.removeItem(PORTAL_URL_KEY);
  } catch (_error) {}
}

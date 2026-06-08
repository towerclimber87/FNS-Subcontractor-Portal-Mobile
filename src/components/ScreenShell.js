import { SafeAreaView, StyleSheet, Text, View, Pressable, Platform, StatusBar as RNStatusBar } from 'react-native';
import { StatusBar } from 'expo-status-bar';

const ANDROID_TOP = Platform.OS === 'android' ? (RNStatusBar.currentHeight || 0) : 0;

export default function ScreenShell({ title, subtitle, onBack, onHome, onLogout, children }) {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" backgroundColor={colors.bg} translucent={false} />
      <View style={[styles.header, { paddingTop: 12 + ANDROID_TOP }]}> 
        <View style={styles.brandMark}><Text style={styles.brandText}>F</Text></View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
        </View>
        <View style={styles.headerActions}>
          {typeof onLogout === 'function' ? (
            <Pressable style={({ pressed }) => [styles.logoutButton, pressed && styles.pressed]} onPress={onLogout}>
              <Text style={styles.logoutText}>Logout</Text>
            </Pressable>
          ) : null}
          {typeof onBack === 'function' ? (
            <Pressable style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]} onPress={onBack}>
              <Text style={styles.headerButtonText}>Back</Text>
            </Pressable>
          ) : null}
          {typeof onHome === 'function' ? (
            <Pressable style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]} onPress={onHome}>
              <Text style={styles.headerButtonText}>Home</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  );
}

export const colors = {
  bg: '#07111f',
  bg2: '#0b1f3a',
  card: '#ffffff',
  text: '#0f172a',
  muted: '#64748b',
  blue: '#2563eb',
  lightBlue: '#dbeafe',
  line: '#dbe4f0',
  green: '#16a34a',
  red: '#dc2626',
  pageBg: '#eef5ff',
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 12, backgroundColor: colors.bg },
  brandMark: { width: 34, height: 34, borderRadius: 13, backgroundColor: '#38bdf8', borderWidth: 2, borderColor: 'rgba(255,255,255,0.24)', alignItems: 'center', justifyContent: 'center' },
  brandText: { color: '#06101f', fontSize: 18, fontWeight: '900', fontStyle: 'italic' },
  headerText: { flex: 1, minWidth: 0 },
  title: { color: '#fff', fontSize: 18, fontWeight: '900' },
  subtitle: { color: '#a7bdd6', marginTop: 2, fontSize: 12, fontWeight: '700' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  headerButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  headerButtonText: { color: '#fff', fontWeight: '900', fontSize: 12 },
  logoutButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(239,68,68,0.18)', borderWidth: 1, borderColor: 'rgba(248,113,113,0.35)' },
  logoutText: { color: '#fecaca', fontWeight: '900', fontSize: 12 },
  body: { flex: 1, backgroundColor: colors.pageBg, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: 'hidden' },
  pressed: { opacity: 0.72 },
});

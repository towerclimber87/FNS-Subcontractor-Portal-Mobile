import { ImageBackground, SafeAreaView, StyleSheet, Text, View, Pressable, Platform, StatusBar as RNStatusBar } from 'react-native';
import { StatusBar } from 'expo-status-bar';

const ANDROID_TOP = Platform.OS === 'android' ? (RNStatusBar.currentHeight || 0) : 0;

export default function ScreenShell({ title, subtitle, onBack, onHome, onLogout, children, backgroundSource }) {
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
      <View style={[styles.body, backgroundSource && styles.bodyWithImage]}>
        {backgroundSource ? (
          <ImageBackground source={backgroundSource} resizeMode="cover" style={styles.backgroundImage} imageStyle={styles.backgroundImageRadius}>
            <View style={styles.backgroundOverlay} />
          </ImageBackground>
        ) : null}
        {!backgroundSource ? (
          <View pointerEvents="none" style={styles.pageDecor}>
            <View style={[styles.decorBlob, styles.decorBlobOne]} />
            <View style={[styles.decorBlob, styles.decorBlobTwo]} />
            <View style={[styles.decorBlob, styles.decorBlobThree]} />
            <View style={styles.decorRing} />
          </View>
        ) : null}
        <View style={styles.bodyContent}>{children}</View>
      </View>
    </SafeAreaView>
  );
}

export const colors = {
  bg: '#06111f',
  bg2: '#0f2a44',
  card: '#ffffff',
  text: '#0f172a',
  muted: '#64748b',
  blue: '#2563eb',
  lightBlue: '#dbeafe',
  line: '#d7e2ef',
  orange: '#f59e0b',
  green: '#16a34a',
  red: '#dc2626',
  pageBg: '#e7f0f8',
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 12, backgroundColor: colors.bg },
  brandMark: { width: 34, height: 34, borderRadius: 13, backgroundColor: '#57c2f4', alignItems: 'center', justifyContent: 'center', shadowColor: '#0ea5e9', shadowOpacity: 0.16, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  brandText: { color: '#06101f', fontSize: 18, fontWeight: '900', fontStyle: 'italic' },
  headerText: { flex: 1, minWidth: 0 },
  title: { color: '#fff', fontSize: 18, fontWeight: '900' },
  subtitle: { color: '#a7bdd6', marginTop: 2, fontSize: 12, fontWeight: '700' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  headerButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  headerButtonText: { color: '#fff', fontWeight: '900', fontSize: 12 },
  logoutButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(239,68,68,0.18)', borderWidth: 1, borderColor: 'rgba(248,113,113,0.35)' },
  logoutText: { color: '#fecaca', fontWeight: '900', fontSize: 12 },
  body: { flex: 1, backgroundColor: colors.pageBg, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: 'hidden', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.18)', position: 'relative' },
  bodyWithImage: { backgroundColor: '#06111f' },
  backgroundImage: { ...StyleSheet.absoluteFillObject },
  backgroundImageRadius: { borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  backgroundOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,12,24,0.42)' },
  pageDecor: { ...StyleSheet.absoluteFillObject },
  bodyContent: { flex: 1 },
  decorBlob: { position: 'absolute', borderRadius: 9999, backgroundColor: 'rgba(125, 169, 214, 0.14)' },
  decorBlobOne: { width: 260, height: 260, top: -40, right: -80 },
  decorBlobTwo: { width: 320, height: 320, bottom: -120, left: -120, backgroundColor: 'rgba(87, 194, 244, 0.12)' },
  decorBlobThree: { width: 200, height: 200, top: '42%', right: -70, backgroundColor: 'rgba(15, 42, 68, 0.05)' },
  decorRing: { position: 'absolute', width: 170, height: 170, borderRadius: 9999, borderWidth: 24, borderColor: 'rgba(255,255,255,0.18)', top: 90, left: -65 },
  pressed: { opacity: 0.72 },
});

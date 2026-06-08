import { SafeAreaView, StyleSheet, Text, View, Pressable, Platform, StatusBar } from 'react-native';

const ANDROID_TOP = Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 0;

export default function ScreenShell({ title, subtitle, rightLabel, onRightPress, children }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.header, { paddingTop: 14 + ANDROID_TOP }]}>
        <View style={styles.brandMark} />
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
        </View>
        {!!rightLabel && (
          <Pressable style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]} onPress={onRightPress}>
            <Text style={styles.headerButtonText}>{rightLabel}</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  );
}

export const colors = {
  bg: '#07111f',
  card: '#ffffff',
  text: '#0f172a',
  muted: '#64748b',
  blue: '#2563eb',
  line: '#dbe4f0',
  green: '#16a34a',
  red: '#dc2626',
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingBottom: 14, backgroundColor: colors.bg },
  brandMark: { width: 38, height: 38, borderRadius: 14, backgroundColor: '#38bdf8', borderWidth: 3, borderColor: 'rgba(255,255,255,0.2)' },
  headerText: { flex: 1, minWidth: 0 },
  title: { color: '#fff', fontSize: 19, fontWeight: '900' },
  subtitle: { color: '#a7bdd6', marginTop: 2, fontSize: 12, fontWeight: '700' },
  headerButton: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  headerButtonText: { color: '#fff', fontWeight: '900', fontSize: 12 },
  body: { flex: 1, backgroundColor: '#f3f7fb', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  pressed: { opacity: 0.72 },
});

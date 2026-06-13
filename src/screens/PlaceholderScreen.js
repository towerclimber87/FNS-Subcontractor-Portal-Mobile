import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ScreenShell, { colors } from '../components/ScreenShell';

export default function PlaceholderScreen({ project, page, onBack, onHome }) {
  return (
    <ScreenShell
      title={page?.label || 'Coming Soon'}
      subtitle={project?.site_name || 'Selected project'}
      onBack={onBack}
      onHome={onHome}
      backgroundSource={require('../../assets/subcontractor-home-background.png')}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.iconWrap}><Text style={styles.icon}>{page?.icon || '•'}</Text></View>
          <Text style={styles.title}>{page?.label || 'This tool'}</Text>
          <Text style={styles.copy}>This section will be added to the native subcontractor mobile app in a future update.</Text>
          <Pressable style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={onBack}>
            <Text style={styles.buttonText}>Back to Project Tools</Text>
          </Pressable>
        </View>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: 16, justifyContent: 'center' },
  card: { backgroundColor: 'rgba(255,255,255,0.93)', borderRadius: 24, borderWidth: 1, borderColor: 'rgba(190,214,239,0.9)', padding: 22, alignItems: 'center', shadowColor: '#0f172a', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
  iconWrap: { width: 66, height: 66, borderRadius: 23, backgroundColor: '#eef6ff', borderWidth: 1, borderColor: '#c8def6', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  icon: { fontSize: 30 },
  title: { color: colors.text, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  copy: { color: colors.muted, fontSize: 15, lineHeight: 22, fontWeight: '700', textAlign: 'center', marginTop: 10, marginBottom: 18 },
  button: { backgroundColor: colors.blue, borderRadius: 16, paddingHorizontal: 18, paddingVertical: 12 },
  buttonText: { color: '#fff', fontWeight: '900' },
  pressed: { opacity: 0.72 },
});

import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import ScreenShell, { colors } from '../components/ScreenShell';

const FALLBACK_PAGES = [
  { key: 'site_daily_tracker', label: 'Site Daily Tracker', icon: '✅' },
  { key: 'daily_reports', label: 'Daily Reports', icon: '📝' },
  { key: 'photo_repository', label: 'Photo Repository', icon: '📷' },
  { key: 'site_cds', label: 'Site CDs', icon: '🗂️' },
  { key: 'material_tracker', label: 'Material Tracker', icon: '📦' },
  { key: 'site_walk_redlines', label: 'Site Walk Redlines', icon: '✏️' },
  { key: 'site_walk_photos', label: 'Site Walk Photos', icon: '🖼️' },
  { key: 'sow_documents', label: 'SOW / Documents', icon: '📄' },
];

export default function ProjectScreen({ project, pages, onBack, onHome, onLogout, onOpenPage }) {
  const { width } = useWindowDimensions();
  const columns = width >= 980 ? 3 : width >= 620 ? 2 : 1;
  const visiblePages = Array.isArray(pages) && pages.length ? pages : FALLBACK_PAGES;

  return (
    <ScreenShell title="Project Tools" subtitle={project?.site_name || 'Selected project'} onBack={onBack} onHome={onHome} onLogout={onLogout}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.projectHero}>
          <Text style={styles.heroEyebrow}>Active Construction Project</Text>
          <Text style={styles.heroTitle}>{project?.site_name || 'Project'}</Text>
          <Text style={styles.heroCopy}>Open the subcontractor tools available for this project.</Text>
        </View>

        <View style={styles.grid}>
          {visiblePages.map((page) => (
            <Pressable
              key={page.key}
              style={({ pressed }) => [styles.tileWrap, { width: `${100 / columns}%` }, pressed && styles.pressed]}
              onPress={() => onOpenPage(page, project)}
            >
              <View style={styles.tile}>
                <View style={styles.tileIconWrap}><Text style={styles.tileIcon}>{page.icon || '•'}</Text></View>
                <Text style={styles.tileText}>{page.label}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 36, backgroundColor: colors.pageBg },
  projectHero: { backgroundColor: '#10233f', borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', padding: 18, marginBottom: 14, shadowColor: '#0f172a', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
  heroEyebrow: { color: '#93c5fd', fontSize: 12, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase' },
  heroTitle: { color: '#fff', fontSize: 24, lineHeight: 30, fontWeight: '900', marginTop: 8 },
  heroCopy: { color: '#b9c8dc', fontWeight: '700', lineHeight: 20, marginTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  tileWrap: { padding: 6 },
  tile: { minHeight: 104, backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 20, borderWidth: 1, borderColor: colors.line, padding: 14, justifyContent: 'space-between', shadowColor: '#0f172a', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  tileIconWrap: { width: 40, height: 40, borderRadius: 15, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', alignItems: 'center', justifyContent: 'center' },
  tileIcon: { fontSize: 21 },
  tileText: { color: colors.text, fontSize: 16, fontWeight: '900', lineHeight: 21, marginTop: 12 },
  pressed: { opacity: 0.72 },
});

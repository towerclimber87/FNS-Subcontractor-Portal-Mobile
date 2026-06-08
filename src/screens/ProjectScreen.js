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

export default function ProjectScreen({ project, pages, onBack, onLogout, onOpenPage }) {
  const { width } = useWindowDimensions();
  const columns = width >= 900 ? 3 : width >= 620 ? 2 : 1;
  const visiblePages = Array.isArray(pages) && pages.length ? pages : FALLBACK_PAGES;

  return (
    <ScreenShell title="Project Tools" subtitle={project?.site_name || 'Selected project'} rightLabel="Logout" onRightPress={onLogout}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} onPress={onBack}>
          <Text style={styles.backText}>← Back to Projects</Text>
        </Pressable>

        <View style={styles.projectHero}>
          <Text style={styles.heroEyebrow}>Active Construction Project</Text>
          <Text style={styles.heroTitle}>{project?.site_name || 'Project'}</Text>
          <Text style={styles.heroCopy}>Use the tools below to open the same subcontractor pages available in the web portal. Permissions are loaded from the ERP subcontractor permission matrix.</Text>
        </View>

        <View style={styles.grid}>
          {visiblePages.map((page) => (
            <Pressable
              key={page.key}
              style={({ pressed }) => [styles.tileWrap, { width: `${100 / columns}%` }, pressed && styles.pressed]}
              onPress={() => onOpenPage(page, project)}
            >
              <View style={styles.tile}>
                <Text style={styles.tileIcon}>{page.icon || '•'}</Text>
                <Text style={styles.tileText}>{page.label}</Text>
                <Text style={styles.tileHint}>Open</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 36 },
  backButton: { alignSelf: 'flex-start', backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: colors.line, marginBottom: 12 },
  backText: { color: colors.blue, fontWeight: '900' },
  projectHero: { backgroundColor: '#fff', borderRadius: 24, borderWidth: 1, borderColor: colors.line, padding: 18, marginBottom: 14 },
  heroEyebrow: { color: colors.green, fontSize: 12, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase' },
  heroTitle: { color: colors.text, fontSize: 25, lineHeight: 31, fontWeight: '900', marginTop: 8 },
  heroCopy: { color: colors.muted, fontWeight: '600', lineHeight: 20, marginTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  tileWrap: { padding: 6 },
  tile: { minHeight: 142, backgroundColor: '#fff', borderRadius: 22, borderWidth: 1, borderColor: colors.line, padding: 16, justifyContent: 'space-between' },
  tileIcon: { fontSize: 30 },
  tileText: { color: colors.text, fontSize: 17, fontWeight: '900', lineHeight: 22 },
  tileHint: { color: colors.blue, fontWeight: '900' },
  pressed: { opacity: 0.72 },
});

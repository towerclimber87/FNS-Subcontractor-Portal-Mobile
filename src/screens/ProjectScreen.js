import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import ScreenShell, { colors } from '../components/ScreenShell';

const FALLBACK_PAGES = [
  { key: 'sow_documents', label: 'SOW Documents', icon: '📄' },
  { key: 'site_walk_redlines', label: 'PDF Editor', icon: '✏️' },
  { key: 'site_walk_photos', label: 'SiteWalk Photos', icon: '🖼️' },
  { key: 'site_walk_360', label: 'SiteWalk 360 Photos', icon: '🌐' },
  { key: 'daily_reports', label: 'Daily Reports', icon: '📝' },
  { key: 'photo_repository', label: 'Photo Repository', icon: '📷' },
  { key: 'site_cds', label: 'Site CDs', icon: '🗂️' },
  { key: 'site_daily_tracker', label: 'Site Daily Tracker', icon: '✅' },
  { key: 'material_tracker', label: 'Material Tracker', icon: '📦' },
];

const HIDDEN_KEYS = new Set(['accounting_contacts']);

function cleanPage(page) {
  if (!page || HIDDEN_KEYS.has(page.key)) return null;
  if (page.key === 'sow_documents') return { ...page, label: 'SOW Documents' };
  if (page.key === 'site_walk_redlines') return { ...page, label: 'PDF Editor' };
  if (page.key === 'site_walk_photos') return { ...page, label: 'SiteWalk Photos' };
  return page;
}

export default function ProjectScreen({ project, pages, onBack, onHome, onOpenPage }) {
  const { width } = useWindowDimensions();
  const columns = width >= 980 ? 3 : width >= 680 ? 2 : 1;
  const rawPages = Array.isArray(pages) && pages.length ? pages : FALLBACK_PAGES;
  const basePages = rawPages.map(cleanPage).filter(Boolean);
  const has360 = basePages.some((page) => page.key === 'site_walk_360');
  const siteWalkInsertIndex = basePages.findIndex((page) => page.key === 'site_walk_photos');
  const canShow360 = basePages.some((page) => page.key === 'site_walk_photos' || page.key === 'site_walk_redlines');
  const visiblePages = [...basePages];
  if (!has360 && canShow360) {
    const item = { key: 'site_walk_360', label: 'SiteWalk 360 Photos', icon: '🌐' };
    visiblePages.splice(siteWalkInsertIndex >= 0 ? siteWalkInsertIndex + 1 : visiblePages.length, 0, item);
  }

  return (
    <ScreenShell
      title="Project Tools"
      subtitle={project?.site_name || 'Selected project'}
      onBack={onBack}
      onHome={onHome}
      backgroundSource={require('../../assets/subcontractor-home-background.png')}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.projectHero}>
          <View style={styles.heroBar} />
          <View style={styles.heroTextWrap}>
            <Text style={styles.heroEyebrow}>Active Construction Project</Text>
            <Text style={styles.heroTitle}>{project?.site_name || 'Project'}</Text>
          </View>
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
                <Text style={styles.tileText} numberOfLines={2}>{page.label}</Text>
                <Text style={styles.tileChevron}>›</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 36, backgroundColor: 'transparent' },
  projectHero: {
    backgroundColor: '#10233f',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    marginBottom: 16,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
    elevation: 4,
  },
  heroBar: { height: 4, backgroundColor: '#57c2f4' },
  heroTextWrap: { paddingHorizontal: 17, paddingVertical: 15 },
  heroEyebrow: { color: '#93c5fd', fontSize: 11, fontWeight: '900', letterSpacing: 0.7, textTransform: 'uppercase' },
  heroTitle: { color: '#fff', fontSize: 23, lineHeight: 29, fontWeight: '900', marginTop: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  tileWrap: { padding: 6 },
  tile: {
    minHeight: 74,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(190,214,239,0.88)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#0f172a',
    shadowOpacity: 0.055,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  tileIconWrap: { width: 42, height: 42, borderRadius: 15, backgroundColor: '#eef6ff', borderWidth: 1, borderColor: '#c8def6', alignItems: 'center', justifyContent: 'center' },
  tileIcon: { fontSize: 21 },
  tileText: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '900', lineHeight: 21 },
  tileChevron: { color: '#8aa3bd', fontSize: 30, lineHeight: 32, fontWeight: '800', marginLeft: 2 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.995 }] },
});

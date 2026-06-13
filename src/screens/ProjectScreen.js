import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import ScreenShell, { colors } from '../components/ScreenShell';
import {
  loadSubcontractorMaterialTracker,
  loadSubcontractorPhotoRepository,
  loadSubcontractorSiteCds,
  loadSubcontractorSiteDailyTracker,
  loadSubcontractorSiteDocuments,
  loadSubcontractorSiteWalk360,
  loadSubcontractorSiteWalkPhotos,
} from '../api/subcontractorApi';

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
const CONTENT_GATED_KEYS = new Set([
  'sow_documents',
  'site_walk_photos',
  'site_walk_360',
  'photo_repository',
  'site_cds',
  'site_daily_tracker',
  'material_tracker',
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clean(value) {
  return String(value ?? '').trim();
}

function siteName(project) {
  return clean(project?.site_name || project?.name || project?.label || project);
}

function siteId(project) {
  return clean(project?.site_id || project?.id || '');
}

function fileCountFromSection(section) {
  if (!section || typeof section !== 'object') return 0;
  let count = asArray(section.files).length;
  const buckets = section.buckets && typeof section.buckets === 'object' ? section.buckets : {};
  Object.values(buckets).forEach((bucket) => {
    if (Array.isArray(bucket)) count += bucket.length;
    else if (bucket && typeof bucket === 'object') count += asArray(bucket.files).length;
  });
  return count;
}

function hasSowDocuments(payload) {
  const sections = payload?.sections && typeof payload.sections === 'object' ? payload.sections : {};
  return Object.values(sections).some((section) => fileCountFromSection(section) > 0);
}

function hasSiteCds(payload) {
  return asArray(payload?.files).length > 0 || asArray(payload?.folders).length > 0;
}

function hasRows(payload, ...keys) {
  return keys.some((key) => asArray(payload?.[key]).length > 0);
}

function cleanPage(page) {
  if (!page || HIDDEN_KEYS.has(page.key)) return null;
  if (page.key === 'sow_documents') return { ...page, label: 'SOW Documents' };
  if (page.key === 'site_walk_redlines') return { ...page, label: 'PDF Editor' };
  if (page.key === 'site_walk_photos') return { ...page, label: 'SiteWalk Photos' };
  if (page.key === 'site_walk_360') return { ...page, label: 'SiteWalk 360 Photos' };
  return page;
}

async function checkToolAvailability({ session, project }) {
  const portalUrl = session?.portalUrl;
  const token = session?.access_token;
  const selectedSiteName = siteName(project);
  const selectedSiteId = siteId(project);
  if (!portalUrl || !token || !selectedSiteName) return {};

  const checks = {
    sow_documents: async () => hasSowDocuments(await loadSubcontractorSiteDocuments(portalUrl, token, selectedSiteName)),
    material_tracker: async () => hasRows(await loadSubcontractorMaterialTracker(portalUrl, token, { siteName: selectedSiteName, siteId: selectedSiteId }), 'items', 'materials', 'records'),
    site_daily_tracker: async () => hasRows(await loadSubcontractorSiteDailyTracker(portalUrl, token, selectedSiteName), 'records', 'items', 'rows'),
    photo_repository: async () => hasRows(await loadSubcontractorPhotoRepository(portalUrl, token, { siteName: selectedSiteName, siteId: selectedSiteId }), 'items', 'photos', 'assets'),
    site_cds: async () => hasSiteCds(await loadSubcontractorSiteCds(portalUrl, token, { siteName: selectedSiteName, rel: '' })),
    site_walk_photos: async () => hasRows(await loadSubcontractorSiteWalkPhotos(portalUrl, token, { siteName: selectedSiteName, tag: 'All' }), 'items', 'photos'),
    site_walk_360: async () => hasRows(await loadSubcontractorSiteWalk360(portalUrl, token, { siteName: selectedSiteName, tag: 'All' }), 'items', 'photos'),
  };

  const entries = await Promise.allSettled(Object.entries(checks).map(async ([key, fn]) => [key, await fn()]));
  const next = {};
  entries.forEach((entry) => {
    if (entry.status === 'fulfilled') {
      const [key, hasContent] = entry.value;
      next[key] = Boolean(hasContent);
    }
  });
  return next;
}

export default function ProjectScreen({ session, project, pages, onBack, onHome, onOpenPage }) {
  const { width } = useWindowDimensions();
  const columns = width >= 980 ? 3 : width >= 680 ? 2 : 1;
  const usingFallbackPages = !(Array.isArray(pages) && pages.length);
  const rawPages = usingFallbackPages ? FALLBACK_PAGES : pages;
  const basePages = rawPages.map(cleanPage).filter(Boolean);
  const [availability, setAvailability] = useState({});
  const [availabilityChecked, setAvailabilityChecked] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadAvailability() {
      setAvailabilityChecked(false);
      setAvailabilityLoading(true);
      try {
        const result = await checkToolAvailability({ session, project });
        if (active) setAvailability(result || {});
      } catch (_error) {
        if (active) setAvailability({});
      } finally {
        if (active) {
          setAvailabilityChecked(true);
          setAvailabilityLoading(false);
        }
      }
    }
    loadAvailability();
    return () => { active = false; };
  }, [session?.portalUrl, session?.access_token, project?.site_name, project?.site_id, project?.id]);

  const visiblePages = useMemo(() => {
    const has360 = basePages.some((page) => page.key === 'site_walk_360');
    const siteWalkInsertIndex = basePages.findIndex((page) => page.key === 'site_walk_photos');
    const canShow360 = basePages.some((page) => page.key === 'site_walk_photos' || page.key === 'site_walk_redlines');
    const pagesWithFallback = [...basePages];
    if (usingFallbackPages && !has360 && canShow360) {
      const item = { key: 'site_walk_360', label: 'SiteWalk 360 Photos', icon: '🌐' };
      pagesWithFallback.splice(siteWalkInsertIndex >= 0 ? siteWalkInsertIndex + 1 : pagesWithFallback.length, 0, item);
    }
    if (!availabilityChecked) return pagesWithFallback;
    return pagesWithFallback.filter((page) => {
      if (!CONTENT_GATED_KEYS.has(page.key)) return true;
      if (Object.prototype.hasOwnProperty.call(availability, page.key)) return availability[page.key] !== false;
      return true;
    });
  }, [basePages, usingFallbackPages, availability, availabilityChecked]);

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

        {availabilityLoading ? (
          <View style={styles.availabilityCard}>
            <ActivityIndicator size="small" color="#57c2f4" />
            <Text style={styles.availabilityText}>Checking available project tools…</Text>
          </View>
        ) : null}

        {availabilityChecked && !visiblePages.length ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No project tools available</Text>
            <Text style={styles.emptyCopy}>There are no documents, trackers, photos, or other available entries for this project yet.</Text>
          </View>
        ) : (
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
        )}
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
  availabilityCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(8,24,44,0.82)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(147,197,253,0.22)' },
  availabilityText: { color: '#dbeafe', fontWeight: '800' },
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
  emptyCard: { backgroundColor: 'rgba(8,24,44,0.84)', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(147,197,253,0.2)', padding: 20 },
  emptyTitle: { color: '#f8fbff', fontWeight: '900', fontSize: 18 },
  emptyCopy: { color: '#b9c8dc', fontWeight: '700', lineHeight: 20, marginTop: 8 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.995 }] },
});

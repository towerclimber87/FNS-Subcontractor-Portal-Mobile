import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import ScreenShell, { colors } from '../components/ScreenShell';
import {
  buildWebSessionUrl,
  loadSubcontractorSiteWalk360Photos,
  loadSubcontractorSiteWalkPhotos,
  loadSubcontractorSiteWalkRedlines,
  sitePagePath,
  tokenizedMediaUrl,
} from '../api/subcontractorApi';

function clean(value) { return String(value ?? '').trim(); }
function siteName(project) { return clean(project?.site_name || project?.name || project?.label || project); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function firstText(...values) { return values.map(clean).find(Boolean) || ''; }
function dateText(value) { const raw = clean(value); return raw ? raw.replace('T', ' ').slice(0, 16) : ''; }

function EmptyState({ title, message }) {
  return <View style={styles.emptyCard}><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyText}>{message}</Text></View>;
}

function ErrorBanner({ message }) {
  if (!message) return null;
  return <View style={styles.errorBanner}><Text style={styles.errorText}>{message}</Text></View>;
}

function SearchBar({ value, onChangeText, placeholder }) {
  return <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#7d8ca8" style={styles.searchInput} autoCapitalize="none" autoCorrect={false} />;
}

function MediaCard({ item, portalUrl, token, is360 = false }) {
  const thumb = tokenizedMediaUrl(portalUrl, item.thumb_url || item.thumbnail_url || item.mobile_thumb_url || item.public_url || item.photo_url || item.url, token);
  const full = tokenizedMediaUrl(portalUrl, item.public_url || item.photo_url || item.url || item.rendered_url || thumb, token);
  const title = firstText(item.name, item.caption, item.filename, item.file_name, is360 ? '360 Photo' : 'Site Walk Photo');
  const meta = [firstText(item.sitewalk_desc, item.sitewalk), firstText(item.tag, item.category), dateText(item.created_at || item.taken_at)].filter(Boolean).join(' • ');
  return (
    <View style={styles.mediaCard}>
      <View style={styles.mediaThumbWrap}>{thumb ? <Image source={{ uri: thumb }} style={styles.mediaThumb} /> : <Text style={styles.placeholderIcon}>{is360 ? '🌐' : '🖼️'}</Text>}</View>
      <View style={styles.mediaBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>{title}</Text>
        {!!meta && <Text style={styles.cardMeta} numberOfLines={2}>{meta}</Text>}
        {!!clean(item.note) && <Text style={styles.cardNote} numberOfLines={3}>{clean(item.note)}</Text>}
        {!!full && <Pressable style={styles.smallPrimary} onPress={() => Linking.openURL(full).catch(() => {})}><Text style={styles.smallPrimaryText}>Open Photo</Text></Pressable>}
      </View>
    </View>
  );
}

function RedlinePageCard({ page, portalUrl, token, onOpenWebEditor }) {
  const thumb = tokenizedMediaUrl(portalUrl, page.image_url || page.page_image_url || page.thumb_url, token);
  const pdfUrl = tokenizedMediaUrl(portalUrl, page.pdf_url, token);
  const title = firstText(page.display_name, page.name, page.sitewalk_desc, 'PDF Page');
  return (
    <View style={styles.redlineCard}>
      <View style={styles.redlineThumbWrap}>{thumb ? <Image source={{ uri: thumb }} style={styles.redlineThumb} /> : <Text style={styles.placeholderIcon}>📄</Text>}</View>
      <View style={styles.mediaBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>{title}</Text>
        <Text style={styles.cardMeta}>{[firstText(page.sitewalk_desc, page.sitewalk), `${Number(page.pin_count || 0)} pins`, `${Number(page.annotation_count || 0)} markups`].filter(Boolean).join(' • ')}</Text>
        <View style={styles.actionRow}>
          {!!pdfUrl && <Pressable style={styles.smallSecondary} onPress={() => Linking.openURL(pdfUrl).catch(() => {})}><Text style={styles.smallSecondaryText}>Open PDF</Text></Pressable>}
          <Pressable style={styles.smallPrimary} onPress={onOpenWebEditor}><Text style={styles.smallPrimaryText}>Editor</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

export default function SubcontractorSiteWalkListScreen({ session, project, page, mode, onBack, onHome }) {
  const { width } = useWindowDimensions();
  const token = session?.access_token || '';
  const portalUrl = session?.portalUrl || '';
  const selectedSiteName = siteName(project);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [payload, setPayload] = useState({});

  const title = mode === 'redlines' ? 'PDF Editor' : mode === '360' ? 'Site Walk 360 Photos' : 'Site Walk Photos';
  const items = useMemo(() => {
    if (mode === 'redlines') return asArray(payload.pages);
    return asArray(payload.photos || payload.items);
  }, [payload, mode]);

  const load = useCallback(async (silent = false) => {
    if (!selectedSiteName) return;
    if (!silent) setLoading(true);
    setError('');
    try {
      const args = { siteName: selectedSiteName, q: query };
      const data = mode === 'redlines'
        ? await loadSubcontractorSiteWalkRedlines(portalUrl, token, { siteName: selectedSiteName })
        : mode === '360'
          ? await loadSubcontractorSiteWalk360Photos(portalUrl, token, args)
          : await loadSubcontractorSiteWalkPhotos(portalUrl, token, args);
      setPayload(data || {});
    } catch (err) {
      setError(err?.message || `Unable to load ${title}.`);
    } finally {
      if (!silent) setLoading(false);
      setRefreshing(false);
    }
  }, [mode, portalUrl, query, selectedSiteName, title, token]);

  useEffect(() => { load(false); }, [load]);

  const openWebEditor = useCallback(() => {
    const webPath = sitePagePath(page || { key: 'site_walk_redlines' }, project);
    Linking.openURL(buildWebSessionUrl(portalUrl, token, webPath)).catch(() => {});
  }, [page, portalUrl, project, token]);

  const columns = width >= 900 ? 2 : 1;
  const contentStyle = [styles.content, columns > 1 && styles.contentWide];

  return (
    <ScreenShell title={title} subtitle={selectedSiteName || 'Selected project'} onBack={onBack} onHome={onHome}>
      <View style={styles.wrap}>
        <View style={styles.topPanel}>
          <Text style={styles.eyebrow}>Native Subcontractor Tool</Text>
          <Text style={styles.heroTitle}>{title}</Text>
          <Text style={styles.heroText}>Site is carried from the project you selected: <Text style={styles.heroSite}>{selectedSiteName}</Text></Text>
          {mode !== 'redlines' ? <SearchBar value={query} onChangeText={setQuery} placeholder="Search photos, tags, notes…" /> : null}
          <View style={styles.heroActions}>
            <Pressable style={styles.refreshButton} onPress={() => load(false)}><Text style={styles.refreshText}>Refresh</Text></Pressable>
            {mode === 'redlines' ? <Pressable style={styles.webButton} onPress={openWebEditor}><Text style={styles.webButtonText}>Open Full Editor</Text></Pressable> : null}
          </View>
        </View>
        <ErrorBanner message={error} />
        {loading ? <View style={styles.loading}><ActivityIndicator size="large" color={colors.blue} /><Text style={styles.loadingText}>Loading {title}…</Text></View> : (
          <ScrollView contentContainerStyle={contentStyle} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} />}>
            {!items.length ? <EmptyState title={`No ${title} found`} message="Nothing is available for this subcontractor/site with the current permissions." /> : null}
            <View style={styles.grid}>
              {items.map((item, index) => (
                <View key={`${mode}-${item.id || item.page_id || index}`} style={[styles.tileWrap, { width: `${100 / columns}%` }]}>
                  {mode === 'redlines'
                    ? <RedlinePageCard page={item} portalUrl={portalUrl} token={token} onOpenWebEditor={openWebEditor} />
                    : <MediaCard item={item} portalUrl={portalUrl} token={token} is360={mode === '360'} />}
                </View>
              ))}
            </View>
          </ScrollView>
        )}
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 14, paddingBottom: 34 },
  contentWide: { paddingHorizontal: 18 },
  topPanel: { margin: 14, marginBottom: 8, backgroundColor: '#10233f', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', padding: 16 },
  eyebrow: { color: '#93c5fd', fontSize: 11, fontWeight: '900', letterSpacing: 0.7, textTransform: 'uppercase' },
  heroTitle: { color: '#fff', fontSize: 24, fontWeight: '900', marginTop: 5 },
  heroText: { color: '#bfd0e5', fontSize: 13, fontWeight: '700', marginTop: 6, lineHeight: 18 },
  heroSite: { color: '#fff', fontWeight: '900' },
  heroActions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginTop: 12 },
  refreshButton: { backgroundColor: '#3360ff', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 11, alignItems: 'center' },
  refreshText: { color: '#fff', fontWeight: '900' },
  webButton: { backgroundColor: 'rgba(87,194,244,0.15)', borderColor: 'rgba(87,194,244,0.45)', borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 11, alignItems: 'center' },
  webButtonText: { color: '#dff6ff', fontWeight: '900' },
  searchInput: { minHeight: 46, borderRadius: 14, paddingHorizontal: 14, color: '#f7f9ff', backgroundColor: '#0b1628', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', fontSize: 15, fontWeight: '700', marginTop: 12 },
  errorBanner: { marginHorizontal: 14, marginBottom: 8, padding: 12, borderRadius: 16, backgroundColor: 'rgba(220,38,38,0.14)', borderWidth: 1, borderColor: 'rgba(248,113,113,0.35)' },
  errorText: { color: '#fecaca', fontWeight: '800' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: colors.text, fontWeight: '900' },
  emptyCard: { backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 18, padding: 18, borderWidth: 1, borderColor: '#d7e2ef' },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },
  emptyText: { color: colors.muted, fontSize: 13, fontWeight: '700', marginTop: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  tileWrap: { padding: 6 },
  mediaCard: { backgroundColor: 'rgba(255,255,255,0.93)', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(190,214,239,0.88)', overflow: 'hidden', flexDirection: 'row', minHeight: 124 },
  redlineCard: { backgroundColor: 'rgba(255,255,255,0.93)', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(190,214,239,0.88)', overflow: 'hidden', flexDirection: 'row', minHeight: 136 },
  mediaThumbWrap: { width: 116, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },
  mediaThumb: { width: '100%', height: '100%' },
  redlineThumbWrap: { width: 104, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },
  redlineThumb: { width: '100%', height: '100%', resizeMode: 'cover' },
  placeholderIcon: { fontSize: 34 },
  mediaBody: { flex: 1, minWidth: 0, padding: 12, justifyContent: 'center' },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '900', lineHeight: 21 },
  cardMeta: { color: colors.muted, fontSize: 12, fontWeight: '800', marginTop: 5, lineHeight: 17 },
  cardNote: { color: '#334155', fontSize: 12, fontWeight: '700', marginTop: 7, lineHeight: 17 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  smallPrimary: { alignSelf: 'flex-start', backgroundColor: '#3360ff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, marginTop: 10 },
  smallPrimaryText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  smallSecondary: { alignSelf: 'flex-start', backgroundColor: '#eef6ff', borderColor: '#c8def6', borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, marginTop: 10 },
  smallSecondaryText: { color: '#164e8a', fontSize: 12, fontWeight: '900' },
});

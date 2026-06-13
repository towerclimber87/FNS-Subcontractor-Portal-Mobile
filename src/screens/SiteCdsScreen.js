import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import ScreenShell, { colors } from '../components/ScreenShell';
import { buildSubcontractorSiteCdOpenPath, buildWebSessionUrl, loadSubcontractorSiteCds } from '../api/subcontractorApi';

function formatBytes(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = n;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${idx === 0 ? Math.round(size) : size.toFixed(1)} ${units[idx]}`;
}

function fileTypeLabel(file) {
  const ext = String(file?.extension || file?.ext || file?.name?.split('.').pop() || '').replace(/^\./, '').toLowerCase();
  if (ext === 'pdf') return 'PDF';
  if (['dwg', 'dxf'].includes(ext)) return 'CAD';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'XLS';
  if (['doc', 'docx', 'rtf'].includes(ext)) return 'DOC';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'tif', 'tiff'].includes(ext)) return 'IMG';
  return ext ? ext.toUpperCase().slice(0, 4) : 'FILE';
}

function formatDate(value) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return '—';
    return d.toLocaleDateString();
  } catch (_error) {
    return '—';
  }
}

function parentRel(rel) {
  const clean = String(rel || '').replace(/^\/+|\/+$/g, '');
  if (!clean) return '';
  const parts = clean.split('/');
  if (parts.length <= 2) return '';
  return parts.slice(0, -1).join('/');
}

export default function SiteCdsScreen({ session, project, page, onBack, onHome }) {
  const { width } = useWindowDimensions();
  const siteName = project?.site_name || project?.name || '';
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState(null);
  const [query, setQuery] = useState('');

  const currentRel = payload?.current_rel || payload?.rel || '';
  const folders = Array.isArray(payload?.folders) ? payload.folders : [];
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const columns = width >= 1050 ? 3 : width >= 720 ? 2 : 1;

  const filteredFiles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return files;
    return files.filter((file) => {
      const hay = `${file?.name || ''} ${file?.extension || ''} ${file?.mime_type || ''}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [files, query]);

  const filteredFolders = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return folders;
    return folders.filter((folder) => String(folder?.name || '').toLowerCase().includes(needle));
  }, [folders, query]);

  const load = useCallback(async ({ rel = currentRel, showSpinner = false } = {}) => {
    if (!siteName) return;
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const data = await loadSubcontractorSiteCds(session.portalUrl, session.access_token, { siteName, rel });
      setPayload(data || {});
    } catch (err) {
      setError(err?.message || 'Unable to load Site CDs.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session?.portalUrl, session?.access_token, siteName, currentRel]);

  useEffect(() => {
    load({ rel: '', showSpinner: true });
  }, [session?.portalUrl, session?.access_token, siteName]);

  async function refresh() {
    setRefreshing(true);
    await load({ rel: currentRel });
  }

  function openFolder(folder) {
    const rel = folder?.rel || '';
    if (!rel) return;
    setQuery('');
    load({ rel, showSpinner: true });
  }

  function goUp() {
    const rel = parentRel(currentRel);
    setQuery('');
    load({ rel, showSpinner: true });
  }

  function openFile(file) {
    const rel = file?.rel || '';
    if (!rel) return;
    const path = buildSubcontractorSiteCdOpenPath({ rel, inline: true });
    const url = buildWebSessionUrl(session.portalUrl, session.access_token, path);
    Linking.openURL(url).catch(() => Alert.alert('Open Error', 'Unable to open this Site CD.'));
  }

  const countText = `${files.length} file${files.length === 1 ? '' : 's'}${folders.length ? ` • ${folders.length} folder${folders.length === 1 ? '' : 's'}` : ''}`;

  return (
    <ScreenShell
      title="Site CDs"
      subtitle={siteName || 'Selected project'}
      onBack={onBack}
      onHome={onHome}
      backgroundSource={require('../../assets/subcontractor-home-background.png')}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#fff" />}
      >
        <View style={styles.controlCard}>
          <View style={styles.topRow}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search Site CDs..."
              placeholderTextColor="#94a3b8"
              style={styles.search}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]} onPress={refresh}>
              <Text style={styles.refreshText}>Refresh</Text>
            </Pressable>
          </View>
          <View style={styles.metaRow}>
            <View>
              <Text style={styles.kicker}>Prints Folder</Text>
              <Text style={styles.pathText} numberOfLines={1}>{payload?.label || currentRel || `${siteName} / Prints`}</Text>
            </View>
            <Text style={styles.countPill}>{countText}</Text>
          </View>
          {!!currentRel && parentRel(currentRel) ? (
            <Pressable style={({ pressed }) => [styles.upButton, pressed && styles.pressed]} onPress={goUp}>
              <Text style={styles.upText}>← Back folder</Text>
            </Pressable>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.centerCard}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.centerText}>Loading Site CDs…</Text>
          </View>
        ) : null}

        {!!error && !loading ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Unable to load Site CDs</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]} onPress={() => load({ rel: currentRel, showSpinner: true })}>
              <Text style={styles.retryText}>Try Again</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !error ? (
          <>
            {filteredFolders.length ? (
              <View style={styles.folderRow}>
                {filteredFolders.map((folder) => (
                  <Pressable key={folder.rel || folder.name} style={({ pressed }) => [styles.folderCard, pressed && styles.pressed]} onPress={() => openFolder(folder)}>
                    <Text style={styles.folderIcon}>📁</Text>
                    <Text style={styles.folderName} numberOfLines={2}>{folder.name}</Text>
                    <Text style={styles.folderMeta}>Open folder</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {filteredFiles.length ? (
              <View style={styles.grid}>
                {filteredFiles.map((file, index) => (
                  <View key={`${file.rel || file.name}-${index}`} style={[styles.fileWrap, { width: `${100 / columns}%` }]}>
                    <Pressable style={({ pressed }) => [styles.fileCard, pressed && styles.pressed]} onPress={() => openFile(file)}>
                      <View style={styles.fileType}>
                        <Text style={styles.fileTypeText}>{fileTypeLabel(file)}</Text>
                      </View>
                      <View style={styles.fileInfo}>
                        <Text style={styles.fileName} numberOfLines={2}>{file.name}</Text>
                        <View style={styles.fileMetaRow}>
                          <Text style={styles.fileMeta}>{formatDate(file.modified_at)}</Text>
                          <Text style={styles.fileMeta}>{formatBytes(file.size_bytes ?? file.size)}</Text>
                        </View>
                      </View>
                      <Text style={styles.openChevron}>›</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No Site CDs found</Text>
                <Text style={styles.emptyText}>
                  {query ? 'Try a different search.' : 'No files were found in this site Prints folder.'}
                </Text>
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { padding: 12, paddingBottom: 34 },
  controlCard: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(219,234,254,0.95)',
    padding: 12,
    marginBottom: 12,
    shadowColor: '#020617',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 3,
  },
  topRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  search: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dbe7f5',
    paddingHorizontal: 13,
    color: colors.text,
    fontWeight: '800',
  },
  refreshButton: { backgroundColor: colors.blue, borderRadius: 14, paddingHorizontal: 15, paddingVertical: 12 },
  refreshText: { color: '#fff', fontWeight: '900' },
  metaRow: { marginTop: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  kicker: { color: colors.red, fontSize: 10, fontWeight: '900', letterSpacing: 1.1, textTransform: 'uppercase' },
  pathText: { color: colors.text, fontSize: 14, fontWeight: '900', marginTop: 2 },
  countPill: { overflow: 'hidden', color: '#1e3a8a', backgroundColor: '#dbeafe', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12, fontWeight: '900' },
  upButton: { alignSelf: 'flex-start', marginTop: 10, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  upText: { color: '#1d4ed8', fontWeight: '900' },
  centerCard: { backgroundColor: 'rgba(15,23,42,0.72)', borderRadius: 18, padding: 18, alignItems: 'center', gap: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  centerText: { color: '#fff', fontWeight: '900' },
  errorCard: { backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: '#fecaca', gap: 8 },
  errorTitle: { color: colors.red, fontSize: 16, fontWeight: '900' },
  errorText: { color: colors.text, fontWeight: '800', lineHeight: 20 },
  retryButton: { alignSelf: 'flex-start', marginTop: 6, backgroundColor: colors.blue, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  retryText: { color: '#fff', fontWeight: '900' },
  folderRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  folderCard: { width: 150, minHeight: 98, backgroundColor: 'rgba(255,255,255,0.94)', borderWidth: 1, borderColor: '#c7d2fe', borderRadius: 17, padding: 12 },
  folderIcon: { fontSize: 24 },
  folderName: { color: colors.text, fontSize: 13, fontWeight: '900', marginTop: 7, lineHeight: 17 },
  folderMeta: { color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: 5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  fileWrap: { padding: 5 },
  fileCard: {
    minHeight: 84,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 17,
    borderWidth: 1,
    borderColor: 'rgba(203,213,225,0.95)',
    padding: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fileType: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', alignItems: 'center', justifyContent: 'center' },
  fileTypeText: { color: '#1d4ed8', fontSize: 10, fontWeight: '900' },
  fileInfo: { flex: 1, minWidth: 0 },
  fileName: { color: colors.text, fontSize: 14, lineHeight: 18, fontWeight: '900' },
  fileMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 6 },
  fileMeta: { color: colors.muted, backgroundColor: '#f8fafc', borderRadius: 999, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, fontWeight: '800' },
  openChevron: { color: '#94a3b8', fontSize: 28, fontWeight: '900' },
  emptyCard: { backgroundColor: 'rgba(15,23,42,0.64)', borderRadius: 18, padding: 22, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  emptyTitle: { color: '#fff', fontSize: 16, fontWeight: '900' },
  emptyText: { color: '#cbd5e1', fontWeight: '800', textAlign: 'center', marginTop: 6 },
  pressed: { opacity: 0.72 },
});

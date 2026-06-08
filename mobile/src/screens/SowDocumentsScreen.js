import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import ScreenShell, { colors } from '../components/ScreenShell';
import {
  buildSiteDocumentDownloadPath,
  buildWebSessionUrl,
  deleteSubcontractorSiteDocument,
  loadSubcontractorSiteDocuments,
} from '../api/subcontractorApi';

const SECTION_ORDER = ['installation', 'scope'];
const SECTION_FALLBACKS = {
  installation: 'Installation Documents',
  scope: 'Scope of Work Documents',
};

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

function fileTypeLabel(filename) {
  const ext = String(filename || '').split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'PDF';
  if (['xls', 'xlsx', 'xlsm', 'csv'].includes(ext)) return 'XLS';
  if (['doc', 'docx', 'rtf'].includes(ext)) return 'DOC';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'tif', 'tiff'].includes(ext)) return 'IMG';
  return 'FILE';
}

function normalizeSection(section, payloadSection) {
  const buckets = payloadSection?.buckets || {};
  const files = Array.isArray(payloadSection?.files) ? payloadSection.files : [];
  return {
    key: section,
    label: payloadSection?.label || SECTION_FALLBACKS[section] || section,
    buckets,
    files,
  };
}

export default function SowDocumentsScreen({ session, project, page, onBack, onHome }) {
  const { width } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [sections, setSections] = useState({});
  const siteName = project?.site_name || project?.name || '';
  const columns = width >= 900 ? 2 : 1;

  const visibleSections = useMemo(() => SECTION_ORDER.map((key) => normalizeSection(key, sections[key])), [sections]);

  const load = useCallback(async ({ showSpinner = false } = {}) => {
    if (!siteName) return;
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const data = await loadSubcontractorSiteDocuments(session.portalUrl, session.access_token, siteName);
      setSections(data?.sections || {});
    } catch (err) {
      setError(err?.message || 'Unable to load SOW documents.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session?.portalUrl, session?.access_token, siteName]);

  useEffect(() => {
    load({ showSpinner: true });
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    await load();
  }

  function openDocument(sectionKey, file) {
    const path = buildSiteDocumentDownloadPath({
      siteName,
      section: sectionKey,
      bucket: file?.bucket,
      filename: file?.name,
    });
    const url = buildWebSessionUrl(session.portalUrl, session.access_token, path);
    Linking.openURL(url).catch(() => Alert.alert('Download Error', 'Unable to open this document.'));
  }

  function confirmDelete(sectionKey, file) {
    Alert.alert(
      'Delete Document',
      `Delete "${file?.name || 'this document'}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteSubcontractorSiteDocument(session.portalUrl, session.access_token, {
                siteName,
                section: sectionKey,
                bucket: file?.bucket,
                filename: file?.name,
              });
              await load();
            } catch (err) {
              Alert.alert('Delete Error', err?.message || 'Unable to delete this document.');
            }
          },
        },
      ],
    );
  }

  return (
    <ScreenShell title={page?.label || 'SOW Documents'} subtitle={siteName || 'Selected project'} onBack={onBack} onHome={onHome}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Subcontractor Documents</Text>
          <Text style={styles.heroTitle}>SOW Documents</Text>
          <Text style={styles.heroText}>Installation documents and scope of work documents for this project.</Text>
        </View>

        {loading ? (
          <View style={styles.centerCard}>
            <ActivityIndicator color={colors.blue} />
            <Text style={styles.centerText}>Loading documents…</Text>
          </View>
        ) : null}

        {!!error && !loading ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Unable to load documents</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]} onPress={() => load({ showSpinner: true })}>
              <Text style={styles.retryText}>Try Again</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !error ? (
          <View style={styles.grid}>
            {visibleSections.map((section) => {
              const files = section.files || [];
              return (
                <View key={section.key} style={[styles.sectionWrap, { width: `${100 / columns}%` }]}>
                  <View style={styles.sectionCard}>
                    <View style={styles.sectionHeader}>
                      <View style={styles.sectionIcon}><Text style={styles.sectionIconText}>{section.key === 'installation' ? 'I' : 'S'}</Text></View>
                      <View style={styles.sectionHeaderText}>
                        <Text style={styles.sectionTitle}>{section.label}</Text>
                        <Text style={styles.sectionSub}>{files.length} document{files.length === 1 ? '' : 's'}</Text>
                      </View>
                    </View>

                    {files.length === 0 ? (
                      <View style={styles.emptyBox}>
                        <Text style={styles.emptyText}>No documents found in this section.</Text>
                      </View>
                    ) : files.map((file, index) => {
                      const bucket = section.buckets?.[file.bucket] || {};
                      const canDelete = Boolean(file.can_delete ?? bucket.can_delete);
                      const ownerLabel = file.bucket_label || bucket.label || (file.bucket === 'company' ? 'Company Managed' : 'Subcontractor Managed');
                      return (
                        <View key={`${section.key}-${file.bucket}-${file.name}-${index}`} style={styles.fileRow}>
                          <View style={styles.fileType}><Text style={styles.fileTypeText}>{fileTypeLabel(file.name)}</Text></View>
                          <View style={styles.fileInfo}>
                            <Text style={styles.fileName}>{file.name}</Text>
                            <View style={styles.metaLine}>
                              <Text style={[styles.metaPill, file.bucket === 'company' ? styles.companyPill : styles.subPill]}>{ownerLabel}</Text>
                              <Text style={styles.metaPill}>{file.modified || '—'}</Text>
                              <Text style={styles.metaPill}>{formatBytes(file.size)}</Text>
                            </View>
                            <View style={styles.actions}>
                              <Pressable style={({ pressed }) => [styles.openButton, pressed && styles.pressed]} onPress={() => openDocument(section.key, file)}>
                                <Text style={styles.openText}>Open</Text>
                              </Pressable>
                              {canDelete ? (
                                <Pressable style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]} onPress={() => confirmDelete(section.key, file)}>
                                  <Text style={styles.deleteText}>Delete</Text>
                                </Pressable>
                              ) : null}
                            </View>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 36, backgroundColor: colors.pageBg },
  hero: { backgroundColor: '#10233f', borderRadius: 24, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', shadowColor: '#0f172a', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
  eyebrow: { color: '#93c5fd', fontSize: 12, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase' },
  heroTitle: { color: '#fff', fontSize: 25, lineHeight: 31, fontWeight: '900', marginTop: 7 },
  heroText: { color: '#c7d8ec', fontSize: 14, lineHeight: 20, fontWeight: '700', marginTop: 8 },
  centerCard: { backgroundColor: '#fff', borderRadius: 18, padding: 18, alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.line },
  centerText: { color: colors.muted, fontWeight: '800' },
  errorCard: { backgroundColor: '#fff', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: '#fecaca', gap: 8 },
  errorTitle: { color: colors.red, fontSize: 16, fontWeight: '900' },
  errorText: { color: colors.text, fontWeight: '700', lineHeight: 20 },
  retryButton: { alignSelf: 'flex-start', marginTop: 6, backgroundColor: colors.blue, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  retryText: { color: '#fff', fontWeight: '900' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  sectionWrap: { padding: 6 },
  sectionCard: { backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(191,219,254,0.92)', padding: 14, shadowColor: '#0f172a', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  sectionIcon: { width: 42, height: 42, borderRadius: 15, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', alignItems: 'center', justifyContent: 'center' },
  sectionIconText: { color: colors.blue, fontSize: 18, fontWeight: '900' },
  sectionHeaderText: { flex: 1, minWidth: 0 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },
  sectionSub: { color: colors.muted, fontSize: 12, fontWeight: '800', marginTop: 2 },
  emptyBox: { borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, padding: 14, backgroundColor: '#f8fafc' },
  emptyText: { color: colors.muted, fontWeight: '800', textAlign: 'center' },
  fileRow: { flexDirection: 'row', gap: 10, paddingVertical: 11, borderTopWidth: 1, borderTopColor: colors.line },
  fileType: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  fileTypeText: { color: colors.text, fontSize: 10, fontWeight: '900' },
  fileInfo: { flex: 1, minWidth: 0 },
  fileName: { color: colors.text, fontSize: 15, fontWeight: '900', lineHeight: 20 },
  metaLine: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 },
  metaPill: { overflow: 'hidden', color: colors.muted, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 11, fontWeight: '800' },
  companyPill: { color: '#24338a', backgroundColor: '#eef2ff', borderColor: '#c7d2fe' },
  subPill: { color: '#166534', backgroundColor: '#ecfdf5', borderColor: '#bbf7d0' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  openButton: { backgroundColor: colors.blue, borderRadius: 13, paddingHorizontal: 14, paddingVertical: 9 },
  openText: { color: '#fff', fontWeight: '900' },
  deleteButton: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 13, paddingHorizontal: 14, paddingVertical: 9 },
  deleteText: { color: colors.red, fontWeight: '900' },
  pressed: { opacity: 0.72 },
});

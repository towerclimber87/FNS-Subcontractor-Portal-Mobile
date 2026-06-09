import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, PanResponder, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import ScreenShell, { colors } from '../components/ScreenShell';
import {
  createSubcontractorRedlineAnnotation,
  createSubcontractorRedlinePin,
  deleteSubcontractorRedlineAnnotation,
  deleteSubcontractorRedlinePin,
  loadSubcontractorRedlinePageData,
  loadSubcontractorSiteWalkRedlines,
  subcontractorMediaUrl,
  updateSubcontractorRedlinePin,
} from '../api/subcontractorApi';

const TAGS = ['Antenna', 'Node', 'Cores', 'Miscellaneous', 'IDF / ER', 'Electrical'];
const TOOLS = [
  { key: 'pan', label: 'Pan' },
  { key: 'pin', label: 'Pin' },
  { key: 'note', label: 'Note' },
  { key: 'rect', label: 'Square' },
  { key: 'circle', label: 'Circle' },
  { key: 'line', label: 'Line' },
  { key: 'arrow', label: 'Arrow' },
  { key: 'cloud', label: 'Cloud' },
];
const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#111827'];
const WIDTHS = [1, 2, 3, 5, 8];

const clean = (v) => String(v ?? '').trim();
const siteName = (project) => clean(project?.site_name || project?.name || project?.label || project);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const pct = (n) => `${clamp(Number(n) || 0, 0, 100)}%`;

function normalizeAnnotation(a) {
  return {
    id: a?.id,
    shape_type: clean(a?.shape_type || a?.type || 'rect'),
    x1: Number(a?.x1 ?? 0),
    y1: Number(a?.y1 ?? 0),
    x2: Number(a?.x2 ?? 0),
    y2: Number(a?.y2 ?? 0),
    stroke_color: clean(a?.stroke_color || '#ef4444'),
    stroke_width: Number(a?.stroke_width || 2),
    note: clean(a?.note),
  };
}

function normalizePin(p) {
  return {
    id: p?.id,
    x: Number(p?.x ?? 50),
    y: Number(p?.y ?? 50),
    label: clean(p?.label || p?.name || 'Pin'),
    tag: clean(p?.tag || 'Miscellaneous'),
    pin_type: clean(p?.pin_type || 'photo'),
    has_photo: Boolean(p?.has_photo || p?.photo_id || p?.photo_url || p?.thumb_url),
    has_360: Boolean(p?.has_360 || p?.has_360_photo || p?.is_expected_360_photo),
    layer: clean(p?.layer || 'subcontractor'),
  };
}

function AnnotationView({ annotation, selected, onPress }) {
  const a = normalizeAnnotation(annotation);
  const left = Math.min(a.x1, a.x2);
  const top = Math.min(a.y1, a.y2);
  const width = Math.max(Math.abs(a.x2 - a.x1), 1);
  const height = Math.max(Math.abs(a.y2 - a.y1), 1);
  const base = {
    position: 'absolute',
    left: pct(left),
    top: pct(top),
    width: pct(width),
    height: pct(height),
    borderColor: a.stroke_color,
    borderWidth: Math.max(1, a.stroke_width),
  };
  if (a.shape_type === 'line' || a.shape_type === 'arrow') {
    const lineWidth = Math.max(1, Math.abs(a.x2 - a.x1));
    const lineStyle = {
      position: 'absolute',
      left: pct(Math.min(a.x1, a.x2)),
      top: pct((a.y1 + a.y2) / 2),
      width: pct(lineWidth),
      height: Math.max(2, a.stroke_width),
      backgroundColor: a.stroke_color,
      transform: [{ rotate: `${Math.atan2(a.y2 - a.y1, a.x2 - a.x1) * 180 / Math.PI}deg` }],
    };
    return <Pressable onPress={onPress} style={[lineStyle, selected && styles.selectedShape]}>{a.shape_type === 'arrow' ? <View style={[styles.arrowHead, { borderLeftColor: a.stroke_color }]} /> : null}</Pressable>;
  }
  return (
    <Pressable onPress={onPress} style={[base, a.shape_type === 'circle' && { borderRadius: 999 }, a.shape_type === 'cloud' && styles.cloudShape, selected && styles.selectedShape]}>
      {!!a.note && <Text style={styles.annotationNote} numberOfLines={2}>{a.note}</Text>}
    </Pressable>
  );
}

function PinView({ pin, selected, onPress }) {
  const p = normalizePin(pin);
  const ringColor = p.has_photo ? '#16a34a' : '#ef4444';
  return (
    <Pressable onPress={onPress} style={[styles.pinWrap, { left: pct(p.x), top: pct(p.y) }, selected && styles.pinSelected]}>
      <View style={[styles.pinDot, { borderColor: ringColor }]}>
        <View style={[styles.pinInner, { backgroundColor: p.has_360 ? '#2563eb' : ringColor }]} />
      </View>
      <Text style={styles.pinLabel} numberOfLines={1}>{p.label}</Text>
    </Pressable>
  );
}

export default function SubcontractorPdfEditorScreen({ session, project, onBack, onHome }) {
  const { width, height } = useWindowDimensions();
  const selectedSite = siteName(project);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [sitewalks, setSitewalks] = useState([]);
  const [selectedSitewalk, setSelectedSitewalk] = useState('');
  const [pages, setPages] = useState([]);
  const [selectedPageId, setSelectedPageId] = useState(null);
  const [pageData, setPageData] = useState({ page: null, pins: [], annotations: [] });
  const [tool, setTool] = useState('pan');
  const [strokeColor, setStrokeColor] = useState('#ef4444');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [selectedItem, setSelectedItem] = useState(null);
  const [draft, setDraft] = useState(null);
  const [pinDialog, setPinDialog] = useState(null);
  const canvasRef = useRef(null);
  const dragStart = useRef(null);

  const portalUrl = session?.portalUrl;
  const token = session?.access_token;
  const pageImage = subcontractorMediaUrl(portalUrl, pageData?.page?.image_api_url || pageData?.page?.image_url || pageData?.page?.storage_img || pageData?.page?.pdf_url);
  const canvasWidth = Math.max(width - 24, width >= 800 ? 760 : 360);
  const canvasHeight = Math.max(420, Math.min(height * 0.62, canvasWidth * 1.34));

  const loadIndex = useCallback(async ({ silent = false } = {}) => {
    if (!selectedSite) return;
    if (!silent) setLoading(true);
    setError('');
    try {
      const data = await loadSubcontractorSiteWalkRedlines(portalUrl, token, { siteName: selectedSite, sitewalkDesc: selectedSitewalk });
      const walks = Array.isArray(data?.sitewalks) ? data.sitewalks.map((w) => clean(w?.value || w?.sitewalk_desc || w)).filter(Boolean) : [];
      const nextWalk = selectedSitewalk || walks[0] || '';
      const nextPages = Array.isArray(data?.pages) ? data.pages : Array.isArray(data?.items) ? data.items : [];
      setSitewalks(walks);
      if (!selectedSitewalk && nextWalk) setSelectedSitewalk(nextWalk);
      setPages(nextPages);
      const currentStillExists = nextPages.some((p) => String(p?.id || p?.page_id) === String(selectedPageId));
      const nextPageId = currentStillExists ? selectedPageId : (nextPages[0]?.id || nextPages[0]?.page_id || null);
      setSelectedPageId(nextPageId);
    } catch (e) {
      setError(e?.message || 'Unable to load PDF editor.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [portalUrl, token, selectedSite, selectedSitewalk, selectedPageId]);

  const loadPage = useCallback(async (pageId) => {
    if (!pageId) return;
    try {
      const data = await loadSubcontractorRedlinePageData(portalUrl, token, pageId);
      setPageData({ page: data?.page || pages.find((p) => String(p?.id || p?.page_id) === String(pageId)) || null, pins: data?.pins || [], annotations: data?.annotations || [] });
      setSelectedItem(null);
    } catch (e) {
      Alert.alert('PDF Editor', e?.message || 'Unable to load this page.');
    }
  }, [portalUrl, token, pages]);

  useEffect(() => { loadIndex(); }, [loadIndex]);
  useEffect(() => { if (selectedPageId) loadPage(selectedPageId); }, [selectedPageId, loadPage]);

  const pageTitle = clean(pageData?.page?.display_name || pageData?.page?.name || pages.find((p) => String(p?.id || p?.page_id) === String(selectedPageId))?.display_name || 'PDF Page');

  const pointFromEvent = useCallback((evt) => {
    const { locationX, locationY } = evt.nativeEvent;
    return { x: clamp((locationX / canvasWidth) * 100, 0, 100), y: clamp((locationY / canvasHeight) * 100, 0, 100) };
  }, [canvasWidth, canvasHeight]);

  const saveAnnotation = useCallback(async (shape) => {
    if (!selectedPageId || !pageData?.page?.site_id) return;
    const payload = {
      site_id: pageData.page.site_id,
      page_id: selectedPageId,
      sitewalk_desc: pageData.page.sitewalk_desc || selectedSitewalk,
      shape_type: shape.shape_type,
      x1: shape.x1,
      y1: shape.y1,
      x2: shape.x2,
      y2: shape.y2,
      stroke_color: strokeColor,
      stroke_width: strokeWidth,
      note: shape.note || '',
      layer: 'subcontractor',
    };
    const saved = await createSubcontractorRedlineAnnotation(portalUrl, token, payload);
    setPageData((prev) => ({ ...prev, annotations: [...(prev.annotations || []), saved?.annotation || saved] }));
    setTool('pan');
  }, [pageData?.page, selectedPageId, selectedSitewalk, strokeColor, strokeWidth, portalUrl, token]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => tool !== 'pan',
    onMoveShouldSetPanResponder: () => tool !== 'pan',
    onPanResponderGrant: (evt) => {
      const pt = pointFromEvent(evt);
      dragStart.current = pt;
      if (tool === 'pin' || tool === 'note') {
        setPinDialog({ x: pt.x, y: pt.y, label: tool === 'note' ? 'Note' : 'Pin', tag: 'Miscellaneous', pin_type: tool === 'note' ? 'note' : 'photo' });
      } else {
        setDraft({ shape_type: tool, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y, stroke_color: strokeColor, stroke_width: strokeWidth });
      }
    },
    onPanResponderMove: (evt) => {
      if (!dragStart.current || tool === 'pin' || tool === 'note') return;
      const pt = pointFromEvent(evt);
      setDraft((d) => d ? { ...d, x2: pt.x, y2: pt.y } : d);
    },
    onPanResponderRelease: async (evt) => {
      if (tool === 'pin' || tool === 'note') return;
      const start = dragStart.current;
      const end = pointFromEvent(evt);
      dragStart.current = null;
      setDraft(null);
      if (!start) return;
      if (Math.abs(end.x - start.x) < 1 && Math.abs(end.y - start.y) < 1) return;
      try {
        await saveAnnotation({ shape_type: tool, x1: start.x, y1: start.y, x2: end.x, y2: end.y });
      } catch (e) {
        Alert.alert('PDF Editor', e?.message || 'Unable to save markup.');
      }
    },
  }), [tool, pointFromEvent, strokeColor, strokeWidth, saveAnnotation]);

  const savePin = useCallback(async () => {
    if (!pinDialog || !selectedPageId || !pageData?.page?.site_id) return;
    try {
      const payload = { site_id: pageData.page.site_id, page_id: selectedPageId, sitewalk_desc: pageData.page.sitewalk_desc || selectedSitewalk, x: pinDialog.x, y: pinDialog.y, label: pinDialog.label, tag: pinDialog.tag, pin_type: pinDialog.pin_type, layer: 'subcontractor' };
      const saved = await createSubcontractorRedlinePin(portalUrl, token, payload);
      setPageData((prev) => ({ ...prev, pins: [...(prev.pins || []), saved?.pin || saved] }));
      setPinDialog(null);
      setTool('pan');
    } catch (e) {
      Alert.alert('PDF Editor', e?.message || 'Unable to save pin.');
    }
  }, [pinDialog, selectedPageId, pageData?.page, selectedSitewalk, portalUrl, token]);

  const deleteSelected = useCallback(async () => {
    if (!selectedItem) return;
    try {
      if (selectedItem.type === 'annotation') {
        await deleteSubcontractorRedlineAnnotation(portalUrl, token, selectedItem.item.id);
        setPageData((prev) => ({ ...prev, annotations: (prev.annotations || []).filter((a) => String(a.id) !== String(selectedItem.item.id)) }));
      } else if (selectedItem.type === 'pin') {
        await deleteSubcontractorRedlinePin(portalUrl, token, selectedItem.item.id);
        setPageData((prev) => ({ ...prev, pins: (prev.pins || []).filter((p) => String(p.id) !== String(selectedItem.item.id)) }));
      }
      setSelectedItem(null);
    } catch (e) {
      Alert.alert('PDF Editor', e?.message || 'Unable to delete selected item.');
    }
  }, [selectedItem, portalUrl, token]);

  const refresh = useCallback(() => { setRefreshing(true); loadIndex({ silent: true }); if (selectedPageId) loadPage(selectedPageId); }, [loadIndex, loadPage, selectedPageId]);

  return (
    <ScreenShell title="PDF Editor" subtitle={selectedSite} onBack={onBack} onHome={onHome}>
      <View style={styles.wrap}>
        <View style={styles.toolbarCard}>
          <View style={styles.toolbarHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>Native Subcontractor PDF Editor</Text>
              <Text style={styles.pageTitle} numberOfLines={1}>{pageTitle}</Text>
            </View>
            <Pressable style={styles.refreshBtn} onPress={refresh}><Text style={styles.refreshText}>Refresh</Text></Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {sitewalks.map((walk) => <Pressable key={walk} onPress={() => { setSelectedSitewalk(walk); setSelectedPageId(null); }} style={[styles.chip, selectedSitewalk === walk && styles.chipActive]}><Text style={[styles.chipText, selectedSitewalk === walk && styles.chipTextActive]}>{walk}</Text></Pressable>)}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {pages.map((p, idx) => { const id = p?.id || p?.page_id; return <Pressable key={String(id || idx)} onPress={() => setSelectedPageId(id)} style={[styles.pageChip, String(selectedPageId) === String(id) && styles.pageChipActive]}><Text style={[styles.pageChipText, String(selectedPageId) === String(id) && styles.pageChipTextActive]}>{clean(p?.display_name || p?.name || `Page ${idx + 1}`)}</Text></Pressable>; })}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tools}>
            {TOOLS.map((t) => <Pressable key={t.key} onPress={() => setTool(t.key)} style={[styles.toolBtn, tool === t.key && styles.toolActive]}><Text style={[styles.toolText, tool === t.key && styles.toolTextActive]}>{t.label}</Text></Pressable>)}
          </ScrollView>
          <View style={styles.optionRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatches}>{COLORS.map((c) => <Pressable key={c} onPress={() => setStrokeColor(c)} style={[styles.swatch, { backgroundColor: c }, strokeColor === c && styles.swatchActive]} />)}</ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.widths}>{WIDTHS.map((w) => <Pressable key={w} onPress={() => setStrokeWidth(w)} style={[styles.widthBtn, strokeWidth === w && styles.widthActive]}><Text style={[styles.widthText, strokeWidth === w && styles.widthTextActive]}>{w}</Text></Pressable>)}</ScrollView>
            {selectedItem ? <Pressable style={styles.deleteBtn} onPress={deleteSelected}><Text style={styles.deleteText}>Delete</Text></Pressable> : null}
          </View>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? <View style={styles.center}><ActivityIndicator color={colors.blue} /><Text style={styles.muted}>Loading native PDF editor…</Text></View> : (
          <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} contentContainerStyle={styles.editorScroll} horizontal>
            <View style={[styles.canvas, { width: canvasWidth, height: canvasHeight }]} ref={canvasRef} {...panResponder.panHandlers}>
              {pageImage ? <Image source={{ uri: pageImage }} style={styles.pageImage} resizeMode="contain" /> : <View style={styles.noPage}><Text style={styles.noPageTitle}>No page image available</Text><Text style={styles.muted}>This SiteWalk has no native-renderable PDF page image.</Text></View>}
              {(pageData.annotations || []).map((a) => <AnnotationView key={`a-${a.id}`} annotation={a} selected={selectedItem?.type === 'annotation' && String(selectedItem?.item?.id) === String(a.id)} onPress={() => setSelectedItem({ type: 'annotation', item: a })} />)}
              {(pageData.pins || []).map((p) => <PinView key={`p-${p.id}`} pin={p} selected={selectedItem?.type === 'pin' && String(selectedItem?.item?.id) === String(p.id)} onPress={() => setSelectedItem({ type: 'pin', item: p })} />)}
              {draft ? <AnnotationView annotation={draft} /> : null}
            </View>
          </ScrollView>
        )}
      </View>
      <Modal visible={!!pinDialog} transparent animationType="fade" onRequestClose={() => setPinDialog(null)}>
        <View style={styles.modalBg}><View style={styles.dialog}><Text style={styles.dialogTitle}>{pinDialog?.pin_type === 'note' ? 'Add Note' : 'Add Pin'}</Text><TextInput value={pinDialog?.label || ''} onChangeText={(label) => setPinDialog((p) => ({ ...p, label }))} placeholder="Label" style={styles.input} placeholderTextColor="#71839b" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{TAGS.map((tag) => <Pressable key={tag} onPress={() => setPinDialog((p) => ({ ...p, tag }))} style={[styles.tagChip, pinDialog?.tag === tag && styles.tagChipActive]}><Text style={[styles.tagChipText, pinDialog?.tag === tag && styles.tagChipTextActive]}>{tag}</Text></Pressable>)}</ScrollView>
          <View style={styles.dialogActions}><Pressable style={styles.cancelBtn} onPress={() => setPinDialog(null)}><Text style={styles.cancelText}>Cancel</Text></Pressable><Pressable style={styles.saveBtn} onPress={savePin}><Text style={styles.saveText}>Save</Text></Pressable></View></View></View>
      </Modal>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 }, toolbarCard: { margin: 12, padding: 12, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.94)', borderWidth: 1, borderColor: colors.line, gap: 10 }, toolbarHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 }, eyebrow: { color: colors.blue, fontSize: 11, fontWeight: '900', letterSpacing: .5, textTransform: 'uppercase' }, pageTitle: { color: colors.text, fontSize: 18, fontWeight: '900', marginTop: 2 }, refreshBtn: { backgroundColor: colors.blue, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14 }, refreshText: { color: '#fff', fontWeight: '900' }, chips: { gap: 8, paddingRight: 8 }, chip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, backgroundColor: '#eef6ff', borderWidth: 1, borderColor: '#c8def6' }, chipActive: { backgroundColor: '#10233f', borderColor: '#10233f' }, chipText: { color: '#31506d', fontWeight: '900' }, chipTextActive: { color: '#fff' }, pageChip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line }, pageChipActive: { backgroundColor: colors.blue, borderColor: colors.blue }, pageChipText: { color: colors.text, fontWeight: '900' }, pageChipTextActive: { color: '#fff' }, tools: { gap: 8, paddingRight: 8 }, toolBtn: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, backgroundColor: '#f8fbff', borderWidth: 1, borderColor: colors.line }, toolActive: { backgroundColor: '#10233f', borderColor: '#10233f' }, toolText: { color: colors.text, fontWeight: '900' }, toolTextActive: { color: '#fff' }, optionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, swatches: { gap: 7 }, swatch: { width: 28, height: 28, borderRadius: 999, borderWidth: 2, borderColor: '#fff' }, swatchActive: { borderColor: '#0f172a', transform: [{ scale: 1.12 }] }, widths: { gap: 6 }, widthBtn: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' }, widthActive: { backgroundColor: colors.blue, borderColor: colors.blue }, widthText: { color: colors.muted, fontWeight: '900' }, widthTextActive: { color: '#fff' }, deleteBtn: { marginLeft: 'auto', backgroundColor: '#dc2626', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12 }, deleteText: { color: '#fff', fontWeight: '900' }, error: { marginHorizontal: 12, color: '#991b1b', backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fecaca', padding: 10, borderRadius: 14, fontWeight: '800' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }, muted: { color: colors.muted, fontWeight: '800', textAlign: 'center' }, editorScroll: { padding: 12, paddingBottom: 28 }, canvas: { backgroundColor: '#0f172a', borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: '#334155' }, pageImage: { width: '100%', height: '100%', backgroundColor: '#e5edf5' }, noPage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: '#e5edf5' }, noPageTitle: { color: colors.text, fontWeight: '900', fontSize: 18, marginBottom: 6 }, cloudShape: { borderStyle: 'dashed', borderRadius: 18 }, selectedShape: { shadowColor: '#38bdf8', shadowOpacity: .9, shadowRadius: 8, elevation: 7 }, annotationNote: { color: '#111827', backgroundColor: 'rgba(255,255,255,.75)', fontWeight: '900', fontSize: 10, padding: 2 }, arrowHead: { position: 'absolute', right: -7, top: -5, width: 0, height: 0, borderTopWidth: 6, borderBottomWidth: 6, borderLeftWidth: 10, borderTopColor: 'transparent', borderBottomColor: 'transparent' }, pinWrap: { position: 'absolute', marginLeft: -18, marginTop: -18, alignItems: 'center', minWidth: 54 }, pinSelected: { transform: [{ scale: 1.1 }] }, pinDot: { width: 32, height: 32, borderRadius: 999, borderWidth: 4, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, pinInner: { width: 13, height: 13, borderRadius: 999 }, pinLabel: { marginTop: 2, color: '#fff', backgroundColor: 'rgba(15,23,42,.84)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, fontSize: 10, fontWeight: '900', overflow: 'hidden' }, modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,.55)', alignItems: 'center', justifyContent: 'center', padding: 16 }, dialog: { width: '100%', maxWidth: 520, backgroundColor: '#fff', borderRadius: 24, padding: 16, gap: 12 }, dialogTitle: { color: colors.text, fontWeight: '900', fontSize: 20 }, input: { borderWidth: 1, borderColor: colors.line, borderRadius: 15, paddingHorizontal: 13, paddingVertical: 11, color: colors.text, fontWeight: '800' }, tagChip: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 999, backgroundColor: '#f8fbff', borderWidth: 1, borderColor: colors.line }, tagChipActive: { backgroundColor: colors.blue, borderColor: colors.blue }, tagChipText: { color: colors.muted, fontWeight: '900' }, tagChipTextActive: { color: '#fff' }, dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }, cancelBtn: { paddingHorizontal: 14, paddingVertical: 11, borderRadius: 14, backgroundColor: '#eef2f7' }, cancelText: { color: colors.text, fontWeight: '900' }, saveBtn: { paddingHorizontal: 17, paddingVertical: 11, borderRadius: 14, backgroundColor: colors.blue }, saveText: { color: '#fff', fontWeight: '900' },
});

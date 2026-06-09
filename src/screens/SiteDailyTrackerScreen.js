import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import ScreenShell, { colors } from '../components/ScreenShell';
import {
  loadSubcontractorSiteDailyTracker,
  updateSubcontractorSiteDailyTrackerRecord,
  uploadSubcontractorSiteDailyTrackerPhoto,
} from '../api/subcontractorApi';

const STATUS_OPTIONS = ['Not Completed', 'Completed'];
const CONNECTOR_OPTIONS = ['Not Completed', 'One End', 'Both Ends'];
const HIDDEN_COUNT_TYPES = new Set(['connectors', 'notset', 'testing']);

function clean(value) { return String(value ?? '').trim(); }
function siteName(site) { return clean(site?.site_name || site?.name || site?.label || site); }
function countTypeKey(value) { return clean(value || 'singleitem').toLowerCase().replace(/\s+/g, ''); }
function isCable(row) { return countTypeKey(row?.count_type_key || row?.count_type) === 'cable'; }
function hasCounts(row) { return ['cable', 'severalitems'].includes(countTypeKey(row?.count_type_key || row?.count_type)); }
function isCompleted(value) { return clean(value).toLowerCase() === 'completed'; }
function isBothEnds(value) { return clean(value).toLowerCase() === 'both ends'; }
function shouldHideCompleted(row) { return isCompleted(row.item_status) && (!isCable(row) || isBothEnds(row.connector_status)); }
function numberDisplay(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n - Math.round(n)) < 0.0001) return String(Math.round(n));
  return n.toFixed(2).replace(/\.00$/, '').replace(/0+$/, '').replace(/\.$/, '');
}
function normalizeRecord(row) {
  return {
    ...row,
    uid: clean(row?.uid || row?.record_uid || row?.id),
    id: row?.id,
    record_id: row?.record_id || row?.id,
    source: clean(row?.source || 'site_record'),
    name: clean(row?.name || row?.item_name),
    item_name: clean(row?.item_name || row?.name),
    task: clean(row?.task),
    location: clean(row?.location),
    count_type: clean(row?.count_type || 'Singleitem'),
    count_type_key: countTypeKey(row?.count_type_key || row?.count_type),
    item_status: clean(row?.item_status || 'Not Completed'),
    connector_status: clean(row?.connector_status || 'Not Completed'),
    installed_amount: Number(row?.installed_amount ?? row?.installed_count ?? 0) || 0,
    installed_count: Number(row?.installed_count ?? row?.installed_amount ?? 0) || 0,
    design_amount: Number(row?.design_amount ?? row?.design_count ?? 0) || 0,
    design_count: Number(row?.design_count ?? row?.design_amount ?? 0) || 0,
    photo_status: clean(row?.photo_status || 'none'),
  };
}
function photoCaption(row) {
  return [row?.name, row?.task, row?.location].map(clean).filter(Boolean).join(' — ');
}
function photoStatusStyle(status) {
  const s = clean(status).toLowerCase();
  if (s === 'approved') return styles.photoGood;
  if (s === 'rejected') return styles.photoBad;
  if (s === 'pending') return styles.photoPending;
  return styles.photoNone;
}

function SheetPicker({ visible, title, options, value, onClose, onSelect }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable style={styles.sheetClose} onPress={onClose}><Text style={styles.sheetCloseText}>Close</Text></Pressable>
          </View>
          {options.map((option) => (
            <Pressable key={option} style={[styles.optionRow, value === option && styles.optionRowActive]} onPress={() => { onSelect(option); onClose(); }}>
              <Text style={[styles.optionText, value === option && styles.optionTextActive]}>{option}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

function StatusFilter({ value, showCompleted, onSelect, onToggleCompleted }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.filterRow}>
      <Pressable style={styles.statusFilterButton} onPress={() => setOpen(true)}>
        <View>
          <Text style={styles.filterLabel}>Status</Text>
          <Text style={styles.statusFilterText}>{value === 'All' ? 'All Statuses' : value}</Text>
        </View>
        <Text style={styles.chevron}>⌄</Text>
      </Pressable>
      <Pressable style={[styles.showCompletedButton, showCompleted && styles.showCompletedButtonActive]} onPress={onToggleCompleted}>
        <Text style={[styles.showCompletedText, showCompleted && styles.showCompletedTextActive]}>{showCompleted ? 'Hide Completed' : 'Show Completed'}</Text>
      </Pressable>
      <SheetPicker visible={open} title="Status" options={['All', ...STATUS_OPTIONS]} value={value} onClose={() => setOpen(false)} onSelect={onSelect} />
    </View>
  );
}

function FilterChip({ label, active, onPress }) {
  return (
    <Pressable style={[styles.filterChip, active && styles.filterChipActive]} onPress={onPress}>
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function QtyStepper({ value, onChange }) {
  const [local, setLocal] = useState(String(value ?? '0'));
  useEffect(() => { setLocal(String(value ?? '0')); }, [value]);
  function commit(next) {
    const safe = String(next ?? '').replace(/[^0-9.]/g, '');
    setLocal(safe);
    onChange(safe === '' ? 0 : Number(safe));
  }
  return (
    <View style={styles.qtyBox}>
      <Text style={styles.qtyLabel}>Installed</Text>
      <View style={styles.qtyRow}>
        <Pressable style={styles.qtyButton} onPress={() => commit(Math.max(0, Number(local || 0) - 1))}><Text style={styles.qtyButtonText}>−</Text></Pressable>
        <TextInput style={styles.qtyInput} value={local} onChangeText={setLocal} onBlur={() => commit(local)} keyboardType="decimal-pad" selectTextOnFocus />
        <Pressable style={styles.qtyButton} onPress={() => commit(Number(local || 0) + 1)}><Text style={styles.qtyButtonText}>+</Text></Pressable>
      </View>
    </View>
  );
}

function RecordCard({ row, onStatus, onConnector, onInstalled, onPhoto, saving }) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [connectorOpen, setConnectorOpen] = useState(false);
  const completed = isCompleted(row.item_status);
  const pct = hasCounts(row) && Number(row.design_amount || 0) > 0 ? Math.min(100, Math.round((Number(row.installed_amount || 0) / Number(row.design_amount || 1)) * 100)) : null;
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.cardTitle} numberOfLines={2}>{row.name || 'Unnamed item'}</Text>
          <Text style={styles.cardMeta} numberOfLines={1}>{[row.task, row.location].filter(Boolean).join(' • ') || row.count_type}</Text>
        </View>
        <Pressable style={[styles.statusPill, completed && styles.statusPillDone]} onPress={() => setStatusOpen(true)}>
          <Text style={[styles.statusPillText, completed && styles.statusPillTextDone]}>{row.item_status}</Text>
        </Pressable>
      </View>

      <View style={styles.metricGrid}>
        <View style={styles.metric}><Text style={styles.metricLabel}>Design</Text><Text style={styles.metricValue}>{numberDisplay(row.design_amount)}</Text></View>
        <View style={styles.metric}><Text style={styles.metricLabel}>Remaining</Text><Text style={styles.metricValue}>{numberDisplay(Math.max(0, Number(row.design_amount || 0) - Number(row.installed_amount || 0)))}</Text></View>
        {isCable(row) ? (
          <Pressable style={styles.connectorBox} onPress={() => setConnectorOpen(true)}>
            <Text style={styles.metricLabel}>Connector</Text><Text style={styles.connectorText} numberOfLines={1}>{row.connector_status}</Text>
          </Pressable>
        ) : null}
      </View>

      {pct !== null ? <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View> : null}

      <View style={styles.actionRow}>
        <QtyStepper value={row.installed_amount} onChange={(value) => onInstalled(row, value)} />
        <Pressable style={[styles.photoButton, photoStatusStyle(row.photo_status)]} onPress={() => onPhoto(row)} disabled={saving}>
          <Text style={styles.photoButtonText}>📷 Photo</Text>
        </Pressable>
      </View>
      {saving ? <Text style={styles.savingText}>Saving…</Text> : null}
      <SheetPicker visible={statusOpen} title="Status" options={STATUS_OPTIONS} value={row.item_status} onClose={() => setStatusOpen(false)} onSelect={(value) => onStatus(row, value)} />
      <SheetPicker visible={connectorOpen} title="Connector" options={CONNECTOR_OPTIONS} value={row.connector_status} onClose={() => setConnectorOpen(false)} onSelect={(value) => onConnector(row, value)} />
    </View>
  );
}

export default function SiteDailyTrackerScreen({ session, project, onBack, onHome }) {
  const { width } = useWindowDimensions();
  const portalUrl = session?.portalUrl;
  const token = session?.access_token;
  const selectedSite = siteName(project);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [records, setRecords] = useState([]);
  const [siteInfo, setSiteInfo] = useState({});
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [taskFilter, setTaskFilter] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [saving, setSaving] = useState({});
  const debounceRefs = useRef({});

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!portalUrl || !token || !selectedSite) return;
    if (!silent) setLoading(true);
    try {
      const payload = await loadSubcontractorSiteDailyTracker(portalUrl, token, selectedSite);
      const nextRecords = (payload?.records || []).map(normalizeRecord).filter((row) => !HIDDEN_COUNT_TYPES.has(row.count_type_key));
      setRecords(nextRecords);
      setSiteInfo(payload?.site || {});
    } catch (error) {
      Alert.alert('Site Daily Tracker', error?.message || 'Unable to load the site daily tracker.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [portalUrl, token, selectedSite]);

  useEffect(() => { load(); }, [load]);

  const tasks = useMemo(() => [...new Set(records.map((r) => r.task).filter(Boolean))].sort(), [records]);
  const visibleRecords = useMemo(() => {
    const q = clean(search).toLowerCase();
    return records.filter((row) => {
      if (taskFilter && row.task !== taskFilter) return false;
      if (statusFilter !== 'All' && row.item_status !== statusFilter) return false;
      if (q && ![row.name, row.task, row.location].some((value) => clean(value).toLowerCase().includes(q))) return false;
      if (!showCompleted && !q && shouldHideCompleted(row)) return false;
      return true;
    });
  }, [records, search, statusFilter, taskFilter, showCompleted]);

  const stats = useMemo(() => {
    const total = records.length;
    const done = records.filter((r) => shouldHideCompleted(r)).length;
    return { total, done, visible: visibleRecords.length };
  }, [records, visibleRecords]);

  function patchLocal(uid, patch) {
    setRecords((prev) => prev.map((row) => row.uid === uid ? normalizeRecord({ ...row, ...patch }) : row));
  }

  async function persist(row, field, value, { debounce = false } = {}) {
    const uid = row.uid;
    patchLocal(uid, { [field]: value, ...(field === 'installed_amount' ? { installed_count: value } : {}) });
    const run = async () => {
      setSaving((prev) => ({ ...prev, [uid]: true }));
      try {
        const payload = await updateSubcontractorSiteDailyTrackerRecord(portalUrl, token, uid, { field, value });
        if (payload?.item) patchLocal(uid, normalizeRecord(payload.item));
      } catch (error) {
        Alert.alert('Update Failed', error?.message || 'Unable to save this change.');
        await load({ silent: true });
      } finally {
        setSaving((prev) => ({ ...prev, [uid]: false }));
      }
    };
    if (debounce) {
      clearTimeout(debounceRefs.current[`${uid}:${field}`]);
      debounceRefs.current[`${uid}:${field}`] = setTimeout(run, 450);
    } else {
      await run();
    }
  }

  async function handleStatus(row, value) {
    const changes = [{ field: 'item_status', value }];
    if (value === 'Completed' && hasCounts(row)) changes.push({ field: 'design_amount', value: row.installed_amount });
    for (const change of changes) await persist(row, change.field, change.value);
  }

  async function handleConnector(row, value) { await persist(row, 'connector_status', value); }
  function handleInstalled(row, value) { persist(row, 'installed_amount', Math.max(0, Number(value || 0)), { debounce: true }); }

  async function pickPhoto(row, mode) {
    try {
      const permission = mode === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission?.granted) {
        Alert.alert('Photo Permission Needed', 'Photo access is required to attach a tracker photo.');
        return;
      }
      const result = mode === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85, exif: false })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85, exif: false });
      if (result?.canceled || !result?.assets?.length) return;
      const siteId = siteInfo?.site_id || siteInfo?.id;
      if (!siteId) {
        Alert.alert('Photo Upload', 'This site is missing a site ID, so the photo cannot be attached.');
        return;
      }
      setSaving((prev) => ({ ...prev, [row.uid]: true }));
      await uploadSubcontractorSiteDailyTrackerPhoto(portalUrl, token, {
        siteId,
        recordUid: row.uid,
        caption: photoCaption(row),
        asset: result.assets[0],
      });
      patchLocal(row.uid, { photo_status: 'pending' });
    } catch (error) {
      Alert.alert('Photo Upload Failed', error?.message || 'Unable to attach this photo.');
    } finally {
      setSaving((prev) => ({ ...prev, [row.uid]: false }));
    }
  }

  function handlePhoto(row) {
    Alert.alert('Attach Photo', row.name || 'Site tracker item', [
      { text: 'Camera', onPress: () => pickPhoto(row, 'camera') },
      { text: 'Photo Library', onPress: () => pickPhoto(row, 'library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  return (
    <ScreenShell title="Site Daily Tracker" subtitle={selectedSite || 'Selected project'} onBack={onBack} onHome={onHome}>
      <View style={styles.container}>
        <View style={styles.toolbar}>
          <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search tracker" placeholderTextColor="#8da1b7" />
        </View>
        <StatusFilter value={statusFilter} showCompleted={showCompleted} onSelect={setStatusFilter} onToggleCompleted={() => setShowCompleted((v) => !v)} />
        <View style={styles.statsRow}>
          <View style={styles.statPill}><Text style={styles.statNumber}>{stats.visible}</Text><Text style={styles.statLabel}>Visible</Text></View>
          <View style={styles.statPill}><Text style={styles.statNumber}>{stats.done}</Text><Text style={styles.statLabel}>Done</Text></View>
          <View style={styles.statPill}><Text style={styles.statNumber}>{stats.total}</Text><Text style={styles.statLabel}>Total</Text></View>
        </View>
        {tasks.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            <FilterChip label="All Tasks" active={!taskFilter} onPress={() => setTaskFilter('')} />
            {tasks.map((task) => <FilterChip key={task} label={task} active={taskFilter === task} onPress={() => setTaskFilter(taskFilter === task ? '' : task)} />)}
          </ScrollView>
        ) : null}
        {loading ? (
          <View style={styles.loadingWrap}><ActivityIndicator size="large" color="#8ec5ff" /><Text style={styles.loadingText}>Loading tracker…</Text></View>
        ) : (
          <ScrollView
            contentContainerStyle={[styles.listContent, width >= 700 && styles.listContentWide]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load({ silent: true }); }} tintColor="#fff" />}
            keyboardShouldPersistTaps="handled"
          >
            {visibleRecords.map((row) => (
              <RecordCard key={row.uid} row={row} onStatus={handleStatus} onConnector={handleConnector} onInstalled={handleInstalled} onPhoto={handlePhoto} saving={saving[row.uid]} />
            ))}
            {!visibleRecords.length ? <View style={styles.emptyCard}><Text style={styles.emptyTitle}>No tracker items found</Text><Text style={styles.emptyText}>Try clearing the search or showing completed items.</Text></View> : null}
          </ScrollView>
        )}
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#071524' },
  toolbar: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8 },
  searchInput: { minHeight: 48, borderRadius: 14, paddingHorizontal: 14, color: '#eef6ff', fontSize: 15, fontWeight: '800', backgroundColor: '#102438', borderWidth: 1, borderColor: '#203a55' },
  filterRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 8 },
  statusFilterButton: { flex: 1, minHeight: 54, borderRadius: 14, backgroundColor: '#102438', borderWidth: 1, borderColor: '#274765', paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  filterLabel: { color: '#8db4de', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.7 },
  statusFilterText: { color: '#fff', fontSize: 16, fontWeight: '900', marginTop: 2 },
  chevron: { color: '#8db4de', fontSize: 18, fontWeight: '900' },
  showCompletedButton: { minWidth: 136, borderRadius: 14, backgroundColor: '#111c2a', borderWidth: 1, borderColor: '#34465c', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  showCompletedButtonActive: { backgroundColor: '#dbeafe', borderColor: '#93c5fd' },
  showCompletedText: { color: '#dbeafe', fontSize: 13, fontWeight: '900', textAlign: 'center' },
  showCompletedTextActive: { color: '#0f2a44' },
  statsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 4 },
  statPill: { flex: 1, borderRadius: 13, paddingVertical: 8, backgroundColor: '#0e2032', borderWidth: 1, borderColor: '#203a55', alignItems: 'center' },
  statNumber: { color: '#fff', fontSize: 18, fontWeight: '900' },
  statLabel: { color: '#9fb6cc', fontSize: 11, fontWeight: '800', marginTop: 1 },
  chipsRow: { paddingHorizontal: 14, gap: 8, paddingTop: 6, paddingBottom: 8 },
  filterChip: { maxWidth: 180, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#0e2032', borderWidth: 1, borderColor: '#203a55' },
  filterChipActive: { backgroundColor: '#2563eb', borderColor: '#60a5fa' },
  filterChipText: { color: '#b7c8dc', fontWeight: '900', fontSize: 12 },
  filterChipTextActive: { color: '#fff' },
  listContent: { padding: 14, paddingBottom: 38, gap: 12 },
  listContentWide: { maxWidth: 980, width: '100%', alignSelf: 'center' },
  card: { backgroundColor: '#102438', borderRadius: 18, borderWidth: 1, borderColor: '#203d59', padding: 13, shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardTitleWrap: { flex: 1, minWidth: 0 },
  cardTitle: { color: '#fff', fontSize: 17, lineHeight: 21, fontWeight: '900' },
  cardMeta: { color: '#9fb6cc', fontSize: 12, fontWeight: '800', marginTop: 3 },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#273c59', borderWidth: 1, borderColor: '#46617f' },
  statusPillDone: { backgroundColor: '#dcfce7', borderColor: '#86efac' },
  statusPillText: { color: '#eef6ff', fontSize: 11, fontWeight: '900' },
  statusPillTextDone: { color: '#14532d' },
  metricGrid: { flexDirection: 'row', gap: 8, marginTop: 12 },
  metric: { flex: 1, borderRadius: 13, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#0c1c2d', borderWidth: 1, borderColor: '#1b354f' },
  metricLabel: { color: '#8db4de', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  metricValue: { color: '#fff', fontSize: 18, fontWeight: '900', marginTop: 2 },
  connectorBox: { flex: 1.3, borderRadius: 13, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#0c1c2d', borderWidth: 1, borderColor: '#1b354f' },
  connectorText: { color: '#fff', fontSize: 14, fontWeight: '900', marginTop: 4 },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: '#071524', overflow: 'hidden', marginTop: 12 },
  progressFill: { height: '100%', backgroundColor: '#60a5fa', borderRadius: 999 },
  actionRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 12 },
  qtyBox: { flex: 1 },
  qtyLabel: { color: '#8db4de', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', marginBottom: 5 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#355878', backgroundColor: '#071524' },
  qtyButton: { width: 42, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1d3650' },
  qtyButtonText: { color: '#fff', fontSize: 22, lineHeight: 24, fontWeight: '900' },
  qtyInput: { flex: 1, height: 44, color: '#fff', textAlign: 'center', fontSize: 20, fontWeight: '900', paddingHorizontal: 6 },
  photoButton: { minHeight: 44, borderRadius: 13, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  photoGood: { backgroundColor: '#dcfce7', borderColor: '#86efac' },
  photoBad: { backgroundColor: '#fee2e2', borderColor: '#fca5a5' },
  photoPending: { backgroundColor: '#dbeafe', borderColor: '#93c5fd' },
  photoNone: { backgroundColor: '#253a55', borderColor: '#496480' },
  photoButtonText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  savingText: { color: '#93c5fd', fontWeight: '800', fontSize: 12, marginTop: 8 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#dbeafe', fontWeight: '900' },
  emptyCard: { borderRadius: 18, padding: 18, backgroundColor: '#102438', borderWidth: 1, borderColor: '#203d59', alignItems: 'center' },
  emptyTitle: { color: '#fff', fontSize: 17, fontWeight: '900' },
  emptyText: { color: '#9fb6cc', fontWeight: '700', marginTop: 4, textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '76%', backgroundColor: '#071524', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, borderWidth: 1, borderColor: '#203d59' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 },
  sheetTitle: { color: '#fff', fontSize: 20, fontWeight: '900' },
  sheetClose: { borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: '#1d3650' },
  sheetCloseText: { color: '#fff', fontWeight: '900' },
  optionRow: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, marginTop: 8, backgroundColor: '#102438', borderWidth: 1, borderColor: '#203d59' },
  optionRowActive: { backgroundColor: '#2563eb', borderColor: '#60a5fa' },
  optionText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  optionTextActive: { color: '#fff' },
});

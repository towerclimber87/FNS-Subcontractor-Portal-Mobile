import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  InteractionManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  loadSubcontractorSiteDailyTracker,
  updateSubcontractorSiteDailyTrackerRecord,
  uploadSubcontractorSiteDailyTrackerPhoto,
} from '../api/subcontractorApi';

const t = (value) => value;

const PRIMARY = '#3f51b5';
const PRIMARY_DARK = '#303f9f';
const BG = '#f5f7fa';
const GREEN = '#45d350';
const RED = '#f11637';
const BLUE = '#add8e6';
const GRAY = '#bdbdbd';
const YELLOW = '#ffd54f';
const RADIUS = 6;

const COLS = {
  name: 140,
  task: 140,
  installed: 80,
  status: 110,
  connector: 110,
  jumper: 90,
  design: 80,
  location: 140,
  photo: 78,
};
const TABLE_WIDTH = Object.values(COLS).reduce((a, b) => a + b, 0);

function buildResponsiveTableMetrics(screenWidth, isTablet) {
  if (!isTablet || !screenWidth || screenWidth <= TABLE_WIDTH) {
    return { cols: COLS, tableWidth: TABLE_WIDTH };
  }

  const tableWidth = Math.floor(screenWidth);
  const scale = tableWidth / TABLE_WIDTH;
  const cols = Object.fromEntries(Object.entries(COLS).map(([key, value]) => [key, Math.floor(value * scale)]));
  const roundedWidth = Object.values(cols).reduce((sum, value) => sum + value, 0);
  cols.location += tableWidth - roundedWidth;
  return { cols, tableWidth };
}

function siteName(site) {
  return site?.site_name || site?.name || site?.label || String(site || '');
}

function siteId(site) {
  return site?.site_id || site?.id || site?.siteId || null;
}

function clean(value) {
  return String(value ?? '').trim();
}

function countTypeKey(value) {
  return clean(value || 'singleitem').toLowerCase().replace(/\s+/g, '');
}

function isCompleted(value) {
  return clean(value).toLowerCase() === 'completed';
}

function isBothEnds(value) {
  return clean(value).toLowerCase() === 'both ends';
}

function isJumperTask(value) {
  const t = clean(value).toLowerCase();
  return t === 'jumper' || t === 'changed to jumper';
}

function hasCounts(row) {
  const ct = countTypeKey(row?.count_type_key || row?.count_type);
  return ct === 'cable' || ct === 'severalitems';
}

function isCable(row) {
  return countTypeKey(row?.count_type_key || row?.count_type) === 'cable';
}

function normalizedRecord(row) {
  return {
    ...row,
    uid: row?.uid || row?.record_uid || row?.id,
    id: row?.uid || row?.record_uid || row?.id,
    name: row?.name ?? row?.item_name ?? '',
    item_name: row?.item_name ?? row?.name ?? '',
    task: row?.task || '',
    location: row?.location || '',
    item_status: row?.item_status || 'Not Completed',
    connector_status: row?.connector_status || 'Not Completed',
    installed_amount: Number(row?.installed_amount ?? row?.installed_count ?? 0) || 0,
    design_amount: Number(row?.design_amount ?? row?.design_count ?? 0) || 0,
    count_type_key: row?.count_type_key || countTypeKey(row?.count_type),
    sub: false,
  };
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatNumber(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n - Math.round(n)) < 0.0001) return String(Math.round(n));
  return n.toFixed(2).replace(/\.00$/, '');
}

function rowMatchesSearch(row, q) {
  const needle = clean(q).toLowerCase();
  if (!needle) return false;
  return [row.name, row.task, row.location].some((value) => clean(value).toLowerCase().includes(needle));
}

function shouldAutoHideCompleted(row) {
  if (!isCompleted(row.item_status)) return false;
  if (isCable(row)) return isBothEnds(row.connector_status);
  return true;
}

function fieldDisplay(field) {
  return ({
    item_name: 'Name',
    name: 'Name',
    task: 'Task',
    location: 'Location',
    item_status: 'Status',
    connector_status: 'Connector',
    installed_amount: 'Installed',
    design_amount: 'Design',
  })[field] || String(field || 'Field');
}

function statusStyle(value) {
  return isCompleted(value) ? styles.statusCompleted : styles.statusNotCompleted;
}

function connectorStyle(value) {
  if (value === 'One End') return styles.connOneEnd;
  if (value === 'Both Ends') return styles.connBothEnds;
  return styles.connNotCompleted;
}

function normalizePhotoBase(value) {
  return String(value || '')
    .trim()
    .replace(/\.[^.]+$/g, '')
    .replace(/[^\w\-. ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 160);
}

function toPhotoFilenameBase(row) {
  const parts = [row?.name, row?.task, row?.location]
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  return normalizePhotoBase(parts.join('-')) || 'Photo';
}

function derivePhotoStatus(row, photoStatuses, recentPhotoBases = {}) {
  const base = toPhotoFilenameBase(row);
  if (recentPhotoBases?.[base] || recentPhotoBases?.[base.toLowerCase()]) {
    return { status: 'pending', label: 'Uploaded photo pending review' };
  }
  const meta = photoStatuses?.[base] || photoStatuses?.[base.toLowerCase()] || photoStatuses?.[row?.id] || photoStatuses?.[row?.uid];
  if (meta && typeof meta === 'object') {
    if (!meta.hasAsset && !meta.hasSubcontractor) return { status: 'none', label: 'No photo' };
    const review = clean(meta.review || meta.status || meta.review_status).toLowerCase();
    if (['approved', 'rejected', 'pending', 'in_progress'].includes(review)) {
      return { status: review, label: `${review.replace(/_/g, ' ')} photo` };
    }
    return { status: 'pending', label: 'Photo pending review' };
  }
  const mapped = clean(meta).toLowerCase();
  if (['approved', 'rejected', 'pending', 'in_progress'].includes(mapped)) {
    return { status: mapped, label: `${mapped.replace(/_/g, ' ')} photo` };
  }
  const direct = clean(row?.photo_status).toLowerCase();
  if (['approved', 'rejected', 'pending', 'in_progress'].includes(direct)) {
    return { status: direct, label: `${direct.replace(/_/g, ' ')} photo` };
  }
  return { status: 'none', label: 'No photo' };
}

function photoButtonStyle(status) {
  if (status === 'approved') return styles.photoGreen;
  if (status === 'rejected') return styles.photoRed;
  if (status === 'pending') return styles.photoBlue;
  if (status === 'in_progress') return styles.photoYellow;
  return styles.photoGray;
}

function photoTextStyle(status) {
  return ['approved', 'pending', 'in_progress'].includes(status) ? styles.darkPhotoText : styles.lightPhotoText;
}

function shouldShowHistoryHint(value) {
  const label = clean(value);
  if (!label || label.includes('\n')) return false;
  return label.length <= 18;
}

function photoTypeLabelForRow(row) {
  return isCompleted(row?.item_status) ? 'Final' : 'Construction';
}

export default function SiteDailyTrackerScreen({ session, project, page, onBack, onHome }) {
  const { width } = useWindowDimensions();
  const portalUrl = session?.portalUrl;
  const token = session?.access_token;
  const site = project || {};
  const selectedSiteName = siteName(project);
  const selectedSiteId = siteId(project);
  const isTablet = width >= 768;
  const tableMetrics = useMemo(() => buildResponsiveTableMetrics(width, isTablet), [width, isTablet]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [records, setRecords] = useState([]);
  const [photoStatuses, setPhotoStatuses] = useState({});
  const [recentPhotoBases, setRecentPhotoBases] = useState({});
  const [siteInfo, setSiteInfo] = useState(site || {});
  const [filters, setFilters] = useState({ tasks: [], locations: [] });
  const [techTrackingEnabled, setTechTrackingEnabled] = useState(true);
  const [search, setSearch] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [processingVisibleRows, setProcessingVisibleRows] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('All');
  const [connectorFilter, setConnectorFilter] = useState('');
  const [taskFilter, setTaskFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [editing, setEditing] = useState(false);
  const [cellEditor, setCellEditor] = useState(null);
  const [choiceEditor, setChoiceEditor] = useState(null);
  const [designExceed, setDesignExceed] = useState(null);
  const [historyRow, setHistoryRow] = useState(null);
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [techPrompt, setTechPrompt] = useState(null);
  const [selectedTechs, setSelectedTechs] = useState({});

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!token) return;
    if (!silent) setLoading(true);
    try {
      const payload = await loadSubcontractorSiteDailyTracker(portalUrl, token, selectedSiteName);
      setSiteInfo(payload?.site || site || {});
      setRecords((payload?.records || []).map(normalizedRecord));
      setFilters(payload?.filters || { tasks: [], locations: [] });
      setTechTrackingEnabled(payload?.tech_tracking_enabled !== false);
      setPhotoStatuses(payload?.photo_statuses || payload?.photo_status_by_base || {});
      setRecentPhotoBases({});
    } catch (error) {
      Alert.alert('Site Daily Tracker', error.message || 'Unable to load this site tracker.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [portalUrl, token, selectedSiteName]);

  useEffect(() => { load(); }, [load]);

  const visibleRecords = useMemo(() => records.filter((row) => {
    if (isJumperTask(row.task)) return false;
    if (statusFilter !== 'All' && row.item_status !== statusFilter) return false;
    if (connectorFilter && row.connector_status !== connectorFilter) return false;
    if (taskFilter && row.task !== taskFilter) return false;
    if (locationFilter && row.location !== locationFilter) return false;

    const searchMatch = rowMatchesSearch(row, search);
    if (clean(search) && !searchMatch) return false;
    if (!showCompleted && !searchMatch && shouldAutoHideCompleted(row)) return false;
    return true;
  }), [records, statusFilter, connectorFilter, taskFilter, locationFilter, search, showCompleted]);

  const activeFiltersCount = [statusFilter !== 'All', Boolean(connectorFilter), Boolean(taskFilter), Boolean(locationFilter)].filter(Boolean).length;

  const toggleShowCompleted = useCallback(() => {
    setProcessingVisibleRows(true);

    setTimeout(() => {
      setShowCompleted((v) => !v);

      InteractionManager.runAfterInteractions(() => {
        setTimeout(() => setProcessingVisibleRows(false), 250);
      });
    }, 60);
  }, []);

  function patchLocal(recordId, patch) {
    setRecords((prev) => prev.map((row) => String(row.id) === String(recordId) ? normalizedRecord({ ...row, ...patch }) : row));
  }

  async function persistChange(row, field, value, { promptTech = true, revertChanges = null } = {}) {
    const oldValue = row?.[field];
    if (String(oldValue ?? '') === String(value ?? '')) return null;
    patchLocal(row.id, { [field]: value });
    try {
      const result = await updateSubcontractorSiteDailyTrackerRecord(portalUrl, token, row.uid || row.id, { field, value });
      if (result?.item) patchLocal(row.id, normalizedRecord(result.item));
      if (promptTech) {
        await maybePromptTechTracking(row, field, oldValue, value, revertChanges || [{ recordId: row.id, field, oldValue }]);
      }
      return result;
    } catch (error) {
      patchLocal(row.id, { [field]: oldValue });
      Alert.alert('Update Failed', error.message || 'Unable to save this change.');
      return null;
    }
  }

  async function persistMultiple(row, changes, prompt) {
    const revertChanges = [];
    try {
      for (const change of changes) {
        const oldValue = row?.[change.field];
        revertChanges.push({ recordId: row.id, field: change.field, oldValue });
        patchLocal(row.id, { [change.field]: change.value });
        const result = await updateSubcontractorSiteDailyTrackerRecord(portalUrl, token, row.uid || row.id, { field: change.field, value: change.value });
        if (result?.item) patchLocal(row.id, normalizedRecord(result.item));
      }
      if (prompt) await maybePromptTechTracking(row, prompt.field, prompt.oldValue, prompt.newValue, revertChanges);
    } catch (error) {
      Alert.alert('Update Failed', error.message || 'Unable to save this change.');
      await load({ silent: true });
    }
  }

  async function handleStatus(row, value) {
    if (row.sub) return;
    const changes = [{ field: 'item_status', value }];
    if (value === 'Completed' && hasCounts(row)) {
      changes.push({ field: 'design_amount', value: row.installed_amount });
    }
    await persistMultiple(row, changes, { field: 'item_status', oldValue: row.item_status, newValue: value });
  }

  async function handleConnector(row, value) {
    if (row.sub || !isCable(row)) return;
    await persistChange(row, 'connector_status', value);
  }

  async function beginInstalledChange(row, rawValue) {
    const attempted = Math.max(0, Number(rawValue || 0));
    const design = Math.max(0, Number(row.design_amount || 0));
    if (attempted > design) {
      setDesignExceed({ row, attempted, newDesign: String(attempted) });
      return;
    }
    await persistChange(row, 'installed_amount', attempted);
  }

  async function confirmDesignExceed() {
    const ctx = designExceed;
    if (!ctx) return;
    const newDesign = Math.max(0, Number(ctx.newDesign || 0));
    if (newDesign < ctx.attempted) {
      Alert.alert(t("Design Amount"), t("New design amount must be greater than or equal to the installed amount."));
      return;
    }
    setDesignExceed(null);
    await persistMultiple(ctx.row, [
      { field: 'design_amount', value: newDesign },
      { field: 'installed_amount', value: ctx.attempted },
    ], { field: 'installed_amount', oldValue: ctx.row.installed_amount, newValue: ctx.attempted });
  }

  async function handleJumper(row) {
    if (row.sub || !isCable(row)) return;
    Alert.alert('Confirm Jumper Change', 'Are you sure you want to change this cable to a jumper?', [
      { text: t("Cancel"), style: 'cancel' },
      { text: t("OK"), onPress: () => persistChange(row, 'task', 'Changed To Jumper', { promptTech: false }) },
    ]);
  }

  function photoCategoryForRow(row) {
    return isCompleted(row?.item_status) ? 'final' : 'construction';
  }

  function photoCaptionForRow(row) {
    return [row?.name, row?.task, row?.location].map((part) => clean(part)).filter(Boolean).join(' — ');
  }


  async function handlePhoto(row) {
    const sid = siteInfo?.site_id || siteInfo?.id || selectedSiteId;
    if (!sid) {
      Alert.alert(t("Photo Upload"), t("This site is missing a site ID, so the photo cannot be attached."));
      return;
    }

    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission?.granted) {
        Alert.alert(t("Camera Permission Needed"), t("Camera access is required to take Site Tracker photos."));
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.85,
        exif: false,
      });

      if (result?.canceled || !result?.assets?.length) return;

      const asset = result.assets[0];
      const base = toPhotoFilenameBase(row);
      setRecentPhotoBases((prev) => ({ ...prev, [base]: true, [base.toLowerCase()]: true }));

      await uploadSubcontractorSiteDailyTrackerPhoto(portalUrl, token, {
        siteId: sid,
        recordUid: row.uid || row.id,
        caption: photoCaptionForRow(row),
        asset,
      });

      patchLocal(row.id, { photo_status: 'pending' });
      await load({ silent: true });
    } catch (error) {
      Alert.alert('Photo Upload Failed', error?.message || 'Unable to take or upload this photo.');
    }
  }


  async function maybePromptTechTracking() { return; }

  async function cancelTechPrompt() {
    const ctx = techPrompt;
    setTechPrompt(null);
    setSelectedTechs({});

    if (!ctx?.revertChanges?.length) return;

    try {
      for (const change of ctx.revertChanges) {
        patchLocal(change.recordId, { [change.field]: change.oldValue });
        await updateSubcontractorSiteDailyTrackerRecord(portalUrl, token, change.recordId, { field: change.field, value: change.oldValue });
      }
      await load({ silent: true });
    } catch (error) {
      Alert.alert('Undo Failed', error.message || 'Unable to undo that change. Please refresh the page.');
    }
  }

  async function submitTechPrompt() {
    setTechPrompt(null);
    setSelectedTechs({});
  }

  async function openHistory(row) {
    setHistoryRow(row);
    setHistoryItems([]);
    setHistoryLoading(false);
  }

  function clearFilters() {
    setStatusFilter('All');
    setConnectorFilter('');
    setTaskFilter('');
    setLocationFilter('');
    setSearch('');
  }

  function startEdit(row, field, title, keyboard = 'default') {
    if (row.sub) return;
    setCellEditor({ row, field, title, value: String(row?.[field] ?? ''), keyboard });
  }

  function saveCellEditor() {
    const ctx = cellEditor;
    if (!ctx) return;
    setCellEditor(null);
    if (ctx.field === 'installed_amount') beginInstalledChange(ctx.row, ctx.value);
    else if (ctx.field === 'design_amount') persistChange(ctx.row, ctx.field, Math.max(0, Number(ctx.value || 0)), { promptTech: false });
    else persistChange(ctx.row, ctx.field, ctx.value, { promptTech: false });
  }

  if (loading) {
    return (
      <View style={styles.loadingPage}>
        <ActivityIndicator size="large" color={PRIMARY} />
        <Text style={styles.loadingText}>{t("Loading Page…")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea}>
        <Header siteName={siteInfo?.site_name || selectedSiteName} userName={session?.employee?.friendly_name || session?.employee?.name || session?.employee?.email || ''} onBack={onBack} onRefresh={() => load()} isTablet={isTablet} />

        <View style={[styles.controls, isTablet ? styles.controlsTablet : styles.controlsMobile]}> 
          <TextInput
            style={[styles.nameSearch, !isTablet && styles.nameSearchMobile]}
            value={search}
            onChangeText={setSearch}
            placeholder={t("Search Name…")}
            placeholderTextColor="#64748b"
            autoCapitalize="none"
          />
          <View style={styles.controlsRight}>
            <Pressable style={[styles.btn, !isTablet && styles.btnMobile, styles.showCompletedBtn, !isTablet && styles.showCompletedBtnMobile, showCompleted && styles.showCompletedActive]} onPress={toggleShowCompleted}>
              <Text style={styles.showCompletedText}>{showCompleted ? 'Hide\nCompleted' : 'Show\nCompleted'}</Text>
            </Pressable>
            <Pressable style={[styles.btn, !isTablet && styles.btnMobile]} onPress={() => setFiltersOpen(true)}>
              <Text style={styles.btnText}>Filters{activeFiltersCount ? ` (${activeFiltersCount})` : ''}</Text>
            </Pressable>
            <Pressable style={[styles.btn, !isTablet && styles.btnMobile]} onPress={() => setEditing((v) => !v)}>
              <Text style={styles.btnText}>{editing ? 'Save' : 'Edit'}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.mainScroll}>
          <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableWrapper} bounces={false} overScrollMode="never" directionalLockEnabled scrollEventThrottle={16} removeClippedSubviews={false}>
            <View style={[styles.table, { width: tableMetrics.tableWidth }]}> 
              <TableHeader cols={tableMetrics.cols} compact={!isTablet} />
              <ScrollView
                style={styles.rowsScroll}
                bounces={false}
                overScrollMode="never"
                nestedScrollEnabled
                scrollEventThrottle={16}
                removeClippedSubviews={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load({ silent: true }); }} tintColor={PRIMARY} />}
              >
                {visibleRecords.length ? visibleRecords.map((row, index) => (
                  <TableRow
                    key={row.id}
                    row={row}
                    index={index}
                    editing={editing}
                    photoStatuses={photoStatuses}
                    recentPhotoBases={recentPhotoBases}
                    cols={tableMetrics.cols}
                    compact={!isTablet}
                    onHistory={() => openHistory(row)}
                    onEdit={startEdit}
                    onStatus={() => !row.sub && setChoiceEditor({ title: 'Status', row, field: 'item_status', value: row.item_status, options: ['Not Completed', 'Completed'], onChoose: handleStatus })}
                    onConnector={() => !row.sub && isCable(row) && setChoiceEditor({ title: 'Connector Status', row, field: 'connector_status', value: row.connector_status, options: ['Not Completed', 'One End', 'Both Ends'], onChoose: handleConnector })}
                    onJumper={() => handleJumper(row)}
                    onPhoto={() => handlePhoto(row)}
                  />
                )) : (
                  <View style={[styles.emptyRow, { width: tableMetrics.tableWidth }]}><Text style={styles.emptyText}>{t("No matching tracker items.")}</Text></View>
                )}
              </ScrollView>
            </View>
          </ScrollView>
        </View>

        <FiltersModal
          visible={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          connectorFilter={connectorFilter}
          setConnectorFilter={setConnectorFilter}
          taskFilter={taskFilter}
          setTaskFilter={setTaskFilter}
          locationFilter={locationFilter}
          setLocationFilter={setLocationFilter}
          tasks={filters.tasks || []}
          locations={filters.locations || []}
          onClear={clearFilters}
        />
        <CellEditModal context={cellEditor} setContext={setCellEditor} onCancel={() => setCellEditor(null)} onSave={saveCellEditor} />
        <ChoiceModal context={choiceEditor} onClose={() => setChoiceEditor(null)} />
        <DesignExceedModal context={designExceed} setContext={setDesignExceed} onCancel={() => setDesignExceed(null)} onConfirm={confirmDesignExceed} />
        <HistoryModal visible={Boolean(historyRow)} row={historyRow} items={historyItems} loading={historyLoading} onClose={() => setHistoryRow(null)} />
        <TechTrackingModal visible={Boolean(techPrompt)} context={techPrompt} selectedTechs={selectedTechs} setSelectedTechs={setSelectedTechs} onCancel={cancelTechPrompt} onSubmit={submitTechPrompt} />
        <ProcessingOverlay visible={processingVisibleRows} />
      </SafeAreaView>
    </View>
  );
}

function Header({ siteName: title, userName, onBack, onRefresh, isTablet }) {
  return (
    <View style={[styles.header, !isTablet && styles.headerMobile]}>
      <View style={styles.headerTitleBlock}>
        <Text style={styles.headerSite} numberOfLines={1}>{title || 'Site Tracker'}</Text>
        {!!userName && <Text style={styles.headerUser} numberOfLines={1}>{userName}</Text>}
      </View>
      <View style={[styles.headerRight, !isTablet && styles.headerRightMobile]}>
        <Pressable style={[styles.headerButton, !isTablet && styles.headerButtonMobile]} onPress={onRefresh}><Text style={styles.headerButtonText}>{t("Refresh")}</Text></Pressable>
        <Pressable style={[styles.headerButton, !isTablet && styles.headerButtonMobile]} onPress={onBack}><Text style={styles.headerButtonText}>{t("Back")}</Text></Pressable>
      </View>
    </View>
  );
}

function TableHeader({ cols, compact }) {
  const columns = [
    ['Name', cols.name, styles.nameCol],
    ['Task', cols.task, styles.taskCol],
    ['Installed', cols.installed, styles.centerText],
    ['Status', cols.status, styles.centerText],
    ['Connector', cols.connector, styles.centerText],
    ['Jumper', cols.jumper, styles.centerText],
    ['Design', cols.design, styles.centerText],
    ['Location', cols.location, styles.locationCol],
    ['Photo', cols.photo, styles.centerText],
  ];
  return (
    <View style={styles.tableHeader}>
      {columns.map(([label, width, extra]) => (
        <View key={label} style={[styles.th, compact && styles.thCompact, { width }, extra]}><Text style={styles.thText}>{label}</Text></View>
      ))}
    </View>
  );
}

function TableRow({ row, index, editing, photoStatuses, recentPhotoBases, cols, compact, onHistory, onEdit, onStatus, onConnector, onJumper, onPhoto }) {
  const locked = Boolean(row.sub);
  const rowStyle = [styles.tr, compact && styles.trCompact, index % 2 === 1 && styles.trEven, locked && styles.lockedRow];
  const photoState = derivePhotoStatus(row, photoStatuses, recentPhotoBases);
  return (
    <View style={rowStyle}>
      <Pressable style={[styles.td, compact && styles.tdCompact, styles.nameCell, { width: cols.name }]} onLongPress={onHistory} delayLongPress={400} onPress={editing && !locked ? () => onEdit(row, 'item_name', 'Name') : undefined}>
        <Text style={styles.boldCell}>{row.name}</Text>
      </Pressable>
      <Pressable style={[styles.td, compact && styles.tdCompact, { width: cols.task }]} onPress={editing && !locked ? () => onEdit(row, 'task', 'Task') : undefined}>
        <Text style={styles.boldCell}>{row.task}</Text>
      </Pressable>
      <Pressable style={[styles.td, compact && styles.tdCompact, styles.centerCell, { width: cols.installed }]} onPress={!locked && hasCounts(row) ? () => onEdit(row, 'installed_amount', 'Installed', 'numeric') : undefined}>
        {hasCounts(row) ? <TextInputPointer value={formatNumber(row.installed_amount)} /> : null}
      </Pressable>
      <Pressable style={[styles.td, compact && styles.tdCompact, styles.centerCell, { width: cols.status }]} onPress={onStatus}>
        <View style={[styles.selectPill, statusStyle(row.item_status)]}><Text style={[styles.selectText, isCompleted(row.item_status) && styles.darkSelectText]}>{row.item_status}</Text></View>
      </Pressable>
      <Pressable style={[styles.td, compact && styles.tdCompact, styles.centerCell, { width: cols.connector }]} onPress={onConnector}>
        {isCable(row) ? <View style={[styles.selectPill, connectorStyle(row.connector_status)]}><Text style={[styles.selectText, row.connector_status !== 'Not Completed' && styles.darkSelectText]}>{row.connector_status}</Text></View> : null}
      </Pressable>
      <View style={[styles.td, compact && styles.tdCompact, styles.centerCell, { width: cols.jumper }]}> 
        {isCable(row) ? <Pressable style={[styles.jumperBtn, locked && styles.disabledControl]} onPress={onJumper}><Text style={styles.jumperText}>{t("Jumper")}</Text></Pressable> : null}
      </View>
      <Pressable style={[styles.td, compact && styles.tdCompact, styles.centerCell, { width: cols.design }]} onPress={editing && !locked && hasCounts(row) ? () => onEdit(row, 'design_amount', 'Design', 'numeric') : undefined}>
        {hasCounts(row) ? <TextInputPointer value={formatNumber(row.design_amount)} muted={!editing} /> : null}
      </Pressable>
      <Pressable style={[styles.td, compact && styles.tdCompact, { width: cols.location }]} onPress={editing && !locked ? () => onEdit(row, 'location', 'Location') : undefined}>
        <Text style={styles.boldCell}>{row.location}</Text>
      </Pressable>
      <View style={[styles.td, compact && styles.tdCompact, styles.centerCell, { width: cols.photo }]}> 
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${photoState.label} (${photoTypeLabelForRow(row)} photo)`}
          disabled={locked}
          onPress={onPhoto}
          style={[styles.photoBtn, photoButtonStyle(photoState.status), locked && styles.disabledControl]}
        >
          <Text style={[styles.photoText, photoTextStyle(photoState.status)]}>📷</Text>
        </Pressable>
        <Text style={styles.photoTypeText}>{photoTypeLabelForRow(row)}</Text>
      </View>
    </View>
  );
}

function TextInputPointer({ value, muted }) {
  return <View style={[styles.numberBox, muted && styles.numberBoxMuted]}><Text style={styles.numberText}>{value}</Text></View>;
}

function ProcessingOverlay({ visible }) {
  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.processingBackdrop}>
        <View style={styles.processingBox}>
          <ActivityIndicator size="large" color={PRIMARY} />
          <Text style={styles.processingTitle}>{t("Processing…")}</Text>
          <Text style={styles.processingText}>{t("Updating the tracker list.")}</Text>
        </View>
      </View>
    </Modal>
  );
}

function SelectButton({ label, selected, onPress }) {
  return (
    <Pressable style={[styles.optionRow, selected && styles.optionRowSelected]} onPress={onPress}>
      <View style={[styles.checkbox, selected && styles.checkboxSelected]}>{selected && <Text style={styles.checkText}>✓</Text>}</View>
      <Text style={styles.optionText}>{label || 'Blank'}</Text>
    </Pressable>
  );
}

function ChoiceOptionButton({ label, selected, kind, onPress }) {
  const swatchStyle = kind === 'connector_status' ? connectorStyle(label) : statusStyle(label);
  return (
    <Pressable style={[styles.choiceOption, selected && styles.choiceOptionSelected]} onPress={onPress}>
      <View style={[styles.choiceSwatch, swatchStyle]} />
      <View style={styles.choiceTextBlock}>
        <Text style={styles.choiceLabel}>{label}</Text>
        {selected && <Text style={styles.choiceSelectedText}>{t("Current selection")}</Text>}
      </View>
      {selected && <View style={styles.choiceCheck}><Text style={styles.choiceCheckText}>✓</Text></View>}
    </Pressable>
  );
}

function FiltersModal(props) {
  const {
    visible, onClose, statusFilter, setStatusFilter, connectorFilter, setConnectorFilter,
    taskFilter, setTaskFilter, locationFilter, setLocationFilter, tasks, locations, onClear,
  } = props;
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>{t("Advanced Filters")}</Text>
          <ScrollView style={styles.modalScroll}>
            <FilterSection title={t("Status")}>
              {['All', 'Completed', 'Not Completed'].map((v) => <SelectButton key={v} label={v === 'All' ? 'All Statuses' : v} selected={statusFilter === v} onPress={() => setStatusFilter(v)} />)}
            </FilterSection>
            <FilterSection title={t("Connector Status")}>
              {['', 'Not Completed', 'One End', 'Both Ends'].map((v) => <SelectButton key={v || 'all'} label={v || 'All'} selected={connectorFilter === v} onPress={() => setConnectorFilter(v)} />)}
            </FilterSection>
            <FilterSection title={t("Task")}>
              <SelectButton label={t("All Tasks")} selected={!taskFilter} onPress={() => setTaskFilter('')} />
              {tasks.map((v) => <SelectButton key={v} label={v} selected={taskFilter === v} onPress={() => setTaskFilter(v)} />)}
            </FilterSection>
            <FilterSection title={t("Location")}>
              <SelectButton label={t("All Locations")} selected={!locationFilter} onPress={() => setLocationFilter('')} />
              {locations.map((v) => <SelectButton key={v} label={v} selected={locationFilter === v} onPress={() => setLocationFilter(v)} />)}
            </FilterSection>
          </ScrollView>
          <View style={styles.modalActions}>
            <Pressable style={[styles.modalBtn, styles.primaryModalBtn]} onPress={onClose}><Text style={styles.primaryModalText}>{t("Apply")}</Text></Pressable>
            <Pressable style={styles.modalBtn} onPress={onClear}><Text style={styles.secondaryModalText}>{t("Clear")}</Text></Pressable>
            <Pressable style={styles.modalBtn} onPress={onClose}><Text style={styles.secondaryModalText}>{t("Cancel")}</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function FilterSection({ title, children }) {
  return <View style={styles.filterSection}><Text style={styles.filterLabel}>{title}</Text>{children}</View>;
}

function CellEditModal({ context, setContext, onCancel, onSave }) {
  if (!context) return null;
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBackdrop}>
        <View style={styles.smallModalContent}>
          <Text style={styles.modalTitle}>{context.title}</Text>
          <TextInput
            style={styles.editInput}
            value={context.value}
            onChangeText={(value) => setContext({ ...context, value })}
            keyboardType={context.keyboard === 'numeric' ? 'numeric' : 'default'}
            autoFocus
            selectTextOnFocus
          />
          <View style={styles.modalActions}>
            <Pressable style={[styles.modalBtn, styles.primaryModalBtn]} onPress={onSave}><Text style={styles.primaryModalText}>{t("Save")}</Text></Pressable>
            <Pressable style={styles.modalBtn} onPress={onCancel}><Text style={styles.secondaryModalText}>{t("Cancel")}</Text></Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ChoiceModal({ context, onClose }) {
  if (!context) return null;
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.smallModalContent}>
          <Text style={styles.modalTitle}>{context.title}</Text>
          <View style={styles.choiceGrid}>
            {context.options.map((option) => (
              <ChoiceOptionButton
                key={option}
                label={option}
                selected={context.value === option}
                kind={context.field}
                onPress={() => {
                  onClose();
                  context.onChoose(context.row, option);
                }}
              />
            ))}
          </View>
          <View style={styles.modalActions}><Pressable style={styles.modalBtn} onPress={onClose}><Text style={styles.secondaryModalText}>{t("Cancel")}</Text></Pressable></View>
        </View>
      </View>
    </Modal>
  );
}

function DesignExceedModal({ context, setContext, onCancel, onConfirm }) {
  if (!context) return null;
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBackdrop}>
        <View style={styles.smallModalContent}>
          <Text style={styles.modalTitle}>{t("Installed exceeds design")}</Text>
          <Text style={styles.modalText}>Installed is {formatNumber(context.attempted)}. Enter a new design amount to continue.</Text>
          <TextInput style={styles.editInput} keyboardType="numeric" value={context.newDesign} onChangeText={(value) => setContext({ ...context, newDesign: value })} autoFocus selectTextOnFocus />
          <View style={styles.modalActions}>
            <Pressable style={[styles.modalBtn, styles.primaryModalBtn]} onPress={onConfirm}><Text style={styles.primaryModalText}>{t("OK")}</Text></Pressable>
            <Pressable style={styles.modalBtn} onPress={onCancel}><Text style={styles.secondaryModalText}>{t("Cancel")}</Text></Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function HistoryModal({ visible, row, items, loading, onClose }) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.historyBackdrop}>
        <View style={styles.historySheet}>
          <View style={styles.grabber} />
          <Text style={styles.modalTitle}>Record History <Text style={styles.modalSubTitle}>{row?.name || ''}</Text></Text>
          {loading ? <ActivityIndicator color={PRIMARY} /> : (
            <ScrollView style={styles.modalScroll}>
              {items.length ? items.map((item) => (
                <View key={item.id || `${item.timestamp}-${item.field_updated}`} style={styles.historyItem}>
                  <Text style={styles.historyWhen}>{item.timestamp ? new Date(item.timestamp).toLocaleString() : ''}</Text>
                  <Text style={styles.historyWho}>{item.user_email || ''}</Text>
                  <Text style={styles.historyField}>{fieldDisplay(item.field_updated)}</Text>
                  <Text style={styles.historyOldNew}>{String(item.old_value ?? '')}  →  {String(item.new_value ?? '')}</Text>
                </View>
              )) : <Text style={styles.modalText}>{t("No history found for this record.")}</Text>}
            </ScrollView>
          )}
          <View style={styles.modalActions}><Pressable style={styles.modalBtn} onPress={onClose}><Text style={styles.secondaryModalText}>{t("Close")}</Text></Pressable></View>
        </View>
      </View>
    </Modal>
  );
}

function TechTrackingModal({ visible, context, selectedTechs, setSelectedTechs, onCancel, onSubmit }) {
  const employees = context?.employees || [];
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.smallModalContent}>
          <Text style={styles.modalTitle}>{t("Select Techs")}</Text>
          <Text style={styles.modalText}>{t("Select the employee(s) responsible for this update.")}</Text>
          <ScrollView style={styles.techList}>
            {employees.length ? employees.map((emp, idx) => {
              const name = clean(emp?.employee_name || emp?.name || emp) || `Employee ${idx + 1}`;
              return <SelectButton key={`${name}-${idx}`} label={name} selected={Boolean(selectedTechs[name])} onPress={() => setSelectedTechs((prev) => ({ ...prev, [name]: !prev[name] }))} />;
            }) : <Text style={styles.modalText}>{t("No clocked-in on-site employees were found for today.")}</Text>}
          </ScrollView>
          <View style={styles.modalActions}>
            <Pressable style={[styles.modalBtn, styles.primaryModalBtn]} onPress={onSubmit}><Text style={styles.primaryModalText}>{t("Submit")}</Text></Pressable>
            <Pressable style={styles.modalBtn} onPress={onCancel}><Text style={styles.secondaryModalText}>{t("Cancel / Undo")}</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: BG },
  safeArea: { flex: 1, backgroundColor: BG },
  loadingPage: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
  loadingText: { marginTop: 12, color: '#333', fontWeight: '500' },
  header: {
    minHeight: 54,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    zIndex: 3,
  },
  headerMobile: { minHeight: 48, paddingHorizontal: 8, paddingVertical: 5 },
  headerTitleBlock: { flex: 1, paddingRight: 8 },
  headerSite: { fontSize: 13, fontWeight: '500', color: '#111827' },
  headerUser: { fontSize: 12, fontWeight: '500', color: '#475569', marginTop: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerRightMobile: { gap: 6 },
  headerButton: { backgroundColor: PRIMARY, paddingHorizontal: 14, paddingVertical: 10, minHeight: 40, borderRadius: RADIUS, borderWidth: 1, borderColor: PRIMARY_DARK, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  headerButtonMobile: { paddingHorizontal: 11, paddingVertical: 7, minHeight: 34 },
  headerButtonText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 10 },
  controlsTablet: { marginHorizontal: 18 },
  controlsMobile: { marginHorizontal: 6, marginTop: 8, marginBottom: 6, gap: 6 },
  nameSearch: { width: 150, maxWidth: 150, minHeight: 40, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff', borderRadius: RADIUS, paddingHorizontal: 10, fontSize: 13, color: '#111827' },
  nameSearchMobile: { width: 122, maxWidth: 122, minHeight: 36, paddingHorizontal: 8 },
  controlsRight: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  btn: { backgroundColor: PRIMARY, borderRadius: RADIUS, paddingHorizontal: 13, paddingVertical: 10, minHeight: 40, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  btnMobile: { paddingHorizontal: 10, paddingVertical: 7, minHeight: 36 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 12 },
  showCompletedBtn: { backgroundColor: '#22c55e', borderWidth: 1, borderColor: '#16a34a', width: 106, minWidth: 106, maxWidth: 106, paddingHorizontal: 7, paddingVertical: 6 },
  showCompletedBtnMobile: { width: 96, minWidth: 96, maxWidth: 96, paddingHorizontal: 5, paddingVertical: 4 },
  showCompletedActive: { backgroundColor: '#15803d', borderColor: '#166534' },
  showCompletedText: { color: '#fff', fontSize: 11, fontWeight: '800', textAlign: 'center', lineHeight: 13 },
  mainScroll: { flex: 1 },
  rowsScroll: { flex: 1 },
  tableWrapper: { flex: 1, margin: 0, padding: 0 },
  table: { flex: 1, backgroundColor: '#fff', marginBottom: 0, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  tableHeader: { flexDirection: 'row', backgroundColor: '#e8eaf6', zIndex: 10, elevation: 4 },
  th: { paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', justifyContent: 'center' },
  thCompact: { paddingHorizontal: 5, paddingVertical: 6 },
  thText: { fontSize: 12, fontWeight: '700', color: '#111827', textTransform: 'capitalize' },
  tr: { flexDirection: 'row', minHeight: 46, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee', overflow: 'hidden' },
  trCompact: { minHeight: 42 },
  trEven: { backgroundColor: '#fafafa' },
  lockedRow: { opacity: 0.72, backgroundColor: '#f3f4f6' },
  td: { paddingHorizontal: 8, paddingVertical: 6, justifyContent: 'center' },
  tdCompact: { paddingHorizontal: 5, paddingVertical: 4 },
  centerCell: { alignItems: 'center' },
  centerText: { alignItems: 'center' },
  nameCell: { alignItems: 'flex-start' },
  nameCol: {},
  taskCol: {},
  locationCol: {},
  boldCell: { fontSize: 12, fontWeight: '700', color: '#111827', lineHeight: 15 },
  historyHintText: { marginTop: 2, color: RED, fontSize: 9, lineHeight: 11, fontWeight: '800' },
  numberBox: { width: '100%', minHeight: 30, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff', borderRadius: RADIUS, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  numberBoxMuted: { backgroundColor: '#f8fafc' },
  numberText: { fontSize: 12, color: '#111827', fontWeight: '500' },
  selectPill: { width: '100%', minHeight: 32, borderRadius: RADIUS, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  selectText: { color: '#fff', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  darkSelectText: { color: '#000' },
  statusCompleted: { backgroundColor: GREEN },
  statusNotCompleted: { backgroundColor: RED },
  connNotCompleted: { backgroundColor: RED },
  connOneEnd: { backgroundColor: BLUE },
  connBothEnds: { backgroundColor: GREEN },
  jumperBtn: { backgroundColor: '#2196f3', borderRadius: RADIUS, paddingHorizontal: 9, paddingVertical: 8 },
  jumperText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  photoBtn: { width: 42, height: 28, borderRadius: RADIUS, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,.08)' },
  photoGray: { backgroundColor: GRAY },
  photoBlue: { backgroundColor: '#2196f3' },
  photoGreen: { backgroundColor: GREEN },
  photoRed: { backgroundColor: RED },
  photoYellow: { backgroundColor: YELLOW },
  photoText: { fontSize: 14 },
  photoTypeText: { marginTop: 2, color: RED, fontSize: 8.5, lineHeight: 10, fontWeight: '900', textAlign: 'center' },
  darkPhotoText: { color: '#000' },
  lightPhotoText: { color: '#fff' },
  disabledControl: { opacity: 0.45 },
  emptyRow: { padding: 18, alignItems: 'center' },
  emptyText: { color: '#64748b', fontWeight: '600' },
  processingBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.22)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  processingBox: { minWidth: 190, borderRadius: 16, backgroundColor: '#fff', paddingVertical: 22, paddingHorizontal: 20, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  processingTitle: { marginTop: 12, color: '#111827', fontSize: 16, fontWeight: '800' },
  processingText: { marginTop: 4, color: '#64748b', fontSize: 12, fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.4)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalContent: { backgroundColor: '#fff', borderRadius: RADIUS, width: '92%', maxWidth: 600, maxHeight: '86%', padding: 18 },
  smallModalContent: { backgroundColor: '#fff', borderRadius: 14, width: '92%', maxWidth: 520, maxHeight: '86%', padding: 18 },
  modalTitle: { color: '#111827', fontSize: 18, fontWeight: '700', marginBottom: 10 },
  modalSubTitle: { color: '#64748b', fontSize: 12, fontWeight: '500' },
  modalText: { color: '#475569', fontSize: 13, lineHeight: 18, marginBottom: 10 },
  modalScroll: { maxHeight: 460 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  modalBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: RADIUS, borderWidth: 1, borderColor: PRIMARY, backgroundColor: 'transparent' },
  primaryModalBtn: { backgroundColor: PRIMARY },
  primaryModalText: { color: '#fff', fontWeight: '700' },
  secondaryModalText: { color: PRIMARY, fontWeight: '700' },
  filterSection: { marginBottom: 14 },
  filterLabel: { color: '#111827', fontSize: 14, fontWeight: '700', marginBottom: 6 },
  optionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 8, borderRadius: RADIUS },
  optionRowSelected: { backgroundColor: 'rgba(63,81,181,.06)' },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1, borderColor: '#94a3b8', marginRight: 10, alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  checkText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  optionText: { flex: 1, color: '#111827', fontWeight: '500' },
  choiceGrid: { gap: 10, marginTop: 4 },
  choiceOption: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc' },
  choiceOptionSelected: { borderColor: PRIMARY, backgroundColor: 'rgba(63,81,181,.08)' },
  choiceSwatch: { width: 16, height: 34, borderRadius: 999, marginRight: 12 },
  choiceTextBlock: { flex: 1 },
  choiceLabel: { color: '#111827', fontSize: 15, fontWeight: '800' },
  choiceSelectedText: { color: PRIMARY, fontSize: 11, fontWeight: '700', marginTop: 2 },
  choiceCheck: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: PRIMARY },
  choiceCheckText: { color: '#fff', fontWeight: '900', fontSize: 14 },
  editInput: { minHeight: 44, borderWidth: 1, borderColor: '#9fb3ff', backgroundColor: '#f8fafc', borderRadius: RADIUS, paddingHorizontal: 12, color: '#111827', fontSize: 16 },
  historyBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.35)', justifyContent: 'center', paddingHorizontal: 14, paddingTop: 58, paddingBottom: 24 },
  historySheet: { backgroundColor: '#fff', borderRadius: 14, padding: 16, maxHeight: '72%', width: '100%', maxWidth: 620, alignSelf: 'center' },
  grabber: { width: 38, height: 4, borderRadius: 999, backgroundColor: '#e5e7eb', alignSelf: 'center', marginBottom: 10 },
  historyItem: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, backgroundColor: '#fbfdff', padding: 10, marginVertical: 5 },
  historyWhen: { color: '#64748b', fontSize: 12, marginBottom: 3 },
  historyWho: { color: '#111827', fontSize: 12, fontWeight: '600' },
  historyField: { color: '#111827', fontSize: 13, fontWeight: '700', marginTop: 5 },
  historyOldNew: { color: '#334155', fontSize: 13, marginTop: 3 },
  techList: { maxHeight: 340, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, marginTop: 8 },
});

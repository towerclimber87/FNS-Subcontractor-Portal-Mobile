import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

const PRIMARY = '#3f51b5';
const PRIMARY_DARK = '#303f9f';
const BG = '#f5f7fa';
const GREEN = '#45d350';
const RED = '#f11637';
const BLUE = '#add8e6';
const GRAY = '#bdbdbd';
const YELLOW = '#ffd54f';

const COLS = {
  name: 150,
  task: 140,
  installed: 82,
  status: 116,
  connector: 116,
  design: 80,
  remaining: 92,
  location: 150,
  photo: 78,
};
const TABLE_WIDTH = Object.values(COLS).reduce((a, b) => a + b, 0);

function buildResponsiveTableMetrics(screenWidth, isTablet) {
  if (!isTablet || !screenWidth || screenWidth <= TABLE_WIDTH) return { cols: COLS, tableWidth: TABLE_WIDTH };
  const tableWidth = Math.floor(screenWidth);
  const scale = tableWidth / TABLE_WIDTH;
  const cols = Object.fromEntries(Object.entries(COLS).map(([key, value]) => [key, Math.floor(value * scale)]));
  const roundedWidth = Object.values(cols).reduce((sum, value) => sum + value, 0);
  cols.location += tableWidth - roundedWidth;
  return { cols, tableWidth };
}

function clean(value) { return String(value ?? '').trim(); }
function siteName(site) { return clean(site?.site_name || site?.name || site?.label || site); }
function countTypeKey(value) { return clean(value || 'singleitem').toLowerCase().replace(/\s+/g, ''); }
function isCable(row) { return countTypeKey(row?.count_type_key || row?.count_type) === 'cable'; }
function hasCounts(row) { return ['cable', 'severalitems'].includes(countTypeKey(row?.count_type_key || row?.count_type)); }
function isCompleted(value) { return clean(value).toLowerCase() === 'completed'; }
function isBothEnds(value) { return clean(value).toLowerCase() === 'both ends'; }
function shouldAutoHideCompleted(row) { return isCompleted(row.item_status) && (!isCable(row) || isBothEnds(row.connector_status)); }
function normalizeRecord(row) {
  const installed = Number(row?.installed_amount ?? row?.installed_count ?? 0) || 0;
  const design = Number(row?.design_amount ?? row?.design_count ?? 0) || 0;
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
    installed_amount: installed,
    installed_count: installed,
    design_amount: design,
    design_count: design,
    remaining_amount: Math.max(0, design - installed),
    photo_status: clean(row?.photo_status || 'none'),
    sub: Boolean(row?.sub),
  };
}
function formatNumber(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n - Math.round(n)) < 0.0001) return String(Math.round(n));
  return n.toFixed(2).replace(/\.00$/, '').replace(/0+$/, '').replace(/\.$/, '');
}
function rowMatchesSearch(row, q) {
  const needle = clean(q).toLowerCase();
  if (!needle) return true;
  return [row.name, row.task, row.location].some((value) => clean(value).toLowerCase().includes(needle));
}
function statusStyle(value) { return isCompleted(value) ? styles.statusCompleted : styles.statusNotCompleted; }
function connectorStyle(value) {
  if (value === 'One End') return styles.connOneEnd;
  if (value === 'Both Ends') return styles.connBothEnds;
  return styles.connNotCompleted;
}
function photoTypeLabelForRow(row) { return isCompleted(row?.item_status) ? 'Final' : 'Construction'; }
function photoButtonStyle(status) {
  const s = clean(status).toLowerCase();
  if (s === 'approved') return styles.photoGreen;
  if (s === 'rejected') return styles.photoRed;
  if (s === 'pending') return styles.photoBlue;
  if (s === 'in_progress') return styles.photoYellow;
  return styles.photoGray;
}
function photoTextStyle(status) { return ['approved', 'pending', 'in_progress'].includes(clean(status).toLowerCase()) ? styles.darkPhotoText : styles.lightPhotoText; }
function photoCaption(row) { return [row?.name, row?.task, row?.location].map(clean).filter(Boolean).join(' — '); }

export default function SiteDailyTrackerScreen({ session, project, onBack, onHome }) {
  const { width } = useWindowDimensions();
  const portalUrl = session?.portalUrl;
  const token = session?.access_token || session?.accessToken;
  const selectedSiteName = siteName(project);
  const isTablet = width >= 768;
  const tableMetrics = useMemo(() => buildResponsiveTableMetrics(width, isTablet), [width, isTablet]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [records, setRecords] = useState([]);
  const [siteInfo, setSiteInfo] = useState(project || {});
  const [filters, setFilters] = useState({ tasks: [], locations: [] });
  const [search, setSearch] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('All');
  const [connectorFilter, setConnectorFilter] = useState('');
  const [taskFilter, setTaskFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [editing, setEditing] = useState(false);
  const [cellEditor, setCellEditor] = useState(null);
  const [choiceEditor, setChoiceEditor] = useState(null);
  const [designExceed, setDesignExceed] = useState(null);
  const [saving, setSaving] = useState({});

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!portalUrl || !token || !selectedSiteName) return;
    if (!silent) setLoading(true);
    try {
      const payload = await loadSubcontractorSiteDailyTracker(portalUrl, token, selectedSiteName);
      const nextRecords = (payload?.records || []).map(normalizeRecord);
      setRecords(nextRecords);
      setSiteInfo(payload?.site || project || {});
      setFilters(payload?.filters || {
        tasks: [...new Set(nextRecords.map((r) => r.task).filter(Boolean))].sort(),
        locations: [...new Set(nextRecords.map((r) => r.location).filter(Boolean))].sort(),
      });
    } catch (error) {
      Alert.alert('Site Tracker Unavailable', error?.message || 'Unable to load this site tracker.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [portalUrl, token, selectedSiteName, project]);

  useEffect(() => { load(); }, [load]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (statusFilter !== 'All') count += 1;
    if (connectorFilter) count += 1;
    if (taskFilter) count += 1;
    if (locationFilter) count += 1;
    return count;
  }, [statusFilter, connectorFilter, taskFilter, locationFilter]);

  const visibleRecords = useMemo(() => records.filter((row) => {
    if (!rowMatchesSearch(row, search)) return false;
    if (statusFilter !== 'All' && row.item_status !== statusFilter) return false;
    if (connectorFilter && row.connector_status !== connectorFilter) return false;
    if (taskFilter && row.task !== taskFilter) return false;
    if (locationFilter && row.location !== locationFilter) return false;
    if (!showCompleted && !search && shouldAutoHideCompleted(row)) return false;
    return true;
  }), [records, search, statusFilter, connectorFilter, taskFilter, locationFilter, showCompleted]);

  function patchLocal(uid, patch) {
    setRecords((prev) => prev.map((row) => row.uid === uid ? normalizeRecord({ ...row, ...patch }) : row));
  }

  async function persistChange(row, field, value) {
    const uid = row.uid;
    patchLocal(uid, { [field]: value, ...(field === 'installed_amount' ? { installed_count: value } : {}) });
    setSaving((prev) => ({ ...prev, [uid]: true }));
    try {
      const payload = await updateSubcontractorSiteDailyTrackerRecord(portalUrl, token, uid, { field, value });
      if (payload?.item) patchLocal(uid, normalizeRecord(payload.item));
    } catch (error) {
      Alert.alert('Update Failed', error?.message || 'Unable to save that change.');
      await load({ silent: true });
    } finally {
      setSaving((prev) => ({ ...prev, [uid]: false }));
    }
  }

  function beginInstalledChange(row, rawValue) {
    const installed = Math.max(0, Number(rawValue || 0));
    if (Number.isFinite(Number(row.design_amount)) && installed > Number(row.design_amount || 0)) {
      setDesignExceed({ row, attempted: installed, newDesign: String(installed) });
      return;
    }
    persistChange(row, 'installed_amount', installed);
  }

  async function confirmDesignExceed() {
    const ctx = designExceed;
    if (!ctx) return;
    setDesignExceed(null);
    const installed = Math.max(0, Number(ctx.attempted || 0));
    const newDesign = Math.max(installed, Number(ctx.newDesign || installed));
    await persistChange(ctx.row, 'design_amount', newDesign);
    await persistChange(ctx.row, 'installed_amount', installed);
  }

  function handleStatus(row, value) {
    persistChange(row, 'item_status', value);
    if (value === 'Completed' && hasCounts(row) && Number(row.installed_amount || 0) > Number(row.design_amount || 0)) {
      persistChange(row, 'design_amount', row.installed_amount);
    }
  }
  function handleConnector(row, value) { persistChange(row, 'connector_status', value); }

  function startEdit(row, field, title, keyboard = 'default') {
    setCellEditor({ row, field, title, value: String(row?.[field] ?? ''), keyboard });
  }

  function saveCellEditor() {
    const ctx = cellEditor;
    if (!ctx) return;
    setCellEditor(null);
    if (ctx.field === 'installed_amount') beginInstalledChange(ctx.row, ctx.value);
    else if (ctx.field === 'design_amount') persistChange(ctx.row, ctx.field, Math.max(0, Number(ctx.value || 0)));
    else persistChange(ctx.row, ctx.field, ctx.value);
  }

  async function pickPhoto(row, mode) {
    try {
      const permission = mode === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission?.granted) {
        Alert.alert('Photo Permission Needed', 'Photo access is required to attach a Site Tracker photo.');
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

  function clearFilters() {
    setStatusFilter('All');
    setConnectorFilter('');
    setTaskFilter('');
    setLocationFilter('');
    setSearch('');
  }

  if (loading) {
    return (
      <View style={styles.loadingPage}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={PRIMARY} />
        <Text style={styles.loadingText}>Loading Page…</Text>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea}>
        <Header siteName={siteInfo?.site_name || selectedSiteName} onBack={onBack} onHome={onHome} onRefresh={() => load()} isTablet={isTablet} />

        <View style={[styles.controls, isTablet ? styles.controlsTablet : styles.controlsMobile]}>
          <TextInput
            style={[styles.nameSearch, !isTablet && styles.nameSearchMobile]}
            value={search}
            onChangeText={setSearch}
            placeholder="Search Name…"
            placeholderTextColor="#64748b"
            autoCapitalize="none"
          />
          <View style={styles.controlsRight}>
            <Pressable style={[styles.btn, !isTablet && styles.btnMobile, styles.showCompletedBtn, !isTablet && styles.showCompletedBtnMobile, showCompleted && styles.showCompletedActive]} onPress={() => setShowCompleted((value) => !value)}>
              <Text style={styles.showCompletedText}>{showCompleted ? 'Hide\nCompleted' : 'Show\nCompleted'}</Text>
            </Pressable>
            <Pressable style={[styles.btn, !isTablet && styles.btnMobile]} onPress={() => setFiltersOpen(true)}>
              <Text style={styles.btnText}>Filters{activeFiltersCount ? ` (${activeFiltersCount})` : ''}</Text>
            </Pressable>
            <Pressable style={[styles.btn, !isTablet && styles.btnMobile, editing && styles.editActive]} onPress={() => setEditing((value) => !value)}>
              <Text style={styles.btnText}>{editing ? 'Done' : 'Edit'}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.mainScroll}>
          <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableWrapper}>
            <View style={[styles.table, { width: tableMetrics.tableWidth }]}>
              <TableHeader cols={tableMetrics.cols} compact={!isTablet} />
              <ScrollView
                style={styles.rowsScroll}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load({ silent: true }); }} tintColor={PRIMARY} />}
              >
                {visibleRecords.length ? visibleRecords.map((row, index) => (
                  <TableRow
                    key={row.uid || `${row.id}-${index}`}
                    row={row}
                    index={index}
                    editing={editing}
                    saving={saving[row.uid]}
                    cols={tableMetrics.cols}
                    compact={!isTablet}
                    onEdit={startEdit}
                    onStatus={() => setChoiceEditor({ title: 'Status', row, field: 'item_status', value: row.item_status, options: ['Not Completed', 'Completed'], onChoose: handleStatus })}
                    onConnector={() => isCable(row) && setChoiceEditor({ title: 'Connector Status', row, field: 'connector_status', value: row.connector_status, options: ['Not Completed', 'One End', 'Both Ends'], onChoose: handleConnector })}
                    onPhoto={() => handlePhoto(row)}
                  />
                )) : (
                  <View style={[styles.emptyRow, { width: tableMetrics.tableWidth }]}><Text style={styles.emptyText}>No matching tracker items.</Text></View>
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
      </SafeAreaView>
    </View>
  );
}

function Header({ siteName: title, onBack, onHome, onRefresh, isTablet }) {
  return (
    <View style={[styles.header, !isTablet && styles.headerMobile]}>
      <View style={styles.headerTitleBlock}>
        <Text style={styles.headerLabel}>FNS</Text>
        <Text style={styles.headerSite} numberOfLines={1}>{title || 'Site Tracker'}</Text>
        <Text style={styles.headerUser} numberOfLines={1}>Site Daily Tracker</Text>
      </View>
      <View style={[styles.headerRight, !isTablet && styles.headerRightMobile]}>
        <Pressable style={[styles.headerButton, !isTablet && styles.headerButtonMobile]} onPress={onRefresh}><Text style={styles.headerButtonText}>Refresh</Text></Pressable>
        <Pressable style={[styles.headerButton, !isTablet && styles.headerButtonMobile]} onPress={onBack}><Text style={styles.headerButtonText}>Back</Text></Pressable>
        <Pressable style={[styles.headerButton, !isTablet && styles.headerButtonMobile]} onPress={onHome}><Text style={styles.headerButtonText}>Home</Text></Pressable>
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
    ['Design', cols.design, styles.centerText],
    ['Remaining', cols.remaining, styles.centerText],
    ['Location', cols.location, styles.locationCol],
    ['Photo', cols.photo, styles.centerText],
  ];
  return (
    <View style={styles.tableHeader}>
      {columns.map(([label, colWidth, extra]) => (
        <View key={label} style={[styles.th, compact && styles.thCompact, { width: colWidth }, extra]}><Text style={styles.thText}>{label}</Text></View>
      ))}
    </View>
  );
}

function TableRow({ row, index, editing, saving, cols, compact, onEdit, onStatus, onConnector, onPhoto }) {
  const rowStyle = [styles.tr, compact && styles.trCompact, index % 2 === 1 && styles.trEven];
  return (
    <View style={rowStyle}>
      <Pressable style={[styles.td, compact && styles.tdCompact, styles.nameCell, { width: cols.name }]} onPress={editing ? () => onEdit(row, 'item_name', 'Name') : undefined}>
        <Text style={styles.boldCell} numberOfLines={3}>{row.name}</Text>
        {saving ? <Text style={styles.savingText}>Saving…</Text> : null}
      </Pressable>
      <Pressable style={[styles.td, compact && styles.tdCompact, { width: cols.task }]} onPress={editing ? () => onEdit(row, 'task', 'Task') : undefined}>
        <Text style={styles.boldCell} numberOfLines={3}>{row.task}</Text>
      </Pressable>
      <Pressable style={[styles.td, compact && styles.tdCompact, styles.centerCell, { width: cols.installed }]} onPress={hasCounts(row) ? () => onEdit(row, 'installed_amount', 'Installed', 'numeric') : undefined}>
        {hasCounts(row) ? <TextInputPointer value={formatNumber(row.installed_amount)} /> : null}
      </Pressable>
      <Pressable style={[styles.td, compact && styles.tdCompact, styles.centerCell, { width: cols.status }]} onPress={onStatus}>
        <View style={[styles.selectPill, statusStyle(row.item_status)]}><Text style={[styles.selectText, isCompleted(row.item_status) && styles.darkSelectText]}>{row.item_status}</Text></View>
      </Pressable>
      <Pressable style={[styles.td, compact && styles.tdCompact, styles.centerCell, { width: cols.connector }]} onPress={onConnector}>
        {isCable(row) ? <View style={[styles.selectPill, connectorStyle(row.connector_status)]}><Text style={[styles.selectText, row.connector_status !== 'Not Completed' && styles.darkSelectText]}>{row.connector_status}</Text></View> : null}
      </Pressable>
      <Pressable style={[styles.td, compact && styles.tdCompact, styles.centerCell, { width: cols.design }]} onPress={editing && hasCounts(row) ? () => onEdit(row, 'design_amount', 'Design', 'numeric') : undefined}>
        {hasCounts(row) ? <TextInputPointer value={formatNumber(row.design_amount)} muted={!editing} /> : null}
      </Pressable>
      <View style={[styles.td, compact && styles.tdCompact, styles.centerCell, { width: cols.remaining }]}>
        {hasCounts(row) ? <Text style={styles.remainingText}>{formatNumber(row.remaining_amount)}</Text> : null}
      </View>
      <Pressable style={[styles.td, compact && styles.tdCompact, { width: cols.location }]} onPress={editing ? () => onEdit(row, 'location', 'Location') : undefined}>
        <Text style={styles.boldCell} numberOfLines={3}>{row.location}</Text>
      </Pressable>
      <View style={[styles.td, compact && styles.tdCompact, styles.centerCell, { width: cols.photo }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${photoTypeLabelForRow(row)} photo`} onPress={onPhoto} style={[styles.photoBtn, photoButtonStyle(row.photo_status)]}>
          <Text style={[styles.photoText, photoTextStyle(row.photo_status)]}>📷</Text>
        </Pressable>
        <Text style={styles.photoTypeText}>{photoTypeLabelForRow(row)}</Text>
      </View>
    </View>
  );
}

function TextInputPointer({ value, muted }) {
  return <View style={[styles.numberBox, muted && styles.numberBoxMuted]}><Text style={styles.numberText}>{value}</Text></View>;
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
        {selected && <Text style={styles.choiceSelectedText}>Current selection</Text>}
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
          <Text style={styles.modalTitle}>Advanced Filters</Text>
          <ScrollView style={styles.modalScroll}>
            <FilterSection title="Status">
              {['All', 'Completed', 'Not Completed'].map((v) => <SelectButton key={v} label={v === 'All' ? 'All Statuses' : v} selected={statusFilter === v} onPress={() => setStatusFilter(v)} />)}
            </FilterSection>
            <FilterSection title="Connector Status">
              {['', 'Not Completed', 'One End', 'Both Ends'].map((v) => <SelectButton key={v || 'all'} label={v || 'All'} selected={connectorFilter === v} onPress={() => setConnectorFilter(v)} />)}
            </FilterSection>
            <FilterSection title="Task">
              <SelectButton label="All Tasks" selected={!taskFilter} onPress={() => setTaskFilter('')} />
              {tasks.map((v) => <SelectButton key={v} label={v} selected={taskFilter === v} onPress={() => setTaskFilter(v)} />)}
            </FilterSection>
            <FilterSection title="Location">
              <SelectButton label="All Locations" selected={!locationFilter} onPress={() => setLocationFilter('')} />
              {locations.map((v) => <SelectButton key={v} label={v} selected={locationFilter === v} onPress={() => setLocationFilter(v)} />)}
            </FilterSection>
          </ScrollView>
          <View style={styles.modalActions}>
            <Pressable style={[styles.modalBtn, styles.primaryModalBtn]} onPress={onClose}><Text style={styles.primaryModalText}>Apply</Text></Pressable>
            <Pressable style={styles.modalBtn} onPress={onClear}><Text style={styles.secondaryModalText}>Clear</Text></Pressable>
            <Pressable style={styles.modalBtn} onPress={onClose}><Text style={styles.secondaryModalText}>Cancel</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
function FilterSection({ title, children }) { return <View style={styles.filterSection}><Text style={styles.filterLabel}>{title}</Text>{children}</View>; }

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
            <Pressable style={[styles.modalBtn, styles.primaryModalBtn]} onPress={onSave}><Text style={styles.primaryModalText}>Save</Text></Pressable>
            <Pressable style={styles.modalBtn} onPress={onCancel}><Text style={styles.secondaryModalText}>Cancel</Text></Pressable>
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
          <View style={styles.modalActions}><Pressable style={styles.modalBtn} onPress={onClose}><Text style={styles.secondaryModalText}>Cancel</Text></Pressable></View>
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
          <Text style={styles.modalTitle}>Installed exceeds design</Text>
          <Text style={styles.modalText}>Installed is {formatNumber(context.attempted)}. Enter a new design amount to continue.</Text>
          <TextInput style={styles.editInput} keyboardType="numeric" value={context.newDesign} onChangeText={(value) => setContext({ ...context, newDesign: value })} autoFocus selectTextOnFocus />
          <View style={styles.modalActions}>
            <Pressable style={[styles.modalBtn, styles.primaryModalBtn]} onPress={onConfirm}><Text style={styles.primaryModalText}>OK</Text></Pressable>
            <Pressable style={styles.modalBtn} onPress={onCancel}><Text style={styles.secondaryModalText}>Cancel</Text></Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: BG },
  safeArea: { flex: 1, backgroundColor: BG },
  loadingPage: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
  loadingText: { marginTop: 12, color: PRIMARY_DARK, fontWeight: '800' },
  header: { backgroundColor: PRIMARY, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerMobile: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 8 },
  headerTitleBlock: { flex: 1, minWidth: 0 },
  headerLabel: { color: '#dce4ff', fontSize: 10, fontWeight: '900', letterSpacing: 1.3, marginBottom: 2 },
  headerSite: { color: '#fff', fontWeight: '900', fontSize: 22 },
  headerUser: { color: '#dbe4ff', fontWeight: '700', fontSize: 12, marginTop: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerRightMobile: { gap: 6 },
  headerButton: { backgroundColor: PRIMARY_DARK, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  headerButtonMobile: { paddingHorizontal: 9, paddingVertical: 7, borderRadius: 9 },
  headerButtonText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  controls: { backgroundColor: BG, padding: 10, borderBottomWidth: 1, borderBottomColor: '#d4dbe8' },
  controlsTablet: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  controlsMobile: { gap: 8 },
  nameSearch: { flex: 1, minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff', paddingHorizontal: 12, color: '#0f172a', fontWeight: '700' },
  nameSearchMobile: { minHeight: 42 },
  controlsRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btn: { backgroundColor: PRIMARY, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, minHeight: 42, justifyContent: 'center', alignItems: 'center' },
  btnMobile: { flex: 1, minHeight: 42, paddingHorizontal: 8, paddingVertical: 7 },
  btnText: { color: '#fff', fontWeight: '900', fontSize: 13, textAlign: 'center' },
  showCompletedBtn: { backgroundColor: '#fff', borderWidth: 1, borderColor: PRIMARY },
  showCompletedBtnMobile: { minHeight: 42 },
  showCompletedActive: { backgroundColor: '#e7f0ff' },
  showCompletedText: { color: PRIMARY_DARK, fontWeight: '900', fontSize: 12, textAlign: 'center', lineHeight: 14 },
  editActive: { backgroundColor: '#0f766e' },
  mainScroll: { flex: 1 },
  tableWrapper: { flex: 1 },
  table: { flex: 1, backgroundColor: '#fff' },
  tableHeader: { flexDirection: 'row', backgroundColor: PRIMARY_DARK, borderBottomWidth: 1, borderBottomColor: '#1e2878' },
  th: { minHeight: 38, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.18)' },
  thCompact: { minHeight: 34, paddingHorizontal: 5 },
  thText: { color: '#fff', fontWeight: '900', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.2, textAlign: 'center' },
  rowsScroll: { flex: 1, backgroundColor: '#f8fafc' },
  tr: { flexDirection: 'row', minHeight: 74, borderBottomWidth: 1, borderBottomColor: '#dbe2ee', backgroundColor: '#fff' },
  trCompact: { minHeight: 66 },
  trEven: { backgroundColor: '#f6f8fb' },
  td: { paddingHorizontal: 8, paddingVertical: 7, borderRightWidth: 1, borderRightColor: '#e2e8f0', justifyContent: 'center' },
  tdCompact: { paddingHorizontal: 5, paddingVertical: 5 },
  nameCol: { alignItems: 'flex-start' },
  taskCol: { alignItems: 'flex-start' },
  locationCol: { alignItems: 'flex-start' },
  centerText: { alignItems: 'center' },
  nameCell: { backgroundColor: 'rgba(63,81,181,0.03)' },
  centerCell: { alignItems: 'center' },
  boldCell: { color: '#0f172a', fontWeight: '900', fontSize: 13, lineHeight: 16 },
  savingText: { color: PRIMARY_DARK, fontWeight: '800', fontSize: 10, marginTop: 3 },
  numberBox: { minWidth: 50, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 7, backgroundColor: '#fff', borderWidth: 1, borderColor: PRIMARY, alignItems: 'center' },
  numberBoxMuted: { borderColor: '#cbd5e1', backgroundColor: '#eef2f7' },
  numberText: { color: '#0f172a', fontWeight: '900', fontSize: 14 },
  remainingText: { color: '#334155', fontWeight: '900', fontSize: 14 },
  selectPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 6, minWidth: 92, alignItems: 'center', borderWidth: 1 },
  selectText: { color: '#fff', fontSize: 11, fontWeight: '900', textAlign: 'center' },
  darkSelectText: { color: '#102a15' },
  statusCompleted: { backgroundColor: GREEN, borderColor: '#24b935' },
  statusNotCompleted: { backgroundColor: RED, borderColor: '#cf102c' },
  connNotCompleted: { backgroundColor: RED, borderColor: '#cf102c' },
  connOneEnd: { backgroundColor: YELLOW, borderColor: '#f5bd10' },
  connBothEnds: { backgroundColor: GREEN, borderColor: '#24b935' },
  photoBtn: { width: 42, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  photoText: { fontSize: 17, fontWeight: '900' },
  lightPhotoText: { color: '#fff' },
  darkPhotoText: { color: '#0f172a' },
  photoGreen: { backgroundColor: GREEN, borderColor: '#24b935' },
  photoRed: { backgroundColor: RED, borderColor: '#cf102c' },
  photoBlue: { backgroundColor: BLUE, borderColor: '#75b8d4' },
  photoYellow: { backgroundColor: YELLOW, borderColor: '#f5bd10' },
  photoGray: { backgroundColor: GRAY, borderColor: '#9ca3af' },
  photoTypeText: { marginTop: 3, color: '#475569', fontSize: 9, fontWeight: '800', textAlign: 'center' },
  emptyRow: { padding: 20, alignItems: 'center' },
  emptyText: { color: '#475569', fontWeight: '800' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'center', padding: 18 },
  modalContent: { maxHeight: '88%', borderRadius: 18, backgroundColor: '#fff', padding: 16, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  smallModalContent: { borderRadius: 18, backgroundColor: '#fff', padding: 16, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  modalTitle: { color: '#0f172a', fontSize: 20, fontWeight: '900', marginBottom: 12 },
  modalText: { color: '#475569', fontWeight: '700', marginBottom: 10 },
  modalScroll: { maxHeight: 460 },
  modalActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  modalBtn: { flexGrow: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, alignItems: 'center', backgroundColor: '#eef2f7' },
  primaryModalBtn: { backgroundColor: PRIMARY },
  primaryModalText: { color: '#fff', fontWeight: '900' },
  secondaryModalText: { color: '#1f2937', fontWeight: '900' },
  editInput: { minHeight: 50, borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff', paddingHorizontal: 12, color: '#0f172a', fontWeight: '900', fontSize: 16 },
  filterSection: { marginBottom: 14 },
  filterLabel: { color: PRIMARY_DARK, fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 10, padding: 11, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 7 },
  optionRowSelected: { backgroundColor: '#e7f0ff', borderColor: PRIMARY },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: '#94a3b8', alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  checkText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  optionText: { color: '#0f172a', fontWeight: '800', flex: 1 },
  choiceGrid: { gap: 8 },
  choiceOption: { flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 12, padding: 12, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },
  choiceOptionSelected: { backgroundColor: '#e7f0ff', borderColor: PRIMARY },
  choiceSwatch: { width: 16, height: 36, borderRadius: 8 },
  choiceTextBlock: { flex: 1 },
  choiceLabel: { color: '#0f172a', fontSize: 16, fontWeight: '900' },
  choiceSelectedText: { color: PRIMARY_DARK, fontSize: 12, fontWeight: '800', marginTop: 2 },
  choiceCheck: { width: 28, height: 28, borderRadius: 14, backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  choiceCheckText: { color: '#fff', fontWeight: '900' },
});

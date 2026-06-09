import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
  createSubcontractorMaterialTrackerItem,
  loadSubcontractorMaterialTracker,
  updateSubcontractorMaterialTrackerItem,
  uploadSubcontractorMaterialTrackerPhotos,
} from '../api/subcontractorApi';

const t = (value) => String(value ?? '');
const ANDROID_NAV_BAR_SAFE_OFFSET = 0;
function makeClientId(prefix = 'material') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const STATUS_OPTIONS = ['Not Completed', 'Completed', 'Missing', 'Damaged'];
const BLANK_ITEM = {
  description: '',
  model_number: '',
  sku: '',
  requested_qty: '',
  ordered_qty: '',
  received_qty: '',
  status: 'Not Completed',
  notes: '',
  receiving_date: '',
  tracking_number: '',
  shipper: '',
};

function clean(value) { return String(value ?? '').trim(); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function numberOrBlank(value) { return value === null || value === undefined ? '' : String(value); }
function siteId(site) { return site?.site_id || site?.id || site?.siteId || ''; }
function siteName(site) { return clean(site?.site_name || site?.name || site?.label || site); }
function normalize(value) { return clean(value).toLowerCase(); }
function dataUrlFromBase64(base64, mime) { return String(base64 || '').startsWith('data:') ? base64 : `data:${mime || 'image/jpeg'};base64,${base64 || ''}`; }
function fileNameFromAsset(asset, fallback = 'material-photo.jpg') { return clean(asset?.fileName || asset?.filename) || fallback; }
function mimeFromAsset(asset) { return clean(asset?.mimeType || asset?.type) || 'image/jpeg'; }

async function assetToPhoto(asset) {
  if (!asset?.uri && !asset?.base64) throw new Error('No photo selected.');
  const mime = mimeFromAsset(asset);
  let base64 = clean(asset?.base64);
  if (!base64 && asset?.uri) {
    base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
  }
  if (!base64) throw new Error('Could not read selected photo.');
  return {
    data_url: dataUrlFromBase64(base64, mime),
    filename: fileNameFromAsset(asset, `material-photo-${Date.now()}.jpg`),
    mime_type: mime,
    preview_uri: asset?.uri || dataUrlFromBase64(base64, mime),
  };
}

function itemFromServer(row) {
  return {
    id: row?.id,
    description: clean(row?.description),
    model_number: clean(row?.model_number),
    sku: clean(row?.sku),
    site_name: clean(row?.site_name),
    requested_qty: numberOrBlank(row?.requested_qty),
    ordered_qty: numberOrBlank(row?.ordered_qty),
    received_qty: numberOrBlank(row?.received_qty),
    status: clean(row?.status || row?.ui_status || 'Not Completed'),
    notes: clean(row?.notes),
    receiving_date: clean(row?.receiving_date).slice(0, 10),
    tracking_number: clean(row?.tracking_number),
    shipper: clean(row?.shipper),
    photo_count: Number(row?.photo_count || 0),
    pending: false,
  };
}

function payloadFromForm(form, site) {
  const description = clean(form.description);
  if (!description) throw new Error('Description is required.');
  const selectedSite = clean(form.site_name || site);
  if (!selectedSite) throw new Error('A site is required.');
  return {
    description,
    model_number: clean(form.model_number),
    sku: clean(form.sku),
    site_name: selectedSite,
    requested_qty: clean(form.requested_qty),
    ordered_qty: clean(form.ordered_qty),
    received_qty: clean(form.received_qty),
    status: clean(form.status) || 'Not Completed',
    notes: clean(form.notes),
    receiving_date: clean(form.receiving_date),
    tracking_number: clean(form.tracking_number),
    shipper: clean(form.shipper),
  };
}

function QueueBanner({ queueCount, syncing, syncProgress, onSync }) {
  if (!queueCount && !syncing) return null;
  const pct = Math.max(5, Math.min(100, Math.round((syncProgress || 0) * 100)));
  return (
    <View style={styles.queueBanner}>
      <View style={styles.queueHeader}>
        <Text style={styles.queueTitle}>{queueCount} pending material update{queueCount === 1 ? '' : 's'}</Text>
        <Pressable style={styles.queueButton} onPress={onSync} disabled={syncing}><Text style={styles.queueButtonText}>{syncing ? 'Syncing...' : 'Sync Now'}</Text></Pressable>
      </View>
      {syncing ? <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View> : null}
      <Text style={styles.queueText}>{t("Entries, updates, and photos are saved on this device and will keep retrying until the portal accepts them.")}</Text>
    </View>
  );
}

function SelectField({ label, value, options, onSelect, placeholder = 'Select', searchable = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = normalize(query);
    const rows = asArray(options).filter(Boolean);
    if (!q) return rows;
    return rows.filter((item) => normalize(item).includes(q));
  }, [options, query]);
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.label}>{label}</Text>
      <Pressable style={styles.selectBox} onPress={() => setOpen(true)}>
        <Text style={[styles.selectText, !value && styles.placeholderText]} numberOfLines={1}>{value || placeholder}</Text><Text style={styles.chevron}>⌄</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>{label}</Text><Pressable style={styles.smallButton} onPress={() => setOpen(false)}><Text style={styles.smallButtonText}>{t("Close")}</Text></Pressable></View>
            {searchable ? <TextInput value={query} onChangeText={setQuery} placeholder={t("Search")} placeholderTextColor="#7d8ca8" style={styles.searchInput} /> : null}
            <ScrollView keyboardShouldPersistTaps="handled">
              {filtered.map((item) => (
                <Pressable key={String(item)} style={styles.optionRow} onPress={() => { onSelect(String(item)); setQuery(''); setOpen(false); }}>
                  <Text style={styles.optionText}>{String(item)}</Text>
                </Pressable>
              ))}
              {!filtered.length ? <Text style={styles.emptyInline}>{t("No options found.")}</Text> : null}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function StatusFilterButton({ value, showCompleted, onSelect, onToggleCompleted }) {
  const [open, setOpen] = useState(false);
  const label = value === 'All' ? 'All Statuses' : value;
  return (
    <View style={styles.filterRow}>
      <Pressable style={styles.statusFilterButton} onPress={() => setOpen(true)}>
        <View>
          <Text style={styles.filterLabel}>{t("Status")}</Text>
          <Text style={styles.statusFilterText} numberOfLines={1}>{label}</Text>
        </View>
        <Text style={styles.chevron}>⌄</Text>
      </Pressable>
      <Pressable style={[styles.showCompletedButton, showCompleted && styles.showCompletedButtonActive]} onPress={onToggleCompleted}>
        <Text style={[styles.showCompletedText, showCompleted && styles.showCompletedTextActive]}>{showCompleted ? 'Hide Completed' : 'Show Completed'}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{t("Status")}</Text>
              <Pressable style={styles.smallButton} onPress={() => setOpen(false)}><Text style={styles.smallButtonText}>{t("Close")}</Text></Pressable>
            </View>
            {['All', ...STATUS_OPTIONS].map((status) => (
              <Pressable key={status} style={[styles.optionRow, value === status && styles.optionRowActive]} onPress={() => { onSelect(status); setOpen(false); }}>
                <Text style={[styles.optionText, value === status && styles.optionTextActive]}>{status === 'All' ? 'All Statuses' : status}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function MaterialFormModal({ visible, title, siteNameValue, initialItem, onClose, onSave }) {
  const scrollRef = useRef(null);
  const fieldLayoutsRef = useRef({});
  const [form, setForm] = useState({ ...BLANK_ITEM, site_name: siteNameValue });
  const [photos, setPhotos] = useState([]);
  const [editDetails, setEditDetails] = useState(false);
  const isEdit = Boolean(initialItem?.id);
  const canEditDetails = !isEdit || editDetails;

  useEffect(() => {
    if (visible) {
      setForm({ ...BLANK_ITEM, site_name: siteNameValue, ...(initialItem || {}) });
      setPhotos([]);
      setEditDetails(false);
    }
  }, [visible, initialItem, siteNameValue]);

  const recordFieldLayout = useCallback((key) => (event) => { fieldLayoutsRef.current[key] = event?.nativeEvent?.layout?.y || 0; }, []);
  const scrollToField = useCallback((key) => {
    const y = Number(fieldLayoutsRef.current[key] || 0);
    setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 90), animated: true }), 260);
  }, []);

  async function pickPhoto(source) {
    try {
      const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert(t("Material Photo"), t("Camera/photo permission is required to attach a material photo."));
        return;
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.85, base64: true })
        : await ImagePicker.launchImageLibraryAsync({ allowsEditing: false, quality: 0.85, base64: true, mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true });
      if (result.canceled) return;
      const selected = [];
      for (const asset of result.assets || []) selected.push(await assetToPhoto(asset));
      setPhotos((current) => [...current, ...selected]);
    } catch (error) {
      Alert.alert('Material Photo', error?.message || 'Unable to attach this photo.');
    }
  }

  function setField(key, value) { setForm((current) => ({ ...current, [key]: value })); }

  async function save() {
    try {
      const payload = payloadFromForm(form, siteNameValue);
      await onSave?.({ payload, photos, item: initialItem });
    } catch (error) {
      Alert.alert('Material Tracker', error?.message || 'Please complete the required fields.');
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}><View style={styles.headerTextBlock}><Text style={styles.kicker}>{t("Material Tracker")}</Text><Text style={styles.title}>{title}</Text></View><Pressable style={styles.backButton} onPress={onClose}><Text style={styles.backButtonText}>{t("Close")}</Text></Pressable></View>
        <View style={styles.keyboardAvoiding}>
          <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} automaticallyAdjustKeyboardInsets={false}>
            <View style={styles.card}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>{t("Material Details")}</Text>
                {isEdit ? <Pressable style={[styles.inlineEditButton, editDetails && styles.inlineEditButtonActive]} onPress={() => setEditDetails((current) => !current)}><Text style={styles.inlineEditButtonText}>{editDetails ? 'Lock Details' : 'Edit Details'}</Text></Pressable> : null}
              </View>
              <View style={styles.fieldBlock}>
                <Text style={styles.label}>{t("Site")}</Text>
                <View style={styles.staticBox}><Text style={styles.staticBoxText} numberOfLines={1}>{form.site_name || siteNameValue || 'Selected site'}</Text></View>
              </View>
              {isEdit && !editDetails ? <Text style={styles.lockHint}>{t("Only Received and Status are open by default. Tap Edit Details to change the rest.")}</Text> : null}
              <View style={styles.fieldBlock} onLayout={recordFieldLayout('description')}><Text style={styles.label}>{t("Description")}</Text><TextInput value={form.description} editable={canEditDetails} onFocus={() => scrollToField('description')} onChangeText={(v) => setField('description', v)} placeholder={t("Material description")} placeholderTextColor="#7d8ca8" style={[styles.input, !canEditDetails && styles.inputLocked]} /></View>
              <View style={styles.twoCol}>
                <View style={styles.halfField} onLayout={recordFieldLayout('model_number')}><Text style={styles.label}>{t("Model #")}</Text><TextInput value={form.model_number} editable={canEditDetails} onFocus={() => scrollToField('model_number')} onChangeText={(v) => setField('model_number', v)} placeholder={t("Model")} placeholderTextColor="#7d8ca8" style={[styles.input, !canEditDetails && styles.inputLocked]} /></View>
                <View style={styles.halfField} onLayout={recordFieldLayout('sku')}><Text style={styles.label}>{t("SKU")}</Text><TextInput value={form.sku} editable={canEditDetails} onFocus={() => scrollToField('sku')} onChangeText={(v) => setField('sku', v)} placeholder={t("SKU")} placeholderTextColor="#7d8ca8" style={[styles.input, !canEditDetails && styles.inputLocked]} /></View>
              </View>
              <View style={styles.threeCol}>
                <View style={styles.thirdField} onLayout={recordFieldLayout('requested_qty')}><Text style={styles.label}>{t("Requested")}</Text><TextInput value={form.requested_qty} editable={canEditDetails} onFocus={() => scrollToField('requested_qty')} onChangeText={(v) => setField('requested_qty', v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#7d8ca8" style={[styles.input, !canEditDetails && styles.inputLocked]} /></View>
                <View style={styles.thirdField} onLayout={recordFieldLayout('ordered_qty')}><Text style={styles.label}>{t("Ordered")}</Text><TextInput value={form.ordered_qty} editable={canEditDetails} onFocus={() => scrollToField('ordered_qty')} onChangeText={(v) => setField('ordered_qty', v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#7d8ca8" style={[styles.input, !canEditDetails && styles.inputLocked]} /></View>
                <View style={styles.thirdField} onLayout={recordFieldLayout('received_qty')}><Text style={styles.label}>{t("Received")}</Text><TextInput value={form.received_qty} onFocus={() => scrollToField('received_qty')} onChangeText={(v) => setField('received_qty', v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#7d8ca8" style={styles.input} /></View>
              </View>
              <SelectField label={t("Status")} value={form.status} options={STATUS_OPTIONS} onSelect={(v) => setField('status', v)} />
              <View style={styles.twoCol}>
                <View style={styles.halfField}><Text style={styles.label}>{t("Receiving Date")}</Text><TextInput value={form.receiving_date} editable={canEditDetails} onChangeText={(v) => setField('receiving_date', v)} placeholder={t("YYYY-MM-DD")} placeholderTextColor="#7d8ca8" style={[styles.input, !canEditDetails && styles.inputLocked]} /></View>
                <View style={styles.halfField}><Text style={styles.label}>{t("Shipper")}</Text><TextInput value={form.shipper} editable={canEditDetails} onChangeText={(v) => setField('shipper', v)} placeholder={t("Carrier")} placeholderTextColor="#7d8ca8" style={[styles.input, !canEditDetails && styles.inputLocked]} /></View>
              </View>
              <View style={styles.fieldBlock}><Text style={styles.label}>{t("Tracking Number")}</Text><TextInput value={form.tracking_number} editable={canEditDetails} onChangeText={(v) => setField('tracking_number', v)} placeholder={t("Tracking number")} placeholderTextColor="#7d8ca8" autoCapitalize="characters" style={[styles.input, !canEditDetails && styles.inputLocked]} /></View>
              <View style={styles.fieldBlock} onLayout={recordFieldLayout('notes')}><Text style={styles.label}>{t("Notes")}</Text><TextInput value={form.notes} editable={canEditDetails} onFocus={() => scrollToField('notes')} onChangeText={(v) => setField('notes', v)} placeholder={t("Notes")} placeholderTextColor="#7d8ca8" style={[styles.input, styles.textarea, !canEditDetails && styles.inputLocked]} multiline /></View>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{isEdit ? 'Add Photos' : 'Photos'}</Text>
              {photos.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false}>{photos.map((photo, index) => <Image key={`${photo.filename}-${index}`} source={{ uri: photo.preview_uri }} style={styles.photoThumb} />)}</ScrollView> : <Text style={styles.helpText}>{t("Attach photos now, or add them later from the material card. Photos are saved offline with the entry until upload succeeds.")}</Text>}
              <View style={styles.buttonRow}><Pressable style={styles.secondaryButton} onPress={() => pickPhoto('camera')}><Text style={styles.secondaryButtonText}>{t("📷 Take Photo")}</Text></Pressable><Pressable style={styles.secondaryButton} onPress={() => pickPhoto('library')}><Text style={styles.secondaryButtonText}>{t("🖼 Upload Photo")}</Text></Pressable></View>
            </View>

            <Pressable style={styles.submitButton} onPress={save}><Text style={styles.submitButtonText}>{isEdit ? 'Save Material' : 'Add Material'}</Text></Pressable>
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function MaterialCard({ item, onEdit, onAddPhoto, onReceiveChange, receiveSaving }) {
  const status = clean(item.status || 'Not Completed');
  const statusStyle = status === 'Completed' ? styles.statusCompleted : status === 'Missing' || status === 'Damaged' ? styles.statusBad : styles.statusOpen;
  const receivedValue = numberOrBlank(item.received_qty);
  return (
    <View style={[styles.itemCard, item.pending && styles.pendingCard]}>
      <View style={styles.itemTop}>
        <View style={styles.itemMain}>
          <Text style={styles.itemTitle} numberOfLines={1}>{item.description || 'Untitled Material'}</Text>
          <Text style={styles.itemSub} numberOfLines={1}>{item.model_number || 'No model'} • {item.sku || 'No SKU'}</Text>
        </View>
        <View style={[styles.statusPill, statusStyle]}><Text style={styles.statusText}>{status}</Text></View>
      </View>
      <View style={styles.cardBodyRow}>
        <View style={styles.qtySummaryBlock}>
          <Text style={styles.qtySmallText}>Req {item.requested_qty || '—'}</Text>
          <Text style={styles.qtySmallText}>Ord {item.ordered_qty || '—'}</Text>
          <Text style={styles.photoCountText}>📷 {item.photo_count || 0}</Text>
        </View>
        <View style={styles.receiveEditorBlock}>
          <View style={styles.receiveLabelRow}>
            <Text style={styles.receiveLabel}>Received</Text>
            {receiveSaving ? <Text style={styles.receiveSaving}>Saving…</Text> : null}
          </View>
          <TextInput
            value={receivedValue}
            onChangeText={(value) => onReceiveChange(item, value)}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor="#6f809b"
            selectTextOnFocus
            style={styles.receiveInput}
          />
        </View>
      </View>
      {item.notes ? <Text style={styles.itemNotes} numberOfLines={1}>{item.notes}</Text> : null}
      <View style={styles.cardActions}>
        <Pressable style={styles.cardActionButton} onPress={() => onAddPhoto(item)}><Text style={styles.cardActionText}>{t("Photos")}</Text></Pressable>
        <Pressable style={styles.cardActionButton} onPress={() => onEdit(item)}><Text style={styles.cardActionText}>{t("Open")}</Text></Pressable>
      </View>
      {item.pending ? <Text style={styles.pendingText}>{t("Pending offline sync")}</Text> : null}
    </View>
  );
}

export default function MaterialTrackerScreen({ session, project, onBack, onHome }) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 760;
  const portalUrl = session?.portalUrl;
  const token = session?.access_token;
  const selectedSiteName = siteName(project);
  const selectedSiteId = siteId(project);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bootstrap, setBootstrap] = useState({});
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showCompleted, setShowCompleted] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [receiveSavingById, setReceiveSavingById] = useState({});
  const receiveSaveTimersRef = useRef({});

  const companyPrefix = clean(bootstrap?.company_prefix || 'FNS');
  const currentSite = clean(bootstrap?.current_site || bootstrap?.site_name || selectedSiteName);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!selectedSiteName) {
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const response = await loadSubcontractorMaterialTracker(portalUrl, token, { siteName: selectedSiteName, siteId: selectedSiteId });
      setBootstrap(response || {});
      setItems(asArray(response?.items).map(itemFromServer));
    } catch (error) {
      if (!silent) Alert.alert('Material Tracker', error?.message || 'Unable to load Material Tracker.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [portalUrl, token, selectedSiteName, selectedSiteId]);

  useEffect(() => { load({ silent: false }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleItems = useMemo(() => {
    const q = normalize(query);
    return items.filter((item) => {
      const status = clean(item.status || 'Not Completed');
      if (!showCompleted && status === 'Completed') return false;
      if (statusFilter !== 'All' && status !== statusFilter) return false;
      if (!q) return true;
      const blob = `${item.description} ${item.model_number} ${item.sku} ${item.notes} ${item.tracking_number} ${item.shipper}`.toLowerCase();
      return blob.includes(q);
    });
  }, [items, query, statusFilter, showCompleted]);

  useEffect(() => () => {
    Object.values(receiveSaveTimersRef.current || {}).forEach((timer) => clearTimeout(timer));
  }, []);

  function buildReceivedUpdatePayload(item, receivedQty) {
    return payloadFromForm({
      ...item,
      site_name: item?.site_name || currentSite,
      received_qty: receivedQty,
    }, currentSite);
  }

  function updateReceivedQtyLive(item, rawValue) {
    const itemId = item?.id;
    const nextValue = String(rawValue || '').replace(/[^0-9.]/g, '');
    setItems((current) => current.map((row) => String(row.id) === String(itemId) ? { ...row, received_qty: nextValue } : row));
    if (!itemId || item.pending) return;
    if (receiveSaveTimersRef.current[itemId]) clearTimeout(receiveSaveTimersRef.current[itemId]);
    const snapshot = { ...item, received_qty: nextValue, site_name: item?.site_name || currentSite };
    receiveSaveTimersRef.current[itemId] = setTimeout(async () => {
      setReceiveSavingById((current) => ({ ...current, [itemId]: true }));
      try {
        const payload = buildReceivedUpdatePayload(snapshot, nextValue);
        const response = await updateSubcontractorMaterialTrackerItem(portalUrl, token, itemId, {
          client_id: makeClientId('sub_material_receive'),
          ...payload,
        });
        if (response?.item) {
          setItems((current) => current.map((row) => String(row.id) === String(itemId) ? itemFromServer(response.item) : row));
        }
      } catch (error) {
        Alert.alert('Material Tracker', error?.message || 'Unable to save the received quantity.');
      } finally {
        setReceiveSavingById((current) => {
          const next = { ...current };
          delete next[itemId];
          return next;
        });
      }
    }, 650);
  }

  async function saveItem({ payload, photos, item }) {
    setSaving(true);
    const isEdit = Boolean(item?.id);
    const clientId = makeClientId(isEdit ? 'sub_material_update' : 'sub_material_create');
    try {
      if (isEdit) {
        const response = await updateSubcontractorMaterialTrackerItem(portalUrl, token, item.id, { client_id: clientId, ...payload });
        if (photos.length) {
          await uploadSubcontractorMaterialTrackerPhotos(portalUrl, token, item.id, photos, makeClientId('sub_material_photo'));
        }
        setItems((current) => current.map((row) => String(row.id) === String(item.id)
          ? itemFromServer(response?.item || { ...row, ...payload, photo_count: Number(row.photo_count || 0) + photos.length })
          : row));
      } else {
        const response = await createSubcontractorMaterialTrackerItem(portalUrl, token, { client_id: clientId, ...payload, photos });
        setItems((current) => [itemFromServer(response?.item || { ...payload, id: response?.server_id, photo_count: photos.length }), ...current]);
      }
      setFormVisible(false);
      setEditingItem(null);
      await load({ silent: true });
    } catch (error) {
      Alert.alert('Material Tracker', error?.message || 'Unable to save this material item.');
    } finally {
      setSaving(false);
    }
  }

  async function addPhotoToItem(item) {
    if (!item?.id || item.pending) {
      Alert.alert('Material Photos', 'This item must finish saving before adding more photos.');
      return;
    }
    try {
      const choice = await new Promise((resolve) => {
        Alert.alert('Material Photo', 'Choose a photo source.', [
          { text: 'Camera', onPress: () => resolve('camera') },
          { text: 'Library', onPress: () => resolve('library') },
          { text: 'Cancel', style: 'cancel', onPress: () => resolve('') },
        ]);
      });
      if (!choice) return;
      const permission = choice === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('Material Photo', 'Camera/photo permission is required to attach a material photo.');
        return;
      }
      const result = choice === 'camera'
        ? await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.85, base64: true })
        : await ImagePicker.launchImageLibraryAsync({ allowsEditing: false, quality: 0.85, base64: true, mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true });
      if (result.canceled) return;
      const photos = [];
      for (const asset of result.assets || []) photos.push(await assetToPhoto(asset));
      await uploadSubcontractorMaterialTrackerPhotos(portalUrl, token, item.id, photos, makeClientId('sub_material_photo'));
      setItems((current) => current.map((row) => String(row.id) === String(item.id)
        ? { ...row, photo_count: Number(row.photo_count || 0) + photos.length }
        : row));
    } catch (error) {
      Alert.alert('Material Photo', error?.message || 'Unable to attach this photo.');
    }
  }

  if (loading) {
    return <SafeAreaView style={styles.safeArea}><View style={styles.loadingWrap}><ActivityIndicator size="large" color="#7aa2ff" /><Text style={styles.loadingText}>Loading Material Tracker...</Text></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={styles.headerTextBlock}>
          <Text style={styles.kicker}>{companyPrefix}</Text>
          <Text style={styles.title}>Material Tracker</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{currentSite || 'No site selected'}</Text>
        </View>
        <Pressable style={styles.backButton} onPress={onBack}><Text style={styles.backButtonText}>Back</Text></Pressable>
        {typeof onHome === 'function' ? <Pressable style={styles.backButton} onPress={onHome}><Text style={styles.backButtonText}>Home</Text></Pressable> : null}
      </View>
      <View style={styles.toolbar}>
        <TextInput value={query} onChangeText={setQuery} placeholder="Search materials" placeholderTextColor="#7d8ca8" style={styles.searchInput} />
        <Pressable style={styles.addButton} disabled={saving} onPress={() => { setEditingItem(null); setFormVisible(true); }}><Text style={styles.addButtonText}>+ Add</Text></Pressable>
      </View>
      <StatusFilterButton value={statusFilter} showCompleted={showCompleted} onSelect={setStatusFilter} onToggleCompleted={() => setShowCompleted((current) => !current)} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.listContent, isTablet && styles.listContentTablet]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load({ silent: true }); }} tintColor="#7aa2ff" />}
      >
        {visibleItems.map((item) => (
          <MaterialCard
            key={String(item.id)}
            item={item}
            onEdit={(row) => { setEditingItem(row); setFormVisible(true); }}
            onAddPhoto={addPhotoToItem}
            onReceiveChange={updateReceivedQtyLive}
            receiveSaving={Boolean(receiveSavingById[item.id])}
          />
        ))}
        {!visibleItems.length ? <View style={styles.emptyCard}><Text style={styles.emptyTitle}>No materials found</Text><Text style={styles.emptyText}>Add a material item or adjust your search/filter.</Text></View> : null}
      </ScrollView>
      <MaterialFormModal visible={formVisible} title={editingItem ? 'Edit Material' : 'Add Material'} siteNameValue={currentSite} initialItem={editingItem} onClose={() => { setFormVisible(false); setEditingItem(null); }} onSave={saveItem} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#07111f' },
  keyboardAvoiding: { flex: 1 },
  header: { paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#0f1f35', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerTextBlock: { flex: 1 },
  kicker: { color: '#8fb2ff', fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  title: { color: '#f7f9ff', fontSize: 24, fontWeight: '900', marginTop: 2 },
  headerSub: { color: '#9fafc8', fontWeight: '800', marginTop: 3 },
  backButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(122,162,255,0.45)', backgroundColor: 'rgba(122,162,255,0.12)' },
  backButtonText: { color: '#dfe7ff', fontWeight: '900', fontSize: 14 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#dfe7ff', fontWeight: '800' },
  scroll: { flex: 1 },
  scrollContent: { padding: 14, paddingBottom: 120, gap: 14 },
  listContent: { padding: 14, paddingBottom: 38, gap: 12 },
  listContentTablet: { maxWidth: 980, alignSelf: 'center', width: '100%' },
  toolbar: { padding: 12, gap: 10, flexDirection: 'row', backgroundColor: '#07111f' },
  searchInput: { color: '#f7f9ff', minHeight: 46, borderRadius: 12, paddingHorizontal: 12, backgroundColor: '#10243a', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', fontWeight: '700', flex: 1 },
  addButton: { borderRadius: 14, paddingHorizontal: 18, minHeight: 46, alignItems: 'center', justifyContent: 'center', backgroundColor: '#4b5cf0' },
  addButtonText: { color: '#fff', fontWeight: '900' },
  filterScroll: { maxHeight: 52 },
  filterContent: { paddingHorizontal: 12, gap: 8, alignItems: 'center' },
  filterChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#10243a', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' },
  filterChipActive: { backgroundColor: '#4b5cf0', borderColor: '#7aa2ff' },
  filterChipText: { color: '#b7c4dc', fontWeight: '900' },
  filterChipTextActive: { color: '#fff' },

  filterRow: { paddingHorizontal: 12, paddingBottom: 10, flexDirection: 'row', gap: 10, alignItems: 'stretch', backgroundColor: '#07111f' },
  filterLabel: { color: '#8fb2ff', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  statusFilterButton: { flex: 1, minHeight: 52, borderRadius: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#10243a', borderWidth: 1, borderColor: 'rgba(122,162,255,0.25)' },
  statusFilterText: { color: '#f7f9ff', fontSize: 15, fontWeight: '900' },
  showCompletedButton: { minHeight: 52, borderRadius: 14, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  showCompletedButtonActive: { backgroundColor: 'rgba(34,197,94,0.16)', borderColor: 'rgba(34,197,94,0.35)' },
  showCompletedText: { color: '#dfe7ff', fontWeight: '900', fontSize: 12 },
  showCompletedTextActive: { color: '#dcfce7' },
  optionRowActive: { backgroundColor: 'rgba(122,162,255,0.13)' },
  optionTextActive: { color: '#bfdbfe' },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  inlineEditButton: { borderRadius: 12, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: 'rgba(122,162,255,0.15)', borderWidth: 1, borderColor: 'rgba(122,162,255,0.25)' },
  inlineEditButtonActive: { backgroundColor: 'rgba(34,197,94,0.16)', borderColor: 'rgba(34,197,94,0.35)' },
  inlineEditButtonText: { color: '#dfe7ff', fontWeight: '900', fontSize: 12 },
  staticBox: { minHeight: 46, borderRadius: 12, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  staticBoxText: { color: '#dfe7ff', fontWeight: '900' },
  lockHint: { color: '#9fafc8', fontWeight: '700', lineHeight: 19, marginTop: -4 },
  inputLocked: { color: '#9fafc8', backgroundColor: 'rgba(255,255,255,0.05)' },
  card: { borderRadius: 20, padding: 16, backgroundColor: '#0f1f35', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 14 },
  sectionTitle: { color: '#f7f9ff', fontSize: 17, fontWeight: '900' },
  fieldBlock: { gap: 7 },
  label: { color: '#b7c4dc', fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { color: '#f7f9ff', minHeight: 46, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#10243a', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', fontWeight: '700' },
  textarea: { minHeight: 92, textAlignVertical: 'top' },
  placeholderText: { color: '#7d8ca8' },
  selectBox: { minHeight: 46, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#10243a', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' },
  selectText: { color: '#f7f9ff', fontWeight: '800', flex: 1 },
  chevron: { color: '#9fafc8', fontWeight: '900', marginLeft: 8 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' , paddingBottom: ANDROID_NAV_BAR_SAFE_OFFSET },
  sheet: { maxHeight: '78%', backgroundColor: '#0f1f35', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  sheetTitle: { color: '#f7f9ff', fontSize: 20, fontWeight: '900' },
  smallButton: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.08)' },
  smallButtonText: { color: '#dfe7ff', fontWeight: '900' },
  optionRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  optionText: { color: '#f7f9ff', fontSize: 16, fontWeight: '800' },
  emptyInline: { color: '#9fafc8', paddingVertical: 16, fontWeight: '700' },
  twoCol: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  threeCol: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  halfField: { flexGrow: 1, flexBasis: 145, gap: 7 },
  thirdField: { flexGrow: 1, flexBasis: 95, gap: 7 },
  helpText: { color: '#9fafc8', fontWeight: '700', lineHeight: 19 },
  buttonRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  secondaryButton: { flexGrow: 1, flexBasis: 150, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 12, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  secondaryButtonText: { color: '#dfe7ff', fontWeight: '900' },
  photoThumb: { width: 110, height: 110, borderRadius: 14, backgroundColor: '#07111f', resizeMode: 'cover', marginRight: 10 },
  submitButton: { marginBottom: 12, borderRadius: 16, minHeight: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: '#4b5cf0' },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  queueBanner: { margin: 12, marginBottom: 0, borderRadius: 18, padding: 14, backgroundColor: '#10243a', borderWidth: 1, borderColor: 'rgba(122,162,255,0.25)' },
  queueHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  queueTitle: { color: '#f7f9ff', fontWeight: '900', fontSize: 15, flex: 1 },
  queueText: { color: '#9fafc8', marginTop: 8, lineHeight: 19, fontWeight: '700' },
  queueButton: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(122,162,255,0.18)', borderWidth: 1, borderColor: 'rgba(122,162,255,0.25)' },
  queueButtonText: { color: '#dfe7ff', fontWeight: '900' },
  progressTrack: { marginTop: 10, height: 8, borderRadius: 999, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)' },
  progressFill: { height: '100%', borderRadius: 999, backgroundColor: '#7aa2ff' },
  itemCard: { borderRadius: 18, padding: 14, backgroundColor: '#0f1f35', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 10 },
  pendingCard: { borderColor: 'rgba(245,158,11,0.55)' },
  itemTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  itemMain: { flex: 1 },
  itemTitle: { color: '#f7f9ff', fontSize: 16, fontWeight: '900' },
  itemSub: { color: '#9fafc8', marginTop: 3, fontWeight: '700' },
  statusPill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1 },
  statusOpen: { backgroundColor: 'rgba(122,162,255,0.13)', borderColor: 'rgba(122,162,255,0.3)' },
  statusCompleted: { backgroundColor: 'rgba(34,197,94,0.14)', borderColor: 'rgba(34,197,94,0.3)' },
  statusBad: { backgroundColor: 'rgba(239,68,68,0.14)', borderColor: 'rgba(239,68,68,0.3)' },
  statusText: { color: '#f7f9ff', fontSize: 11, fontWeight: '900' },
  qtyGrid: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  qtyText: { color: '#dfe7ff', fontWeight: '900', backgroundColor: '#10243a', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6 },
  itemMeta: { color: '#b7c4dc', fontWeight: '700', lineHeight: 19 },
  itemNotes: { color: '#9fafc8', fontWeight: '700', lineHeight: 19 },
  cardActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  cardActionButton: { borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  cardActionText: { color: '#dfe7ff', fontWeight: '900' },
  deleteAction: { backgroundColor: 'rgba(239,68,68,0.14)', borderColor: 'rgba(239,68,68,0.25)' },
  deleteActionText: { color: '#fecaca', fontWeight: '900' },
  pendingText: { color: '#fbbf24', fontWeight: '900' },
  emptyCard: { borderRadius: 18, padding: 18, backgroundColor: '#0f1f35', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center' },
  emptyTitle: { color: '#f7f9ff', fontWeight: '900', fontSize: 17 },
  emptyText: { color: '#9fafc8', marginTop: 6, textAlign: 'center', fontWeight: '700' },
  compactQtyRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  photoCountText: { color: '#b7c4dc', fontWeight: '900', backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5 },
  itemCard: { borderRadius: 16, padding: 11, backgroundColor: '#0f1f35', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 7 },
  itemTitle: { color: '#f7f9ff', fontSize: 15, fontWeight: '900' },
  itemSub: { color: '#9fafc8', marginTop: 2, fontWeight: '700', fontSize: 12 },
  qtyText: { color: '#dfe7ff', fontWeight: '900', backgroundColor: '#10243a', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5, fontSize: 12 },
  itemNotes: { color: '#9fafc8', fontWeight: '700', lineHeight: 18, fontSize: 12 },
  cardActions: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  cardActionButton: { borderRadius: 11, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  cardActionText: { color: '#dfe7ff', fontWeight: '900', fontSize: 12 },

  cardBodyRow: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  qtySummaryBlock: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignContent: 'flex-start', paddingTop: 2 },
  qtySmallText: { color: '#dfe7ff', fontWeight: '900', backgroundColor: '#10243a', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5, fontSize: 12 },
  receiveEditorBlock: { width: 124, borderRadius: 16, padding: 10, backgroundColor: 'rgba(75,92,240,0.18)', borderWidth: 1, borderColor: 'rgba(122,162,255,0.35)' },
  receiveLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 5 },
  receiveLabel: { color: '#bfdbfe', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.7 },
  receiveSaving: { color: '#93c5fd', fontSize: 9, fontWeight: '900' },
  receiveInput: { minHeight: 46, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, color: '#ffffff', fontSize: 26, fontWeight: '900', textAlign: 'center', backgroundColor: 'rgba(7,17,31,0.68)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },

});

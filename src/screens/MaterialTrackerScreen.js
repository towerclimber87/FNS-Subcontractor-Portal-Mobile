import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { loadSubcontractorMaterialTracker, updateSubcontractorMaterialTrackerItem } from '../api/subcontractorApi';

const STATUS_OPTIONS = ['Not Completed', 'Completed', 'Missing', 'Damaged'];

function clean(value) {
  return String(value ?? '').trim();
}

function qty(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fmtQty(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return Number.isInteger(n) ? String(n) : String(n.toFixed(2)).replace(/\.00$/, '').replace(/0$/, '');
}

function progressFor(item) {
  const requested = qty(item.requested_qty);
  const ordered = qty(item.ordered_qty);
  const received = qty(item.received_qty);
  const total = requested + ordered;
  if (total <= 0) return received > 0 ? 1 : 0;
  return Math.max(0, Math.min(1, received / total));
}

function statusStyle(status) {
  const value = clean(status).toLowerCase();
  if (value === 'completed') return { pill: styles.statusCompleted, text: styles.statusCompletedText };
  if (value === 'missing') return { pill: styles.statusMissing, text: styles.statusMissingText };
  if (value === 'damaged') return { pill: styles.statusDamaged, text: styles.statusDamagedText };
  return { pill: styles.statusOpen, text: styles.statusOpenText };
}

export default function MaterialTrackerScreen({ session, project, onBack, onHome }) {
  const { width } = useWindowDimensions();
  const columns = width >= 980 ? 2 : 1;
  const siteName = project?.site_name || project?.name || '';
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async ({ showSpinner = false } = {}) => {
    if (!siteName) return;
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const data = await loadSubcontractorMaterialTracker(session.portalUrl, session.access_token, siteName);
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setError(err?.message || 'Unable to load material tracker.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session?.portalUrl, session?.access_token, siteName]);

  useEffect(() => {
    load({ showSpinner: true });
  }, [load]);

  const summary = useMemo(() => {
    const total = items.length;
    const completed = items.filter((item) => clean(item.status).toLowerCase() === 'completed').length;
    const attention = items.filter((item) => ['missing', 'damaged'].includes(clean(item.status).toLowerCase())).length;
    return { total, completed, attention };
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = clean(query).toLowerCase();
    if (!q) return items;
    return items.filter((item) => [
      item.description,
      item.model_number,
      item.sku,
      item.status,
      item.notes,
      item.tracking_number,
      item.shipper,
    ].some((part) => clean(part).toLowerCase().includes(q)));
  }, [items, query]);

  async function refresh() {
    setRefreshing(true);
    await load();
  }

  function openEditor(item) {
    setSelected(item);
    setDraft({
      received_qty: item.received_qty === null || item.received_qty === undefined ? '' : String(item.received_qty),
      status: clean(item.status) || 'Not Completed',
      tracking_number: clean(item.tracking_number),
      shipper: clean(item.shipper),
      notes: clean(item.notes),
    });
  }

  async function saveEditor() {
    if (!selected?.id) return;
    setSaving(true);
    try {
      const payload = {
        received_qty: draft.received_qty,
        status: draft.status,
        tracking_number: draft.tracking_number,
        shipper: draft.shipper,
        notes: draft.notes,
      };
      const data = await updateSubcontractorMaterialTrackerItem(session.portalUrl, session.access_token, selected.id, payload);
      const updated = data?.item;
      if (updated) {
        setItems((prev) => prev.map((item) => String(item.id) === String(updated.id) ? updated : item));
      } else {
        await load();
      }
      setSelected(null);
    } catch (err) {
      Alert.alert('Save Error', err?.message || 'Unable to save this material item.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScreenShell title="Material Tracker" subtitle={siteName || 'Selected project'} onBack={onBack} onHome={onHome}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <View style={styles.summaryCard}>
          <View>
            <Text style={styles.summaryKicker}>Materials</Text>
            <Text style={styles.summaryTitle}>{summary.total} item{summary.total === 1 ? '' : 's'} on this project</Text>
          </View>
          <View style={styles.summaryStats}>
            <View style={styles.statPill}><Text style={styles.statNumber}>{summary.completed}</Text><Text style={styles.statLabel}>Done</Text></View>
            <View style={[styles.statPill, styles.attentionPill]}><Text style={styles.statNumber}>{summary.attention}</Text><Text style={styles.statLabel}>Issues</Text></View>
          </View>
        </View>

        <TextInput
          style={styles.search}
          placeholder="Search material, model, SKU, status…"
          placeholderTextColor="#7890aa"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />

        {loading ? (
          <View style={styles.centerCard}>
            <ActivityIndicator color={colors.blue} />
            <Text style={styles.centerText}>Loading material tracker…</Text>
          </View>
        ) : null}

        {!!error && !loading ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Unable to load material tracker</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]} onPress={() => load({ showSpinner: true })}>
              <Text style={styles.retryText}>Try Again</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !error ? (
          <View style={styles.grid}>
            {filteredItems.length === 0 ? (
              <View style={styles.emptyCard}><Text style={styles.emptyText}>No material items found.</Text></View>
            ) : filteredItems.map((item) => {
              const status = statusStyle(item.status);
              const progress = progressFor(item);
              return (
                <Pressable key={String(item.id)} style={({ pressed }) => [styles.itemWrap, { width: `${100 / columns}%` }, pressed && styles.pressed]} onPress={() => openEditor(item)}>
                  <View style={styles.itemCard}>
                    <View style={styles.itemHeader}>
                      <Text style={styles.itemTitle} numberOfLines={2}>{item.description || 'Material Item'}</Text>
                      <View style={[styles.statusPill, status.pill]}><Text style={[styles.statusText, status.text]}>{item.status || 'Not Completed'}</Text></View>
                    </View>
                    <View style={styles.detailGrid}>
                      <Text style={styles.detailLabel}>Model</Text><Text style={styles.detailValue} numberOfLines={1}>{item.model_number || '—'}</Text>
                      <Text style={styles.detailLabel}>SKU</Text><Text style={styles.detailValue} numberOfLines={1}>{item.sku || '—'}</Text>
                      <Text style={styles.detailLabel}>Tracking</Text><Text style={styles.detailValue} numberOfLines={1}>{item.tracking_number || '—'}</Text>
                    </View>
                    <View style={styles.qtyRow}>
                      <View><Text style={styles.qtyLabel}>Requested</Text><Text style={styles.qtyValue}>{fmtQty(item.requested_qty)}</Text></View>
                      <View><Text style={styles.qtyLabel}>Ordered</Text><Text style={styles.qtyValue}>{fmtQty(item.ordered_qty)}</Text></View>
                      <View><Text style={styles.qtyLabel}>Received</Text><Text style={styles.qtyValue}>{fmtQty(item.received_qty)}</Text></View>
                    </View>
                    <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} /></View>
                    <Text style={styles.tapHint}>Tap to update received quantity, status, tracking, or notes</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={!!selected} animationType="slide" transparent onRequestClose={() => setSelected(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalKicker}>Update Material</Text>
                <Text style={styles.modalTitle} numberOfLines={2}>{selected?.description || 'Material Item'}</Text>
              </View>
              <Pressable style={styles.closeButton} onPress={() => setSelected(null)} disabled={saving}><Text style={styles.closeText}>×</Text></Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.inputLabel}>Received Quantity</Text>
              <TextInput style={styles.input} value={draft.received_qty} onChangeText={(v) => setDraft((d) => ({ ...d, received_qty: v }))} keyboardType="decimal-pad" placeholder="0" />

              <Text style={styles.inputLabel}>Status</Text>
              <View style={styles.statusChoices}>
                {STATUS_OPTIONS.map((status) => {
                  const active = draft.status === status;
                  return (
                    <Pressable key={status} style={[styles.choice, active && styles.choiceActive]} onPress={() => setDraft((d) => ({ ...d, status }))}>
                      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{status}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.inputLabel}>Tracking Number</Text>
              <TextInput style={styles.input} value={draft.tracking_number} onChangeText={(v) => setDraft((d) => ({ ...d, tracking_number: v }))} placeholder="Tracking number" autoCapitalize="none" />

              <Text style={styles.inputLabel}>Shipper</Text>
              <TextInput style={styles.input} value={draft.shipper} onChangeText={(v) => setDraft((d) => ({ ...d, shipper: v }))} placeholder="Carrier / shipper" />

              <Text style={styles.inputLabel}>Notes</Text>
              <TextInput style={[styles.input, styles.notesInput]} value={draft.notes} onChangeText={(v) => setDraft((d) => ({ ...d, notes: v }))} placeholder="Notes" multiline />
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable style={[styles.secondaryButton, saving && styles.disabled]} onPress={() => setSelected(null)} disabled={saving}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
              <Pressable style={[styles.primaryButton, saving && styles.disabled]} onPress={saveEditor} disabled={saving}><Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save'}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { padding: 14, paddingBottom: 36, backgroundColor: 'transparent' },
  summaryCard: { backgroundColor: '#10233f', borderRadius: 22, padding: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, shadowColor: '#0f172a', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 7 }, elevation: 4 },
  summaryKicker: { color: '#93c5fd', fontSize: 11, fontWeight: '900', letterSpacing: 0.7, textTransform: 'uppercase' },
  summaryTitle: { color: '#fff', fontSize: 19, lineHeight: 24, fontWeight: '900', marginTop: 4 },
  summaryStats: { flexDirection: 'row', gap: 8 },
  statPill: { minWidth: 58, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', borderRadius: 16, paddingHorizontal: 9, paddingVertical: 8, alignItems: 'center' },
  attentionPill: { backgroundColor: 'rgba(245,158,11,0.18)', borderColor: 'rgba(251,191,36,0.25)' },
  statNumber: { color: '#fff', fontSize: 17, fontWeight: '900' },
  statLabel: { color: '#c7d8ec', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', marginTop: 1 },
  search: { backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: 'rgba(190,214,239,0.92)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, color: colors.text, fontSize: 15, fontWeight: '800', marginBottom: 10 },
  centerCard: { backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 18, padding: 18, alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.line },
  centerText: { color: colors.muted, fontWeight: '800' },
  errorCard: { backgroundColor: '#fff', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: '#fecaca', gap: 8 },
  errorTitle: { color: colors.red, fontSize: 16, fontWeight: '900' },
  errorText: { color: colors.text, fontWeight: '700', lineHeight: 20 },
  retryButton: { alignSelf: 'flex-start', marginTop: 6, backgroundColor: colors.blue, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  retryText: { color: '#fff', fontWeight: '900' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  itemWrap: { padding: 5 },
  itemCard: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 19, borderWidth: 1, borderColor: 'rgba(190,214,239,0.9)', padding: 13, shadowColor: '#0f172a', shadowOpacity: 0.055, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  itemHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  itemTitle: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '900', lineHeight: 21 },
  statusPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1 },
  statusText: { fontSize: 10, fontWeight: '900' },
  statusCompleted: { backgroundColor: '#ecfdf5', borderColor: '#bbf7d0' },
  statusCompletedText: { color: '#166534' },
  statusMissing: { backgroundColor: '#fffbeb', borderColor: '#fde68a' },
  statusMissingText: { color: '#92400e' },
  statusDamaged: { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  statusDamagedText: { color: '#991b1b' },
  statusOpen: { backgroundColor: '#eff6ff', borderColor: '#bfdbfe' },
  statusOpenText: { color: '#1d4ed8' },
  detailGrid: { marginTop: 10, rowGap: 4 },
  detailLabel: { color: colors.muted, fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  detailValue: { color: colors.text, fontSize: 13, fontWeight: '800', marginBottom: 2 },
  qtyRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line },
  qtyLabel: { color: colors.muted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  qtyValue: { color: colors.text, fontSize: 15, fontWeight: '900', marginTop: 2 },
  progressTrack: { height: 7, borderRadius: 999, backgroundColor: '#e2e8f0', overflow: 'hidden', marginTop: 12 },
  progressFill: { height: '100%', backgroundColor: '#57c2f4', borderRadius: 999 },
  tapHint: { color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: 10 },
  emptyCard: { flex: 1, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 18, alignItems: 'center' },
  emptyText: { color: colors.muted, fontWeight: '900' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(2,6,23,0.52)', justifyContent: 'flex-end' },
  modalCard: { maxHeight: '88%', backgroundColor: '#f8fbff', borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: 'hidden' },
  modalHeader: { backgroundColor: '#10233f', padding: 16, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  modalKicker: { color: '#93c5fd', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.7 },
  modalTitle: { color: '#fff', fontSize: 19, lineHeight: 24, fontWeight: '900', marginTop: 4 },
  closeButton: { width: 34, height: 34, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#fff', fontSize: 27, lineHeight: 30, fontWeight: '800' },
  modalBody: { padding: 16, paddingBottom: 8 },
  inputLabel: { color: colors.text, fontSize: 13, fontWeight: '900', marginBottom: 7, marginTop: 10 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 11, color: colors.text, fontSize: 15, fontWeight: '800' },
  notesInput: { minHeight: 90, textAlignVertical: 'top' },
  statusChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 9 },
  choiceActive: { backgroundColor: colors.blue, borderColor: colors.blue },
  choiceText: { color: colors.text, fontWeight: '900', fontSize: 12 },
  choiceTextActive: { color: '#fff' },
  modalActions: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: '#fff' },
  secondaryButton: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 15, paddingVertical: 12, alignItems: 'center' },
  secondaryText: { color: colors.text, fontWeight: '900' },
  primaryButton: { flex: 1, backgroundColor: colors.blue, borderRadius: 15, paddingVertical: 12, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '900' },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.72 },
});

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import ScreenShell, { colors } from '../components/ScreenShell';
import { loadSubcontractorPhotoRepository, markSubcontractorPhotoViewed, subcontractorMediaUrl } from '../api/subcontractorApi';

const STATUS_FILTERS = [
  { key: '', label: 'All' },
  { key: 'Accepted', label: 'Accepted' },
  { key: 'Not Accepted', label: 'Rejected' },
];

function siteName(project) {
  return project?.site_name || project?.name || '';
}

function siteId(project) {
  return project?.site_id || project?.id || project?.siteId || null;
}

function clean(value) {
  return String(value ?? '').trim();
}

function statusLabel(status) {
  const s = clean(status);
  if (s === 'Accepted') return 'Accepted';
  if (s === 'Not Accepted') return 'Rejected';
  return 'Pending Review';
}

function statusStyle(status) {
  const s = clean(status);
  if (s === 'Accepted') return styles.badgeAccepted;
  if (s === 'Not Accepted') return styles.badgeRejected;
  return styles.badgePending;
}

export default function PhotoRepositoryScreen({ session, project, page, onBack, onHome }) {
  const portalUrl = session?.portalUrl;
  const token = session?.access_token;
  const { width } = useWindowDimensions();
  const isTablet = width >= 720;
  const columns = width >= 1050 ? 4 : width >= 720 ? 3 : 2;
  const [items, setItems] = useState([]);
  const [siteInfo, setSiteInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState(null);

  const imageHeaders = useMemo(() => token ? { Authorization: `Bearer ${token}` } : undefined, [token]);

  const fetchItems = useCallback(async ({ silent = false } = {}) => {
    if (!portalUrl || !token) return;
    if (!silent) setLoading(true);
    setError('');
    try {
      const data = await loadSubcontractorPhotoRepository(portalUrl, token, {
        siteName: siteName(project),
        siteId: siteId(project),
        q: query,
        statusFilter,
      });
      setSiteInfo(data?.site || { site_name: siteName(project), site_id: siteId(project) });
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      const msg = err?.message || 'Unable to load Photo Repository.';
      setError(msg);
      if (!silent) Alert.alert('Photo Repository', msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [portalUrl, token, project, query, statusFilter]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  async function openPhoto(item) {
    setSelected(item);
    if (!item?.viewed_by_me) {
      try {
        await markSubcontractorPhotoViewed(portalUrl, token, item.id || item.asset_id);
        setItems((prev) => prev.map((p) => String(p.id || p.asset_id) === String(item.id || item.asset_id) ? { ...p, viewed_by_me: true } : p));
      } catch (_err) {}
    }
  }

  const renderItem = ({ item }) => {
    const thumb = subcontractorMediaUrl(portalUrl, item.thumb_url || item.preview_url || item.photo_url || item.full_url);
    return (
      <Pressable style={({ pressed }) => [styles.cardWrap, { width: `${100 / columns}%` }, pressed && styles.pressed]} onPress={() => openPhoto(item)}>
        <View style={styles.card}>
          <Image source={{ uri: thumb, headers: imageHeaders }} style={styles.thumb} resizeMode="cover" />
          <View style={styles.cardBody}>
            <Text style={styles.caption} numberOfLines={2}>{item.caption || item.filename || 'Photo'}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.dateText}>{item.display_date || ''}</Text>
              {item.viewed_by_me ? <Text style={styles.viewed}>Viewed</Text> : null}
            </View>
            <Text style={[styles.badge, statusStyle(item.review_status)]}>{statusLabel(item.review_status)}</Text>
          </View>
        </View>
      </Pressable>
    );
  };

  const selectedUrl = selected ? subcontractorMediaUrl(portalUrl, selected.full_url || selected.photo_url || selected.preview_url) : '';

  return (
    <ScreenShell
      title={page?.label || 'Photo Repository'}
      subtitle={siteInfo?.site_name || siteName(project) || 'Selected project'}
      onBack={onBack}
      onHome={onHome}
      backgroundSource={require('../../assets/subcontractor-home-background.png')}
    >
      <View style={styles.container}>
        <View style={styles.toolbar}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search photos"
            placeholderTextColor="#7d8fa6"
            style={styles.search}
            returnKeyType="search"
            onSubmitEditing={() => fetchItems()}
          />
          <Pressable style={styles.refreshBtn} onPress={() => fetchItems()}><Text style={styles.refreshText}>Refresh</Text></Pressable>
        </View>

        <View style={styles.filters}>
          {STATUS_FILTERS.map((filter) => (
            <Pressable key={filter.key || 'all'} style={[styles.filterChip, statusFilter === filter.key && styles.filterChipActive]} onPress={() => setStatusFilter(filter.key)}>
              <Text style={[styles.filterText, statusFilter === filter.key && styles.filterTextActive]}>{filter.label}</Text>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={styles.centerText}>Loading photos…</Text></View>
        ) : error ? (
          <View style={styles.center}><Text style={styles.errorTitle}>Unable to load photos</Text><Text style={styles.errorText}>{error}</Text></View>
        ) : items.length === 0 ? (
          <View style={styles.center}><Text style={styles.emptyTitle}>No photos found</Text><Text style={styles.centerText}>Photos uploaded for this subcontractor/site will show here.</Text></View>
        ) : (
          <FlatList
            data={items}
            key={`cols-${columns}`}
            numColumns={columns}
            keyExtractor={(item) => String(item.id || item.asset_id)}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchItems({ silent: true }); }} />}
          />
        )}
      </View>

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, isTablet && styles.modalCardTablet]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle} numberOfLines={2}>{selected?.caption || selected?.filename || 'Photo'}</Text>
                <Text style={styles.modalSub}>{selected?.display_date || ''} · {statusLabel(selected?.review_status)}</Text>
              </View>
              <Pressable style={styles.closeBtn} onPress={() => setSelected(null)}><Text style={styles.closeText}>Close</Text></Pressable>
            </View>
            {selectedUrl ? <Image source={{ uri: selectedUrl, headers: imageHeaders }} style={styles.fullImage} resizeMode="contain" /> : null}
          </View>
        </View>
      </Modal>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12 },
  toolbar: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  search: { flex: 1, minHeight: 44, borderRadius: 14, paddingHorizontal: 14, backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: '#c7d7ec', color: colors.text, fontWeight: '800' },
  refreshBtn: { minWidth: 92, minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, paddingHorizontal: 14 },
  refreshText: { color: '#fff', fontWeight: '900' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  filterChip: { borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.86)', borderWidth: 1, borderColor: '#c7d7ec' },
  filterChipActive: { backgroundColor: '#10233f', borderColor: '#10233f' },
  filterText: { color: colors.text, fontWeight: '900' },
  filterTextActive: { color: '#fff' },
  list: { paddingBottom: 28 },
  cardWrap: { padding: 6 },
  card: { overflow: 'hidden', borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.94)', borderWidth: 1, borderColor: '#c7d7ec', shadowColor: '#0f172a', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  thumb: { width: '100%', aspectRatio: 1.12, backgroundColor: '#dbe8f6' },
  cardBody: { padding: 10, gap: 6 },
  caption: { color: colors.text, fontWeight: '900', fontSize: 13, lineHeight: 17, minHeight: 34 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  dateText: { color: '#64748b', fontSize: 11, fontWeight: '800' },
  viewed: { color: '#2563eb', fontSize: 10, fontWeight: '900' },
  badge: { alignSelf: 'flex-start', overflow: 'hidden', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 10, fontWeight: '900' },
  badgeAccepted: { color: '#166534', backgroundColor: '#dcfce7' },
  badgeRejected: { color: '#991b1b', backgroundColor: '#fee2e2' },
  badgePending: { color: '#92400e', backgroundColor: '#fef3c7' },
  pressed: { opacity: 0.72 },
  center: { margin: 16, padding: 24, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.9)', borderWidth: 1, borderColor: '#c7d7ec', alignItems: 'center', gap: 8 },
  centerText: { color: '#64748b', fontWeight: '800', textAlign: 'center' },
  emptyTitle: { color: colors.text, fontWeight: '900', fontSize: 17 },
  errorTitle: { color: '#991b1b', fontWeight: '900', fontSize: 17 },
  errorText: { color: '#991b1b', fontWeight: '800', textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.78)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalCard: { width: '100%', maxHeight: '92%', borderRadius: 20, backgroundColor: '#fff', overflow: 'hidden' },
  modalCardTablet: { width: '86%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  modalTitle: { color: colors.text, fontWeight: '900', fontSize: 16 },
  modalSub: { color: '#64748b', fontWeight: '800', marginTop: 2 },
  closeBtn: { borderRadius: 12, backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 10 },
  closeText: { color: '#fff', fontWeight: '900' },
  fullImage: { width: '100%', height: 560, maxHeight: '82%', backgroundColor: '#0f172a' },
});

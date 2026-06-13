import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import ScreenShell, { colors } from '../components/ScreenShell';
import {
  loadSubcontractorPhotoAnnotation,
  loadSubcontractorPhotoRepository,
  markSubcontractorPhotoViewed,
  subcontractorMediaUrl,
} from '../api/subcontractorApi';

const STATUS_FILTERS = [
  { key: '', label: 'All Status' },
  { key: 'Pending', label: 'Pending' },
  { key: 'Accepted', label: 'Accepted' },
  { key: 'Not Accepted', label: 'Rejected' },
];

const VIEW_FILTERS = [
  { key: '', label: 'All' },
  { key: 'unseen', label: 'Unseen' },
  { key: 'seen', label: 'Seen' },
];

const DEFAULT_ANNOTATION = { rot: 0, strokes: [], labels: [], shapes: [] };

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

function normalizeAnnotationPayload(payload) {
  const raw = payload?.data_json ?? payload?.annotation?.data_json ?? payload?.annotation ?? payload ?? {};
  return {
    rot: Number(raw?.rot || 0),
    strokes: Array.isArray(raw?.strokes) ? raw.strokes : [],
    labels: Array.isArray(raw?.labels) ? raw.labels : [],
    shapes: Array.isArray(raw?.shapes) ? raw.shapes : [],
  };
}

function lineStyleFromPoints(x1, y1, x2, y2, color, size) {
  const strokeSize = Math.max(1, Number(size || 2));
  const dx = Number(x2 || 0) - Number(x1 || 0);
  const dy = Number(y2 || 0) - Number(y1 || 0);
  const length = Math.max(1, Math.hypot(dx, dy));
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  const width = length + strokeSize;
  const centerX = (Number(x1 || 0) + Number(x2 || 0)) / 2;
  const centerY = (Number(y1 || 0) + Number(y2 || 0)) / 2;
  return {
    position: 'absolute',
    left: centerX - width / 2,
    top: centerY - strokeSize / 2,
    width,
    height: strokeSize,
    borderRadius: strokeSize / 2,
    backgroundColor: color || '#ff0000',
    transform: [{ rotate: `${angle}deg` }],
  };
}

function AnnotationLine({ x1, y1, x2, y2, color, size }) {
  return <View pointerEvents="none" style={lineStyleFromPoints(x1, y1, x2, y2, color, size)} />;
}

function AnnotationPolyline({ shape, mapX, mapY, mapSize }) {
  const points = Array.isArray(shape.points) ? shape.points : [];
  return points.slice(1).map((point, index) => {
    const prev = points[index];
    return (
      <AnnotationLine
        key={`poly-${shape.id || 'x'}-${index}`}
        x1={mapX(prev?.x)}
        y1={mapY(prev?.y)}
        x2={mapX(point?.x)}
        y2={mapY(point?.y)}
        color={shape.color || '#ff0000'}
        size={mapSize(shape.size || 6)}
      />
    );
  });
}

function AnnotationArrow({ shape, mapX, mapY, mapSize }) {
  const x1 = mapX(shape.x1);
  const y1 = mapY(shape.y1);
  const x2 = mapX(shape.x2);
  const y2 = mapY(shape.y2);
  const size = mapSize(shape.size || 6);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.max(10, size * 3.5);
  const a1 = angle + Math.PI * 0.82;
  const a2 = angle - Math.PI * 0.82;
  return (
    <>
      <AnnotationLine x1={x1} y1={y1} x2={x2} y2={y2} color={shape.color || '#ff0000'} size={size} />
      <AnnotationLine x1={x2} y1={y2} x2={x2 + Math.cos(a1) * head} y2={y2 + Math.sin(a1) * head} color={shape.color || '#ff0000'} size={size} />
      <AnnotationLine x1={x2} y1={y2} x2={x2 + Math.cos(a2) * head} y2={y2 + Math.sin(a2) * head} color={shape.color || '#ff0000'} size={size} />
    </>
  );
}

function AnnotationOverlay({ annotation, imageSize, displaySize }) {
  const imgW = Math.max(1, Number(imageSize?.width || 1));
  const imgH = Math.max(1, Number(imageSize?.height || 1));
  const dispW = Math.max(1, Number(displaySize?.width || 1));
  const dispH = Math.max(1, Number(displaySize?.height || 1));
  const sx = dispW / imgW;
  const sy = dispH / imgH;
  const scale = Math.min(sx, sy);
  const mapX = (x) => Number(x || 0) * sx;
  const mapY = (y) => Number(y || 0) * sy;
  const mapSize = (size) => Math.max(1, Number(size || 1) * scale);
  const data = annotation || DEFAULT_ANNOTATION;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { width: dispW, height: dispH }]}> 
      {(data.shapes || []).map((shape, index) => {
        if (shape.type === 'arrow') return <AnnotationArrow key={`shape-${shape.id || index}`} shape={shape} mapX={mapX} mapY={mapY} mapSize={mapSize} />;
        if (shape.type === 'line') return <AnnotationLine key={`shape-${shape.id || index}`} x1={mapX(shape.x1)} y1={mapY(shape.y1)} x2={mapX(shape.x2)} y2={mapY(shape.y2)} color={shape.color || '#ff0000'} size={mapSize(shape.size || 6)} />;
        if (shape.type === 'polyline' || shape.type === 'poly_line' || shape.type === 'poly') return <AnnotationPolyline key={`shape-${shape.id || index}`} shape={shape} mapX={mapX} mapY={mapY} mapSize={mapSize} />;
        const left = mapX(shape.x);
        const top = mapY(shape.y);
        const width = Number(shape.w || 0) * sx;
        const height = Number(shape.h || 0) * sy;
        return (
          <View
            key={`shape-${shape.id || index}`}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: width < 0 ? left + width : left,
              top: height < 0 ? top + height : top,
              width: Math.abs(width),
              height: Math.abs(height),
              borderWidth: mapSize(shape.size || 6),
              borderColor: shape.color || '#ff0000',
              borderRadius: shape.type === 'ellipse' || shape.type === 'circle' ? 9999 : 0,
            }}
          />
        );
      })}
      {(data.strokes || []).map((stroke, strokeIndex) => {
        const points = Array.isArray(stroke.points) ? stroke.points : [];
        return points.slice(1).map((point, index) => {
          const prev = points[index];
          return <AnnotationLine key={`stroke-${strokeIndex}-${index}`} x1={mapX(prev?.x)} y1={mapY(prev?.y)} x2={mapX(point?.x)} y2={mapY(point?.y)} color={stroke.color || '#ff0000'} size={mapSize(stroke.size || 6)} />;
        });
      })}
      {(data.labels || []).map((label, index) => (
        <Text
          key={`label-${label.id || index}`}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: mapX(label.x),
            top: mapY(label.y) - mapSize(label.size || 36),
            color: label.color || '#ff0000',
            fontSize: mapSize(label.size || 36),
            fontWeight: label.fontWeight || 'normal',
            fontStyle: label.fontStyle || 'normal',
            textShadowColor: 'rgba(0,0,0,0.35)',
            textShadowOffset: { width: 1, height: 1 },
            textShadowRadius: 1,
          }}
        >{label.text || ''}</Text>
      ))}
    </View>
  );
}

function getDistance(touches) {
  if (!touches || touches.length < 2) return 0;
  const [a, b] = touches;
  return Math.hypot((a.pageX || 0) - (b.pageX || 0), (a.pageY || 0) - (b.pageY || 0));
}

function getCentroid(touches) {
  const list = Array.from(touches || []);
  if (!list.length) return { x: 0, y: 0 };
  return { x: list.reduce((sum, t) => sum + (t.pageX || 0), 0) / list.length, y: list.reduce((sum, t) => sum + (t.pageY || 0), 0) / list.length };
}

export default function PhotoRepositoryScreen({ session, project, page, onBack, onHome }) {
  const portalUrl = session?.portalUrl;
  const token = session?.access_token;
  const { width, height } = useWindowDimensions();
  const isTablet = width >= 720;
  const columns = width >= 1050 ? 4 : width >= 720 ? 3 : 2;
  const [items, setItems] = useState([]);
  const [siteInfo, setSiteInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [viewFilter, setViewFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState(DEFAULT_ANNOTATION);
  const [annotationLoading, setAnnotationLoading] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const gestureRef = useRef({ distance: 0, scale: 1, pan: { x: 0, y: 0 }, lastPoint: null });

  const imageHeaders = useMemo(() => token ? { Authorization: `Bearer ${token}` } : undefined, [token]);

  const fetchItems = useCallback(async ({ silent = false } = {}) => {
    if (!portalUrl || !token) return;
    if (!silent) setLoading(true);
    setError('');
    try {
      const apiStatusFilter = statusFilter === 'Pending' ? '' : statusFilter;
      const data = await loadSubcontractorPhotoRepository(portalUrl, token, {
        siteName: siteName(project),
        siteId: siteId(project),
        q: query,
        statusFilter: apiStatusFilter,
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

  const visibleItems = useMemo(() => {
    return (items || []).filter((item) => {
      if (statusFilter === 'Pending' && clean(item.review_status)) return false;
      if (viewFilter === 'seen' && !item.viewed_by_me) return false;
      if (viewFilter === 'unseen' && item.viewed_by_me) return false;
      return true;
    });
  }, [items, statusFilter, viewFilter]);

  const selectedUrl = selected ? subcontractorMediaUrl(portalUrl, selected.full_url || selected.photo_url || selected.preview_url) : '';
  const previewBox = useMemo(() => {
    const maxW = Math.max(1, width);
    const maxH = Math.max(1, height - 96);
    const ratio = Math.max(0.01, imageSize.width / Math.max(1, imageSize.height));
    let boxW = maxW;
    let boxH = boxW / ratio;
    if (boxH > maxH) {
      boxH = maxH;
      boxW = boxH * ratio;
    }
    return { width: boxW, height: boxH };
  }, [height, imageSize.height, imageSize.width, width]);

  const resetViewer = useCallback(() => {
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
    gestureRef.current = { distance: 0, scale: 1, pan: { x: 0, y: 0 }, lastPoint: null };
  }, []);

  const closeViewer = useCallback(() => {
    setSelected(null);
    setSelectedAnnotation(DEFAULT_ANNOTATION);
    setImageSize({ width: 1, height: 1 });
    resetViewer();
  }, [resetViewer]);

  useEffect(() => {
    if (!selected) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeViewer();
      return true;
    });
    return () => subscription.remove();
  }, [closeViewer, selected]);

  useEffect(() => {
    if (!selected || !selectedUrl) return;
    setSelectedAnnotation(DEFAULT_ANNOTATION);
    setAnnotationLoading(true);
    resetViewer();
    let active = true;
    const assetId = selected.id || selected.asset_id;
    loadSubcontractorPhotoAnnotation(portalUrl, token, assetId)
      .then((payload) => { if (active) setSelectedAnnotation(normalizeAnnotationPayload(payload)); })
      .catch(() => { if (active) setSelectedAnnotation(DEFAULT_ANNOTATION); })
      .finally(() => { if (active) setAnnotationLoading(false); });
    if (token && typeof Image.getSizeWithHeaders === 'function') {
      Image.getSizeWithHeaders(selectedUrl, imageHeaders || {}, (w, h) => active && setImageSize({ width: Math.max(1, w), height: Math.max(1, h) }), () => {});
    } else {
      Image.getSize(selectedUrl, (w, h) => active && setImageSize({ width: Math.max(1, w), height: Math.max(1, h) }), () => {});
    }
    return () => { active = false; };
  }, [imageHeaders, portalUrl, resetViewer, selected, selectedUrl, token]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => Boolean(selected),
    onMoveShouldSetPanResponder: () => Boolean(selected),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (evt) => {
      const touches = evt.nativeEvent.touches || [];
      gestureRef.current = {
        distance: getDistance(touches),
        scale: zoomScale,
        pan: panOffset,
        lastPoint: getCentroid(touches),
      };
    },
    onPanResponderMove: (evt) => {
      const touches = evt.nativeEvent.touches || [];
      if (touches.length >= 2) {
        const nextDistance = getDistance(touches);
        const startDistance = Math.max(1, gestureRef.current.distance || nextDistance || 1);
        const nextScale = Math.max(1, Math.min(6, gestureRef.current.scale * (nextDistance / startDistance)));
        setZoomScale(nextScale);
        return;
      }
      const point = getCentroid(touches);
      const last = gestureRef.current.lastPoint || point;
      const dx = point.x - last.x;
      const dy = point.y - last.y;
      gestureRef.current.lastPoint = point;
      setPanOffset((prev) => {
        if (zoomScale <= 1.01) return { x: 0, y: 0 };
        const maxX = (previewBox.width * zoomScale - previewBox.width) / 2 + 160;
        const maxY = (previewBox.height * zoomScale - previewBox.height) / 2 + 160;
        return { x: Math.max(-maxX, Math.min(maxX, prev.x + dx)), y: Math.max(-maxY, Math.min(maxY, prev.y + dy)) };
      });
    },
    onPanResponderRelease: () => {
      if (zoomScale <= 1.01) {
        setZoomScale(1);
        setPanOffset({ x: 0, y: 0 });
      }
    },
  }), [panOffset, previewBox.height, previewBox.width, selected, zoomScale]);

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
          {!item.viewed_by_me ? <Text style={styles.unseenPill}>Unseen</Text> : null}
          <View style={styles.cardBody}>
            <Text style={styles.caption} numberOfLines={2}>{item.caption || item.filename || 'Photo'}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.dateText}>{item.display_date || ''}</Text>
              {item.viewed_by_me ? <Text style={styles.viewed}>Seen</Text> : null}
            </View>
            <Text style={[styles.badge, statusStyle(item.review_status)]}>{statusLabel(item.review_status)}</Text>
          </View>
        </View>
      </Pressable>
    );
  };

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

        <Text style={styles.filterLabel}>Review Status</Text>
        <View style={styles.filters}>
          {STATUS_FILTERS.map((filter) => (
            <Pressable key={filter.key || 'all'} style={[styles.filterChip, statusFilter === filter.key && styles.filterChipActive]} onPress={() => setStatusFilter(filter.key)}>
              <Text style={[styles.filterText, statusFilter === filter.key && styles.filterTextActive]}>{filter.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.filterLabel}>Seen / Unseen</Text>
        <View style={styles.filters}>
          {VIEW_FILTERS.map((filter) => (
            <Pressable key={filter.key || 'all-view'} style={[styles.filterChip, viewFilter === filter.key && styles.filterChipActive]} onPress={() => setViewFilter(filter.key)}>
              <Text style={[styles.filterText, viewFilter === filter.key && styles.filterTextActive]}>{filter.label}</Text>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={styles.centerText}>Loading photos…</Text></View>
        ) : error ? (
          <View style={styles.center}><Text style={styles.errorTitle}>Unable to load photos</Text><Text style={styles.errorText}>{error}</Text></View>
        ) : visibleItems.length === 0 ? (
          <View style={styles.center}><Text style={styles.emptyTitle}>No photos found</Text><Text style={styles.centerText}>Photos uploaded for this subcontractor/site will show here.</Text></View>
        ) : (
          <FlatList
            data={visibleItems}
            key={`cols-${columns}`}
            numColumns={columns}
            keyExtractor={(item) => String(item.id || item.asset_id)}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchItems({ silent: true }); }} />}
          />
        )}
      </View>

      <Modal visible={!!selected} transparent={false} animationType="fade" onRequestClose={closeViewer} presentationStyle="fullScreen">
        <View style={styles.viewerRoot}>
          <View style={styles.viewerHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.viewerTitle} numberOfLines={1}>{selected?.caption || selected?.filename || 'Photo'}</Text>
              <Text style={styles.viewerSub} numberOfLines={1}>{selected?.display_date || ''} · {statusLabel(selected?.review_status)}{annotationLoading ? ' · Loading markups…' : ''}</Text>
            </View>
            <Pressable style={styles.resetBtn} onPress={resetViewer}><Text style={styles.viewerButtonText}>Reset</Text></Pressable>
            <Pressable style={styles.closeBtn} onPress={closeViewer}><Text style={styles.viewerButtonText}>Close</Text></Pressable>
          </View>
          <View style={styles.viewerStage} {...panResponder.panHandlers}>
            {selectedUrl ? (
              <View
                style={{
                  width: previewBox.width,
                  height: previewBox.height,
                  transform: [{ translateX: panOffset.x }, { translateY: panOffset.y }, { scale: zoomScale }],
                }}
              >
                <Image
                  source={{ uri: selectedUrl, headers: imageHeaders }}
                  style={{ width: previewBox.width, height: previewBox.height }}
                  resizeMode="contain"
                  onLoad={(event) => {
                    const src = event?.nativeEvent?.source;
                    if (src?.width && src?.height) setImageSize({ width: src.width, height: src.height });
                  }}
                />
                <AnnotationOverlay annotation={selectedAnnotation} imageSize={imageSize} displaySize={previewBox} />
              </View>
            ) : null}
          </View>
          <Text style={styles.viewerHint}>Pinch to zoom. Drag while zoomed to pan.</Text>
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
  filterLabel: { color: '#334155', fontWeight: '900', marginBottom: 6, marginLeft: 2 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  filterChip: { borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.86)', borderWidth: 1, borderColor: '#c7d7ec' },
  filterChipActive: { backgroundColor: '#10233f', borderColor: '#10233f' },
  filterText: { color: colors.text, fontWeight: '900' },
  filterTextActive: { color: '#fff' },
  list: { paddingBottom: 28 },
  cardWrap: { padding: 6 },
  card: { overflow: 'hidden', borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.94)', borderWidth: 1, borderColor: '#c7d7ec', shadowColor: '#0f172a', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  thumb: { width: '100%', aspectRatio: 1.12, backgroundColor: '#dbe8f6' },
  unseenPill: { position: 'absolute', top: 8, right: 8, overflow: 'hidden', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#dc2626', color: '#fff', fontWeight: '900', fontSize: 10 },
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
  viewerRoot: { flex: 1, backgroundColor: '#020617' },
  viewerHeader: { minHeight: 72, paddingTop: 12, paddingHorizontal: 12, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(15,23,42,0.96)', zIndex: 5 },
  viewerTitle: { color: '#fff', fontWeight: '900', fontSize: 16 },
  viewerSub: { color: '#cbd5e1', fontWeight: '800', marginTop: 2 },
  resetBtn: { borderRadius: 12, backgroundColor: '#334155', paddingHorizontal: 12, paddingVertical: 10 },
  closeBtn: { borderRadius: 12, backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 10 },
  viewerButtonText: { color: '#fff', fontWeight: '900' },
  viewerStage: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  viewerHint: { color: '#cbd5e1', textAlign: 'center', fontWeight: '800', paddingVertical: 8, backgroundColor: 'rgba(15,23,42,0.96)' },
});

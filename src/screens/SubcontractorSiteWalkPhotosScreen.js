import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import ScreenShell, { colors } from '../components/ScreenShell';
import { loadSubcontractorSiteWalkPhotoAnnotation, loadSubcontractorSiteWalkPhotos, subcontractorMediaUrl } from '../api/subcontractorApi';

const TAGS = ['All', 'Antenna', 'Node', 'Cores', 'Miscellaneous', 'IDF / ER', 'Electrical'];
const DEFAULT_ANNOTATION = { rot: 0, imageWidth: 0, imageHeight: 0, strokes: [], labels: [], shapes: [] };
const clean = (v) => String(v ?? '').trim();
const siteName = (project) => clean(project?.site_name || project?.name || project?.label || project);
const photoTitle = (p) => clean(p?.name || p?.caption || p?.file_name || `Photo ${p?.id || ''}`) || 'SiteWalk Photo';
const photoUrl = (portalUrl, p) => subcontractorMediaUrl(portalUrl, p?.mobile_thumb_url || p?.mobile_thumb || p?.thumb_url || p?.thumbnail_url || p?.url || p?.public_url || p?.image_url);
const fullPhotoUrl = (portalUrl, p) => subcontractorMediaUrl(portalUrl, p?.rendered_url || p?.url || p?.public_url || p?.photo_url || p?.full_url || p?.thumb_url || p?.image_url);
const pinPhotoId = (pin) => clean(pin?.matching_photo_id || pin?.photo_id || pin?.site_walk_photo_id || pin?.sitewalk_photo_id || pin?.linked_photo_id);
const pinPhotoUrl = (pin) => clean(pin?.matching_photo_url || pin?.photo_url || pin?.site_walk_photo_url || pin?.image_url || pin?.url);

function firstNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function normalizeAnnotationPayload(payload) {
  const raw = payload?.data_json ?? payload?.annotation?.data_json ?? payload?.annotation ?? payload ?? {};
  const imageWidth = firstNumber(raw?.imageWidth, raw?.image_width, raw?.imgW, raw?.img_w, raw?.canvasWidth, raw?.canvas_width, raw?.width, payload?.imageWidth, payload?.image_width, payload?.width);
  const imageHeight = firstNumber(raw?.imageHeight, raw?.image_height, raw?.imgH, raw?.img_h, raw?.canvasHeight, raw?.canvas_height, raw?.height, payload?.imageHeight, payload?.image_height, payload?.height);
  return {
    rot: Number(raw?.rot || 0),
    imageWidth,
    imageHeight,
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
  return { position: 'absolute', left: centerX - width / 2, top: centerY - strokeSize / 2, width, height: strokeSize, borderRadius: strokeSize / 2, backgroundColor: color || '#ff0000', transform: [{ rotate: `${angle}deg` }] };
}
function AnnotationLine({ x1, y1, x2, y2, color, size }) { return <View pointerEvents="none" style={lineStyleFromPoints(x1, y1, x2, y2, color, size)} />; }
function AnnotationPolyline({ shape, mapX, mapY, mapSize }) {
  const points = Array.isArray(shape.points) ? shape.points : [];
  return points.slice(1).map((point, index) => {
    const prev = points[index];
    return <AnnotationLine key={`poly-${shape.id || 'x'}-${index}`} x1={mapX(prev?.x)} y1={mapY(prev?.y)} x2={mapX(point?.x)} y2={mapY(point?.y)} color={shape.color || '#ff0000'} size={mapSize(shape.size || 6)} />;
  });
}
function AnnotationArrow({ shape, mapX, mapY, mapSize }) {
  const x1 = mapX(shape.x1); const y1 = mapY(shape.y1); const x2 = mapX(shape.x2); const y2 = mapY(shape.y2);
  const size = mapSize(shape.size || 6); const angle = Math.atan2(y2 - y1, x2 - x1); const head = Math.max(10, size * 3.5);
  const a1 = angle + Math.PI * 0.82; const a2 = angle - Math.PI * 0.82;
  return <><AnnotationLine x1={x1} y1={y1} x2={x2} y2={y2} color={shape.color || '#ff0000'} size={size} /><AnnotationLine x1={x2} y1={y2} x2={x2 + Math.cos(a1) * head} y2={y2 + Math.sin(a1) * head} color={shape.color || '#ff0000'} size={size} /><AnnotationLine x1={x2} y1={y2} x2={x2 + Math.cos(a2) * head} y2={y2 + Math.sin(a2) * head} color={shape.color || '#ff0000'} size={size} /></>;
}
function AnnotationOverlay({ annotation, imageSize, displaySize }) {
  const imgW = Math.max(1, firstNumber(annotation?.imageWidth, imageSize?.width, 1));
  const imgH = Math.max(1, firstNumber(annotation?.imageHeight, imageSize?.height, 1));
  const dispW = Math.max(1, Number(displaySize?.width || 1));
  const dispH = Math.max(1, Number(displaySize?.height || 1));
  const sx = dispW / imgW; const sy = dispH / imgH; const scale = Math.min(sx, sy);
  const mapX = (x) => Number(x || 0) * sx; const mapY = (y) => Number(y || 0) * sy; const mapSize = (size) => Math.max(1, Number(size || 1) * scale);
  const data = annotation || DEFAULT_ANNOTATION;
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { width: dispW, height: dispH }]}>
    {(data.shapes || []).map((shape, index) => {
      if (shape.type === 'arrow') return <AnnotationArrow key={`shape-${shape.id || index}`} shape={shape} mapX={mapX} mapY={mapY} mapSize={mapSize} />;
      if (shape.type === 'line') return <AnnotationLine key={`shape-${shape.id || index}`} x1={mapX(shape.x1)} y1={mapY(shape.y1)} x2={mapX(shape.x2)} y2={mapY(shape.y2)} color={shape.color || '#ff0000'} size={mapSize(shape.size || 6)} />;
      if (shape.type === 'polyline' || shape.type === 'poly_line' || shape.type === 'poly') return <AnnotationPolyline key={`shape-${shape.id || index}`} shape={shape} mapX={mapX} mapY={mapY} mapSize={mapSize} />;
      const left = mapX(shape.x); const top = mapY(shape.y); const w = Number(shape.w || 0) * sx; const h = Number(shape.h || 0) * sy;
      return <View key={`shape-${shape.id || index}`} pointerEvents="none" style={{ position: 'absolute', left: w < 0 ? left + w : left, top: h < 0 ? top + h : top, width: Math.abs(w), height: Math.abs(h), borderWidth: mapSize(shape.size || 6), borderColor: shape.color || '#ff0000', borderRadius: shape.type === 'ellipse' || shape.type === 'circle' ? 9999 : 0 }} />;
    })}
    {(data.strokes || []).map((stroke, strokeIndex) => {
      const points = Array.isArray(stroke.points) ? stroke.points : [];
      return points.slice(1).map((point, index) => { const prev = points[index]; return <AnnotationLine key={`stroke-${strokeIndex}-${index}`} x1={mapX(prev?.x)} y1={mapY(prev?.y)} x2={mapX(point?.x)} y2={mapY(point?.y)} color={stroke.color || '#ff0000'} size={mapSize(stroke.size || 6)} />; });
    })}
    {(data.labels || []).map((label, index) => <Text key={`label-${label.id || index}`} pointerEvents="none" style={{ position: 'absolute', left: mapX(label.x), top: mapY(label.y) - mapSize(label.size || 36), color: label.color || '#ff0000', fontSize: mapSize(label.size || 36), fontWeight: label.fontWeight || 'normal', fontStyle: label.fontStyle || 'normal', textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 1 }}>{label.text || ''}</Text>)}
  </View>;
}

const fallbackPhotoFromPin = (pin) => {
  const id = pinPhotoId(pin);
  const url = pinPhotoUrl(pin);
  if (!id && !url) return null;
  return { id: id || `pin-photo-${clean(pin?.id) || Date.now()}`, photo_id: id, source: 'site_walk_photo', name: clean(pin?.matching_photo_name || pin?.label || pin?.sr_location || pin?.sr_task) || 'SiteWalk Photo', caption: clean(pin?.label || pin?.sr_location || pin?.sr_task), tag: clean(pin?.tag), sitewalk_desc: clean(pin?.sitewalk_desc || pin?.site_walk_desc), public_url: url, url, thumb_url: clean(pin?.matching_photo_thumb_url || pin?.photo_thumb_url || url), note: clean(pin?.note || pin?.text), __from_redline_pin: true };
};

export default function SubcontractorSiteWalkPhotosScreen({ session, project, initialRedlinePhotoPin, onBack, onHome }) {
  const { width, height } = useWindowDimensions();
  const columns = width >= 980 ? 4 : width >= 680 ? 3 : 2;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sitewalks, setSitewalks] = useState([]);
  const [selectedSitewalk, setSelectedSitewalk] = useState('');
  const [tag, setTag] = useState('All');
  const [query, setQuery] = useState('');
  const [photos, setPhotos] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState(DEFAULT_ANNOTATION);
  const [annotationLoading, setAnnotationLoading] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const selectedSite = siteName(project);
  const initialPhotoId = pinPhotoId(initialRedlinePhotoPin);
  const initialSitewalk = clean(initialRedlinePhotoPin?.sitewalk_desc || initialRedlinePhotoPin?.site_walk_desc);
  const openedFromRedlinePin = Boolean(clean(initialRedlinePhotoPin?.id || initialRedlinePhotoPin?.redline_pin_id) || initialPhotoId || pinPhotoUrl(initialRedlinePhotoPin));
  const selectedUrl = selected ? fullPhotoUrl(session.portalUrl, selected) : '';
  const previewBox = useMemo(() => {
    const maxW = Math.max(1, width - 28);
    const maxH = Math.max(1, height * 0.78);
    const ratio = Math.max(0.01, imageSize.width / Math.max(1, imageSize.height));
    let boxW = maxW;
    let boxH = boxW / ratio;
    if (boxH > maxH) { boxH = maxH; boxW = boxH * ratio; }
    return { width: boxW, height: boxH };
  }, [height, imageSize.height, imageSize.width, width]);

  const closeSelected = useCallback(() => {
    if (openedFromRedlinePin && typeof onBack === 'function') { onBack(); return; }
    setSelected(null);
    setSelectedAnnotation(DEFAULT_ANNOTATION);
    setImageSize({ width: 1, height: 1 });
  }, [openedFromRedlinePin, onBack]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!selectedSite) return;
    if (!silent) setLoading(true);
    try {
      const data = await loadSubcontractorSiteWalkPhotos(session.portalUrl, session.access_token, { siteName: selectedSite, sitewalk: selectedSitewalk, tag, q: query });
      const walks = Array.isArray(data?.sitewalks) ? data.sitewalks : [];
      setSitewalks(walks);
      if (!selectedSitewalk && initialSitewalk) setSelectedSitewalk(initialSitewalk);
      else if (!selectedSitewalk && walks.length) setSelectedSitewalk(clean(walks[0]?.value || walks[0]?.sitewalk_desc || walks[0]));
      const serverItems = Array.isArray(data?.items) ? data.items : [];
      const fallback = fallbackPhotoFromPin(initialRedlinePhotoPin);
      const merged = fallback && !serverItems.some((item) => String(item?.id || '') === String(fallback.id)) ? [fallback, ...serverItems] : serverItems;
      setPhotos(merged);
      if (initialPhotoId || fallback) {
        const match = merged.find((item) => String(item?.id || '') === String(initialPhotoId)) || fallback || null;
        if (match) setSelected(match);
      }
    } catch (error) {
      Alert.alert('SiteWalk Photos', error?.message || 'Unable to load SiteWalk photos.');
    } finally { setLoading(false); setRefreshing(false); }
  }, [session?.portalUrl, session?.access_token, selectedSite, selectedSitewalk, tag, query, initialRedlinePhotoPin, initialPhotoId, initialSitewalk]);

  useEffect(() => { load(); }, [load]);
  const refresh = useCallback(() => { setRefreshing(true); load({ silent: true }); }, [load]);
  const data = useMemo(() => photos, [photos]);

  useEffect(() => {
    if (!selected) return;
    const photoKey = clean(selected?.photo_asset_id ? `asset-${selected.photo_asset_id}` : (selected?.id || selected?.photo_id));
    if (!photoKey || photoKey.startsWith('pin-photo-')) return;
    let active = true;
    setSelectedAnnotation(DEFAULT_ANNOTATION);
    setAnnotationLoading(true);
    const itemW = firstNumber(selected?.image_width, selected?.imageWidth, selected?.width);
    const itemH = firstNumber(selected?.image_height, selected?.imageHeight, selected?.height);
    if (itemW && itemH) setImageSize({ width: itemW, height: itemH });
    loadSubcontractorSiteWalkPhotoAnnotation(session.portalUrl, session.access_token, photoKey)
      .then((payload) => {
        if (!active) return;
        const normalized = normalizeAnnotationPayload(payload);
        setSelectedAnnotation(normalized);
        if (normalized.imageWidth && normalized.imageHeight) setImageSize({ width: normalized.imageWidth, height: normalized.imageHeight });
      })
      .catch(() => { if (active) setSelectedAnnotation(DEFAULT_ANNOTATION); })
      .finally(() => { if (active) setAnnotationLoading(false); });
    if (selectedUrl) Image.getSize(selectedUrl, (w, h) => active && setImageSize({ width: Math.max(1, w), height: Math.max(1, h) }), () => {});
    return () => { active = false; };
  }, [selected, selectedUrl, session?.portalUrl, session?.access_token]);

  return (
    <ScreenShell title="SiteWalk Photos" subtitle={selectedSite} onBack={onBack} onHome={onHome} backgroundSource={require('../../assets/subcontractor-home-background.png')}>
      <View style={styles.wrap}>
        <View style={styles.toolbarCard}>
          <TextInput value={query} onChangeText={setQuery} placeholder="Search photos" placeholderTextColor="#71839b" style={styles.search} returnKeyType="search" onSubmitEditing={() => load({ silent: true })} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{sitewalks.map((walk, idx) => { const value = clean(walk?.value || walk?.sitewalk_desc || walk) || `SiteWalk ${idx + 1}`; return <Pressable key={`${value}-${idx}`} onPress={() => { setSelectedSitewalk(value); setTag('All'); }} style={[styles.chip, selectedSitewalk === value && styles.chipActive]}><Text style={[styles.chipText, selectedSitewalk === value && styles.chipTextActive]}>{value}</Text></Pressable>; })}</ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{TAGS.map((value) => <Pressable key={value} onPress={() => setTag(value)} style={[styles.tag, tag === value && styles.tagActive]}><Text style={[styles.tagText, tag === value && styles.tagTextActive]}>{value}</Text></Pressable>)}</ScrollView>
        </View>
        {loading ? <View style={styles.center}><ActivityIndicator color={colors.blue} /><Text style={styles.muted}>Loading photos…</Text></View> : <FlatList data={data} key={columns} numColumns={columns} keyExtractor={(item, index) => String(item?.id || index)} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} contentContainerStyle={styles.list} renderItem={({ item }) => <Pressable style={[styles.cardWrap, { width: `${100 / columns}%` }]} onPress={() => setSelected(item)}><View style={styles.photoCard}>{photoUrl(session.portalUrl, item) ? <Image source={{ uri: photoUrl(session.portalUrl, item) }} style={styles.thumb} /> : <View style={[styles.thumb, styles.noImage]}><Text style={styles.noImageText}>No Image</Text></View>}<View style={styles.cardBody}><Text style={styles.photoTitle} numberOfLines={2}>{photoTitle(item)}</Text><Text style={styles.meta} numberOfLines={1}>{clean(item?.tag) || 'Untagged'}{clean(item?.sitewalk_desc) ? ` · ${clean(item.sitewalk_desc)}` : ''}</Text></View></View></Pressable>} ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyTitle}>No photos found</Text><Text style={styles.muted}>This subcontractor view only shows SiteWalk photos allowed for this site/SiteWalk.</Text></View>} />}
      </View>
      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={closeSelected}>
        <View style={styles.modalBg}><View style={styles.viewer}><View style={styles.viewerHeader}><View style={{ flex: 1 }}><Text style={styles.viewerTitle} numberOfLines={1}>{selected ? photoTitle(selected) : ''}</Text>{annotationLoading ? <Text style={styles.viewerSub}>Loading annotations…</Text> : null}</View><Pressable style={styles.closeBtn} onPress={closeSelected}><Text style={styles.closeText}>Close</Text></Pressable></View>{selected ? <View style={styles.imageStage}><View style={{ width: previewBox.width, height: previewBox.height }}><Image source={{ uri: selectedUrl }} style={{ width: previewBox.width, height: previewBox.height, backgroundColor: '#020617' }} resizeMode="contain" /><AnnotationOverlay annotation={selectedAnnotation} imageSize={imageSize} displaySize={previewBox} /></View></View> : null}<Text style={styles.viewerMeta}>{clean(selected?.note || selected?.caption)}</Text></View></View>
      </Modal>
    </ScreenShell>
  );
}
const styles = StyleSheet.create({
  wrap:{flex:1}, toolbarCard:{margin:12,padding:12,borderRadius:22,backgroundColor:'rgba(255,255,255,0.92)',borderWidth:1,borderColor:colors.line,gap:10}, search:{backgroundColor:'#fff',borderWidth:1,borderColor:colors.line,borderRadius:16,paddingHorizontal:14,paddingVertical:11,color:colors.text,fontWeight:'800'}, chips:{gap:8,paddingRight:8}, chip:{paddingHorizontal:12,paddingVertical:9,borderRadius:999,backgroundColor:'#eef6ff',borderWidth:1,borderColor:'#c8def6'}, chipActive:{backgroundColor:'#10233f',borderColor:'#10233f'}, chipText:{fontWeight:'900',color:'#31506d'}, chipTextActive:{color:'#fff'}, tag:{paddingHorizontal:11,paddingVertical:8,borderRadius:999,backgroundColor:'#fff',borderWidth:1,borderColor:colors.line}, tagActive:{backgroundColor:colors.blue,borderColor:colors.blue}, tagText:{fontWeight:'900',color:colors.muted}, tagTextActive:{color:'#fff'}, center:{flex:1,alignItems:'center',justifyContent:'center',gap:10}, muted:{color:colors.muted,fontWeight:'800'}, list:{padding:8,paddingBottom:30}, cardWrap:{padding:6}, photoCard:{backgroundColor:'#fff',borderRadius:18,borderWidth:1,borderColor:colors.line,overflow:'hidden',shadowColor:'#0f172a',shadowOpacity:.06,shadowRadius:10,shadowOffset:{width:0,height:5},elevation:2}, thumb:{width:'100%',aspectRatio:1.12,backgroundColor:'#dbe7f2'}, noImage:{alignItems:'center',justifyContent:'center'}, noImageText:{color:colors.muted,fontWeight:'900'}, cardBody:{padding:10}, photoTitle:{color:colors.text,fontWeight:'900',fontSize:14,lineHeight:18}, meta:{marginTop:4,color:colors.muted,fontWeight:'800',fontSize:11}, empty:{padding:26,alignItems:'center'}, emptyTitle:{fontSize:18,fontWeight:'900',color:colors.text,marginBottom:6}, modalBg:{flex:1,backgroundColor:'rgba(0,0,0,.82)',padding:14,justifyContent:'center'}, viewer:{height:'90%',backgroundColor:'#071220',borderRadius:24,overflow:'hidden',borderWidth:1,borderColor:'#334155'}, viewerHeader:{flexDirection:'row',alignItems:'center',gap:10,padding:12,borderBottomWidth:1,borderBottomColor:'#26364e'}, viewerTitle:{color:'#fff',fontWeight:'900',fontSize:16}, viewerSub:{color:'#cbd5e1',fontWeight:'800',fontSize:11,marginTop:2}, closeBtn:{paddingHorizontal:13,paddingVertical:8,borderRadius:999,backgroundColor:'#fff'}, closeText:{color:colors.blue,fontWeight:'900'}, imageStage:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:'#020617'}, viewerMeta:{padding:12,color:'#cbd5e1',fontWeight:'800'}
});

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import ScreenShell, { colors } from '../components/ScreenShell';
import { loadSubcontractorSiteWalkPhotos, subcontractorMediaUrl } from '../api/subcontractorApi';

const TAGS = ['All', 'Antenna', 'Node', 'Cores', 'Miscellaneous', 'IDF / ER', 'Electrical'];
const clean = (v) => String(v ?? '').trim();
const siteName = (project) => clean(project?.site_name || project?.name || project?.label || project);
const photoTitle = (p) => clean(p?.name || p?.caption || p?.file_name || `Photo ${p?.id || ''}`) || 'SiteWalk Photo';
const photoUrl = (portalUrl, p) => subcontractorMediaUrl(portalUrl, p?.thumb_url || p?.url || p?.public_url || p?.image_url);
const fullPhotoUrl = (portalUrl, p) => subcontractorMediaUrl(portalUrl, p?.url || p?.public_url || p?.thumb_url || p?.image_url);

export default function SubcontractorSiteWalkPhotosScreen({ session, project, onBack, onHome }) {
  const { width } = useWindowDimensions();
  const columns = width >= 980 ? 4 : width >= 680 ? 3 : 2;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sitewalks, setSitewalks] = useState([]);
  const [selectedSitewalk, setSelectedSitewalk] = useState('');
  const [tag, setTag] = useState('All');
  const [query, setQuery] = useState('');
  const [photos, setPhotos] = useState([]);
  const [selected, setSelected] = useState(null);
  const selectedSite = siteName(project);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!selectedSite) return;
    if (!silent) setLoading(true);
    try {
      const data = await loadSubcontractorSiteWalkPhotos(session.portalUrl, session.access_token, { siteName: selectedSite, sitewalk: selectedSitewalk, tag, q: query });
      const walks = Array.isArray(data?.sitewalks) ? data.sitewalks : [];
      setSitewalks(walks);
      if (!selectedSitewalk && walks.length) setSelectedSitewalk(clean(walks[0]?.value || walks[0]?.sitewalk_desc || walks[0]));
      setPhotos(Array.isArray(data?.items) ? data.items : []);
    } catch (error) {
      Alert.alert('SiteWalk Photos', error?.message || 'Unable to load SiteWalk photos.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session?.portalUrl, session?.access_token, selectedSite, selectedSitewalk, tag, query]);

  useEffect(() => { load(); }, [load]);
  const refresh = useCallback(() => { setRefreshing(true); load({ silent: true }); }, [load]);
  const data = useMemo(() => photos, [photos]);

  return (
    <ScreenShell title="SiteWalk Photos" subtitle={selectedSite} onBack={onBack} onHome={onHome}>
      <View style={styles.wrap}>
        <View style={styles.toolbarCard}>
          <TextInput value={query} onChangeText={setQuery} placeholder="Search photos" placeholderTextColor="#71839b" style={styles.search} returnKeyType="search" onSubmitEditing={() => load({ silent: true })} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {sitewalks.map((walk, idx) => {
              const value = clean(walk?.value || walk?.sitewalk_desc || walk) || `SiteWalk ${idx + 1}`;
              return <Pressable key={`${value}-${idx}`} onPress={() => setSelectedSitewalk(value)} style={[styles.chip, selectedSitewalk === value && styles.chipActive]}><Text style={[styles.chipText, selectedSitewalk === value && styles.chipTextActive]}>{value}</Text></Pressable>;
            })}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {TAGS.map((value) => <Pressable key={value} onPress={() => setTag(value)} style={[styles.tag, tag === value && styles.tagActive]}><Text style={[styles.tagText, tag === value && styles.tagTextActive]}>{value}</Text></Pressable>)}
          </ScrollView>
        </View>
        {loading ? <View style={styles.center}><ActivityIndicator color={colors.blue} /><Text style={styles.muted}>Loading photos…</Text></View> : (
          <FlatList data={data} key={columns} numColumns={columns} keyExtractor={(item, index) => String(item?.id || index)} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} contentContainerStyle={styles.list} renderItem={({ item }) => (
            <Pressable style={[styles.cardWrap, { width: `${100 / columns}%` }]} onPress={() => setSelected(item)}>
              <View style={styles.photoCard}>
                {photoUrl(session.portalUrl, item) ? <Image source={{ uri: photoUrl(session.portalUrl, item) }} style={styles.thumb} /> : <View style={[styles.thumb, styles.noImage]}><Text style={styles.noImageText}>No Image</Text></View>}
                <View style={styles.cardBody}><Text style={styles.photoTitle} numberOfLines={2}>{photoTitle(item)}</Text><Text style={styles.meta} numberOfLines={1}>{clean(item?.tag) || 'Untagged'}{clean(item?.sitewalk_desc) ? ` · ${clean(item.sitewalk_desc)}` : ''}</Text></View>
              </View>
            </Pressable>
          )} ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyTitle}>No photos found</Text><Text style={styles.muted}>This subcontractor view only shows SiteWalk photos allowed for this site/SiteWalk.</Text></View>} />
        )}
      </View>
      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalBg}><View style={styles.viewer}><View style={styles.viewerHeader}><Text style={styles.viewerTitle} numberOfLines={1}>{selected ? photoTitle(selected) : ''}</Text><Pressable style={styles.closeBtn} onPress={() => setSelected(null)}><Text style={styles.closeText}>Close</Text></Pressable></View>{selected ? <Image source={{ uri: fullPhotoUrl(session.portalUrl, selected) }} style={styles.fullImage} resizeMode="contain" /> : null}<Text style={styles.viewerMeta}>{clean(selected?.note || selected?.caption)}</Text></View></View>
      </Modal>
    </ScreenShell>
  );
}
const styles = StyleSheet.create({
  wrap:{flex:1}, toolbarCard:{margin:12,padding:12,borderRadius:22,backgroundColor:'rgba(255,255,255,0.92)',borderWidth:1,borderColor:colors.line,gap:10}, search:{backgroundColor:'#fff',borderWidth:1,borderColor:colors.line,borderRadius:16,paddingHorizontal:14,paddingVertical:11,color:colors.text,fontWeight:'800'}, chips:{gap:8,paddingRight:8}, chip:{paddingHorizontal:12,paddingVertical:9,borderRadius:999,backgroundColor:'#eef6ff',borderWidth:1,borderColor:'#c8def6'}, chipActive:{backgroundColor:'#10233f',borderColor:'#10233f'}, chipText:{fontWeight:'900',color:'#31506d'}, chipTextActive:{color:'#fff'}, tag:{paddingHorizontal:11,paddingVertical:8,borderRadius:999,backgroundColor:'#fff',borderWidth:1,borderColor:colors.line}, tagActive:{backgroundColor:colors.blue,borderColor:colors.blue}, tagText:{fontWeight:'900',color:colors.muted}, tagTextActive:{color:'#fff'}, center:{flex:1,alignItems:'center',justifyContent:'center',gap:10}, muted:{color:colors.muted,fontWeight:'800'}, list:{padding:8,paddingBottom:30}, cardWrap:{padding:6}, photoCard:{backgroundColor:'#fff',borderRadius:18,borderWidth:1,borderColor:colors.line,overflow:'hidden',shadowColor:'#0f172a',shadowOpacity:.06,shadowRadius:10,shadowOffset:{width:0,height:5},elevation:2}, thumb:{width:'100%',aspectRatio:1.12,backgroundColor:'#dbe7f2'}, noImage:{alignItems:'center',justifyContent:'center'}, noImageText:{color:colors.muted,fontWeight:'900'}, cardBody:{padding:10}, photoTitle:{color:colors.text,fontWeight:'900',fontSize:14,lineHeight:18}, meta:{marginTop:4,color:colors.muted,fontWeight:'800',fontSize:11}, empty:{padding:26,alignItems:'center'}, emptyTitle:{fontSize:18,fontWeight:'900',color:colors.text,marginBottom:6}, modalBg:{flex:1,backgroundColor:'rgba(0,0,0,.76)',padding:14,justifyContent:'center'}, viewer:{height:'88%',backgroundColor:'#071220',borderRadius:24,overflow:'hidden',borderWidth:1,borderColor:'#334155'}, viewerHeader:{flexDirection:'row',alignItems:'center',gap:10,padding:12,borderBottomWidth:1,borderBottomColor:'#26364e'}, viewerTitle:{flex:1,color:'#fff',fontWeight:'900',fontSize:16}, closeBtn:{paddingHorizontal:13,paddingVertical:8,borderRadius:999,backgroundColor:'#fff'}, closeText:{color:colors.blue,fontWeight:'900'}, fullImage:{flex:1,backgroundColor:'#020617'}, viewerMeta:{padding:12,color:'#cbd5e1',fontWeight:'800'}
});

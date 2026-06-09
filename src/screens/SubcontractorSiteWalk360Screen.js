import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { WebView } from 'react-native-webview';
import ScreenShell, { colors } from '../components/ScreenShell';
import { loadSubcontractorRedlinePin360, loadSubcontractorSiteWalk360, loadSubcontractorSiteWalk360Annotations, subcontractorMediaUrl } from '../api/subcontractorApi';

const TAGS = ['All', 'Antenna', 'Node', 'Cores', 'Miscellaneous', 'IDF / ER', 'Electrical'];
const clean = (v) => String(v ?? '').trim();
const siteName = (project) => clean(project?.site_name || project?.name || project?.label || project);
const media = (portalUrl, p) => subcontractorMediaUrl(portalUrl, p?.thumb_url || p?.thumbnail_url || p?.public_url || p?.url || p?.image_url || p?.photo_url);
const full = (portalUrl, p) => subcontractorMediaUrl(portalUrl, p?.public_url || p?.url || p?.photo_url || p?.full_url || p?.image_url || p?.thumb_url);
const pin360Id = (pin) => clean(pin?.matching_360_photo_id || pin?.photo_360_id || pin?.site_walk_360_id || pin?.sitewalk_360_id || pin?.linked_360_photo_id);
const pin360Url = (pin) => clean(pin?.matching_360_photo_url || pin?.photo_360_url || pin?.panorama_url || pin?.pano_url || pin?.url);
const pin360Thumb = (pin) => clean(pin?.matching_360_thumb_url || pin?.photo_360_thumb_url || pin?.pano_thumb_url || pin?.thumb_360_url || pin360Url(pin));

const mimeFromUrl = (url) => {
  const lower = clean(url).split('?')[0].toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
};

async function preparePanoImageForWebView({ portalUrl, token, item }) {
  const sourceUrl = full(portalUrl, item);
  if (!sourceUrl) return '';
  if (/^data:/i.test(sourceUrl) || /^file:/i.test(sourceUrl)) return sourceUrl;
  const encodedUrl = encodeURI(sourceUrl);
  const ext = mimeFromUrl(sourceUrl) === 'image/png' ? 'png' : mimeFromUrl(sourceUrl) === 'image/webp' ? 'webp' : 'jpg';
  const target = `${FileSystem.cacheDirectory || ''}subcontractor-pano-${clean(item?.id) || Date.now()}.${ext}`;
  const download = await FileSystem.downloadAsync(encodedUrl, target, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (download?.status && Number(download.status) >= 400) {
    throw new Error(`The portal returned ${download.status} while downloading the 360 photo.`);
  }
  const info = await FileSystem.getInfoAsync(download.uri).catch(() => null);
  if (!info?.exists || Number(info?.size || 0) < 128) {
    throw new Error('The 360 photo download was empty.');
  }
  const base64 = await FileSystem.readAsStringAsync(download.uri, { encoding: FileSystem.EncodingType.Base64 });
  return `data:${mimeFromUrl(sourceUrl)};base64,${base64}`;
}


function fallback360FromPin(pin) {
  const id = pin360Id(pin);
  const url = pin360Url(pin);
  const thumb = pin360Thumb(pin);
  if (!id && !url && !thumb) return null;
  return {
    id: id || `pin-360-${clean(pin?.id) || Date.now()}`,
    name: clean(pin?.matching_360_photo_name || pin?.label || pin?.sr_location || pin?.sr_task) || '360 Photo',
    caption: clean(pin?.label || pin?.sr_location || pin?.sr_task),
    tag: clean(pin?.tag),
    sitewalk_desc: clean(pin?.sitewalk_desc || pin?.site_walk_desc),
    note: clean(pin?.note || pin?.text),
    redline_pin_id: pin?.id || pin?.redline_pin_id || null,
    redline_page_id: pin?.page_id || pin?.redline_page_id || null,
    public_url: url || thumb,
    url: url || thumb,
    thumb_url: thumb || url,
    __from_redline_pin: true,
  };
}

function sameCleanValue(a, b) {
  const left = clean(a);
  const right = clean(b);
  return !!left && !!right && left === right;
}

function urlsMatch(a, b) {
  const left = clean(a).split('?')[0];
  const right = clean(b).split('?')[0];
  if (!left || !right) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
}

function findServer360ForRedlinePin(serverItems, pin) {
  if (!Array.isArray(serverItems) || !serverItems.length || !pin) return null;
  const photoId = pin360Id(pin);
  const pinId = clean(pin?.id || pin?.redline_pin_id);
  const pageId = clean(pin?.page_id || pin?.redline_page_id);
  const pinUrl = pin360Url(pin);
  const pinThumb = pin360Thumb(pin);

  return serverItems.find((item) => sameCleanValue(item?.id, photoId))
    || serverItems.find((item) => sameCleanValue(item?.redline_pin_id, pinId))
    || serverItems.find((item) => sameCleanValue(item?.linked_redline_pin_id, pinId))
    || serverItems.find((item) => sameCleanValue(item?.pin_id, pinId))
    || serverItems.find((item) => sameCleanValue(item?.redline_page_id, pageId) && urlsMatch(full('', item), pinUrl || pinThumb))
    || serverItems.find((item) => urlsMatch(full('', item), pinUrl || pinThumb) || urlsMatch(media('', item), pinThumb || pinUrl))
    || null;
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function buildPanoHtml({ imageUrl, annotations = [] }) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>
    html,body{margin:0;height:100%;overflow:hidden;background:#020617;color:#fff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;touch-action:none;}
    #gl{position:absolute;inset:0;width:100%;height:100%;display:block;background:#020617;}
    #anno{position:absolute;inset:0;pointer-events:none;}
    .hint{position:absolute;left:14px;right:14px;bottom:14px;border-radius:16px;padding:10px 12px;background:rgba(2,6,23,.68);font-weight:800;text-align:center;font-size:13px;}
    .status{position:absolute;left:16px;right:16px;top:50%;transform:translateY(-50%);text-align:center;font-weight:900;color:#cbd5e1;}
  </style></head><body><canvas id="gl"></canvas><svg id="anno"></svg><div id="status" class="status">Loading 360 photo…</div><div class="hint">Drag to look around · pinch to zoom</div><script>
(function(){
  var imageUrl=${safeJson(imageUrl || '')};
  var annotations=${safeJson(Array.isArray(annotations) ? annotations : [])};
  var canvas=document.getElementById('gl'), status=document.getElementById('status'), svg=document.getElementById('anno');
  var gl=canvas.getContext('webgl')||canvas.getContext('experimental-webgl');
  var yaw=0,pitch=0,fov=82,drag=null,lastDist=0,texture=null,program=null,buffer=null;
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
  function wrap(v){while(v>180)v-=360;while(v<=-180)v+=360;return v;}
  function show(msg){status.textContent=msg||'';status.style.display=msg?'block':'none';}
  function shader(type,src){var s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
  function init(){
    if(!gl){show('This device cannot open the native 360 viewer.');return;}
    var vs=shader(gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}');
    var fs=shader(gl.FRAGMENT_SHADER,'precision mediump float;uniform sampler2D tex;uniform vec2 res;uniform float yaw;uniform float pitch;uniform float fov;const float PI=3.141592653589793;void main(){float hf=radians(fov);float fx=res.x/(2.0*tan(hf*0.5));vec2 sc=vec2(gl_FragCoord.x,res.y-gl_FragCoord.y);float x1=(sc.x-res.x*.5)/fx;float y1=(res.y*.5-sc.y)/fx;float z1=1.0;float cp=cos(radians(pitch));float sp=sin(radians(pitch));float y=cp*y1+sp*z1;float z2=-sp*y1+cp*z1;float yr=radians(-yaw);float cy=cos(yr);float sy=sin(yr);float x=cy*x1-sy*z2;float z=sy*x1+cy*z2;vec3 dir=normalize(vec3(x,y,z));float lon=atan(dir.x,dir.z);float lat=asin(clamp(dir.y,-1.0,1.0));vec2 uv=vec2(fract(.5+lon/(2.0*PI)),.5-lat/PI);gl_FragColor=texture2D(tex,uv);}');
    program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
    buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    resize();
  }
  function resize(){var dpr=window.devicePixelRatio||1;canvas.width=Math.max(1,Math.floor(innerWidth*dpr));canvas.height=Math.max(1,Math.floor(innerHeight*dpr));canvas.style.width=innerWidth+'px';canvas.style.height=innerHeight+'px';svg.setAttribute('width',innerWidth);svg.setAttribute('height',innerHeight);render();}
  function render(){if(!gl||!program||!texture)return;gl.viewport(0,0,canvas.width,canvas.height);gl.useProgram(program);var loc=gl.getAttribLocation(program,'p');gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(gl.getUniformLocation(program,'tex'),0);gl.uniform2f(gl.getUniformLocation(program,'res'),canvas.width,canvas.height);gl.uniform1f(gl.getUniformLocation(program,'yaw'),yaw);gl.uniform1f(gl.getUniformLocation(program,'pitch'),pitch);gl.uniform1f(gl.getUniformLocation(program,'fov'),fov);gl.drawArrays(gl.TRIANGLES,0,6);renderAnnotations();}
  function load(){if(!imageUrl){show('No 360 photo URL was returned.');return;}var img=new Image();img.crossOrigin='anonymous';img.onload=function(){texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);show('');render();};img.onerror=function(){show('Unable to load this 360 photo.');};img.src=imageUrl;}
  function rad(v){return v*Math.PI/180;}
  function yawPitchToScreen(pt){var py=rad(Number(pt.yaw||0)), pp=rad(Number(pt.pitch||0));var x=Math.cos(pp)*Math.sin(py), y=Math.sin(pp), z=Math.cos(pp)*Math.cos(py);var yr=rad(-yaw), cy=Math.cos(yr), sy=Math.sin(yr);var x1=cy*x+sy*z, z1=-sy*x+cy*z;var pr=rad(pitch), cp=Math.cos(pr), sp=Math.sin(pr);var y2=cp*y-sp*z1, z2=sp*y+cp*z1;if(z2<=0.05)return null;var scale=(innerWidth/(2*Math.tan(rad(fov)*.5)));return {x:innerWidth*.5+(x1/z2)*scale,y:innerHeight*.5-(y2/z2)*scale};}
  function annPoints(a){var g=a.geometry_json||a.geometry||{};if(typeof g==='string'){try{g=JSON.parse(g)}catch(e){g={}}}return Array.isArray(a.points)?a.points:(Array.isArray(g.points)?g.points:[]);}
  function renderAnnotations(){while(svg.firstChild)svg.removeChild(svg.firstChild);annotations.forEach(function(a){var pts=annPoints(a).map(yawPitchToScreen).filter(Boolean);if(pts.length<2)return;var path=document.createElementNS('http://www.w3.org/2000/svg','polyline');path.setAttribute('points',pts.map(function(p){return p.x+','+p.y}).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke',a.color||'#ef4444');path.setAttribute('stroke-width',Math.max(2,Number(a.stroke_width||3)));path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');svg.appendChild(path);});}
  function dist(t){if(!t||t.length<2)return 0;var dx=t[0].clientX-t[1].clientX,dy=t[0].clientY-t[1].clientY;return Math.sqrt(dx*dx+dy*dy);}
  window.addEventListener('resize',resize);
  canvas.addEventListener('pointerdown',function(e){canvas.setPointerCapture&&canvas.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,yaw:yaw,pitch:pitch};e.preventDefault();},{passive:false});
  canvas.addEventListener('pointermove',function(e){if(!drag)return;yaw=wrap(drag.yaw-((e.clientX-drag.x)/Math.max(1,innerWidth))*fov*1.35);pitch=clamp(drag.pitch+((e.clientY-drag.y)/Math.max(1,innerHeight))*fov,-89,89);render();e.preventDefault();},{passive:false});
  canvas.addEventListener('pointerup',function(){drag=null;});canvas.addEventListener('pointercancel',function(){drag=null;});
  canvas.addEventListener('wheel',function(e){fov=clamp(fov+(e.deltaY>0?6:-6),35,110);render();e.preventDefault();},{passive:false});
  canvas.addEventListener('touchmove',function(e){if(e.touches.length===2){var d=dist(e.touches);if(lastDist){fov=clamp(fov+((lastDist-d)/Math.max(1,innerWidth))*120,35,110);render();}lastDist=d;e.preventDefault();}},{passive:false});
  canvas.addEventListener('touchend',function(){lastDist=0;});
  try{init();load();}catch(e){show(String(e&&e.message||e));}
})();
</script></body></html>`;
}

export default function SubcontractorSiteWalk360Screen({ session, project, initialRedline360Pin, onBack, onHome }) {
  const { width } = useWindowDimensions();
  const columns = width >= 980 ? 3 : width >= 680 ? 2 : 1;
  const webRef = useRef(null);
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [sitewalks,setSitewalks]=useState([]);
  const [selectedSitewalk,setSelectedSitewalk]=useState('');
  const [tag,setTag]=useState('All');
  const [query,setQuery]=useState('');
  const [items,setItems]=useState([]);
  const [selected,setSelected]=useState(null);
  const [panoImageUrl,setPanoImageUrl]=useState('');
  const [panoPreparing,setPanoPreparing]=useState(false);
  const [annotations,setAnnotations]=useState([]);
  const [annotationLoading,setAnnotationLoading]=useState(false);
  const selectedSite=siteName(project);
  const initial360Id=pin360Id(initialRedline360Pin);
  const initialSitewalk=clean(initialRedline360Pin?.sitewalk_desc || initialRedline360Pin?.site_walk_desc);
  const openedFromRedlinePin=Boolean(clean(initialRedline360Pin?.id || initialRedline360Pin?.redline_pin_id));
  const closeSelected=useCallback(()=>{
    if(openedFromRedlinePin && typeof onBack==='function'){
      onBack();
      return;
    }
    setSelected(null);
  },[openedFromRedlinePin,onBack]);

  const load=useCallback(async({silent=false}={})=>{
    if(!selectedSite)return;
    if(!silent)setLoading(true);
    try{
      const requestedSitewalk = selectedSitewalk || initialSitewalk || '';
      const fallback=fallback360FromPin(initialRedline360Pin);
      const redlinePinId=clean(initialRedline360Pin?.id || initialRedline360Pin?.redline_pin_id);

      if(redlinePinId){
        // Opening from the PDF editor needs the pin-specific endpoint.  The normal
        // 360 list can still be correct, but it can miss older rows where the
        // SiteWalk 360 record is linked by the same matching rules that draw the
        // blue 360 ring instead of by redline_pin_id/sitewalk_desc directly.
        const pinData=await loadSubcontractorRedlinePin360(session.portalUrl,session.access_token,redlinePinId,{photoId:initial360Id});
        const pinPhotos=Array.isArray(pinData?.photos)?pinData.photos:[];
        const nextItems=pinPhotos.length ? pinPhotos : (pinData?.latest_photo ? [pinData.latest_photo] : (fallback ? [fallback] : []));
        setItems(nextItems);
        if(nextItems.length){
          const preferredId=clean(pinData?.selected_photo_id || initial360Id);
          const match=nextItems.find((item)=>preferredId && String(item?.id||'')===String(preferredId)) || nextItems[0];
          setSelected(match);
        }
        if(!sitewalks.length && requestedSitewalk){
          setSitewalks([{value:requestedSitewalk}]);
          if(!selectedSitewalk) setSelectedSitewalk(requestedSitewalk);
        }
        return;
      }

      const data=await loadSubcontractorSiteWalk360(session.portalUrl,session.access_token,{siteName:selectedSite,sitewalk:requestedSitewalk,tag,q:query});
      const walks=Array.isArray(data?.sitewalks)?data.sitewalks:[];
      setSitewalks(walks);
      if(!selectedSitewalk && requestedSitewalk) setSelectedSitewalk(requestedSitewalk);
      else if(!selectedSitewalk&&walks.length)setSelectedSitewalk(clean(walks[0]?.value||walks[0]?.sitewalk_desc||walks[0]));
      const serverItems=Array.isArray(data?.items)?data.items:[];
      const serverMatch=findServer360ForRedlinePin(serverItems, initialRedline360Pin);
      const merged=fallback && !serverMatch && !serverItems.some((item)=>String(item?.id||'')===String(fallback.id)) ? [fallback,...serverItems] : serverItems;
      setItems(merged);
      if(initial360Id || fallback){
        const match=serverMatch || merged.find((item)=>String(item?.id||'')===String(initial360Id)) || fallback || null;
        if(match) setSelected(match);
      }
    }catch(e){Alert.alert('SiteWalk 360',e?.message||'Unable to load SiteWalk 360 photos.')}
    finally{setLoading(false);setRefreshing(false)}
  },[session?.portalUrl,session?.access_token,selectedSite,selectedSitewalk,sitewalks.length,tag,query,initialRedline360Pin,initial360Id,initialSitewalk]);

  useEffect(()=>{load()},[load]);
  const refresh=()=>{setRefreshing(true);load({silent:true})};
  const data=useMemo(()=>items,[items]);

  useEffect(()=>{
    let cancelled=false;
    async function prepare(){
      setPanoImageUrl('');
      if(!selected){ setPanoPreparing(false); return; }
      setPanoPreparing(true);
      try{
        const prepared=await preparePanoImageForWebView({ portalUrl: session.portalUrl, token: session.access_token, item: selected });
        if(!cancelled) setPanoImageUrl(prepared);
      }catch(e){
        if(!cancelled){
          setPanoImageUrl('');
          Alert.alert('SiteWalk 360', e?.message || 'Unable to prepare this 360 photo.');
        }
      }finally{ if(!cancelled) setPanoPreparing(false); }
    }
    prepare();
    return()=>{cancelled=true};
  },[selected,session?.portalUrl,session?.access_token]);

  useEffect(()=>{
    let cancelled=false;
    async function fetchAnnotations(){
      if(!selected?.id || String(selected.id).startsWith('pin-360-')) { setAnnotations([]); return; }
      setAnnotationLoading(true);
      try{
        const payload=await loadSubcontractorSiteWalk360Annotations(session.portalUrl,session.access_token,selected.id);
        if(!cancelled) setAnnotations(Array.isArray(payload?.annotations)?payload.annotations:[]);
      }catch(_err){ if(!cancelled) setAnnotations([]); }
      finally{ if(!cancelled) setAnnotationLoading(false); }
    }
    fetchAnnotations();
    return()=>{cancelled=true};
  },[selected?.id,session?.portalUrl,session?.access_token]);

  const viewerHtml=useMemo(()=>buildPanoHtml({ imageUrl: panoImageUrl, annotations }),[panoImageUrl,annotations]);

  return <ScreenShell title="SiteWalk 360 Photos" subtitle={selectedSite} onBack={onBack} onHome={onHome} backgroundSource={require('../../assets/subcontractor-home-background.png')}><View style={styles.wrap}><View style={styles.toolbarCard}><TextInput value={query} onChangeText={setQuery} placeholder="Search 360 photos" placeholderTextColor="#71839b" style={styles.search} returnKeyType="search" onSubmitEditing={()=>load({silent:true})}/><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{sitewalks.map((walk,idx)=>{const value=clean(walk?.value||walk?.sitewalk_desc||walk)||`SiteWalk ${idx+1}`;return <Pressable key={`${value}-${idx}`} onPress={()=>setSelectedSitewalk(value)} style={[styles.chip,selectedSitewalk===value&&styles.chipActive]}><Text style={[styles.chipText,selectedSitewalk===value&&styles.chipTextActive]}>{value}</Text></Pressable>})}</ScrollView><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{TAGS.map(v=><Pressable key={v} onPress={()=>setTag(v)} style={[styles.tag,tag===v&&styles.tagActive]}><Text style={[styles.tagText,tag===v&&styles.tagTextActive]}>{v}</Text></Pressable>)}</ScrollView></View>{loading?<View style={styles.center}><ActivityIndicator color={colors.blue}/><Text style={styles.muted}>Loading 360 photos…</Text></View>:<FlatList data={data} key={columns} numColumns={columns} keyExtractor={(item,index)=>String(item?.id||index)} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh}/>} contentContainerStyle={styles.list} renderItem={({item})=><Pressable style={[styles.cardWrap,{width:`${100/columns}%`}]} onPress={()=>setSelected(item)}><View style={styles.photoCard}>{media(session.portalUrl,item)?<Image source={{uri:media(session.portalUrl,item)}} style={styles.thumb}/>:<View style={[styles.thumb,styles.noImage]}><Text style={styles.noImageText}>360</Text></View>}<View style={styles.cardBody}><Text style={styles.photoTitle} numberOfLines={2}>{clean(item?.name||item?.caption||item?.file_name)||'360 Photo'}</Text><Text style={styles.meta} numberOfLines={1}>{clean(item?.tag)||'Untagged'}{clean(item?.sitewalk_desc)?` · ${clean(item.sitewalk_desc)}`:''}</Text></View></View></Pressable>} ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyTitle}>No 360 photos found</Text><Text style={styles.muted}>This shows only allowed SiteWalk 360 photos for this subcontractor project.</Text></View>}/>}</View><Modal visible={!!selected} animationType="slide" onRequestClose={closeSelected}><ScreenShell title="360 Viewer" subtitle={clean(selected?.name||selected?.caption||selected?.file_name)} onBack={closeSelected} onHome={onHome}><View style={styles.nativeViewer}>{(annotationLoading||panoPreparing)?<View style={styles.annotationLoading}><ActivityIndicator color="#fff"/><Text style={styles.annotationLoadingText}>{panoPreparing?'Preparing 360 photo…':'Loading annotations…'}</Text></View>:null}<WebView ref={webRef} originWhitelist={['*']} source={{html:viewerHtml}} javaScriptEnabled domStorageEnabled allowFileAccess allowUniversalAccessFromFileURLs mixedContentMode="always" style={styles.webview}/></View></ScreenShell></Modal></ScreenShell>
}
const styles=StyleSheet.create({wrap:{flex:1},toolbarCard:{margin:12,padding:12,borderRadius:22,backgroundColor:'rgba(255,255,255,.92)',borderWidth:1,borderColor:colors.line,gap:10},search:{backgroundColor:'#fff',borderWidth:1,borderColor:colors.line,borderRadius:16,paddingHorizontal:14,paddingVertical:11,color:colors.text,fontWeight:'800'},chips:{gap:8,paddingRight:8},chip:{paddingHorizontal:12,paddingVertical:9,borderRadius:999,backgroundColor:'#eef6ff',borderWidth:1,borderColor:'#c8def6'},chipActive:{backgroundColor:'#10233f',borderColor:'#10233f'},chipText:{fontWeight:'900',color:'#31506d'},chipTextActive:{color:'#fff'},tag:{paddingHorizontal:11,paddingVertical:8,borderRadius:999,backgroundColor:'#fff',borderWidth:1,borderColor:colors.line},tagActive:{backgroundColor:colors.blue,borderColor:colors.blue},tagText:{fontWeight:'900',color:colors.muted},tagTextActive:{color:'#fff'},center:{flex:1,alignItems:'center',justifyContent:'center',gap:10},muted:{color:colors.muted,fontWeight:'800',textAlign:'center'},list:{padding:8,paddingBottom:30},cardWrap:{padding:6},photoCard:{backgroundColor:'rgba(255,255,255,.94)',borderRadius:18,borderWidth:1,borderColor:'rgba(190,214,239,.9)',overflow:'hidden',shadowColor:'#0f172a',shadowOpacity:.06,shadowRadius:10,shadowOffset:{width:0,height:5},elevation:2},thumb:{width:'100%',aspectRatio:1.72,backgroundColor:'#dbe7f2'},noImage:{alignItems:'center',justifyContent:'center'},noImageText:{color:colors.blue,fontWeight:'900',fontSize:30},cardBody:{padding:12},photoTitle:{color:colors.text,fontWeight:'900',fontSize:15,lineHeight:20},meta:{marginTop:5,color:colors.muted,fontWeight:'800',fontSize:12},empty:{padding:26,alignItems:'center',backgroundColor:'rgba(255,255,255,.88)',borderRadius:18,margin:12},emptyTitle:{fontSize:18,fontWeight:'900',color:colors.text,marginBottom:6},nativeViewer:{flex:1,backgroundColor:'#020617'},webview:{flex:1,backgroundColor:'#020617'},annotationLoading:{position:'absolute',zIndex:4,top:12,left:12,right:12,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:8,padding:9,borderRadius:14,backgroundColor:'rgba(2,6,23,.72)'},annotationLoadingText:{color:'#fff',fontWeight:'900',fontSize:12}})

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

function parseAnnotationPoints(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch (_err) { return []; }
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.points)) return parsed.points;
  return [];
}

function wrapYaw(value) {
  let yaw = Number(value || 0);
  while (yaw > 180) yaw -= 360;
  while (yaw <= -180) yaw += 360;
  return yaw;
}

function clampPitch(value) {
  const n = Number(value || 0);
  return Math.max(-89, Math.min(89, n));
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function pointHasYawPitch(point) {
  return point && point.yaw !== undefined && point.yaw !== null && point.pitch !== undefined && point.pitch !== null;
}

function pointToYawPitch(point) {
  return {
    yaw: (clamp01(point?.x) * 360) - 180,
    pitch: 90 - (clamp01(point?.y) * 180),
  };
}

function normalize360Annotation(row) {
  const rawPoints = parseAnnotationPoints(row?.points || row?.geometry_json || row?.geometry);
  const rawKind = clean(row?.kind || row?.type || 'polyline').toLowerCase();
  const kind = rawKind === 'draw' || rawKind === 'pencil' ? 'polyline' : rawKind;
  return {
    ...row,
    id: clean(row?.id || row?.annotation_id) || `ann-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind,
    color: clean(row?.color) || '#ef4444',
    stroke_width: Number(row?.stroke_width || row?.strokeWidth || 3) || 3,
    strokeWidth: Number(row?.stroke_width || row?.strokeWidth || 3) || 3,
    is_closed: Boolean(row?.is_closed || row?.isClosed || row?.closed),
    label: clean(row?.label || row?.text || row?.note),
    points: rawPoints
      .map((point) => {
        let spherical = null;
        if (Array.isArray(point)) {
          spherical = { yaw: Number(point[0] || 0), pitch: Number(point[1] || 0) };
        } else if (point && typeof point === 'object') {
          spherical = pointHasYawPitch(point) ? point : pointToYawPitch(point);
        }
        if (!spherical) return null;
        return { yaw: wrapYaw(spherical.yaw), pitch: clampPitch(spherical.pitch) };
      })
      .filter(Boolean),
  };
}

function buildPanoHtml({ imageUrl, annotations = [] }) {
  const config = { imageUrl, annotations: Array.isArray(annotations) ? annotations : [] };
  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<style>
html, body { margin:0; width:100%; height:100%; overflow:hidden; background:#020617; touch-action:none; user-select:none; -webkit-user-select:none; }
#wrap { position:fixed; inset:0; overflow:hidden; background:radial-gradient(circle at 50% 45%, #111827 0%, #020617 70%); }
#gl { position:absolute; inset:0; width:100%; height:100%; display:block; }
#overlay { position:absolute; inset:0; pointer-events:none; }
#shade { position:absolute; inset:0; pointer-events:none; background:radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.03) 0%, rgba(15,23,42,0.05) 48%, rgba(0,0,0,0.38) 100%); }
#status { position:absolute; left:12px; top:12px; max-width:calc(100% - 24px); border-radius:14px; padding:10px 12px; color:#fff; background:rgba(15,23,42,.78); font:800 13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; display:none; }
#hint { position:absolute; right:10px; bottom:10px; border-radius:14px; padding:8px 10px; color:#fff; background:rgba(15,23,42,.70); font:800 12px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; text-align:right; pointer-events:none; }
#hint small { display:block; color:#bfdbfe; font-size:10px; margin-top:2px; }
.ann-line { position:absolute; height:3px; border-radius:999px; transform-origin:0 50%; pointer-events:none; }
.ann-arrow-head { position:absolute; width:0; height:0; border-top:8px solid transparent; border-bottom:8px solid transparent; border-left:14px solid currentColor; transform-origin:0 50%; pointer-events:none; }
.ann-label { position:absolute; transform:translate(6px,-18px); padding:2px 6px; border-radius:8px; background:rgba(2,6,23,.68); color:#fff; font:900 13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; white-space:nowrap; text-shadow:0 1px 2px rgba(0,0,0,.8); pointer-events:none; }
</style>
</head>
<body>
<div id="wrap">
  <canvas id="gl"></canvas>
  <div id="overlay"></div>
  <div id="shade"></div>
  <div id="status">Loading 360 photo...</div>
  <div id="hint">Drag to look around<small>Pinch to zoom · full sphere</small></div>
</div>
<script>
(function(){
  var config = ${safeJson(config)};
  var canvas = document.getElementById('gl');
  var overlay = document.getElementById('overlay');
  var status = document.getElementById('status');
  var hint = document.getElementById('hint');
  var gl = null;
  var program = null;
  var texture = null;
  var buffer = null;
  var yaw = 0;
  var pitch = 0;
  var fov = 100;
  var annotations = Array.isArray(config.annotations) ? config.annotations : [];
  var touches = new Map();
  var dragStart = null;
  var pinchStart = null;
  var dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));

  function post(data){ try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(data)); } catch(e) {} }
  function showStatus(text){ status.style.display = text ? 'block' : 'none'; status.textContent = text || ''; }
  function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
  function wrap(v){ while(v > 180) v -= 360; while(v <= -180) v += 360; return v; }
  function rad(v){ return v * Math.PI / 180; }
  function esc(s){ return String(s || '').replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); }

  function resize(){
    var w = Math.max(1, Math.floor(window.innerWidth * dpr));
    var h = Math.max(1, Math.floor(window.innerHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      if (gl) gl.viewport(0, 0, w, h);
    }
    render();
  }

  function compile(type, source){
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Shader compile failed');
    return shader;
  }

  function initGl(){
    gl = canvas.getContext('webgl', { antialias:true, alpha:false, preserveDrawingBuffer:false }) || canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('This device did not provide a WebGL 360 viewer.');
    var vertex = compile(gl.VERTEX_SHADER, 'attribute vec2 a_pos; void main(){ gl_Position=vec4(a_pos,0.0,1.0); }');
    var fragment = compile(gl.FRAGMENT_SHADER, 'precision mediump float; uniform sampler2D u_tex; uniform vec2 u_res; uniform float u_yaw; uniform float u_pitch; uniform float u_fov; const float PI=3.141592653589793; void main(){ float hfov=radians(u_fov); float fx=u_res.x/(2.0*tan(hfov*0.5)); float fy=fx; vec2 screen=vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y); float x1=(screen.x-(u_res.x*0.5))/fx; float y2=((u_res.y*0.5)-screen.y)/fy; float z2=1.0; float cp=cos(radians(u_pitch)); float sp=sin(radians(u_pitch)); float y=(cp*y2)+(sp*z2); float z1=(-sp*y2)+(cp*z2); float yawRad=radians(-u_yaw); float cy=cos(yawRad); float sy=sin(yawRad); float x=(cy*x1)-(sy*z1); float z=(sy*x1)+(cy*z1); vec3 dir=normalize(vec3(x,y,z)); float lon=atan(dir.x, dir.z); float lat=asin(clamp(dir.y,-1.0,1.0)); vec2 uv=vec2(0.5 + lon/(2.0*PI), 0.5 - lat/PI); gl_FragColor=texture2D(u_tex, uv); }');
    program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Program link failed');
    gl.useProgram(program);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function loadImage(url){
    showStatus('Loading 360 photo...');
    var img = new Image();
    img.onload = function(){
      try {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        showStatus('');
        render();
      } catch(e) {
        showStatus('Unable to open this 360 photo in the dome viewer.');
        post({ type:'error', message:String(e && e.message || e) });
      }
    };
    img.onerror = function(){ showStatus('Unable to load the 360 photo image.'); post({ type:'error', message:'Unable to load the 360 photo image.' }); };
    img.src = url;
  }

  function render(){
    if (!gl || !program) return;
    gl.useProgram(program);
    gl.uniform2f(gl.getUniformLocation(program, 'u_res'), canvas.width, canvas.height);
    gl.uniform1f(gl.getUniformLocation(program, 'u_yaw'), yaw);
    gl.uniform1f(gl.getUniformLocation(program, 'u_pitch'), pitch);
    gl.uniform1f(gl.getUniformLocation(program, 'u_fov'), fov);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    renderAnnotations();
    hint.innerHTML = 'Drag to look around<small>Pinch to zoom · full sphere</small>';
  }

  function shortestAngleDelta(fromYaw, toYaw){ return wrap(Number(toYaw || 0) - Number(fromYaw || 0)); }
  function getProjectionState(){
    var width = Math.max(1, window.innerWidth || canvas.clientWidth || 1);
    var height = Math.max(1, window.innerHeight || canvas.clientHeight || 1);
    var hfov = rad(fov);
    var fx = width / (2 * Math.tan(hfov / 2));
    var vfov = 2 * Math.atan((height / width) * Math.tan(hfov / 2));
    var fy = height / (2 * Math.tan(vfov / 2));
    return { width:width, height:height, fx:fx, fy:fy };
  }
  function yawPitchToScreen(point){
    var state = getProjectionState();
    var pointYaw = Number(point && point.yaw || 0);
    var pointPitch = Number(point && point.pitch || 0);
    var yawDelta = rad(shortestAngleDelta(yaw, pointYaw));
    var pitchRad = rad(pointPitch);
    var x = Math.cos(pitchRad) * Math.sin(yawDelta);
    var y = Math.sin(pitchRad);
    var z = Math.cos(pitchRad) * Math.cos(yawDelta);
    var pitchRadView = rad(pitch);
    var cp = Math.cos(pitchRadView);
    var sp = Math.sin(pitchRadView);
    var y2 = (cp * y) - (sp * z);
    var z2 = (sp * y) + (cp * z);
    if (z2 <= 0.03) return null;
    return { x:state.width / 2 + (x / z2) * state.fx, y:state.height / 2 - (y2 / z2) * state.fy, visible:true };
  }
  function angularDistanceDegrees(a,b){
    var lat1=rad(a.pitch), lon1=rad(a.yaw), lat2=rad(b.pitch), lon2=rad(b.yaw);
    var sinDLat=Math.sin((lat2-lat1)/2), sinDLon=Math.sin((lon2-lon1)/2);
    var h=sinDLat*sinDLat + Math.cos(lat1)*Math.cos(lat2)*sinDLon*sinDLon;
    return (2*Math.asin(Math.min(1,Math.sqrt(Math.max(0,h))))) * 180 / Math.PI;
  }
  function destinationPointOnSphere(center,bearingDeg,distanceDeg){
    var lat1=rad(center.pitch), lon1=rad(center.yaw), brng=rad(bearingDeg), ang=rad(distanceDeg);
    var sinLat1=Math.sin(lat1), cosLat1=Math.cos(lat1), sinAng=Math.sin(ang), cosAng=Math.cos(ang);
    var lat2=Math.asin(sinLat1*cosAng + cosLat1*sinAng*Math.cos(brng));
    var lon2=lon1 + Math.atan2(Math.sin(brng)*sinAng*cosLat1, cosAng - sinLat1*Math.sin(lat2));
    return { yaw:wrap(lon2 * 180 / Math.PI), pitch:lat2 * 180 / Math.PI };
  }
  function circleSamples(annotation, sampleCount){
    var pts = annotation.points || [];
    if (pts.length < 2) return [];
    var center = { yaw:Number(pts[0].yaw), pitch:Number(pts[0].pitch) };
    var edge = { yaw:Number(pts[1].yaw), pitch:Number(pts[1].pitch) };
    var radiusDeg = angularDistanceDegrees(center, edge);
    if (!Number.isFinite(radiusDeg) || radiusDeg <= 0) return [];
    var samples = [];
    for (var i=0; i<=sampleCount; i++) samples.push(yawPitchToScreen(destinationPointOnSphere(center, (i / sampleCount) * 360, radiusDeg)));
    return samples;
  }
  function rectSphericalCorners(annotation){
    var pts = Array.isArray(annotation.points) ? annotation.points : [];
    if (pts.length < 2) return [];
    var p1 = pts[0], p2 = pts[1];
    return [
      { yaw:p1.yaw, pitch:p1.pitch },
      { yaw:p2.yaw, pitch:p1.pitch },
      { yaw:p2.yaw, pitch:p2.pitch },
      { yaw:p1.yaw, pitch:p2.pitch },
      { yaw:p1.yaw, pitch:p1.pitch }
    ];
  }
  function shapePoints(annotation){
    var pts = Array.isArray(annotation.points) ? annotation.points : [];
    if (annotation.kind === 'rectangle' || annotation.kind === 'rect') return rectSphericalCorners(annotation).map(yawPitchToScreen);
    return pts.map(yawPitchToScreen);
  }
  function lineEl(a, b, ann){
    if (!a || !b) return '';
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.sqrt(dx*dx + dy*dy);
    if (!isFinite(len) || len < 1 || len > window.innerWidth * 1.7) return '';
    var angle = Math.atan2(dy, dx);
    var sw = Math.max(1, Number(ann.strokeWidth || ann.stroke_width || 3));
    return '<div class="ann-line" style="left:' + a.x + 'px;top:' + (a.y - sw/2) + 'px;width:' + len + 'px;height:' + sw + 'px;background:' + esc(ann.color || '#ef4444') + ';transform:rotate(' + angle + 'rad)"></div>';
  }
  function arrowHeadEl(a, b, ann){
    if (!a || !b) return '';
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.sqrt(dx*dx + dy*dy);
    if (!isFinite(len) || len < 8 || len > window.innerWidth * 1.7) return '';
    var angle = Math.atan2(dy, dx);
    var color = esc(ann.color || '#ef4444');
    return '<div class="ann-arrow-head" style="left:' + b.x + 'px;top:' + (b.y - 8) + 'px;color:' + color + ';transform:rotate(' + angle + 'rad) translateX(-12px)"></div>';
  }
  function renderArrow(points, ann){ if (!points || points.length < 2) return ''; var a=points[0], b=points[points.length-1]; return lineEl(a,b,ann)+arrowHeadEl(a,b,ann); }
  function renderPolyline(points, ann){ var html=''; for (var i=1;i<points.length;i++) html += lineEl(points[i-1], points[i], ann); return html; }
  function renderLabel(point, ann){
    var text = String(ann.label || '').trim();
    if (!text || !point) return '';
    return '<div class="ann-label" style="left:' + point.x + 'px;top:' + point.y + 'px;color:' + esc(ann.color || '#ef4444') + '">' + esc(text) + '</div>';
  }
  function renderOneAnn(ann){
    var kind = String(ann.kind || ann.type || 'line').toLowerCase();
    var points = [];
    if (kind === 'circle' || kind === 'ellipse') points = circleSamples(ann, 96).filter(Boolean);
    else points = shapePoints(ann).filter(Boolean);
    if (points.length < 1) return '';
    var html = '';
    if (kind === 'arrow') html = renderArrow(points, ann);
    else html = renderPolyline(points, ann);
    html += renderLabel(points[0], ann);
    return html;
  }
  function renderAnnotations(){ overlay.innerHTML = annotations.map(renderOneAnn).join(''); }

  function touchDistance(){
    var arr = Array.from(touches.values());
    if (arr.length < 2) return 0;
    var dx = arr[0].x - arr[1].x;
    var dy = arr[0].y - arr[1].y;
    return Math.sqrt(dx*dx + dy*dy);
  }
  function pointerDown(e){
    e.preventDefault();
    touches.set(e.pointerId, { x:e.clientX, y:e.clientY });
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    if (touches.size === 2) { pinchStart = { distance: touchDistance(), fov:fov }; dragStart = null; return; }
    dragStart = { x:e.clientX, y:e.clientY, yaw:yaw, pitch:pitch };
  }
  function pointerMove(e){
    if (!touches.has(e.pointerId)) return;
    e.preventDefault();
    touches.set(e.pointerId, { x:e.clientX, y:e.clientY });
    if (touches.size >= 2 && pinchStart) {
      var ratio = touchDistance() / Math.max(1, pinchStart.distance || 1);
      fov = clamp(pinchStart.fov / Math.max(0.35, Math.min(2.5, ratio)), 35, 110);
      render();
      return;
    }
    if (!dragStart) return;
    yaw = wrap(dragStart.yaw - ((e.clientX - dragStart.x) / Math.max(1, window.innerWidth)) * fov * 1.25);
    pitch = clamp(dragStart.pitch + ((e.clientY - dragStart.y) / Math.max(1, window.innerHeight)) * fov, -89, 89);
    render();
  }
  function pointerUp(e){ touches.delete(e.pointerId); if (!touches.size) { dragStart=null; pinchStart=null; } }

  window.addEventListener('resize', resize);
  canvas.addEventListener('pointerdown', pointerDown, { passive:false });
  canvas.addEventListener('pointermove', pointerMove, { passive:false });
  canvas.addEventListener('pointerup', pointerUp, { passive:false });
  canvas.addEventListener('pointercancel', pointerUp, { passive:false });
  canvas.addEventListener('wheel', function(e){ fov = clamp(fov + (e.deltaY > 0 ? 6 : -6), 35, 110); render(); e.preventDefault(); }, { passive:false });

  try { initGl(); resize(); loadImage(config.imageUrl || ''); } catch(e) { showStatus(String(e && e.message || e)); post({ type:'error', message:String(e && e.message || e) }); }
})();
</script>
</body>
</html>`;
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
        const raw = Array.isArray(payload?.annotations) ? payload.annotations : (Array.isArray(payload?.items) ? payload.items : []);
        if(!cancelled) setAnnotations(raw.map(normalize360Annotation));
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

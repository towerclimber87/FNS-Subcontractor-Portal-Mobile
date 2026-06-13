import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  InteractionManager,
  Linking,
  Modal,
  PanResponder,
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
import { ANDROID_NAV_BAR_SAFE_OFFSET, withAndroidNavBottom } from '../utils/androidLayout';
import { getInsta360CameraStatus, requestX4WifiConnection, takeX4OscPhoto } from '../services/insta360Camera';

import { t } from '../i18n';

import {
  createMobileRedlineAnnotation,
  updateMobileRedlineAnnotation,
  createMobileRedlinePin,
  deleteMobileRedlineAnnotation,
  deleteMobileRedlinePin,
  deleteMobileRedline360Photo,
  loadMobilePhotoAssetUnseenCounts,
  loadMobilePhotoAssets,
  loadMobileRedlineDotOptions,
  loadMobileSiteWalkRedlineSites,
  loadMobileSiteWalkRedlines,
  loadMobileSiteWalkRedlinesPageData,
  loadMobileSiteWalkOfflineManifest,
  normalizePortalUrl,
  saveMobileRedlinePageOrder,
  saveMobileRedlineSitewalkPermission,
  saveMobileRedlineSiteWalkPhotoAnnotation,
  saveMobileRedline360PhotoAnnotations,
  updateMobileRedlinePin,
  uploadMobileRedlinePinPhoto,
  uploadMobileRedline360PinPhoto,
} from '../api/subcontractorApi';

const TOOL_SELECT = 'select';
const TOOL_LINE = 'line';
const TOOL_POLYLINE = 'polyline';
const TOOL_ARROW = 'arrow';
const TOOL_DRAW = 'draw';
const TOOL_RECT = 'rect';
const TOOL_CIRCLE = 'circle';
const TOOL_CLOUD = 'cloud';
const TOOL_PHOTO = 'photo';
const TOOL_LOCATION = 'location';
const TOOL_GRID = 'site_record_dot';
const TOOL_ICON = 'icon';
const TOOL_NOTE = 'note';
const TOOL_SEARCH = 'search';
const TOOL_WHITEBOARD = 'whiteboard';

const CATEGORY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'antenna', label: 'Antenna' },
  { key: 'node', label: 'Node' },
  { key: 'cores', label: 'Cores' },
  { key: 'misc', label: 'Misc' },
  { key: 'idf er', label: 'IDF / ER' },
  { key: 'electrical', label: 'Electrical' },
];

const DEFAULT_X4_WIFI_SSID = 'X4 0QB5CJ.OSC';
const DEFAULT_X4_WIFI_PASSWORD = '793PH4RS';
const X4_WIFI_SETTINGS_STORAGE_KEY = 'fns_insta360_x4_wifi_settings_v1';

const MARKUP_TOOLS = [
  { key: TOOL_LINE, label: 'Line' },
  { key: TOOL_POLYLINE, label: 'Polyline' },
  { key: TOOL_ARROW, label: 'Arrow' },
  { key: TOOL_DRAW, label: 'Pencil' },
  { key: TOOL_RECT, label: 'Square' },
  { key: TOOL_CIRCLE, label: 'Circle' },
  { key: TOOL_CLOUD, label: 'Cloud' },
  { key: TOOL_PHOTO, label: 'Camera' },
  { key: TOOL_LOCATION, label: 'Pin' },
  { key: TOOL_ICON, label: 'Icon' },
  { key: TOOL_NOTE, label: 'Note' },
];

const MARKUP_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#111827'];
const MARKUP_WIDTHS = [1, 2, 3, 5, 8];

const IMAGE_PICKER_IMAGE_OPTIONS = {
  mediaTypes: ['images'],
};

function imagePickerOptions(extra = {}) {
  return { ...IMAGE_PICKER_IMAGE_OPTIONS, ...extra };
}

function pauseForNativePicker(ms = 450) {
  return new Promise((resolve) => {
    InteractionManager.runAfterInteractions(() => setTimeout(resolve, ms));
  });
}

function permissionGranted(permission) {
  return Boolean(permission?.granted || permission?.status === 'granted');
}

function permissionCanAskAgain(permission) {
  return permission?.canAskAgain !== false;
}

function showPermissionSettingsAlert(title, message) {
  Alert.alert(title, message, [
    { text: t("Cancel"), style: 'cancel' },
    { text: t("Open Settings"), onPress: () => Linking.openSettings?.().catch(() => {}) },
  ]);
}

async function ensureCameraPermission() {
  try {
    const current = await ImagePicker.getCameraPermissionsAsync?.();
    if (permissionGranted(current)) return true;
    if (current && !permissionCanAskAgain(current)) {
      showPermissionSettingsAlert(
        'Camera Permission Needed',
        'Camera access is turned off for FNS Employee Portal. Open Settings and allow Camera access to take a photo.'
      );
      return false;
    }
    const requested = await ImagePicker.requestCameraPermissionsAsync();
    if (permissionGranted(requested)) return true;
    if (!permissionCanAskAgain(requested)) {
      showPermissionSettingsAlert(
        'Camera Permission Needed',
        'Camera access is turned off for FNS Employee Portal. Open Settings and allow Camera access to take a photo.'
      );
      return false;
    }
    return false;
  } catch (error) {
    console.warn('Camera permission check failed:', error?.message || error);
    return false;
  }
}

async function ensureMediaLibraryPermission() {
  try {
    const current = await ImagePicker.getMediaLibraryPermissionsAsync?.();
    if (permissionGranted(current)) return true;
    if (current && !permissionCanAskAgain(current)) {
      showPermissionSettingsAlert(
        'Photo Library Permission Needed',
        'Photo library access is turned off for FNS Employee Portal. Open Settings and allow Photos access to upload an image.'
      );
      return false;
    }
    const requested = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permissionGranted(requested)) return true;
    if (!permissionCanAskAgain(requested)) {
      showPermissionSettingsAlert(
        'Photo Library Permission Needed',
        'Photo library access is turned off for FNS Employee Portal. Open Settings and allow Photos access to upload an image.'
      );
      return false;
    }
    return false;
  } catch (error) {
    console.warn('Photo library permission check failed:', error?.message || error);
    return false;
  }
}

async function launchImagePickerForSource(source, options = {}) {
  await pauseForNativePicker();
  const finalOptions = imagePickerOptions({
    allowsEditing: false,
    exif: false,
    ...options,
  });
  return source === 'camera'
    ? ImagePicker.launchCameraAsync({
        cameraType: ImagePicker.CameraType?.back || 'back',
        ...finalOptions,
      })
    : ImagePicker.launchImageLibraryAsync(finalOptions);
}

const DRAW_SHAPE_TOOLS = new Set([TOOL_LINE, TOOL_ARROW, TOOL_DRAW, TOOL_RECT, TOOL_CIRCLE]);

function isDrawShapeTool(value) {
  return DRAW_SHAPE_TOOLS.has(value);
}

function isPinPlacementTool(value) {
  return value === TOOL_PHOTO || value === TOOL_LOCATION;
}

function shapeTypeForTool(value) {
  if (value === TOOL_LINE) return 'line';
  if (value === TOOL_ARROW) return 'arrow';
  if (value === TOOL_DRAW) return 'draw';
  if (value === TOOL_CIRCLE) return 'circle';
  if (value === TOOL_CLOUD) return 'cloud';
  return 'rect';
}

function isLineLikeTool(value) {
  return value === TOOL_LINE || value === TOOL_ARROW || value === TOOL_DRAW;
}

function clean(value) {
  return String(value ?? '').trim();
}

function safeStoragePart(value) {
  return clean(value).replace(/[^a-zA-Z0-9_.:-]/g, '_') || 'default';
}

function redlineSelectionStorageKey(portalUrl, selectedSiteId, selectedSiteName) {
  return [
    REDLINE_LAST_SELECTION_KEY_PREFIX,
    safeStoragePart(normalizePortalUrl(portalUrl).toLowerCase()),
    safeStoragePart(selectedSiteId || selectedSiteName),
  ].join(':');
}


const SITEWALK_PDF_LAST_SITE_STORAGE_PREFIX = 'mobile:sitewalk-pdf-editor:last-site';

function siteWalkPdfLastSiteStorageKey(portalUrl) {
  return `${SITEWALK_PDF_LAST_SITE_STORAGE_PREFIX}:${normalizePortalUrl(portalUrl).replace(/\/+$/, '').toLowerCase() || 'default'}`;
}

async function readLastPdfEditorSite(portalUrl) {
  try {
    const raw = await AsyncStorage.getItem(siteWalkPdfLastSiteStorageKey(portalUrl));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch (_) {
    return null;
  }
}

async function rememberLastPdfEditorSite(portalUrl, site) {
  const name = siteName(site);
  const id = siteId(site);
  if (!name && !id) return;
  try {
    await AsyncStorage.setItem(siteWalkPdfLastSiteStorageKey(portalUrl), JSON.stringify({ id: String(id || ''), name, savedAt: Date.now() }));
  } catch (_) {
    // Non-critical: the selector still works even if storage is unavailable.
  }
}

function findSiteByStoredSelection(sites, stored) {
  if (!stored || !Array.isArray(sites) || !sites.length) return null;
  const storedId = clean(stored.id);
  const storedName = clean(stored.name).toLowerCase();
  if (storedId) {
    const byId = sites.find((site) => String(siteId(site)) === storedId);
    if (byId) return byId;
  }
  if (storedName) {
    return sites.find((site) => siteName(site).toLowerCase() === storedName) || null;
  }
  return null;
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 9;
const CANVAS_SCROLL_PADDING = 10;
const REDLINE_TAP_SLOP_PX = 8;
const REDLINE_PIN_DRAG_HOLD_MS = 750;
const REDLINE_PIN_DRAG_CANCEL_SLOP_PX = 18;
const REDLINE_LAST_SELECTION_KEY_PREFIX = 'sitewalk_redlines_last_selection_v1';

function clampZoom(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return MIN_ZOOM;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, n));
}


function pagePointFromPressEvent(evt) {
  const native = evt?.nativeEvent || {};
  const touches = native.touches || [];
  const changedTouches = native.changedTouches || [];
  const touch = touches[0] || changedTouches[0] || native;
  const pageX = Number(touch.pageX ?? native.pageX);
  const pageY = Number(touch.pageY ?? native.pageY);
  if (!Number.isFinite(pageX) || !Number.isFinite(pageY)) return null;
  return { x: pageX, y: pageY };
}

function pagePointMoved(start, current, slop = REDLINE_TAP_SLOP_PX) {
  if (!start || !current) return false;
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  return Math.sqrt((dx * dx) + (dy * dy)) > slop;
}

function GuardedTapPressable({ onPress, onTap, tapSlop = REDLINE_TAP_SLOP_PX, children, ...props }) {
  const tapRef = useRef({ start: null, moved: false, active: false });

  const handleTouchStart = useCallback((evt) => {
    props.onTouchStart?.(evt);
    tapRef.current = { start: pagePointFromPressEvent(evt), moved: false, active: true };
  }, [props]);

  const handleTouchMove = useCallback((evt) => {
    props.onTouchMove?.(evt);
    const state = tapRef.current;
    if (!state.active || state.moved) return;
    if (pagePointMoved(state.start, pagePointFromPressEvent(evt), tapSlop)) {
      tapRef.current = { ...state, moved: true };
    }
  }, [props, tapSlop]);

  const handleTouchEnd = useCallback((evt) => {
    props.onTouchEnd?.(evt);
    const state = tapRef.current;
    const moved = state.moved || pagePointMoved(state.start, pagePointFromPressEvent(evt), tapSlop);
    tapRef.current = { start: null, moved: false, active: false };
    if (!state.active || moved) return;
    (onTap || onPress)?.(evt);
  }, [onPress, onTap, props, tapSlop]);

  const handleTouchCancel = useCallback((evt) => {
    props.onTouchCancel?.(evt);
    tapRef.current = { start: null, moved: true, active: false };
  }, [props]);

  return (
    <Pressable
      {...props}
      onPress={undefined}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      {children}
    </Pressable>
  );
}

function distanceBetweenTouches(touches) {
  if (!touches || touches.length < 2) return 0;
  const [a, b] = touches;
  const dx = Number(a.pageX || 0) - Number(b.pageX || 0);
  const dy = Number(a.pageY || 0) - Number(b.pageY || 0);
  return Math.sqrt((dx * dx) + (dy * dy));
}

function focalPointFromTouches(touches, viewport) {
  if (!touches || !touches.length) return { focalX: 0, focalY: 0 };
  const usable = touches.length >= 2 ? [touches[0], touches[1]] : [touches[0]];
  const centerPageX = usable.reduce((sum, item) => sum + (Number(item.pageX) || 0), 0) / usable.length;
  const centerPageY = usable.reduce((sum, item) => sum + (Number(item.pageY) || 0), 0) / usable.length;
  return {
    focalX: Math.max(0, Math.min(viewport.width, centerPageX - viewport.pageX)),
    focalY: Math.max(0, Math.min(viewport.height, centerPageY - viewport.pageY)),
  };
}

function siteId(site) {
  return site?.site_id || site?.id || site?.siteId || '';
}

function siteName(site) {
  return site?.site_name || site?.name || site?.label || String(site || '');
}

function absUrl(portalUrl, raw) {
  const value = clean(raw);
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `${normalizePortalUrl(portalUrl)}${value.startsWith('/') ? value : `/${value}`}`;
}

function smallHash(value) {
  const text = String(value || '');
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function pageIdValue(page) {
  return page?.id || page?.page_id || page?.pageId || '';
}

function redlineDocumentCacheKey(portalUrl, selectedSiteId, selectedSiteName, sitewalkDesc) {
  return [
    'sitewalk_redlines_document_cache_v1',
    safeStoragePart(normalizePortalUrl(portalUrl).toLowerCase()),
    safeStoragePart(selectedSiteId || selectedSiteName),
    safeStoragePart(sitewalkDesc || 'default'),
  ].join(':');
}

function redlinePageDataCacheKey(portalUrl, selectedSiteId, selectedSiteName, sitewalkDesc, pageId) {
  return [
    'sitewalk_redlines_page_data_cache_v1',
    safeStoragePart(normalizePortalUrl(portalUrl).toLowerCase()),
    safeStoragePart(selectedSiteId || selectedSiteName),
    safeStoragePart(sitewalkDesc || 'default'),
    safeStoragePart(pageId || 'page'),
  ].join(':');
}


function redlineDocumentCachePrefix(portalUrl, selectedSiteId, selectedSiteName) {
  return [
    'sitewalk_redlines_document_cache_v1',
    safeStoragePart(normalizePortalUrl(portalUrl).toLowerCase()),
    safeStoragePart(selectedSiteId || selectedSiteName),
  ].join(':');
}

function redlinePageDataAnySitewalkCacheKey(portalUrl, selectedSiteId, selectedSiteName, pageId) {
  return [
    'sitewalk_redlines_page_data_cache_v1',
    safeStoragePart(normalizePortalUrl(portalUrl).toLowerCase()),
    safeStoragePart(selectedSiteId || selectedSiteName),
    '__any_sitewalk__',
    safeStoragePart(pageId || 'page'),
  ].join(':');
}

function redlineImageAnySitewalkPageIndexKey(portalUrl, selectedSiteId, selectedSiteName, pageId) {
  return [
    'sitewalk_redlines_page_image_index_v1',
    safeStoragePart(normalizePortalUrl(portalUrl).toLowerCase()),
    safeStoragePart(selectedSiteId || selectedSiteName),
    '__any_sitewalk__',
    safeStoragePart(pageId || 'page'),
  ].join(':');
}

async function findCachedRedlineDocument(portalUrl, selectedSiteId, selectedSiteName, preferredSitewalkDesc = '') {
  const preferredKey = redlineDocumentCacheKey(portalUrl, selectedSiteId, selectedSiteName, preferredSitewalkDesc);
  const preferred = await readJsonFromStorage(preferredKey);
  if (preferred) return preferred;
  try {
    const prefix = `${redlineDocumentCachePrefix(portalUrl, selectedSiteId, selectedSiteName)}:`;
    const keys = typeof AsyncStorage.getAllKeys === 'function' ? await AsyncStorage.getAllKeys() : [];
    const cacheKeys = (keys || []).filter((key) => String(key || '').startsWith(prefix));
    for (const key of cacheKeys) {
      const cached = await readJsonFromStorage(key);
      if (cached?.page || (Array.isArray(cached?.pages) && cached.pages.length)) return cached;
    }
  } catch (_err) {}
  return null;
}

async function findCachedRedlinePageData(portalUrl, selectedSiteId, selectedSiteName, sitewalkDesc, pageId) {
  if (!pageId) return null;
  const sitewalkCache = await readJsonFromStorage(redlinePageDataCacheKey(portalUrl, selectedSiteId, selectedSiteName, sitewalkDesc, pageId));
  if (sitewalkCache) return sitewalkCache;
  const anySitewalkCache = await readJsonFromStorage(redlinePageDataAnySitewalkCacheKey(portalUrl, selectedSiteId, selectedSiteName, pageId));
  if (anySitewalkCache) return anySitewalkCache;
  try {
    const prefix = [
      'sitewalk_redlines_page_data_cache_v1',
      safeStoragePart(normalizePortalUrl(portalUrl).toLowerCase()),
      safeStoragePart(selectedSiteId || selectedSiteName),
    ].join(':') + ':';
    const suffix = `:${safeStoragePart(pageId || 'page')}`;
    const keys = typeof AsyncStorage.getAllKeys === 'function' ? await AsyncStorage.getAllKeys() : [];
    const cacheKeys = (keys || []).filter((key) => String(key || '').startsWith(prefix) && String(key || '').endsWith(suffix));
    for (const key of cacheKeys) {
      const cached = await readJsonFromStorage(key);
      if (cached?.page || Array.isArray(cached?.pins) || Array.isArray(cached?.annotations)) return cached;
    }
  } catch (_err) {}
  return null;
}

function redlineMarkupPrefsKey(portalUrl, selectedSiteId, selectedSiteName) {
  return [
    'sitewalk_redlines_markup_prefs_v1',
    safeStoragePart(normalizePortalUrl(portalUrl).toLowerCase()),
    safeStoragePart(selectedSiteId || selectedSiteName || 'default'),
  ].join(':');
}

function redlineImagePageIndexKey(portalUrl, selectedSiteId, selectedSiteName, sitewalkDesc, pageId) {
  return [
    'sitewalk_redlines_page_image_index_v1',
    safeStoragePart(normalizePortalUrl(portalUrl).toLowerCase()),
    safeStoragePart(selectedSiteId || selectedSiteName),
    safeStoragePart(sitewalkDesc || 'default'),
    safeStoragePart(pageId || 'page'),
  ].join(':');
}

function redlineImageCacheKey(portalUrl, selectedSiteId, selectedSiteName, sitewalkDesc, pageId, url) {
  return [
    'sitewalk_redlines_page_image_cache_v1',
    safeStoragePart(normalizePortalUrl(portalUrl).toLowerCase()),
    safeStoragePart(selectedSiteId || selectedSiteName),
    safeStoragePart(sitewalkDesc || 'default'),
    safeStoragePart(pageId || 'page'),
    smallHash(url),
  ].join(':');
}

function redlineImageFileName(portalUrl, selectedSiteId, selectedSiteName, sitewalkDesc, pageId, url) {
  const pathPart = String(url || '').split('?')[0].toLowerCase();
  const extMatch = pathPart.match(/\.(png|jpe?g|webp)$/i);
  const ext = extMatch ? extMatch[0].replace('.jpeg', '.jpg') : '.png';
  return `${safeStoragePart(normalizePortalUrl(portalUrl).toLowerCase())}_${safeStoragePart(selectedSiteId || selectedSiteName)}_${safeStoragePart(sitewalkDesc || 'default')}_${safeStoragePart(pageId || 'page')}_${smallHash(url)}${ext}`;
}

async function ensureRedlineImageCacheDir() {
  const root = FileSystem.documentDirectory || FileSystem.cacheDirectory;
  if (!root) return '';
  const dir = `${root}sitewalk-redlines-cache/`;
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch (_err) {
    return '';
  }
  return dir;
}

async function ensureRedlineOfflinePhotoDir() {
  const root = FileSystem.documentDirectory || FileSystem.cacheDirectory;
  if (!root) return '';
  const dir = `${root}sitewalk-redlines-offline-photos/`;
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch (_err) {
    return '';
  }
  return dir;
}


async function ensureRedlineLinkedMediaDir() {
  const root = FileSystem.documentDirectory || FileSystem.cacheDirectory;
  if (!root) return '';
  const dir = `${root}sitewalk-redlines-linked-media/`;
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch (_err) {
    return '';
  }
  return dir;
}

const PHOTO_ASSET_CACHE_VERSION = 'rn-preview-v4';
const PHOTO_ASSET_LIST_CACHE_PREFIX = 'site-photo-list-cache-v1:';
const PHOTO_ASSET_LIST_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PHOTO_ASSET_ANNOTATION_CACHE_PREFIX = 'site-photo-annotation-cache-v1:';
const SITE_PHOTO_PREFETCH_CATEGORIES = ['construction', 'final', 'management', 'customer', 'all'];

function cacheSafePart(value) {
  return String(value ?? '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80) || 'photo';
}

function photoListStorageKey(siteValue, categoryValue) {
  return `${PHOTO_ASSET_LIST_CACHE_PREFIX}${cacheSafePart(siteValue)}::${cacheSafePart(categoryValue || 'construction')}`;
}

function photoAssetVersion(asset) {
  return cacheSafePart(asset?.updated_at || asset?.created_at || asset?.taken_at || asset?.display_date || asset?.filename || 'v1');
}

async function ensurePhotoAssetCacheDir() {
  const root = FileSystem.documentDirectory || FileSystem.cacheDirectory;
  if (!root) return '';
  const dir = `${root}photo-asset-previews/`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

async function downloadRemoteFileToLocal({ remoteUrl, finalUri, token, minBytes = 256 }) {
  const source = clean(remoteUrl);
  if (!source) return '';
  if (isLocalFileUri(source)) return source;
  try {
    const existing = await FileSystem.getInfoAsync(finalUri);
    if (existing.exists && Number(existing.size || 0) > minBytes) return finalUri;
  } catch (_err) {}
  const tempUri = `${finalUri}.tmp-${Date.now()}`;
  try {
    await FileSystem.deleteAsync(tempUri, { idempotent: true });
    await FileSystem.downloadAsync(
      source,
      tempUri,
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
    );
    const info = await FileSystem.getInfoAsync(tempUri);
    if (!info.exists || Number(info.size || 0) <= minBytes) throw new Error('Downloaded file was empty.');
    await FileSystem.deleteAsync(finalUri, { idempotent: true });
    await FileSystem.moveAsync({ from: tempUri, to: finalUri });
    return finalUri;
  } catch (error) {
    try { await FileSystem.deleteAsync(tempUri, { idempotent: true }); } catch (_err) {}
    throw error;
  }
}

function extFromUrl(url) {
  const match = String(url || '').split('?')[0].match(/\.(png|jpe?g|webp|heic|heif|insp)$/i);
  if (!match) return '.jpg';
  const ext = match[0].toLowerCase();
  return ext === '.jpeg' ? '.jpg' : ext;
}

async function cacheLinkedRedlineMedia({ portalUrl, token, pin, siteId: selectedSiteId, siteName: selectedSiteName, sitewalkDesc, pageId }) {
  if (!pin?.id) return pin;
  const patch = {};
  const dir = await ensureRedlineLinkedMediaDir();
  if (!dir) return pin;
  const pinPart = cacheSafePart(pin.id);
  const contextPart = `${cacheSafePart(normalizePortalUrl(portalUrl).toLowerCase())}_${cacheSafePart(selectedSiteId || selectedSiteName)}_${cacheSafePart(sitewalkDesc)}_${cacheSafePart(pageId)}`;

  const photoUrl = absUrl(portalUrl, pin.photo_url || pin.public_url || pin.full_url || pin.url);
  const thumbUrl = absUrl(portalUrl, pin.thumb_url || pin.thumbnail_url || pin.photo_thumb_url || pin.photo_url || pin.public_url || pin.full_url);
  if (thumbUrl) {
    try {
      const uri = await downloadRemoteFileToLocal({ remoteUrl: thumbUrl, finalUri: `${dir}${contextPart}_${pinPart}_photo_thumb_${smallHash(thumbUrl)}${extFromUrl(thumbUrl)}`, token, minBytes: 512 });
      if (uri) patch.__offline_cached_thumb_uri = uri;
    } catch (_err) {}
  }
  if (photoUrl) {
    try {
      const uri = await downloadRemoteFileToLocal({ remoteUrl: photoUrl, finalUri: `${dir}${contextPart}_${pinPart}_photo_full_${smallHash(photoUrl)}${extFromUrl(photoUrl)}`, token, minBytes: 512 });
      if (uri) {
        patch.__offline_cached_photo_uri = uri;
        patch.offline_local_uri = uri;
      }
    } catch (_err) {}
  }

  const panoUrl = absUrl(portalUrl, pin.matching_360_photo_url || pin.photo_360_url || pin.panorama_url || pin.pano_url);
  const panoThumbUrl = absUrl(portalUrl, pin.matching_360_thumb_url || pin.photo_360_thumb_url || pin.pano_thumb_url || pin.thumb_360_url || pin.matching_360_photo_url || pin.photo_360_url || pin.panorama_url);
  if (panoThumbUrl) {
    try {
      const uri = await downloadRemoteFileToLocal({ remoteUrl: panoThumbUrl, finalUri: `${dir}${contextPart}_${pinPart}_360_thumb_${smallHash(panoThumbUrl)}${extFromUrl(panoThumbUrl)}`, token, minBytes: 512 });
      if (uri) patch.__offline_cached_360_thumb_uri = uri;
    } catch (_err) {}
  }
  if (panoUrl) {
    try {
      const uri = await downloadRemoteFileToLocal({ remoteUrl: panoUrl, finalUri: `${dir}${contextPart}_${pinPart}_360_full_${smallHash(panoUrl)}${extFromUrl(panoUrl)}`, token, minBytes: 512 });
      if (uri) patch.__offline_cached_360_uri = uri;
    } catch (_err) {}
  }

  let nextPin = Object.keys(patch).length ? { ...pin, ...patch, __offline_media_cached_at: new Date().toISOString() } : pin;
  if (Array.isArray(pin.photos) && pin.photos.length) {
    const cachedPhotos = [];
    for (const photo of pin.photos) {
      const cachedPhoto = await cacheManifestImageObject({ portalUrl, token, item: photo, kindPrefix: `redline_pin_${cacheSafePart(pin.id)}_photo` }).catch(() => photo);
      cachedPhotos.push(cachedPhoto || photo);
    }
    nextPin = { ...nextPin, photos: cachedPhotos };
  }
  return nextPin;
}

async function downloadPhotoAssetImageToLocalForPrecache({ portalUrl, token, asset, kind }) {
  if (!asset?.id) return '';
  const source = kind === 'thumb'
    ? absUrl(portalUrl, asset.thumb_url || asset.thumbnail_url || asset.photo_url || asset.full_url || asset.public_url)
    : absUrl(portalUrl, asset.photo_url || asset.full_url || asset.public_url || asset.thumb_url || asset.thumbnail_url);
  if (!source) return '';
  if (isLocalFileUri(source)) return source;
  const dir = await ensurePhotoAssetCacheDir();
  if (!dir) return '';
  const version = photoAssetVersion(asset);
  const localUri = `${dir}${cacheSafePart(asset.id)}-${kind}-${PHOTO_ASSET_CACHE_VERSION}-${version}.jpg`;
  return downloadRemoteFileToLocal({ remoteUrl: source, finalUri: localUri, token, minBytes: 1024 });
}

async function cachePhotoAssetForOfflinePrecache({ portalUrl, token, asset }) {
  if (!asset?.id) return asset;
  const patch = {};
  try {
    const thumb = await downloadPhotoAssetImageToLocalForPrecache({ portalUrl, token, asset, kind: 'thumb' });
    if (thumb) patch.__offline_thumb_uri = thumb;
  } catch (_err) {}
  try {
    const full = await downloadPhotoAssetImageToLocalForPrecache({ portalUrl, token, asset: { ...asset, ...patch }, kind: 'full' });
    if (full) patch.__offline_full_uri = full;
  } catch (_err) {}
  const next = Object.keys(patch).length ? { ...asset, ...patch, __offline_cached_at: new Date().toISOString() } : asset;
  await cacheManifestPhotoAnnotation(next);
  return next;
}

async function cacheManifestPhotoAnnotation(asset) {
  const assetId = asset?.id || asset?.photo_id;
  const data = asset?.annotation?.data_json !== undefined ? asset.annotation : null;
  if (!assetId || !data) return;
  try {
    await AsyncStorage.setItem(`${PHOTO_ASSET_ANNOTATION_CACHE_PREFIX}${cacheSafePart(assetId)}`, JSON.stringify({
      data_json: data.data_json || {},
      version: data.version ?? null,
      pending: false,
      saved_at: new Date().toISOString(),
    }));
  } catch (_err) {}
}

async function cacheManifestImageObject({ portalUrl, token, item, kindPrefix = 'manifest' }) {
  if (!item?.id && !item?.photo_id) return item;
  const dir = await ensureRedlineLinkedMediaDir();
  if (!dir) return item;
  const idPart = cacheSafePart(item.id || item.photo_id);
  const patch = {};
  const thumbUrl = absUrl(portalUrl, item.thumb_url || item.thumbnail_url || item.photo_url || item.full_url || item.public_url || item.url);
  const fullUrl = absUrl(portalUrl, item.photo_url || item.full_url || item.public_url || item.url || item.thumb_url || item.thumbnail_url);
  if (thumbUrl) {
    try {
      const uri = await downloadRemoteFileToLocal({ remoteUrl: thumbUrl, finalUri: `${dir}${kindPrefix}_${idPart}_thumb_${smallHash(thumbUrl)}${extFromUrl(thumbUrl)}`, token, minBytes: 512 });
      if (uri) {
        patch.__offline_thumb_uri = uri;
        if (kindPrefix.includes('360')) patch.__offline_cached_360_thumb_uri = uri;
        else patch.__offline_cached_thumb_uri = uri;
      }
    } catch (_err) {}
  }
  if (fullUrl) {
    try {
      const uri = await downloadRemoteFileToLocal({ remoteUrl: fullUrl, finalUri: `${dir}${kindPrefix}_${idPart}_full_${smallHash(fullUrl)}${extFromUrl(fullUrl)}`, token, minBytes: 512 });
      if (uri) {
        patch.__offline_full_uri = uri;
        patch.__offline_photo_uri = uri;
        patch.offline_local_uri = uri;
        if (kindPrefix.includes('360')) patch.__offline_cached_360_uri = uri;
        else patch.__offline_cached_photo_uri = uri;
      }
    } catch (_err) {}
  }
  const next = Object.keys(patch).length ? { ...item, ...patch, __offline_cached_at: new Date().toISOString() } : item;
  await cacheManifestPhotoAnnotation(next);
  return next;
}

function fileExtFromAsset(asset) {
  const rawName = String(asset?.fileName || asset?.uri || '').split('?')[0];
  const match = rawName.match(/\.(png|jpe?g|webp|heic|heif)$/i);
  if (!match) return '.jpg';
  const ext = match[0].toLowerCase();
  return ext === '.jpeg' ? '.jpg' : ext;
}

function mimeTypeFromExt(ext) {
  const value = String(ext || '').toLowerCase();
  if (value === '.png') return 'image/png';
  if (value === '.webp') return 'image/webp';
  if (value === '.heic') return 'image/heic';
  if (value === '.heif') return 'image/heif';
  if (value === '.insp') return 'application/octet-stream';
  return 'image/jpeg';
}

async function copyImageAssetToOfflineFile(asset, { portalUrl, selectedSiteId, selectedSiteName, pageId, pinId } = {}) {
  if (!asset?.uri) throw new Error('The selected image did not include a usable file path.');
  const dir = await ensureRedlineOfflinePhotoDir();
  if (!dir) throw new Error('This device storage is not available for offline photos.');
  const ext = fileExtFromAsset(asset);
  const localId = `offline_photo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const name = `${safeStoragePart(normalizePortalUrl(portalUrl).toLowerCase())}_${safeStoragePart(selectedSiteId || selectedSiteName)}_${safeStoragePart(pageId || 'page')}_${safeStoragePart(pinId || 'pin')}_${localId}${ext}`;
  const uri = `${dir}${name}`;
  try {
    await FileSystem.copyAsync({ from: asset.uri, to: uri });
  } catch (_err) {
    const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
    await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  }
  return { localId, uri, name, type: asset.mimeType || mimeTypeFromExt(ext) };
}

async function copyLocalFileToOffline360File(sourceUri, { portalUrl, selectedSiteId, selectedSiteName, pageId, pinId, fileName } = {}) {
  if (!sourceUri) throw new Error('The X4 did not return a usable local file path.');
  const dir = await ensureRedlineOfflinePhotoDir();
  if (!dir) throw new Error('This device storage is not available for offline 360 photos.');
  const rawName = clean(fileName) || fileNameFromUri(sourceUri) || `x4-360-${Date.now()}.jpg`;
  const ext = extFromUrl(rawName);
  const localId = `offline_360_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const name = `${safeStoragePart(normalizePortalUrl(portalUrl).toLowerCase())}_${safeStoragePart(selectedSiteId || selectedSiteName)}_${safeStoragePart(pageId || 'page')}_${safeStoragePart(pinId || 'pin')}_${localId}${ext}`;
  const uri = `${dir}${name}`;
  try {
    await FileSystem.copyAsync({ from: sourceUri, to: uri });
  } catch (_err) {
    const base64 = await FileSystem.readAsStringAsync(sourceUri, { encoding: FileSystem.EncodingType.Base64 });
    await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  }
  return { localId, uri, name, type: mimeTypeFromExt(ext) };
}


function fileNameFromUri(uri) {
  const cleanUri = String(uri || '').split('?')[0];
  const parts = cleanUri.split('/').filter(Boolean);
  return parts.length ? decodeURIComponent(parts[parts.length - 1]) : '';
}

async function resolveOfflinePhotoFileUri(op) {
  const candidates = [];
  const originalUri = String(op?.local_uri || '');
  if (originalUri) candidates.push(originalUri);

  const filename = clean(op?.local_file_name || op?.stored_file_name || fileNameFromUri(originalUri));
  const dir = await ensureRedlineOfflinePhotoDir();
  if (dir && filename) candidates.push(`${dir}${filename}`);

  for (const candidate of candidates) {
    try {
      const info = await FileSystem.getInfoAsync(candidate);
      if (info.exists && !info.isDirectory) return candidate;
    } catch (_err) {}
  }

  if (dir && filename) {
    try {
      const names = await FileSystem.readDirectoryAsync(dir);
      const exact = names.find((name) => String(name) === filename);
      if (exact) return `${dir}${exact}`;
      const suffix = filename.split('_offline_photo_').pop();
      if (suffix && suffix !== filename) {
        const bySuffix = names.find((name) => String(name).endsWith(suffix));
        if (bySuffix) return `${dir}${bySuffix}`;
      }
    } catch (_err) {}
  }

  return '';
}

function isTempRedlineId(value) {
  return String(value || '').startsWith('temp_');
}

function queuedUploadCount(queue) {
  return (Array.isArray(queue) ? queue : []).filter((op) => op?.type === 'upload_pin_photo' || op?.type === 'upload_pin_360_photo').length;
}

function offlineRedlinePhotoAnnotationKey(pinId, localUri) {
  return [
    'sitewalk_redline_offline_photo_annotation_v1',
    safeStoragePart(pinId || 'pin'),
    smallHash(localUri || ''),
  ].join(':');
}

async function readOfflineRedlinePhotoAnnotation(pinId, localUri) {
  try {
    const raw = await AsyncStorage.getItem(offlineRedlinePhotoAnnotationKey(pinId, localUri));
    return raw ? JSON.parse(raw) : null;
  } catch (_err) {
    return null;
  }
}

function siteWalk360AnnotationCacheKey(photoId) {
  return `sitewalk_360_annotation_cache_v1:${cacheSafePart(photoId)}`;
}

async function readCached360AnnotationsForSync(photoId) {
  if (!photoId) return null;
  try {
    const raw = await AsyncStorage.getItem(siteWalk360AnnotationCacheKey(photoId));
    return raw ? JSON.parse(raw) : null;
  } catch (_err) {
    return null;
  }
}

async function clearCached360AnnotationsForSync(photoId) {
  if (!photoId) return;
  try { await AsyncStorage.removeItem(siteWalk360AnnotationCacheKey(photoId)); } catch (_err) {}
}

async function clearOfflineRedlinePhotoAnnotation(pinId, localUri) {
  try { await AsyncStorage.removeItem(offlineRedlinePhotoAnnotationKey(pinId, localUri)); } catch (_err) {}
}

async function readJsonFromStorage(key) {
  if (!key) return null;
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_err) {
    return null;
  }
}

async function writeJsonToStorage(key, value) {
  if (!key || !value) return;
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (_err) {}
}

async function pause(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function responseBlobToBase64(blob) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('Unable to read image response.'));
      reader.onloadend = () => {
        const result = String(reader.result || '');
        const idx = result.indexOf(',');
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      reject(err);
    }
  });
}

async function downloadRedlineImageToFile(remoteUrl, finalUri, token) {
  const tempUri = `${finalUri}.tmp`;
  try { await FileSystem.deleteAsync(tempUri, { idempotent: true }); } catch (_err) {}
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

  try {
    await FileSystem.downloadAsync(remoteUrl, tempUri, headers ? { headers } : undefined);
    const info = await FileSystem.getInfoAsync(tempUri);
    if (info.exists && Number(info.size || 0) > 0) {
      try { await FileSystem.deleteAsync(finalUri, { idempotent: true }); } catch (_err) {}
      await FileSystem.moveAsync({ from: tempUri, to: finalUri });
      return finalUri;
    }
  } catch (_err) {
    try { await FileSystem.deleteAsync(tempUri, { idempotent: true }); } catch (__err) {}
  }

  try {
    const response = await fetch(remoteUrl, { headers });
    if (!response.ok) return '';
    const blob = await response.blob();
    const base64 = await responseBlobToBase64(blob);
    if (!base64) return '';
    await FileSystem.writeAsStringAsync(tempUri, base64, { encoding: FileSystem.EncodingType.Base64 });
    const info = await FileSystem.getInfoAsync(tempUri);
    if (!info.exists || Number(info.size || 0) <= 0) return '';
    try { await FileSystem.deleteAsync(finalUri, { idempotent: true }); } catch (_err) {}
    await FileSystem.moveAsync({ from: tempUri, to: finalUri });
    return finalUri;
  } catch (_err) {
    try { await FileSystem.deleteAsync(tempUri, { idempotent: true }); } catch (__err) {}
    return '';
  }
}

function isLocalFileUri(value) {
  return /^(file|content):\/\//i.test(clean(value));
}

function looksLikePdfUrl(value) {
  const raw = clean(value).split('?')[0].toLowerCase();
  return raw.endsWith('.pdf');
}

function looksLikeImageUrl(value) {
  const raw = clean(value).split('?')[0].toLowerCase();
  return /\.(png|jpe?g|webp)$/i.test(raw) || raw.includes('/page-image/');
}

function uniqueCleanUrls(items) {
  const seen = new Set();
  const out = [];
  (Array.isArray(items) ? items : []).forEach((item) => {
    const value = clean(item);
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(value);
  });
  return out;
}

function pageImageUrlCandidates(portalUrl, page) {
  if (!page) return [];
  const pageId = pageIdValue(page);
  const localCached = clean(page.cached_image_uri || page.local_image_uri || page.offline_image_uri);
  const candidates = [];
  if (localCached && isLocalFileUri(localCached)) candidates.push(localCached);

  // Prefer the mobile image-render endpoint.  Some page rows include PDF URLs in
  // image_url_candidates; React Native cannot display/cache those as page images.
  // The endpoint always returns an actual image for the page when the backend can
  // resolve the stored PDF/PNG.
  if (pageId) candidates.push(absUrl(portalUrl, `/mobile/subcontractor/api/site-walk-redlines/page-image/${pageId}`));
  if (clean(page.image_api_url)) candidates.push(absUrl(portalUrl, page.image_api_url));

  [page.image_url, page.storage_img].forEach((item) => {
    const value = clean(item);
    if (value && !looksLikePdfUrl(value)) candidates.push(absUrl(portalUrl, value));
  });

  (Array.isArray(page.image_url_candidates) ? page.image_url_candidates : []).forEach((item) => {
    const value = clean(item);
    if (!value || looksLikePdfUrl(value)) return;
    if (looksLikeImageUrl(value)) candidates.push(absUrl(portalUrl, value));
  });

  return uniqueCleanUrls(candidates);
}

function pageImageUrl(portalUrl, page) {
  return pageImageUrlCandidates(portalUrl, page).find((item) => clean(item)) || '';
}

function pinKind(pin) {
  const type = clean(pin?.pin_type).toLowerCase();
  const tag = clean(pin?.tag).toLowerCase();
  if (type === 'site_record_dot') return 'site_record_dot';
  if (type === 'camera_misc') return 'camera_misc';
  if (type === 'location' || type === 'location_marker') return 'location';
  if (type === 'note' || tag === 'note') return 'note';
  // Important: an expected/linked 360 photo is not a different pin type.
  // It is still a normal SiteWalk photo pin with a separate 360 status/action.
  return 'photo';
}

function normalizeStatusText(value) {
  return clean(value).toLowerCase().replace(/[\s_-]+/g, ' ').trim();
}

function isCompletedStatus(value) {
  const status = normalizeStatusText(value);
  return status === 'completed' || status === 'complete' || status === 'done' || status === 'installed';
}

function siteRecordDotStatus(pin) {
  return clean(
    pin?.matched_site_record_status
    || pin?.site_record_status
    || pin?.item_status
    || pin?.sr_status
    || pin?.status
  );
}

function pinColor(pin) {
  const kind = pinKind(pin);
  if (kind === 'site_record_dot') return isCompletedStatus(siteRecordDotStatus(pin)) ? '#16a34a' : '#ef4444';
  if (kind === 'note') return '#f59e0b';
  if (kind === 'location') return '#7c3aed';
  return '#2563eb';
}


function pinHasRegularPhoto(pin) {
  return Boolean(
    pin?.photo_url
    || pin?.thumb_url
    || pin?.photo_id
    || Number(pin?.photo_count || 0) > 0
    || pin?.__offline_local_photo_uri
    || Number(pin?.__offline_photo_pending || 0) > 0
  );
}

function pinIsExpected360(pin) {
  return Boolean(pin?.is_expected_360_photo);
}

function pinHas360Photo(pin) {
  return Boolean(pin?.has_matching_360_photo || pin?.matching_360_photo_id || pin?.matching_360_photo_url || pin?.matching_360_thumb_url || pin?.__offline_360_pending || pin?.__offline_local_360_uri || pin?.__offline_cached_360_uri);
}

function photoPinBorderColor(pin) {
  // Inner ring only represents the normal SiteWalk photo state.
  // Green = SiteWalk photo exists; red = no SiteWalk photo.
  if (pinHasRegularPhoto(pin)) return '#166534';
  return '#e11d48';
}

function pinDisplayLabel(pin) {
  if (!pin) return '';
  const kind = pinKind(pin);
  if (kind === 'note' || kind === 'camera_misc') return '';
  if (kind === 'site_record_dot') return clean(pin.label || pin.sr_location || pin.sr_task);
  if (kind === 'location') return clean(pin.label || pin.sr_location || 'Location');
  return clean(pin.label || pin.sr_location || pin.sr_task || (pin.id ? `Pin ${pin.id}` : ''));
}

function categoryMatches(pin, category) {
  if (category === 'all') return true;
  const blob = `${pin?.label || ''} ${pin?.tag || ''} ${pin?.sr_location || ''} ${pin?.sr_task || ''}`.toLowerCase();
  return blob.includes(category);
}

const ICON_NOTE_CHECK = '__ICON_CHECK__';
const ICON_NOTE_X = '__ICON_X__';
const ICON_NOTE_OUTLET = '__ICON_OUTLET__';
const ICON_NOTE_BREAKER = '__ICON_BREAKER_BOX__';
const ICON_NOTE_BLUEPRINT = '__ICON_BLUE_LAYOUT__';

function freehandGroupKey(ann) {
  const shape = clean(ann?.shape_type).toLowerCase();
  const note = clean(ann?.note);
  if (shape !== 'draw' || !note) return '';
  if (/^(stroke_|poly_|draw_)/i.test(note)) return note;
  return '';
}

function isPolylineGroupKey(value) {
  return /^poly_/i.test(clean(value));
}

function isOrderedFreehandGroupKey(value) {
  return /^(stroke_|poly_)/i.test(clean(value));
}

function shiftAnnCoord(value, delta) {
  return clampAnnCoord((Number(value) || 0) + delta);
}

function movedFreehandGroupAnn(ann, dx, dy) {
  if (!ann?.__isFreehandGroup || !Array.isArray(ann.__segments)) return ann;
  const segments = ann.__segments.map((seg) => ({
    ...seg,
    x1: shiftAnnCoord(seg.x1, dx),
    y1: shiftAnnCoord(seg.y1, dy),
    x2: shiftAnnCoord(seg.x2, dx),
    y2: shiftAnnCoord(seg.y2, dy),
  }));
  const first = segments[0] || ann;
  const last = segments[segments.length - 1] || first;
  return {
    ...ann,
    x1: first.x1,
    y1: first.y1,
    x2: last.x2,
    y2: last.y2,
    __segments: segments,
  };
}


function pointDistance(a, b) {
  const dx = (Number(b?.x) || 0) - (Number(a?.x) || 0);
  const dy = (Number(b?.y) || 0) - (Number(a?.y) || 0);
  return Math.sqrt((dx * dx) + (dy * dy));
}

function compactFreehandPoints(points, minDistance = 0.00045) {
  const raw = Array.isArray(points) ? points : [];
  const cleanPoints = [];
  raw.forEach((pt) => {
    const next = { x: clamp01(pt?.x), y: clamp01(pt?.y) };
    const last = cleanPoints[cleanPoints.length - 1];
    if (!last || pointDistance(last, next) >= minDistance) cleanPoints.push(next);
  });
  return cleanPoints;
}

function limitFreehandPoints(points, maxPoints = 180) {
  const list = Array.isArray(points) ? points : [];
  if (list.length <= maxPoints) return list;
  const sampled = [];
  const step = (list.length - 1) / Math.max(1, maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) sampled.push(list[Math.round(i * step)]);
  return sampled;
}

function chaikinSmoothPoints(points, passes = 2, maxPoints = 180) {
  let current = compactFreehandPoints(points, 0.00012);
  for (let pass = 0; pass < passes; pass += 1) {
    if (current.length < 3) break;
    const next = [current[0]];
    for (let i = 0; i < current.length - 1; i += 1) {
      const p0 = current[i];
      const p1 = current[i + 1];
      next.push({ x: clamp01((p0.x * 0.75) + (p1.x * 0.25)), y: clamp01((p0.y * 0.75) + (p1.y * 0.25)) });
      next.push({ x: clamp01((p0.x * 0.25) + (p1.x * 0.75)), y: clamp01((p0.y * 0.25) + (p1.y * 0.75)) });
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return limitFreehandPoints(current, maxPoints);
}

function interpolateFreehandPoints(points, maxStep = 0.003, maxPoints = 220) {
  const compacted = compactFreehandPoints(points, 0.00005);
  if (compacted.length < 2) return compacted;
  const out = [compacted[0]];
  for (let i = 1; i < compacted.length; i += 1) {
    const prev = out[out.length - 1];
    const next = compacted[i];
    const dist = pointDistance(prev, next);
    const pieces = Math.max(1, Math.min(8, Math.ceil(dist / Math.max(0.0002, maxStep))));
    for (let piece = 1; piece <= pieces; piece += 1) {
      const t = piece / pieces;
      out.push({
        x: clamp01(prev.x + ((next.x - prev.x) * t)),
        y: clamp01(prev.y + ((next.y - prev.y) * t)),
      });
    }
  }
  return limitFreehandPoints(out, maxPoints);
}

function movingAverageFreehandPoints(points, passes = 1) {
  let current = compactFreehandPoints(points, 0.00005);
  for (let pass = 0; pass < passes; pass += 1) {
    if (current.length < 4) break;
    const next = [current[0]];
    for (let i = 1; i < current.length - 1; i += 1) {
      const a = current[i - 1];
      const b = current[i];
      const c = current[i + 1];
      next.push({
        x: clamp01((a.x * 0.2) + (b.x * 0.6) + (c.x * 0.2)),
        y: clamp01((a.y * 0.2) + (b.y * 0.6) + (c.y * 0.2)),
      });
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

function catmullRomFreehandPoints(points, samplesPerSegment = 6, maxPoints = 200) {
  const pts = compactFreehandPoints(points, 0.00005);
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let sample = 1; sample <= samplesPerSegment; sample += 1) {
      const t = sample / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (
        (2 * p1.x)
        + ((-p0.x + p2.x) * t)
        + (((2 * p0.x) - (5 * p1.x) + (4 * p2.x) - p3.x) * t2)
        + ((-p0.x + (3 * p1.x) - (3 * p2.x) + p3.x) * t3)
      );
      const y = 0.5 * (
        (2 * p1.y)
        + ((-p0.y + p2.y) * t)
        + (((2 * p0.y) - (5 * p1.y) + (4 * p2.y) - p3.y) * t2)
        + ((-p0.y + (3 * p1.y) - (3 * p2.y) + p3.y) * t3)
      );
      out.push({ x: clamp01(x), y: clamp01(y) });
    }
  }
  return limitFreehandPoints(out, maxPoints);
}

function iosSmoothFreehandPoints(points, maxPoints = 190) {
  const retained = simplifyFreehandPoints(points, 0.00018, 125);
  const densified = interpolateFreehandPoints(retained, 0.0028, 220);
  const averaged = movingAverageFreehandPoints(densified, 1);
  return catmullRomFreehandPoints(averaged, 7, maxPoints);
}

function renderSmoothFreehandPoints(points, maxPoints = 220) {
  const compacted = compactFreehandPoints(points, 0.00005);
  if (Platform.OS === 'ios') return iosSmoothFreehandPoints(compacted, maxPoints);
  return chaikinSmoothPoints(compacted, 2, Math.min(maxPoints, 180));
}

function simplifyFreehandPoints(points, minDistance = 0.003, maxPoints = 70) {
  let compacted = compactFreehandPoints(points, minDistance);
  if (compacted.length < 2) compacted = compactFreehandPoints(points, 0.00005);
  if (compacted.length <= maxPoints) return compacted;
  const sampled = [];
  const step = (compacted.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) sampled.push(compacted[Math.round(i * step)]);
  return sampled;
}

function smoothFreehandInputPoints(points) {
  if (Platform.OS === 'ios') return iosSmoothFreehandPoints(points, 190);
  const retained = simplifyFreehandPoints(points, 0.00045, 95);
  return chaikinSmoothPoints(retained, 2, 130);
}

function arrowHeadMetrics(strokeValue) {
  const stroke = Math.max(1, Number(strokeValue) || 1);
  const length = Math.max(7, Math.min(20, 7 + (stroke * 2.1)));
  const half = Math.max(4, length * 0.42);
  return { length, half, height: half * 2 };
}

function renderArrowHead(strokeValue, top, key = 'arrow-head') {
  const head = arrowHeadMetrics(strokeValue);
  return (
    <View
      key={key}
      pointerEvents="none"
      style={[
        styles.arrowHeadTriangle,
        {
          right: -(head.length * 0.08),
          top: top - head.half,
          borderTopWidth: head.half,
          borderBottomWidth: head.half,
          borderLeftWidth: head.length,
          borderLeftColor: '#000000',
        },
      ]}
    />
  );
}

function sameFreehandStyle(a, b) {
  if (!a || !b) return false;
  return clean(a.stroke_color || '#ef4444').toLowerCase() === clean(b.stroke_color || '#ef4444').toLowerCase()
    && Number(annotationStrokeWidth(a.stroke_width, 3)) === Number(annotationStrokeWidth(b.stroke_width, 3))
    && String(a.page_id || '') === String(b.page_id || '')
    && String(a.created_by_email || '') === String(b.created_by_email || '');
}

function isConnectableFreehandSegment(prev, next) {
  if (!prev || !next || !sameFreehandStyle(prev, next)) return false;
  const end = { x: clamp01(prev.x2), y: clamp01(prev.y2) };
  const start = { x: clamp01(next.x1), y: clamp01(next.y1) };
  return pointDistance(end, start) <= 0.012;
}

function makeFreehandGroup(firstAnn, key) {
  return {
    ...firstAnn,
    id: `drawgroup:${key}`,
    note: key,
    __isFreehandGroup: true,
    __isPolylineGroup: isPolylineGroupKey(key),
    __preserveSegmentOrder: isOrderedFreehandGroupKey(key),
    __groupKey: key,
    __groupIds: [],
    __segments: [],
  };
}

function appendFreehandSegment(group, ann) {
  group.__groupIds.push(ann.id);
  group.__segments.push(ann);
  const first = group.__segments[0] || ann;
  const last = group.__segments[group.__segments.length - 1] || ann;
  group.x1 = first.x1;
  group.y1 = first.y1;
  group.x2 = last.x2;
  group.y2 = last.y2;
  group.stroke_color = first.stroke_color;
  group.stroke_width = first.stroke_width;
  return group;
}

function orderedFreehandSegments(segments) {
  const remaining = (Array.isArray(segments) ? segments : []).map((seg) => ({
    ...seg,
    x1: clamp01(seg.x1),
    y1: clamp01(seg.y1),
    x2: clamp01(seg.x2),
    y2: clamp01(seg.y2),
  }));
  if (remaining.length <= 1) return remaining;

  const endpointTolerance = 0.0025;
  const endpoints = [];
  remaining.forEach((seg, index) => {
    endpoints.push({ index, endName: 'start', point: { x: seg.x1, y: seg.y1 } });
    endpoints.push({ index, endName: 'end', point: { x: seg.x2, y: seg.y2 } });
  });

  let startIndex = 0;
  let reverseStart = false;
  let bestOpenDistance = -1;
  endpoints.forEach((endpoint) => {
    let nearest = Infinity;
    endpoints.forEach((other) => {
      if (other.index === endpoint.index && other.endName !== endpoint.endName) return;
      const dist = pointDistance(endpoint.point, other.point);
      if (dist > 0 && dist < nearest) nearest = dist;
    });
    if (nearest > bestOpenDistance && nearest > endpointTolerance) {
      bestOpenDistance = nearest;
      startIndex = endpoint.index;
      reverseStart = endpoint.endName === 'end';
    }
  });

  const takeAt = (index, reversed = false) => {
    const [seg] = remaining.splice(index, 1);
    if (!reversed) return seg;
    return { ...seg, x1: seg.x2, y1: seg.y2, x2: seg.x1, y2: seg.y1 };
  };

  const ordered = [takeAt(startIndex, reverseStart)];
  while (remaining.length) {
    const tail = ordered[ordered.length - 1];
    const tailPoint = { x: tail.x2, y: tail.y2 };
    let bestIndex = 0;
    let bestReversed = false;
    let bestDistance = Infinity;

    remaining.forEach((seg, index) => {
      const startDist = pointDistance(tailPoint, { x: seg.x1, y: seg.y1 });
      if (startDist < bestDistance) {
        bestDistance = startDist;
        bestIndex = index;
        bestReversed = false;
      }
      const endDist = pointDistance(tailPoint, { x: seg.x2, y: seg.y2 });
      if (endDist < bestDistance) {
        bestDistance = endDist;
        bestIndex = index;
        bestReversed = true;
      }
    });

    ordered.push(takeAt(bestIndex, bestReversed));
  }

  return ordered;
}

function sortedSegmentsByServerOrder(segments) {
  return (Array.isArray(segments) ? [...segments] : []).sort((a, b) => {
    const aId = Number(a?.id);
    const bId = Number(b?.id);
    if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) return aId - bId;
    return 0;
  });
}

function freehandRenderPointsFromSegments(segments, preserveOrder = false) {
  const list = preserveOrder ? sortedSegmentsByServerOrder(segments) : orderedFreehandSegments(segments);
  if (!list.length) return [];
  const points = [];
  list.forEach((seg, idx) => {
    const start = { x: clamp01(seg.x1), y: clamp01(seg.y1) };
    const end = { x: clamp01(seg.x2), y: clamp01(seg.y2) };
    if (idx === 0) points.push(start);
    points.push(end);
  });
  return compactFreehandPoints(points, 0.00005);
}

function renderPolylineStroke(points, canvasWidth, canvasHeight, color, stroke, keyPrefix = 'polyline') {
  const pts = compactFreehandPoints(points, 0.00005);
  if (pts.length < 2) return null;
  const hitHeight = Math.max(24, stroke + 18);
  const jointSize = Math.max(2, stroke);
  return (
    <>
      {pts.slice(1).map((pt, idx) => {
        const prev = pts[idx];
        const x1 = prev.x * canvasWidth;
        const y1 = prev.y * canvasHeight;
        const x2 = pt.x * canvasWidth;
        const y2 = pt.y * canvasHeight;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.max(1, Math.sqrt((dx * dx) + (dy * dy)));
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        return (
          <View
            key={`${keyPrefix}-seg-${idx}`}
            pointerEvents="none"
            style={[
              styles.lineHit,
              {
                left: ((x1 + x2) / 2) - (len / 2),
                top: ((y1 + y2) / 2) - (hitHeight / 2),
                width: len,
                height: hitHeight,
                transform: [{ rotateZ: `${angle}deg` }],
              },
            ]}
          >
            <View style={[styles.lineShape, { left: 0, top: (hitHeight - stroke) / 2, width: len, height: stroke, backgroundColor: color }]} />
          </View>
        );
      })}
      {pts.map((pt, idx) => (
        <View
          key={`${keyPrefix}-joint-${idx}`}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: (pt.x * canvasWidth) - (jointSize / 2),
            top: (pt.y * canvasHeight) - (jointSize / 2),
            width: jointSize,
            height: jointSize,
            borderRadius: jointSize / 2,
            backgroundColor: color,
          }}
        />
      ))}
    </>
  );
}


function renderPolylineHitTargets(points, canvasWidth, canvasHeight, stroke, onPress, keyPrefix = 'polyline-hit') {
  const pts = compactFreehandPoints(points, 0.00005);
  if (pts.length < 2) return null;
  const hitHeight = Math.max(18, stroke + 14);
  return pts.slice(1).map((pt, idx) => {
    const prev = pts[idx];
    const x1 = prev.x * canvasWidth;
    const y1 = prev.y * canvasHeight;
    const x2 = pt.x * canvasWidth;
    const y2 = pt.y * canvasHeight;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.max(1, Math.sqrt((dx * dx) + (dy * dy)));
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    return (
      <GuardedTapPressable
        key={`${keyPrefix}-${idx}`}
        onTap={onPress}
        style={{
          position: 'absolute',
          left: ((x1 + x2) / 2) - (len / 2),
          top: ((y1 + y2) / 2) - (hitHeight / 2),
          width: len,
          height: hitHeight,
          transform: [{ rotateZ: `${angle}deg` }],
        }}
      />
    );
  });
}

function boxEdgeHitStyles(left, top, width, height, edgeWidth) {
  const edge = Math.max(12, Number(edgeWidth) || 0);
  const half = edge / 2;
  const safeWidth = Math.max(1, Number(width) || 0);
  const safeHeight = Math.max(1, Number(height) || 0);
  return [
    { left: left - half, top: top - half, width: safeWidth + edge, height: edge },
    { left: left - half, top: top + safeHeight - half, width: safeWidth + edge, height: edge },
    { left: left - half, top: top + half, width: edge, height: Math.max(1, safeHeight - edge) },
    { left: left + safeWidth - half, top: top + half, width: edge, height: Math.max(1, safeHeight - edge) },
  ];
}

function renderBoxEdgeHitTargets(bounds, canvasWidth, canvasHeight, stroke, onPress, keyPrefix = 'box-edge-hit') {
  if (!bounds || !canvasWidth || !canvasHeight) return null;
  const left = bounds.left * canvasWidth;
  const top = bounds.top * canvasHeight;
  const width = Math.max(1, bounds.width * canvasWidth);
  const height = Math.max(1, bounds.height * canvasHeight);
  const edgeWidth = Math.max(18, (Number(stroke) || 1) + 14);
  return boxEdgeHitStyles(left, top, width, height, edgeWidth).map((style, idx) => (
    <GuardedTapPressable
      key={`${keyPrefix}-${idx}`}
      onTap={onPress}
      style={[styles.boxEdgeHit, style]}
    />
  ));
}

function renderFreehandStroke(points, canvasWidth, canvasHeight, color, stroke, keyPrefix = 'freehand') {
  const pts = renderSmoothFreehandPoints(points, 220);
  if (pts.length < 2) return null;
  const hitHeight = Math.max(24, stroke + 18);
  const jointSize = Math.max(stroke, 1);
  return (
    <>
      {pts.slice(1).map((pt, idx) => {
        const prev = pts[idx];
        const x1 = prev.x * canvasWidth;
        const y1 = prev.y * canvasHeight;
        const x2 = pt.x * canvasWidth;
        const y2 = pt.y * canvasHeight;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.max(1, Math.sqrt((dx * dx) + (dy * dy)) + Math.max(1.5, jointSize * 1.35));
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        return (
          <View
            key={`${keyPrefix}-seg-${idx}`}
            pointerEvents="none"
            style={[
              styles.lineHit,
              {
                left: ((x1 + x2) / 2) - (len / 2),
                top: ((y1 + y2) / 2) - (hitHeight / 2),
                width: len,
                height: hitHeight,
                transform: [{ rotateZ: `${angle}deg` }],
              },
            ]}
          >
            <View style={[styles.lineShape, { left: 0, top: (hitHeight - stroke) / 2, width: len, height: stroke, backgroundColor: color }]} />
          </View>
        );
      })}
    </>
  );
}

function buildAnnotationDisplayList(items) {
  const result = [];
  const explicitGroups = new Map();
  let implicitGroup = null;
  let implicitIndex = 0;

  (Array.isArray(items) ? items : []).forEach((ann) => {
    const shape = clean(ann?.shape_type).toLowerCase();
    const explicitKey = freehandGroupKey(ann);

    if (shape !== 'draw') {
      implicitGroup = null;
      result.push(ann);
      return;
    }

    if (explicitKey) {
      implicitGroup = null;
      if (!explicitGroups.has(explicitKey)) {
        const group = makeFreehandGroup(ann, explicitKey);
        explicitGroups.set(explicitKey, group);
        result.push(group);
      }
      appendFreehandSegment(explicitGroups.get(explicitKey), ann);
      return;
    }

    // Older/mobile-created pencil strokes can arrive without a group note.
    // Collapse connected draw segments into one selectable/deletable entity so
    // one freehand line does not behave like dozens of separate annotations.
    if (!implicitGroup || !isConnectableFreehandSegment(implicitGroup.__segments[implicitGroup.__segments.length - 1], ann)) {
      const implicitKey = `implicit_${ann.page_id || 'page'}_${implicitIndex += 1}_${ann.id || Date.now()}`;
      implicitGroup = makeFreehandGroup(ann, implicitKey);
      result.push(implicitGroup);
    }
    appendFreehandSegment(implicitGroup, ann);
  });

  return result;
}

function annotationBounds(a) {
  const points = [];
  if (a?.__isFreehandGroup && Array.isArray(a.__segments)) {
    a.__segments.forEach((seg) => {
      points.push([clamp01(seg.x1), clamp01(seg.y1)], [clamp01(seg.x2), clamp01(seg.y2)]);
    });
  } else {
    points.push([clamp01(a.x1), clamp01(a.y1)], [clamp01(a.x2), clamp01(a.y2)]);
  }
  const xs = points.map((pt) => pt[0]);
  const ys = points.map((pt) => pt[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  const width = Math.max(right - left, 0.006);
  const height = Math.max(bottom - top, 0.006);
  return { left, top, width, height };
}

function isIconNote(note) {
  return note === ICON_NOTE_CHECK
    || note === ICON_NOTE_X
    || note === ICON_NOTE_OUTLET
    || note === ICON_NOTE_BREAKER
    || note === ICON_NOTE_BLUEPRINT;
}

function iconStrokeColor(note) {
  if (note === ICON_NOTE_CHECK) return '#16a34a';
  if (note === ICON_NOTE_BLUEPRINT) return '#2563eb';
  return '#dc2626';
}

function isCloudNote(note) {
  return String(note || '').startsWith('cloud:');
}

function cloudParse(note) {
  const raw = String(note || '');
  if (!isCloudNote(raw)) return { text: '', rot: 0 };
  const payload = raw.slice('cloud:'.length);
  const parts = payload.split('||rot=');
  const text = String(parts[0] || '').trim();
  const rot = parts.length > 1 ? Number.parseFloat(String(parts[1] || '').trim()) : 0;
  return { text, rot: Number.isFinite(rot) ? rot : 0 };
}

function isPlainNoteAnnotation(ann) {
  if (clean(ann?.shape_type).toLowerCase() !== 'note') return false;
  const note = String(ann?.note || '');
  return !!note && !isIconNote(note) && !isCloudNote(note);
}

function noteAnnotationDistance(pin, ann) {
  const px = clamp01(pin?.x);
  const py = clamp01(pin?.y);
  const ax = clamp01(ann?.x1);
  const ay = clamp01(ann?.y1);
  const dx = px - ax;
  const dy = py - ay;
  return Math.sqrt((dx * dx) + (dy * dy));
}

function noteAnnotationForPin(pin, annotations) {
  if (!pin || pinKind(pin) !== 'note') return null;
  const list = (Array.isArray(annotations) ? annotations : []).filter(isPlainNoteAnnotation);

  // Prefer a direct note-pin link when newer local saves have one.  Older notes
  // do not have this field, so we fall back to tight coordinate matching below.
  const pinId = clean(pin?.id);
  if (pinId) {
    const linked = list.find((ann) => clean(ann?.note_pin_id || ann?.pin_id || ann?.linked_pin_id) === pinId);
    if (linked) return linked;
  }

  const exact = list
    .map((ann) => ({ ann, dist: noteAnnotationDistance(pin, ann) }))
    .filter((item) => item.dist <= 0.004)
    .sort((a, b) => a.dist - b.dist);
  if (exact[0]?.ann) return exact[0].ann;

  // Keep the fallback intentionally small.  The older 12% page-wide tolerance
  // caused clustered note pins to all edit the same text annotation.
  const candidates = list
    .map((ann) => ({ ann, dist: noteAnnotationDistance(pin, ann) }))
    .filter((item) => item.dist <= 0.025)
    .sort((a, b) => a.dist - b.dist);
  return candidates[0]?.ann || null;
}

function noteTextForPin(pin, annotations) {
  const localText = clean(pin?.__mobile_note_text);
  if (localText) return localText;
  const ann = noteAnnotationForPin(pin, annotations);
  if (ann) return String(ann.note || '');
  return clean(pin?.note || pin?.note_text || pin?.text || pin?.description || '');
}

function annotationStrokeWidth(value, fallback = 3) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, n) : fallback;
}

function clampAnnCoord(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function editableAnnotationShape(shapeType) {
  const shape = clean(shapeType).toLowerCase();
  return ['rect', 'rectangle', 'ellipse', 'circle', 'cloud', 'line', 'arrow', 'measure', 'measure_line', 'draw', 'note'].includes(shape);
}

function annotationUpdatePayload(ann, overrides = {}) {
  const next = { ...(ann || {}), ...(overrides || {}) };
  return {
    page_id: next.page_id || next.pageId || next.page || undefined,
    shape_type: clean(next.shape_type) || 'rect',
    x1: clampAnnCoord(next.x1),
    y1: clampAnnCoord(next.y1),
    x2: clampAnnCoord(next.x2),
    y2: clampAnnCoord(next.y2),
    stroke_color: clean(next.stroke_color) || '#ef4444',
    stroke_width: annotationStrokeWidth(next.stroke_width, 3),
    note: next.note || '',
    layer: clean(next.layer) || 'primary',
  };
}

function normalizeMovedBox(startBox, dx, dy) {
  const width = Math.max(0.006, startBox.width);
  const height = Math.max(0.006, startBox.height);
  const left = Math.max(0, Math.min(1 - width, startBox.left + dx));
  const top = Math.max(0, Math.min(1 - height, startBox.top + dy));
  return { x1: left, y1: top, x2: left + width, y2: top + height };
}

function resizedBoxFromHandle(startBox, point, handle) {
  const minSize = 0.006;
  let left = startBox.left;
  let top = startBox.top;
  let right = startBox.left + startBox.width;
  let bottom = startBox.top + startBox.height;

  if (handle === 'nw') {
    left = Math.min(right - minSize, clampAnnCoord(point.x));
    top = Math.min(bottom - minSize, clampAnnCoord(point.y));
  } else if (handle === 'ne') {
    right = Math.max(left + minSize, clampAnnCoord(point.x));
    top = Math.min(bottom - minSize, clampAnnCoord(point.y));
  } else if (handle === 'sw') {
    left = Math.min(right - minSize, clampAnnCoord(point.x));
    bottom = Math.max(top + minSize, clampAnnCoord(point.y));
  } else {
    right = Math.max(left + minSize, clampAnnCoord(point.x));
    bottom = Math.max(top + minSize, clampAnnCoord(point.y));
  }

  left = clampAnnCoord(left);
  top = clampAnnCoord(top);
  right = clampAnnCoord(right);
  bottom = clampAnnCoord(bottom);
  if (right - left < minSize) right = Math.min(1, left + minSize);
  if (bottom - top < minSize) bottom = Math.min(1, top + minSize);
  return { x1: left, y1: top, x2: right, y2: bottom };
}


function approxTextWidth(text, fontSize) {
  return String(text || '').length * (fontSize * 0.58);
}


function resizedCircleBoxFromHandle(startBox, point, handle, canvasWidth = 1, canvasHeight = 1) {
  const minPx = 6;
  const safeW = Math.max(1, Number(canvasWidth) || 1);
  const safeH = Math.max(1, Number(canvasHeight) || 1);
  const leftPx = startBox.left * safeW;
  const topPx = startBox.top * safeH;
  const rightPx = (startBox.left + startBox.width) * safeW;
  const bottomPx = (startBox.top + startBox.height) * safeH;
  const pointPx = { x: clampAnnCoord(point.x) * safeW, y: clampAnnCoord(point.y) * safeH };

  let anchorX = leftPx;
  let anchorY = topPx;
  let signX = 1;
  let signY = 1;
  if (handle === 'nw') {
    anchorX = rightPx;
    anchorY = bottomPx;
    signX = -1;
    signY = -1;
  } else if (handle === 'ne') {
    anchorX = leftPx;
    anchorY = bottomPx;
    signX = 1;
    signY = -1;
  } else if (handle === 'sw') {
    anchorX = rightPx;
    anchorY = topPx;
    signX = -1;
    signY = 1;
  }

  const rawSide = Math.max(Math.abs(pointPx.x - anchorX), Math.abs(pointPx.y - anchorY), minPx);
  const maxSideX = signX > 0 ? safeW - anchorX : anchorX;
  const maxSideY = signY > 0 ? safeH - anchorY : anchorY;
  const side = Math.max(minPx, Math.min(rawSide, maxSideX, maxSideY));
  const nextX = anchorX + (signX * side);
  const nextY = anchorY + (signY * side);
  const left = Math.min(anchorX, nextX) / safeW;
  const top = Math.min(anchorY, nextY) / safeH;
  const right = Math.max(anchorX, nextX) / safeW;
  const bottom = Math.max(anchorY, nextY) / safeH;
  return { x1: clampAnnCoord(left), y1: clampAnnCoord(top), x2: clampAnnCoord(right), y2: clampAnnCoord(bottom) };
}

function circleEndFromDrag(start, end, canvasWidth = 1, canvasHeight = 1) {
  const safeW = Math.max(1, Number(canvasWidth) || 1);
  const safeH = Math.max(1, Number(canvasHeight) || 1);
  const sx = clampAnnCoord(start.x) * safeW;
  const sy = clampAnnCoord(start.y) * safeH;
  const ex = clampAnnCoord(end.x) * safeW;
  const ey = clampAnnCoord(end.y) * safeH;
  const signX = ex >= sx ? 1 : -1;
  const signY = ey >= sy ? 1 : -1;
  const rawSide = Math.max(Math.abs(ex - sx), Math.abs(ey - sy), 6);
  const maxSideX = signX > 0 ? safeW - sx : sx;
  const maxSideY = signY > 0 ? safeH - sy : sy;
  const side = Math.max(6, Math.min(rawSide, maxSideX, maxSideY));
  return { x: clampAnnCoord((sx + (signX * side)) / safeW), y: clampAnnCoord((sy + (signY * side)) / safeH) };
}

function breakLongTokenToChars(token, maxChars) {
  const value = String(token || '');
  if (!value) return [];
  const safeMax = Math.max(1, Math.floor(maxChars || 1));
  const out = [];
  for (let i = 0; i < value.length; i += safeMax) {
    out.push(value.slice(i, i + safeMax));
  }
  return out;
}

function wrapCloudTextToLines(text, targetChars) {
  const raw = String(text || '').replace(/\r\n/g, '\n');
  if (!raw.trim()) return [];
  const safeMax = Math.max(1, Math.floor(targetChars || 12));
  const out = [];
  raw.split('\n').forEach((part) => {
    const cleaned = String(part || '').replace(/[ \t]+/g, ' ').trim();
    if (!cleaned) {
      out.push('');
      return;
    }
    let cur = '';
    cleaned.split(' ').forEach((token) => {
      if (token.length > safeMax) {
        if (cur) {
          out.push(cur);
          cur = '';
        }
        breakLongTokenToChars(token, safeMax).forEach((chunk) => out.push(chunk));
        return;
      }
      const next = cur ? `${cur} ${token}` : token;
      if (cur && next.length > safeMax) {
        out.push(cur);
        cur = token;
      } else {
        cur = next;
      }
    });
    if (cur) out.push(cur);
  });
  return out;
}

function cloudLayoutMetrics(text, stroke) {
  const sw = Number(stroke || 1);
  // Cloud sizing only: keep the line-width picker behavior for every other
  // annotation, but shift clouds down so the previous "1" size now lands
  // around "3" and sizes 1/2 are available for tighter labels.
  const fontSize = Math.max(7, Math.min(20, 6 + (sw - 1) * 2));
  const lineHeight = fontSize * 1.16;
  const rawText = String(text || '');
  const rawLen = rawText.replace(/\s+/g, ' ').trim().length;
  const minChars = 4;
  const maxChars = Math.min(30, Math.max(8, Math.round(9 + sw * 1.33)));
  const targetChars = Math.max(minChars, Math.min(maxChars, rawLen || maxChars));
  const lines = wrapCloudTextToLines(rawText, targetChars);
  const visibleLines = lines.slice(0, 28);
  if (lines.length > 28 && visibleLines.length) {
    visibleLines[visibleLines.length - 1] = `${visibleLines[visibleLines.length - 1].replace(/\s+$/, '')}…`;
  }
  // Keep cloud labels tight to the text. The cloud size scale was lowered,
  // so avoid reintroducing dead space through minimum padding.
  const padX = Math.max(2, fontSize * 0.18);
  const padY = Math.max(1.5, fontSize * 0.14);
  let widest = 0;
  visibleLines.forEach((line) => {
    widest = Math.max(widest, approxTextWidth(line, fontSize));
  });
  return {
    fontSize,
    lineHeight,
    lines: visibleLines.length ? visibleLines : [''],
    width: Math.max(fontSize * 1.9, widest + padX * 2),
    height: Math.max(fontSize * 1.28, padY * 2 + Math.max(1, visibleLines.length) * lineHeight),
    borderRadius: Math.max(6, Math.min(20, (padY * 2 + Math.max(1, visibleLines.length) * lineHeight) * 0.28)),
    borderWidth: Math.max(0.65, Math.min(2.0, fontSize * 0.10)),
  };
}

function cloudAnnotationPixelBox(ann, canvasWidth, canvasHeight, zoomScale = 1) {
  const parsed = cloudParse(ann?.note);
  const baseStroke = annotationStrokeWidth(ann?.stroke_width, 3);
  const baseCloud = cloudLayoutMetrics(parsed.text, baseStroke);
  const width = Math.max(24, baseCloud.width * zoomScale);
  const height = Math.max(18, baseCloud.height * zoomScale);
  const centerX = clamp01(ann?.x1) * canvasWidth;
  const centerY = clamp01(ann?.y1) * canvasHeight;
  return {
    left: centerX - (width / 2),
    top: centerY - (height / 2),
    width,
    height,
  };
}

function iconLayoutMetrics(stroke) {
  const raw = Number(stroke || 1);
  const lw = Number.isFinite(raw) ? Math.max(1, raw) : 1;

  // Icons use the line-width control as a size control. Keep the drawn strokes
  // crisp, but grow the whole icon noticeably so selected check/X, outlet,
  // breaker panel, and drywall patch icons all resize the same way.
  const visibleSize = Math.max(13, Math.min(34, 10 + (lw * 3)));
  const radius = visibleSize / 2;
  const hitSize = Math.max(32, visibleSize + 16);
  const strokeWidth = Math.max(1.05, Math.min(3.2, visibleSize * 0.085));
  const haloWidth = strokeWidth * 1.9;
  const borderWidth = strokeWidth;
  return { visibleSize, hitSize, borderWidth, strokeWidth, haloWidth, radius };
}

function Dropdown({ label, value, items, onSelect, disabled, searchValue = null, onSearchChange = null, searchPlaceholder = 'Search...' }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.dropdownWrap}>
      <Text style={styles.controlLabel}>{label}</Text>
      <Pressable style={[styles.dropdown, disabled && styles.disabled]} disabled={disabled} onPress={() => setOpen(true)}>
        <Text style={styles.dropdownText} numberOfLines={1}>{clean(value) || 'Select'}</Text>
        <Text style={styles.dropdownCaret}>⌄</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.dropdownModal} onPress={(event) => event.stopPropagation?.()}>
            <Text style={styles.modalTitle}>{label}</Text>
            {typeof onSearchChange === 'function' ? (
              <TextInput
                style={[styles.textInput, styles.dropdownSearchInput]}
                value={searchValue || ''}
                onChangeText={onSearchChange}
                placeholder={searchPlaceholder}
                placeholderTextColor="#94a3b8"
                autoCapitalize="none"
                autoCorrect={false}
              />
            ) : null}
            <ScrollView style={styles.dropdownOptionsScroll} keyboardShouldPersistTaps="handled">
              {(items || []).length ? (items || []).map((item) => {
                const itemLabel = clean(item?.label ?? item?.display_name ?? item?.sitewalk_desc ?? item?.site_name ?? item);
                const itemValue = item?.value ?? item?.id ?? item;
                if (item?.type === 'header') {
                  return <Text key={`${itemLabel}-${itemValue}`} style={styles.dropdownGroupHeader}>{itemLabel}</Text>;
                }
                return (
                  <Pressable key={`${itemLabel}-${itemValue}`} style={styles.dropdownOption} onPress={() => { onSelect?.(item); setOpen(false); }}>
                    <Text style={styles.dropdownOptionText}>{itemLabel}</Text>
                  </Pressable>
                );
              }) : (
                <Text style={styles.emptyDropdownText}>{t("No options available.")}</Text>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function ToolGlyph({ type, active }) {
  const stroke = active ? '#ffffff' : '#111827';
  if (type === TOOL_LINE) {
    return <View style={[styles.glyphLine, { backgroundColor: stroke, transform: [{ rotateZ: '-38deg' }] }]} />;
  }
  if (type === TOOL_POLYLINE) {
    return (
      <View style={styles.glyphPolylineWrap}>
        <View style={[styles.glyphPolylineSegA, { backgroundColor: stroke }]} />
        <View style={[styles.glyphPolylineSegB, { backgroundColor: stroke }]} />
        <View style={[styles.glyphPolylineDot, { left: 3, top: 18, backgroundColor: stroke }]} />
        <View style={[styles.glyphPolylineDot, { left: 12, top: 8, backgroundColor: stroke }]} />
        <View style={[styles.glyphPolylineDot, { left: 23, top: 15, backgroundColor: stroke }]} />
      </View>
    );
  }
  if (type === TOOL_ARROW) {
    return (
      <View style={styles.glyphArrowWrap}>
        <View style={styles.glyphArrowAxis}>
          <View style={styles.glyphArrowLine} />
          <View style={styles.glyphArrowHead} />
        </View>
      </View>
    );
  }
  if (type === TOOL_DRAW) {
    return <Text style={[styles.glyphPencil, { color: stroke }]}>✎</Text>;
  }
  if (type === TOOL_RECT) {
    return <View style={[styles.glyphSquare, { borderColor: stroke }]} />;
  }
  if (type === TOOL_CIRCLE) {
    return <View style={[styles.glyphCircle, { borderColor: stroke }]} />;
  }
  if (type === TOOL_CLOUD) {
    return <Text style={[styles.glyphCloud, { color: stroke }]}>☁</Text>;
  }
  if (type === TOOL_PHOTO) {
    return (
      <View style={[styles.glyphCameraBody, { borderColor: stroke }]}>
        <View style={[styles.glyphCameraTop, { backgroundColor: stroke }]} />
        <View style={[styles.glyphCameraLens, { borderColor: stroke }]} />
        <View style={[styles.glyphCameraDot, { backgroundColor: stroke }]} />
      </View>
    );
  }
  if (type === TOOL_LOCATION) {
    return (
      <View style={styles.glyphPinWrap}>
        <View style={[styles.glyphPinHead, { borderColor: stroke }]} />
        <View style={[styles.glyphPinTail, { borderTopColor: stroke }]} />
        <View style={[styles.glyphPinDot, { backgroundColor: stroke }]} />
      </View>
    );
  }
  if (type === TOOL_ICON) {
    return (
      <View style={styles.glyphGrid}>
        {[0, 1, 2, 3].map((idx) => <View key={idx} style={[styles.glyphGridCell, { borderColor: stroke }]} />)}
      </View>
    );
  }
  if (type === TOOL_NOTE) {
    return (
      <View style={[styles.glyphNotePage, { borderColor: stroke }]}>
        <View style={[styles.glyphNoteFold, { borderLeftColor: stroke, borderBottomColor: stroke }]} />
        <View style={[styles.glyphNoteLine, { backgroundColor: stroke, width: 10 }]} />
        <View style={[styles.glyphNoteLine, { backgroundColor: stroke, width: 7 }]} />
      </View>
    );
  }
  return <Text style={[styles.toolIcon, active && styles.toolIconActive]}>•</Text>;
}

function ToolButton({ item, active, onPress }) {
  return (
    <Pressable style={[styles.toolBtn, active && styles.toolBtnActive]} onPress={onPress}>
      <ToolGlyph type={item.key} active={active} />
    </Pressable>
  );
}

function FilterChip({ label, active, onPress }) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function OutletIconMark({ size, color }) {
  const s = Math.max(16, Number(size) || 18);
  const stroke = Math.max(1.2, s * 0.07);
  const plateW = s * 0.80;
  const plateH = s * 1.05;
  const inset = Math.max(1.1, stroke * 0.9);
  const plateRadius = s * 0.12;
  const faceW = plateW * 0.58;
  const faceH = plateH * 0.20;
  const slotW = Math.max(1.1, s * 0.055);
  const slotH = Math.max(2.4, faceH * 0.34);
  const groundW = Math.max(3.2, faceW * 0.19);
  const groundH = Math.max(2.3, faceH * 0.22);
  const renderFace = (top) => (
    <View
      key={top}
      style={{
        position: 'absolute',
        left: (plateW - faceW) / 2,
        top,
        width: faceW,
        height: faceH,
        borderRadius: faceH * 0.34,
        borderWidth: Math.max(0.9, stroke * 0.78),
        borderColor: color,
        backgroundColor: '#ffffff',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          position: 'absolute',
          left: faceW * 0.30 - slotW / 2,
          top: faceH * 0.26,
          width: slotW,
          height: slotH,
          borderRadius: slotW / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: faceW * 0.30 - slotW / 2,
          top: faceH * 0.26,
          width: slotW,
          height: slotH,
          borderRadius: slotW / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: (faceW - groundW) / 2,
          bottom: faceH * 0.13,
          width: groundW,
          height: groundH,
          borderRadius: groundH * 0.7,
          backgroundColor: color,
        }}
      />
    </View>
  );
  return (
    <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: plateW,
          height: plateH,
          borderRadius: plateRadius,
          borderWidth: Math.max(1, stroke * 0.95),
          borderColor: color,
          backgroundColor: '#fee2e2',
          position: 'relative',
          overflow: 'hidden',
          alignItems: 'center',
        }}
      >
        <View
          style={{
            position: 'absolute',
            left: inset,
            top: inset,
            right: inset,
            bottom: inset,
            borderRadius: Math.max(3, plateRadius - inset * 0.35),
            backgroundColor: '#fecaca',
          }}
        />
        {renderFace(plateH * 0.16)}
        {renderFace(plateH * 0.56)}
      </View>
    </View>
  );
}

function BreakerBoxIconMark({ size, color }) {
  const s = Math.max(17, Number(size) || 19);
  const stroke = Math.max(1.15, s * 0.065);
  const panelW = s * 0.82;
  const panelH = s * 1.06;
  const panelRadius = s * 0.09;
  const lineW = Math.max(1, stroke * 0.78);
  return (
    <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: panelW,
          height: panelH,
          borderRadius: panelRadius,
          borderWidth: Math.max(1, stroke * 0.95),
          borderColor: color,
          backgroundColor: '#fecaca',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            left: panelW * 0.31,
            top: panelH * 0.08,
            width: panelW * 0.38,
            height: panelH * 0.07,
            borderRadius: panelH * 0.02,
            borderWidth: Math.max(0.7, stroke * 0.55),
            borderColor: color,
            backgroundColor: '#fee2e2',
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: panelW * 0.18,
            top: panelH * 0.24,
            width: panelW * 0.66,
            height: panelH * 0.56,
            borderRadius: panelH * 0.05,
            borderWidth: Math.max(0.8, stroke * 0.72),
            borderColor: color,
            backgroundColor: '#fff1f2',
          }}
        />
        <View style={{ position: 'absolute', left: panelW * 0.07, top: panelH * 0.33, width: panelW * 0.10, height: panelH * 0.17, borderRadius: panelW * 0.02, borderWidth: Math.max(0.6, stroke * 0.5), borderColor: color, backgroundColor: '#fecaca' }} />
        <View style={{ position: 'absolute', left: panelW * 0.07, top: panelH * 0.66, width: panelW * 0.10, height: panelH * 0.17, borderRadius: panelW * 0.02, borderWidth: Math.max(0.6, stroke * 0.5), borderColor: color, backgroundColor: '#fecaca' }} />
        <View style={{ position: 'absolute', right: panelW * 0.03, top: panelH * 0.45, width: panelW * 0.06, height: panelH * 0.16, borderRadius: panelW * 0.02, borderWidth: Math.max(0.6, stroke * 0.5), borderColor: color, backgroundColor: '#fecaca' }} />

        <View
          style={{
            position: 'absolute',
            left: panelW * 0.29,
            top: panelH * 0.25,
            width: 0,
            height: 0,
            borderLeftWidth: panelW * 0.17,
            borderRightWidth: panelW * 0.17,
            borderBottomWidth: panelH * 0.24,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderBottomColor: '#ef4444',
          }}
        />
        <Text style={{ position: 'absolute', left: panelW * 0.40, top: panelH * 0.31, color: '#ffffff', fontSize: Math.max(6, s * 0.24), fontWeight: '900', lineHeight: Math.max(7, s * 0.24) }}>⚡</Text>
        <View style={{ position: 'absolute', left: panelW * 0.27, top: panelH * 0.63, width: panelW * 0.42, height: lineW, borderRadius: lineW / 2, backgroundColor: color }} />
        <View style={{ position: 'absolute', left: panelW * 0.30, top: panelH * 0.75, width: panelW * 0.34, height: lineW, borderRadius: lineW / 2, backgroundColor: color }} />
      </View>
    </View>
  );
}

function BlueLayoutIconMark({ size, color }) {
  const s = Math.max(18, Number(size) || 20);
  const stroke = Math.max(1.15, s * 0.062);
  const frame = s * 0.82;
  const lineW = Math.max(1, stroke * 0.9);
  const segH = lineW;
  const segments = [
    { left: frame * 0.02, top: frame * 0.57, width: frame * 0.22, rotate: '-2deg' },
    { left: frame * 0.22, top: frame * 0.55, width: frame * 0.18, rotate: '-12deg' },
    { left: frame * 0.37, top: frame * 0.48, width: frame * 0.19, rotate: '-28deg' },
    { left: frame * 0.54, top: frame * 0.33, width: frame * 0.20, rotate: '-16deg' },
    { left: frame * 0.72, top: frame * 0.20, width: frame * 0.25, rotate: '-2deg' },
  ];
  const dots = [
    { left: frame * 0.15, top: frame * 0.84 },
    { left: frame * 0.45, top: frame * 0.84 },
    { left: frame * 0.75, top: frame * 0.84 },
    { left: frame * 0.85, top: frame * 0.52 },
    { left: frame * 0.85, top: frame * 0.66 },
  ];
  const dotSize = Math.max(2.1, s * 0.10);
  return (
    <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: frame,
          height: frame,
          borderRadius: frame * 0.06,
          borderWidth: lineW,
          borderColor: color,
          backgroundColor: 'transparent',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <View style={{ position: 'absolute', left: frame * 0.34, top: 0, width: lineW, height: frame * 0.54, borderRadius: lineW / 2, backgroundColor: color }} />
        <View style={{ position: 'absolute', left: frame * 0.64, top: 0, width: lineW, height: frame * 0.42, borderRadius: lineW / 2, backgroundColor: color }} />
        {segments.map((seg, index) => (
          <View key={index} style={{ position: 'absolute', left: seg.left, top: seg.top, width: seg.width, height: segH, borderRadius: segH / 2, backgroundColor: '#ffffff', transform: [{ rotateZ: seg.rotate }] }} />
        ))}
        {segments.map((seg, index) => (
          <View key={`f-${index}`} style={{ position: 'absolute', left: seg.left, top: seg.top, width: seg.width, height: lineW, borderRadius: lineW / 2, backgroundColor: color, transform: [{ rotateZ: seg.rotate }] }} />
        ))}
        {dots.map((dot, index) => (
          <View key={index} style={{ position: 'absolute', left: dot.left, top: dot.top, width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: color }} />
        ))}
      </View>
    </View>
  );
}

function PlacedIconMark({ note, icon }) {

  const color = iconStrokeColor(note);
  if (note === ICON_NOTE_OUTLET) return <OutletIconMark size={icon.visibleSize * 1.15} color={color} />;
  if (note === ICON_NOTE_BREAKER) return <BreakerBoxIconMark size={icon.visibleSize * 1.2} color={color} />;
  if (note === ICON_NOTE_BLUEPRINT) return <BlueLayoutIconMark size={icon.visibleSize * 1.25} color={color} />;

  const isCheck = note === ICON_NOTE_CHECK;
  return (
    <View
      style={[
        styles.iconAnnMark,
        {
          width: icon.visibleSize,
          height: icon.visibleSize,
          borderRadius: icon.visibleSize / 2,
          borderWidth: icon.borderWidth,
          borderColor: isCheck ? '#16a34a' : '#dc2626',
        },
      ]}
    >
      {isCheck ? (
        <>
          <View style={[styles.iconCheckStroke, styles.iconCheckStrokeShort, { backgroundColor: '#ffffff', height: Math.max(2, icon.haloWidth), width: icon.visibleSize * 0.34, left: icon.visibleSize * 0.22, top: icon.visibleSize * 0.52 }]} />
          <View style={[styles.iconCheckStroke, styles.iconCheckStrokeLong, { backgroundColor: '#ffffff', height: Math.max(2, icon.haloWidth), width: icon.visibleSize * 0.62, left: icon.visibleSize * 0.39, top: icon.visibleSize * 0.44 }]} />
          <View style={[styles.iconCheckStroke, styles.iconCheckStrokeShort, { backgroundColor: '#16a34a', height: Math.max(1, icon.strokeWidth), width: icon.visibleSize * 0.34, left: icon.visibleSize * 0.22, top: icon.visibleSize * 0.52 }]} />
          <View style={[styles.iconCheckStroke, styles.iconCheckStrokeLong, { backgroundColor: '#16a34a', height: Math.max(1, icon.strokeWidth), width: icon.visibleSize * 0.62, left: icon.visibleSize * 0.39, top: icon.visibleSize * 0.44 }]} />
        </>
      ) : (
        <>
          <View style={[styles.iconXStroke, { backgroundColor: '#ffffff', height: Math.max(2, icon.haloWidth), width: icon.visibleSize * 0.76, left: icon.visibleSize * 0.12, top: icon.visibleSize * 0.49 }]} />
          <View style={[styles.iconXStroke, styles.iconXStrokeReverse, { backgroundColor: '#ffffff', height: Math.max(2, icon.haloWidth), width: icon.visibleSize * 0.76, left: icon.visibleSize * 0.12, top: icon.visibleSize * 0.49 }]} />
          <View style={[styles.iconXStroke, { backgroundColor: '#dc2626', height: Math.max(1, icon.strokeWidth), width: icon.visibleSize * 0.76, left: icon.visibleSize * 0.12, top: icon.visibleSize * 0.49 }]} />
          <View style={[styles.iconXStroke, styles.iconXStrokeReverse, { backgroundColor: '#dc2626', height: Math.max(1, icon.strokeWidth), width: icon.visibleSize * 0.76, left: icon.visibleSize * 0.12, top: icon.visibleSize * 0.49 }]} />
        </>
      )}
    </View>
  );
}

function Annotation({ ann, canvasWidth, canvasHeight, zoomScale = 1, selected, onPress }) {
  const b = annotationBounds(ann);
  const shape = clean(ann.shape_type).toLowerCase();
  const note = String(ann.note || '');
  const color = clean(ann.stroke_color) || '#ef4444';
  const baseStroke = annotationStrokeWidth(ann.stroke_width, 3);
  const stroke = Math.max(1, baseStroke);
  const x1 = clamp01(ann.x1) * canvasWidth;
  const y1 = clamp01(ann.y1) * canvasHeight;
  const x2 = clamp01(ann.x2) * canvasWidth;
  const y2 = clamp01(ann.y2) * canvasHeight;

  if (shape === 'note') {
    if (isIconNote(note)) {
      const baseIcon = iconLayoutMetrics(baseStroke);
      const icon = {
        visibleSize: baseIcon.visibleSize,
        hitSize: Math.max(28, baseIcon.hitSize),
        borderWidth: Math.max(0.9, baseIcon.borderWidth),
        strokeWidth: baseIcon.strokeWidth,
        haloWidth: baseIcon.haloWidth,
      };
      return (
        <GuardedTapPressable
          onTap={onPress}
          style={[
            styles.iconAnnHit,
            {
              left: x1 - (icon.hitSize / 2),
              top: y1 - (icon.hitSize / 2),
              width: icon.hitSize,
              height: icon.hitSize,
            },
            selected && styles.iconAnnHitSelected,
          ]}
        >
          <PlacedIconMark note={note} icon={icon} />
        </GuardedTapPressable>
      );
    }

    if (isCloudNote(note)) {
      const parsed = cloudParse(note);
      const baseCloud = cloudLayoutMetrics(parsed.text, baseStroke);
      const cloud = {
        ...baseCloud,
        fontSize: baseCloud.fontSize * zoomScale,
        lineHeight: baseCloud.lineHeight * zoomScale,
        width: baseCloud.width * zoomScale,
        height: baseCloud.height * zoomScale,
        borderRadius: baseCloud.borderRadius * zoomScale,
        borderWidth: Math.max(0.7, baseCloud.borderWidth * zoomScale),
      };
      return (
        <GuardedTapPressable
          onTap={onPress}
          style={[
            styles.cloudAnn,
            {
              left: x1 - (cloud.width / 2),
              top: y1 - (cloud.height / 2),
              width: cloud.width,
              minHeight: cloud.height,
              borderRadius: cloud.borderRadius,
              borderWidth: cloud.borderWidth,
              borderColor: '#dc2626',
              transform: [{ rotateZ: `${parsed.rot}deg` }],
            },
            selected && styles.cloudAnnSelected,
          ]}
        >
          <Text style={[styles.cloudAnnText, { fontSize: cloud.fontSize, lineHeight: cloud.lineHeight }]}>
            {cloud.lines.join('\n')}
          </Text>
        </GuardedTapPressable>
      );
    }

    // Desktop intentionally keeps ordinary note annotations out of the drawing layer.
    // The real note text is handled by the note/pin flow, so do not show raw DB markers.
    return null;
  }

  if (shape === 'draw' && ann.__isFreehandGroup && Array.isArray(ann.__segments)) {
    const bounds = annotationBounds(ann);
    const freehandPoints = freehandRenderPointsFromSegments(ann.__segments, ann.__preserveSegmentOrder);
    const hitLeft = bounds.left * canvasWidth;
    const hitTop = bounds.top * canvasHeight;
    const hitWidth = Math.max(bounds.width * canvasWidth, 24);
    const hitHeight = Math.max(bounds.height * canvasHeight, 24);
    return (
      <>
        {ann.__isPolylineGroup
          ? renderPolylineHitTargets(freehandPoints, canvasWidth, canvasHeight, stroke, onPress, `polyline-hit-${ann.id}`)
          : (
            <GuardedTapPressable
              onTap={onPress}
              style={{
                position: 'absolute',
                left: hitLeft - 12,
                top: hitTop - 12,
                width: hitWidth + 24,
                height: hitHeight + 24,
              }}
            />
          )}
        {ann.__isPolylineGroup
          ? renderPolylineStroke(freehandPoints, canvasWidth, canvasHeight, color, stroke, `polyline-${ann.id}`)
          : renderFreehandStroke(freehandPoints, canvasWidth, canvasHeight, color, stroke, `freehand-${ann.id}`)}
        {selected && (
          <View
            pointerEvents="none"
            style={[
              styles.selectedOutline,
              {
                position: 'absolute',
                left: hitLeft,
                top: hitTop,
                right: undefined,
                bottom: undefined,
                width: hitWidth,
                height: hitHeight,
              },
            ]}
          />
        )}
      </>
    );
  }

  if (shape === 'line' || shape === 'arrow' || shape === 'measure' || shape === 'measure_line' || shape === 'draw') {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.max(1, Math.sqrt((dx * dx) + (dy * dy)));
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const centerX = (x1 + x2) / 2;
    const centerY = (y1 + y2) / 2;
    const hitHeight = Math.max(24, stroke + 18);
    const arrowHead = arrowHeadMetrics(baseStroke);
    const arrowBackoff = shape === 'arrow' ? Math.max(arrowHead.length * 0.62, 4.5) : 0;
    const lineDrawWidth = Math.max(1, len - arrowBackoff);
    return (
      <GuardedTapPressable
        onTap={onPress}
        style={[
          styles.lineHit,
          {
            left: centerX - (len / 2),
            top: centerY - (hitHeight / 2),
            width: len,
            height: hitHeight,
            transform: [{ rotateZ: `${angle}deg` }],
          },
        ]}
      >
        <View
          style={[
            styles.lineShape,
            {
              left: 0,
              top: (hitHeight - stroke) / 2,
              width: lineDrawWidth,
              height: stroke,
              backgroundColor: color,
            },
          ]}
        />
        {shape === 'arrow' ? renderArrowHead(baseStroke, hitHeight / 2) : null}
        {selected && <View style={styles.selectedOutline} />}
      </GuardedTapPressable>
    );
  }

  const isEllipse = shape === 'ellipse' || shape === 'circle';
  const isCloudBox = shape === 'cloud';
  return (
    <>
      <View
        pointerEvents="none"
        style={[
          styles.shapeAnn,
          {
            left: `${b.left * 100}%`,
            top: `${b.top * 100}%`,
            width: `${b.width * 100}%`,
            height: `${b.height * 100}%`,
            borderColor: color,
            borderWidth: stroke,
            borderRadius: isEllipse ? 999 : isCloudBox ? 18 : 2,
            borderStyle: isCloudBox ? 'dashed' : 'solid',
            backgroundColor: 'transparent',
          },
          selected && styles.shapeAnnSelected,
        ]}
      />
      {renderBoxEdgeHitTargets(b, canvasWidth, canvasHeight, stroke, onPress, `shape-edge-hit-${ann.id || 'ann'}`)}
    </>
  );
}

function SiteWalkRedlinesNative({ portalUrl, session, site, onBack, onHome, onOpenPhotoPin, onOpen360Pin, initialViewportState = null, initialReturnSnapshot = null, onViewportStateChange, allowSiteSelection = false, onSelectedSiteChange }) {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= 768;
  const isLandscape = width > height;
  const token = session?.accessToken;
  const [redlineSites, setRedlineSites] = useState([]);
  const [redlineSitesLoading, setRedlineSitesLoading] = useState(false);
  const [redlineSiteQuery, setRedlineSiteQuery] = useState('');
  const [selectedRedlineSite, setSelectedRedlineSite] = useState(() => allowSiteSelection ? null : (site || null));
  const userSelectedRedlineSiteRef = useRef(false);
  const effectiveSite = allowSiteSelection ? (selectedRedlineSite || site || null) : site;
  const selectedSiteId = siteId(effectiveSite);
  const selectedSiteName = siteName(effectiveSite);
  const selectionStorageKey = useMemo(() => redlineSelectionStorageKey(portalUrl, selectedSiteId, selectedSiteName), [portalUrl, selectedSiteId, selectedSiteName]);
  const initialSnapshotPayload = useMemo(() => {
    const snapshot = initialReturnSnapshot || {};
    const snapshotSiteId = snapshot.siteId || snapshot.site_id || snapshot.payload?.site_id || '';
    if (snapshotSiteId && selectedSiteId && String(snapshotSiteId) !== String(selectedSiteId)) return null;
    return snapshot.payload && typeof snapshot.payload === 'object' ? snapshot.payload : null;
  }, [initialReturnSnapshot, selectedSiteId]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offlinePrecache, setOfflinePrecache] = useState({ active: false, done: 0, total: 0, label: '', error: '', complete: false });
  const offlinePrecacheCancelRef = useRef(false);
  const offlinePrecacheAbortRef = useRef(null);
  const offlinePrecacheRunIdRef = useRef(0);

  useEffect(() => () => {
    offlinePrecacheCancelRef.current = true;
    offlinePrecacheRunIdRef.current += 1;
    try { offlinePrecacheAbortRef.current?.abort?.(); } catch (_err) {}
    offlinePrecacheAbortRef.current = null;
  }, []);
  const [error, setError] = useState('');
  const [insta360Status, setInsta360Status] = useState(null);
  const [insta360Checking, setInsta360Checking] = useState(false);
  const [insta360Connecting, setInsta360Connecting] = useState(false);
  const [insta360ConnectMessage, setInsta360ConnectMessage] = useState('');
  const [insta360WifiSsid, setInsta360WifiSsid] = useState(DEFAULT_X4_WIFI_SSID);
  const [insta360WifiPassword, setInsta360WifiPassword] = useState(DEFAULT_X4_WIFI_PASSWORD);
  const [camera360Visible, setCamera360Visible] = useState(false);
  const [camera360CapturePin, setCamera360CapturePin] = useState(null);
  const [camera360CaptureBusy, setCamera360CaptureBusy] = useState(false);
  const [camera360CaptureStatus, setCamera360CaptureStatus] = useState('');
  const [payload, setPayload] = useState(() => initialSnapshotPayload || null);


  useEffect(() => {
    if (!camera360Visible) return;
    let cancelled = false;
    AsyncStorage.getItem(X4_WIFI_SETTINGS_STORAGE_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          const saved = JSON.parse(raw);
          if (typeof saved?.ssid === 'string' && saved.ssid.trim()) setInsta360WifiSsid(saved.ssid.trim());
          if (typeof saved?.password === 'string' && saved.password) setInsta360WifiPassword(saved.password);
        } catch (_err) {}
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [camera360Visible]);

  const formatInsta360StatusLines = useCallback((status) => {
    const lines = [
      `Platform: ${status?.platform || Platform.OS || 'unknown'}`,
      `X4 Wi-Fi reachable: ${status?.osc?.reachable ? 'Yes' : 'No'}`,
      status?.osc?.model ? `X4 model: ${status.osc.model}` : null,
      status?.osc?.firmwareVersion ? `Firmware: ${status.osc.firmwareVersion}` : null,
      status?.oscState?.ok ? 'OSC state: OK' : (status?.oscState?.error ? `OSC state: ${status.oscState.error}` : null),
      status?.osc?.error ? `OSC error: ${status.osc.error}` : null,
    ];

    if (Platform.OS === 'ios') {
      lines.splice(1, 0, `Bridge available: ${status?.available ? 'Yes' : 'No'}`);
    }

    return lines.filter(Boolean);
  }, []);

  const refreshInsta360CameraStatus = useCallback(async ({ showAlert = false } = {}) => {
    setInsta360Checking(true);

    try {
      const status = await getInsta360CameraStatus();
      setInsta360Status(status);

      if (showAlert) {
        Alert.alert('360 Camera Status', formatInsta360StatusLines(status).join('\n'));
      }

      return status;
    } finally {
      setInsta360Checking(false);
    }
  }, [formatInsta360StatusLines]);

  const handleCheckInsta360Camera = useCallback(async () => {
    await refreshInsta360CameraStatus({ showAlert: true });
  }, [refreshInsta360CameraStatus]);

  const handleConnectInsta360Camera = useCallback(async () => {
    if (insta360Connecting) return;

    const ssid = String(insta360WifiSsid || '').trim();
    const password = String(insta360WifiPassword || '');

    const targetLabel = ssid || 'the first visible X4 Wi-Fi network';

    setInsta360Connecting(true);
    setInsta360ConnectMessage(Platform.OS === 'android' ? `Opening Wi-Fi settings for ${targetLabel}...` : `Requesting iOS to join ${targetLabel}...`);

    try {
      await AsyncStorage.setItem(X4_WIFI_SETTINGS_STORAGE_KEY, JSON.stringify({ ssid, password, savedAt: Date.now() }));
      const result = await requestX4WifiConnection({ ssid, password });

      if (Platform.OS === 'android') {
        setInsta360ConnectMessage(result?.message || `Connect this device to ${targetLabel}, then return here and press Check Status.`);
        openWifiSettingsForX4();
        return;
      }

      setInsta360ConnectMessage(result?.message || 'X4 Wi-Fi join request completed. Checking camera status...');

      await new Promise((resolve) => setTimeout(resolve, 2200));
      const status = await refreshInsta360CameraStatus({ showAlert: false });

      if (status?.osc?.reachable) {
        setInsta360ConnectMessage(`Connected to ${targetLabel}. X4 OSC check passed.`);
      } else {
        setInsta360ConnectMessage(status?.osc?.error || `iOS completed the Wi-Fi request for ${targetLabel}, but the X4 OSC endpoint is not reachable yet. Make sure the camera Wi-Fi screen is open/advertising, or connect from iOS Wi-Fi Settings once and come back.`);
      }
    } catch (error) {
      setInsta360ConnectMessage(error?.message || 'Unable to connect to the X4 Wi-Fi network.');
    } finally {
      setInsta360Connecting(false);
    }
  }, [insta360Connecting, insta360WifiPassword, insta360WifiSsid, refreshInsta360CameraStatus]);
  const [category, setCategory] = useState('all');
  const [pinOpacity, setPinOpacity] = useState(1);
  const [tool, setTool] = useState(TOOL_SELECT);
  const [cloudVisible, setCloudVisible] = useState(false);
  const [cloudText, setCloudText] = useState('');
  const [pendingCloudText, setPendingCloudText] = useState('');
  const [editingCloudAnn, setEditingCloudAnn] = useState(null);
  const [draftStart, setDraftStart] = useState(null);
  const [draftShape, setDraftShape] = useState(null);
  const [selectedPin, setSelectedPin] = useState(null);
  const [selectedAnn, setSelectedAnn] = useState(null);
  const [polylineDraft, setPolylineDraft] = useState(null);
  const [pinEditor, setPinEditor] = useState(null);
  const [cameraPhotoPin, setCameraPhotoPin] = useState(null);
  const [photoOptionsPin, setPhotoOptionsPin] = useState(null);
  const [pinWhiteboardPin, setPinWhiteboardPin] = useState(null);
  const [pendingPhotoPicker, setPendingPhotoPicker] = useState(null);
  const [noteEditor, setNoteEditor] = useState(null);
  const noteEditorTextRef = useRef('');
  const [pendingNoteText, setPendingNoteText] = useState('');
  const pendingNoteTextRef = useRef('');
  const [whiteboardEnabled, setWhiteboardEnabled] = useState(false);
  const [whiteboardStrokes, setWhiteboardStrokes] = useState([]);
  const noteLongPressRef = useRef(false);
  const suppressCanvasToolPressRef = useRef(false);
  const suppressCanvasToolPressUntilRef = useRef(0);
  const noteTouchRef = useRef({ active: false, longPressed: false, moved: false, timer: null, pin: null, startPoint: null, startPagePoint: null, startPin: null, startAnn: null, currentPin: null, currentAnn: null });

  function suppressNextCanvasToolPress() {
    suppressCanvasToolPressRef.current = true;
    suppressCanvasToolPressUntilRef.current = Date.now() + 900;
  }
  const [menuVisible, setMenuVisible] = useState(false);
  const [rightsVisible, setRightsVisible] = useState(false);
  const [pagesVisible, setPagesVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [dotVisible, setDotVisible] = useState(false);
  const [tagsVisible, setTagsVisible] = useState(false);
  const [colorVisible, setColorVisible] = useState(false);
  const [widthVisible, setWidthVisible] = useState(false);
  const [iconPickerVisible, setIconPickerVisible] = useState(false);
  const [goPageVisible, setGoPageVisible] = useState(false);
  const [goPageText, setGoPageText] = useState('');
  const [fullScreen, setFullScreen] = useState(false);
  const [strokeColor, setStrokeColor] = useState('#ef4444');
  const [strokeWidth, setStrokeWidth] = useState(1);
  const [pendingIconNote, setPendingIconNote] = useState(ICON_NOTE_CHECK);
  const [dotOptions, setDotOptions] = useState(null);
  const [query, setQuery] = useState('');
  const [imageSize, setImageSize] = useState({ width: 1100, height: 760 });
  const [cachedImageByPage, setCachedImageByPage] = useState({});
  const [failedImageUrls, setFailedImageUrls] = useState({});
  const [zoomScale, setZoomScale] = useState(1);
  const canvasViewportRef = useRef(null);
  const zoomScaleRef = useRef(1);
  const restoredViewportKeyRef = useRef('');
  const initialViewportConsumedRef = useRef(false);
  const initialSnapshotAppliedRef = useRef(false);
  const initialLoadKeyRef = useRef('');
  const userSelectedPageIdRef = useRef('');
  const lastReportedViewportKeyRef = useRef('');
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [viewportLayoutVersion, setViewportLayoutVersion] = useState(0);
  const panOffsetRef = useRef({ x: 0, y: 0 });
  const viewportRef = useRef({ pageX: 0, pageY: 0, width: 1, height: 1 });
  const pinchRef = useRef({ startDistance: 0, startScale: 1, logicalX: 0, logicalY: 0, focalX: 0, focalY: 0 });
  const panRef = useRef({ startX: 0, startY: 0 });
  const drawRef = useRef({ active: false, start: null, end: null, points: [], tool: TOOL_SELECT });
  const polylineRef = useRef({ active: false, groupId: '', lastPoint: null, points: [] });
  const editRef = useRef({ active: false, mode: null, startPoint: null, startAnn: null, currentAnn: null, startBox: null });
  const pinDragRef = useRef({ active: false, startPoint: null, startPin: null, currentPin: null, startAnn: null, currentAnn: null });
  const gestureModeRef = useRef('idle');
  const precacheRunRef = useRef('');
  const loadRequestSeqRef = useRef(0);
  const markupPrefsLoadedRef = useRef(false);
  const annotationMutationRef = useRef(0);

  const sitewalks = Array.isArray(payload?.sitewalks) ? payload.sitewalks : [];
  const pages = Array.isArray(payload?.pages) ? payload.pages : [];
  const page = payload?.page || null;
  const pins = Array.isArray(payload?.pins) ? payload.pins : [];
  const rawAnnotations = Array.isArray(payload?.annotations) ? payload.annotations : [];
  const annotations = useMemo(() => buildAnnotationDisplayList(rawAnnotations), [rawAnnotations]);
  const liveSelectedAnn = selectedAnn?.id ? (annotations.find((ann) => String(ann.id) === String(selectedAnn.id)) || selectedAnn) : null;
  const menu = payload?.menu_permissions || {};
  const canEdit = Boolean(payload?.can_edit ?? true);
  const canRights = Boolean(menu.can_page_rights);
  const canRename = Boolean(menu.can_rename_order_pages);
  const currentSitewalk = clean(payload?.selected_sitewalk_desc);
  const currentSitewalkRef = useRef('');

  useEffect(() => {
    noteEditorTextRef.current = String(noteEditor?.text || '');
  }, [noteEditor?.text]);

  useEffect(() => {
    if (!pendingPhotoPicker || cameraPhotoPin || photoOptionsPin) return undefined;
    let cancelled = false;
    const request = pendingPhotoPicker;
    const timer = setTimeout(() => {
      if (cancelled) return;
      setPendingPhotoPicker(null);
      pickCameraPhotoForPin(request.pin, request.source, request.appendMode);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cameraPhotoPin, pendingPhotoPicker, photoOptionsPin]);

  useEffect(() => {
    currentSitewalkRef.current = currentSitewalk;
  }, [currentSitewalk]);

  useEffect(() => {
    if (!allowSiteSelection) {
      setSelectedRedlineSite(site || null);
    }
  }, [allowSiteSelection, site]);

  useEffect(() => {
    if (effectiveSite && typeof onSelectedSiteChange === 'function') {
      onSelectedSiteChange(effectiveSite);
    }
  }, [allowSiteSelection, effectiveSite, onSelectedSiteChange, portalUrl]);

  useEffect(() => {
    if (!allowSiteSelection) return undefined;
    let cancelled = false;
    async function loadRedlineSites() {
      setRedlineSitesLoading(true);
      try {
        const response = await loadMobileSiteWalkRedlineSites(portalUrl, token);
        if (cancelled) return;
        const items = Array.isArray(response?.sites)
          ? response.sites
          : Array.isArray(response?.items)
            ? response.items
            : Array.isArray(response)
              ? response
              : [];
        setRedlineSites(items);
        const storedSite = await readLastPdfEditorSite(portalUrl);
        if (cancelled) return;
        setSelectedRedlineSite((current) => {
          const storedMatched = findSiteByStoredSelection(items, storedSite);
          if (!userSelectedRedlineSiteRef.current && storedMatched) return storedMatched;

          const currentKey = String(siteId(current) || '');
          if (currentKey) {
            const matched = items.find((item) => String(siteId(item)) === currentKey);
            if (matched) return matched;
          }

          const routeSiteKey = String(siteId(site) || '');
          if (routeSiteKey) {
            const matched = items.find((item) => String(siteId(item)) === routeSiteKey);
            if (matched) return matched;
          }

          return storedMatched || items[0] || current || site || null;
        });
        } catch (err) {
        if (!cancelled) {
          setRedlineSites([]);
          setSelectedRedlineSite(null);
          setError(err?.message || 'Unable to load SiteWalk PDF sites.');
        }
      } finally {
        if (!cancelled) setRedlineSitesLoading(false);
      }
    }
    loadRedlineSites();
    return () => { cancelled = true; };
  }, [allowSiteSelection, portalUrl, token]);

  useEffect(() => {
    userSelectedPageIdRef.current = '';
    initialSnapshotAppliedRef.current = false;
    initialLoadKeyRef.current = '';
  }, [selectedSiteId, selectedSiteName]);

  useEffect(() => {
    if (!initialSnapshotPayload?.page) return;
    if (initialSnapshotAppliedRef.current) return;
    if (userSelectedPageIdRef.current) return;
    initialSnapshotAppliedRef.current = true;
    setPayload((current) => {
      const snapshotPageId = pageIdValue(initialSnapshotPayload.page);
      const currentPageIdValue = pageIdValue(current?.page);
      if (currentPageIdValue && snapshotPageId && String(currentPageIdValue) === String(snapshotPageId)) return current;
      if (userSelectedPageIdRef.current) return current;
      return initialSnapshotPayload;
    });
  }, [initialSnapshotPayload, selectedSiteId, selectedSiteName]);
  const selectedCategoryLabel = CATEGORY_FILTERS.find((item) => item.key === category)?.label || 'All';
  const filteredRedlineSites = useMemo(() => {
    const needle = clean(redlineSiteQuery).toLowerCase();
    const excludedStatuses = new Set(['completed', 'complete', 'on hold', 'on-hold', 'dead']);
    const items = Array.isArray(redlineSites) ? redlineSites : [];
    const visibleItems = items.filter((item) => {
      const status = clean(item?.active_inactive || item?.status || item?.status_group).toLowerCase();
      return !excludedStatuses.has(status);
    });
    if (!needle) return visibleItems;
    return visibleItems.filter((item) => `${siteName(item)} ${clean(item?.active_inactive || item?.status || item?.status_group)}`.toLowerCase().includes(needle));
  }, [redlineSites, redlineSiteQuery]);
  const groupedRedlineSiteItems = useMemo(() => {
    const result = [];
    let lastStatus = null;
    filteredRedlineSites.forEach((item) => {
      const status = clean(item?.active_inactive || item?.status || item?.status_group) || 'No Status';
      if (status !== lastStatus) {
        result.push({ type: 'header', label: status, value: `header-${status}` });
        lastStatus = status;
      }
      result.push({ ...item, label: siteName(item), value: siteId(item) });
    });
    return result;
  }, [filteredRedlineSites]);
  const currentPageId = pageIdValue(page);
  const currentPageIndex = pages.findIndex((p) => String(pageIdValue(p)) === String(currentPageId));
  const currentPageNumber = currentPageIndex >= 0 ? currentPageIndex + 1 : 0;
  const pageCount = pages.length;
  const pageFromList = pages.find((p) => String(pageIdValue(p)) === String(currentPageId));
  const imageCandidates = useMemo(() => uniqueCleanUrls([
    ...pageImageUrlCandidates(portalUrl, page),
    ...pageImageUrlCandidates(portalUrl, pageFromList),
  ]), [page, pageFromList, portalUrl]);
  const imageUrl = imageCandidates.find((item) => !isLocalFileUri(item)) || imageCandidates[0] || '';
  const imageCacheKey = imageUrl ? redlineImageCacheKey(portalUrl, selectedSiteId, selectedSiteName, currentSitewalk, currentPageId, imageUrl) : '';
  const imagePageIndexKey = currentPageId ? redlineImagePageIndexKey(portalUrl, selectedSiteId, selectedSiteName, currentSitewalk, currentPageId) : '';
  const cachedImageUri = imageCacheKey ? clean(cachedImageByPage[imageCacheKey]) : '';
  const cachedPageImageUri = imagePageIndexKey ? clean(cachedImageByPage[imagePageIndexKey]) : '';
  const cachedImageFromPage = clean(page?.cached_image_uri || page?.local_image_uri || page?.offline_image_uri || pageFromList?.cached_image_uri);
  const displayImageCandidates = useMemo(() => uniqueCleanUrls([
    cachedImageUri,
    cachedPageImageUri,
    cachedImageFromPage,
    ...imageCandidates,
  ]), [cachedImageFromPage, cachedImageUri, cachedPageImageUri, imageCandidates]);
  const displayedImageUrl = displayImageCandidates.find((item) => !failedImageUrls[clean(item)]) || '';
  const displayedImageIsLocal = Boolean(displayedImageUrl && isLocalFileUri(displayedImageUrl));
  const imageSource = displayedImageUrl ? { uri: displayedImageUrl, headers: displayedImageIsLocal ? undefined : (token ? { Authorization: `Bearer ${token}` } : undefined) } : null;

  const baseCanvasWidth = isTablet ? Math.max(900, Math.min(1280, width - 28)) : Math.max(820, width * 1.75);
  const baseCanvasHeight = Math.max(520, Math.round(baseCanvasWidth * (imageSize.height / Math.max(1, imageSize.width))));
  const canvasWidth = Math.round(baseCanvasWidth * zoomScale);
  const canvasHeight = Math.round(baseCanvasHeight * zoomScale);
  const shortestSide = Math.min(width, height);
  const longestSide = Math.max(width, height);
  const isTabletLayout = shortestSide >= 700 || (isTablet && longestSide >= 1000);
  const isLargeTabletLayout = shortestSide >= 900 || (isTabletLayout && longestSide >= 1180);
  const sideRailWidth = isTabletLayout || isLandscape ? 68 : 54;
  const isCompactPhoneLayout = !isTabletLayout && shortestSide < 520;
  const availableToolHeight = isCompactPhoneLayout
    ? Math.max(220, height - (isLandscape ? 24 : 92))
    : Math.max(320, height - (isTabletLayout ? 90 : 130));
  const toolRailMaxHeight = isLargeTabletLayout
    ? Math.min(availableToolHeight, 900)
    : isTabletLayout
      ? Math.min(availableToolHeight, 760)
      : Math.min(availableToolHeight, isLandscape ? 340 : 430);
  const compactFixedToolHeight = 190;
  const toolScrollMaxHeight = isLargeTabletLayout
    ? Math.max(360, toolRailMaxHeight - 120)
    : isTabletLayout
      ? Math.max(300, toolRailMaxHeight - 120)
      : Math.max(84, toolRailMaxHeight - compactFixedToolHeight);

  useEffect(() => {
    zoomScaleRef.current = zoomScale;
  }, [zoomScale]);

  useEffect(() => {
    setFailedImageUrls({});
  }, [currentPageId, currentSitewalk]);

  const clampPanOffset = useCallback((x, y, scaleOverride = zoomScaleRef.current) => {
    const viewport = viewportRef.current;
    const scaledWidth = Math.round(baseCanvasWidth * clampZoom(scaleOverride));
    const scaledHeight = Math.round(baseCanvasHeight * clampZoom(scaleOverride));
    const minX = Math.min(0, viewport.width - scaledWidth - (CANVAS_SCROLL_PADDING * 2));
    const minY = Math.min(0, viewport.height - scaledHeight - (CANVAS_SCROLL_PADDING * 2));
    return {
      x: Math.max(minX, Math.min(CANVAS_SCROLL_PADDING, Number(x) || 0)),
      y: Math.max(minY, Math.min(CANVAS_SCROLL_PADDING, Number(y) || 0)),
    };
  }, [baseCanvasHeight, baseCanvasWidth]);

  const setClampedPanOffset = useCallback((x, y, scaleOverride = zoomScaleRef.current) => {
    const next = clampPanOffset(x, y, scaleOverride);
    panOffsetRef.current = next;
    setPanOffset((current) => {
      const sameX = Math.abs(Number(current?.x || 0) - Number(next.x || 0)) < 0.5;
      const sameY = Math.abs(Number(current?.y || 0) - Number(next.y || 0)) < 0.5;
      return sameX && sameY ? current : next;
    });
    return next;
  }, [clampPanOffset]);


  const reportViewportState = useCallback((override = {}) => {
    if (!page?.id) return null;
    const nextScale = clampZoom(override.zoomScale ?? zoomScaleRef.current ?? zoomScale);
    const nextPan = override.panOffset || panOffsetRef.current || panOffset;
    const nextState = {
      siteId: selectedSiteId,
      siteName: selectedSiteName,
      sitewalk: currentSitewalk,
      pageId: page.id || page.page_id,
      zoomScale: nextScale,
      panOffset: { x: Number(nextPan.x || 0), y: Number(nextPan.y || 0) },
    };
    const key = [
      nextState.siteId || '',
      nextState.sitewalk || '',
      nextState.pageId || '',
      Number(nextState.zoomScale || 1).toFixed(3),
      Math.round(nextState.panOffset.x),
      Math.round(nextState.panOffset.y),
    ].join('|');
    if (lastReportedViewportKeyRef.current !== key) {
      lastReportedViewportKeyRef.current = key;
      if (typeof onViewportStateChange === 'function') {
        onViewportStateChange(nextState);
      }
    }
    return nextState;
  }, [currentSitewalk, onViewportStateChange, page?.id, page?.page_id, panOffset, selectedSiteId, selectedSiteName, zoomScale]);

  const buildReturnSnapshot = useCallback((viewportState = null) => {
    if (!payload?.page) return null;
    const activePageId = pageIdValue(payload.page);
    const localImage = displayedImageIsLocal ? displayedImageUrl : clean(payload.page?.cached_image_uri || pageFromList?.cached_image_uri);
    const snapPage = localImage ? { ...payload.page, cached_image_uri: localImage, local_image_uri: localImage } : payload.page;
    const snapPages = (Array.isArray(payload.pages) ? payload.pages : []).map((item) => {
      if (String(pageIdValue(item)) !== String(activePageId)) return item;
      return localImage ? { ...item, cached_image_uri: localImage, local_image_uri: localImage } : item;
    });
    return {
      siteId: selectedSiteId,
      siteName: selectedSiteName,
      sitewalk: currentSitewalk,
      pageId: activePageId,
      viewportState,
      payload: {
        ...payload,
        site_id: selectedSiteId || payload.site_id,
        selected_sitewalk_desc: currentSitewalk || payload.selected_sitewalk_desc,
        pages: snapPages.length ? snapPages : [snapPage],
        page: snapPage,
        pins: Array.isArray(payload.pins) ? payload.pins : [],
        annotations: Array.isArray(payload.annotations) ? payload.annotations : [],
      },
      savedAt: Date.now(),
    };
  }, [currentSitewalk, displayedImageIsLocal, displayedImageUrl, pageFromList, payload, selectedSiteId, selectedSiteName]);

  // Do not continuously push pan/zoom changes up to App state. Doing that while
  // this screen is mounted can cause the parent to rerender during active
  // gestures, which makes panning feel locked or jumpy. We snapshot the
  // viewport only when leaving for a linked photo/360 screen.
  useEffect(() => {
    if (initialViewportConsumedRef.current || !initialViewportState || !page?.id) return;
    const viewport = viewportRef.current || {};
    if (viewport.width <= 1 || viewport.height <= 1) return;
    const initialPageId = initialViewportState.pageId;
    const currentPageIdValue = page.id || page.page_id;
    if (initialPageId && String(initialPageId) !== String(currentPageIdValue)) return;
    if (initialViewportState.siteId && selectedSiteId && String(initialViewportState.siteId) !== String(selectedSiteId)) return;
    const restoreKey = [initialViewportState.siteId || selectedSiteId || '', initialViewportState.sitewalk || currentSitewalk || '', currentPageIdValue || '', initialViewportState.zoomScale || 1, initialViewportState.panOffset?.x || 0, initialViewportState.panOffset?.y || 0].join('|');
    if (restoredViewportKeyRef.current === restoreKey) return;
    restoredViewportKeyRef.current = restoreKey;
    initialViewportConsumedRef.current = true;
    const nextScale = clampZoom(initialViewportState.zoomScale || 1);
    zoomScaleRef.current = nextScale;
    setZoomScale((current) => (Math.abs(Number(current || 1) - nextScale) < 0.001 ? current : nextScale));
    const nextPan = initialViewportState.panOffset || { x: 0, y: 0 };
    setClampedPanOffset(Number(nextPan.x || 0), Number(nextPan.y || 0), nextScale);
  }, [currentSitewalk, initialViewportState, page?.id, page?.page_id, selectedSiteId, setClampedPanOffset, viewportLayoutVersion]);


  const canPanCanvas = useCallback((scaleOverride = zoomScaleRef.current) => {
    const viewport = viewportRef.current;
    const scaledWidth = Math.round(baseCanvasWidth * clampZoom(scaleOverride));
    const scaledHeight = Math.round(baseCanvasHeight * clampZoom(scaleOverride));
    return (scaledWidth + (CANVAS_SCROLL_PADDING * 2) > viewport.width + 1) || (scaledHeight + (CANVAS_SCROLL_PADDING * 2) > viewport.height + 1);
  }, [baseCanvasHeight, baseCanvasWidth]);

  const rememberViewport = useCallback((event) => {
    const layout = event?.nativeEvent?.layout || {};
    viewportRef.current = {
      ...viewportRef.current,
      width: Math.max(1, Number(layout.width) || 1),
      height: Math.max(1, Number(layout.height) || 1),
    };
    canvasViewportRef.current?.measureInWindow?.((pageX, pageY, measuredWidth, measuredHeight) => {
      viewportRef.current = {
        pageX: Number(pageX) || 0,
        pageY: Number(pageY) || 0,
        width: Math.max(1, Number(measuredWidth) || viewportRef.current.width || 1),
        height: Math.max(1, Number(measuredHeight) || viewportRef.current.height || 1),
      };
      const current = panOffsetRef.current;
      setClampedPanOffset(current.x, current.y, zoomScaleRef.current);
      setViewportLayoutVersion((value) => value + 1);
    });
  }, [setClampedPanOffset]);

  const resetZoomAndPan = useCallback(() => {
    zoomScaleRef.current = 1;
    setZoomScale(1);
    setClampedPanOffset(CANVAS_SCROLL_PADDING, CANVAS_SCROLL_PADDING, 1);
  }, [setClampedPanOffset]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const current = panOffsetRef.current;
      setClampedPanOffset(current.x, current.y, zoomScaleRef.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [fullScreen, setClampedPanOffset]);

  const keepPinchFocusLocked = useCallback((nextScale, pinch) => {
    const nextX = pinch.focalX - (pinch.logicalX * nextScale);
    const nextY = pinch.focalY - (pinch.logicalY * nextScale);
    setClampedPanOffset(nextX, nextY, nextScale);
  }, [setClampedPanOffset]);

  const beginPinchAtTouches = useCallback((touches) => {
    const viewport = viewportRef.current;
    const currentPan = panOffsetRef.current;
    const startScale = zoomScaleRef.current;
    const { focalX, focalY } = focalPointFromTouches(touches, viewport);
    pinchRef.current = {
      startDistance: distanceBetweenTouches(touches),
      startScale,
      logicalX: Math.max(0, (focalX - currentPan.x) / startScale),
      logicalY: Math.max(0, (focalY - currentPan.y) / startScale),
      focalX,
      focalY,
    };
    gestureModeRef.current = 'pinch';
  }, []);

  const zoomPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (evt) => (evt.nativeEvent.touches || []).length >= 2,
    onStartShouldSetPanResponderCapture: (evt) => (evt.nativeEvent.touches || []).length >= 2,
    onMoveShouldSetPanResponder: (evt, gestureState) => {
      const touches = evt.nativeEvent.touches || [];
      if (touches.length >= 2) return true;
      // Only let the page pan responder take a one-finger drag when no child
      // edit gesture is active. Selected icons/clouds/annotations install their
      // own PanResponder; without this guard the outer canvas steals the drag
      // and the viewport moves instead of the annotation.
      if (touches.length === 1 && !isDrawShapeTool(tool) && tool === TOOL_SELECT && gestureModeRef.current === 'idle' && canPanCanvas(zoomScaleRef.current)) {
        if (isTouchOnSelectedNotePin(evt) || isTouchOnAnyNotePin(evt) || isTouchOnSelectedAnnotationEditArea(evt)) return false;
        return Math.abs(gestureState.dx) > 2 || Math.abs(gestureState.dy) > 2;
      }
      return false;
    },
    onMoveShouldSetPanResponderCapture: (evt, gestureState) => {
      const touches = evt.nativeEvent.touches || [];
      if (touches.length >= 2) return true;
      // Do not capture one-finger moves from selected annotation controls. This
      // keeps icon relocation from being interpreted as page panning.
      if (touches.length === 1 && !isDrawShapeTool(tool) && tool === TOOL_SELECT && gestureModeRef.current === 'idle' && canPanCanvas(zoomScaleRef.current)) {
        if (isTouchOnSelectedNotePin(evt) || isTouchOnAnyNotePin(evt) || isTouchOnSelectedAnnotationEditArea(evt)) return false;
        return Math.abs(gestureState.dx) > 2 || Math.abs(gestureState.dy) > 2;
      }
      return false;
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (evt) => {
      canvasViewportRef.current?.measureInWindow?.((pageX, pageY, measuredWidth, measuredHeight) => {
        viewportRef.current = {
          pageX: Number(pageX) || 0,
          pageY: Number(pageY) || 0,
          width: Math.max(1, Number(measuredWidth) || viewportRef.current.width || 1),
          height: Math.max(1, Number(measuredHeight) || viewportRef.current.height || 1),
        };
      });
      const touches = evt.nativeEvent.touches || [];
      const currentPan = panOffsetRef.current;
      panRef.current = { startX: currentPan.x, startY: currentPan.y };
      gestureModeRef.current = touches.length >= 2 ? 'pinch' : 'pan';
      if (touches.length >= 2) beginPinchAtTouches(touches);
    },
    onPanResponderMove: (evt, gestureState) => {
      const touches = evt.nativeEvent.touches || [];
      if (touches.length >= 2) {
        if (!pinchRef.current.startDistance) beginPinchAtTouches(touches);
        const distance = distanceBetweenTouches(touches);
        const startDistance = pinchRef.current.startDistance;
        if (!startDistance || !distance) return;
        const nextScale = clampZoom(pinchRef.current.startScale * (distance / startDistance));
        const { focalX, focalY } = focalPointFromTouches(touches, viewportRef.current);
        const pinch = { ...pinchRef.current, focalX, focalY };
        pinchRef.current = pinch;
        zoomScaleRef.current = nextScale;
        setZoomScale(nextScale);
        keepPinchFocusLocked(nextScale, pinch);
        return;
      }
      if (touches.length === 1 && tool === TOOL_SELECT && gestureModeRef.current === 'pan' && canPanCanvas(zoomScaleRef.current)) {
        setClampedPanOffset(panRef.current.startX + gestureState.dx, panRef.current.startY + gestureState.dy, zoomScaleRef.current);
      }
    },
    onPanResponderRelease: () => {
      const nextScale = clampZoom(zoomScaleRef.current);
      zoomScaleRef.current = nextScale;
      setZoomScale(nextScale);
      setClampedPanOffset(panOffsetRef.current.x, panOffsetRef.current.y, nextScale);
      pinchRef.current = { startDistance: 0, startScale: 1, logicalX: 0, logicalY: 0, focalX: 0, focalY: 0 };
      gestureModeRef.current = 'idle';
    },
    onPanResponderTerminate: () => {
      const nextScale = clampZoom(zoomScaleRef.current);
      zoomScaleRef.current = nextScale;
      setZoomScale(nextScale);
      setClampedPanOffset(panOffsetRef.current.x, panOffsetRef.current.y, nextScale);
      pinchRef.current = { startDistance: 0, startScale: 1, logicalX: 0, logicalY: 0, focalX: 0, focalY: 0 };
      gestureModeRef.current = 'idle';
    },
  }), [beginPinchAtTouches, canPanCanvas, canvasHeight, canvasWidth, keepPinchFocusLocked, liveSelectedAnn, selectedPin, setClampedPanOffset, tool]);

  const visiblePins = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pins.filter((pin) => categoryMatches(pin, category)).filter((pin) => {
      if (!q) return true;
      return `${pin.label || ''} ${pin.tag || ''} ${pin.sr_location || ''} ${pin.sr_task || ''}`.toLowerCase().includes(q);
    });
  }, [pins, category, query]);

  const hasInitialViewportForCurrentSite = useCallback(() => {
    if (!initialViewportState) return false;
    if (initialViewportState.siteId && selectedSiteId && String(initialViewportState.siteId) !== String(selectedSiteId)) return false;
    return Boolean(initialViewportState.pageId || initialViewportState.zoomScale || initialViewportState.panOffset);
  }, [initialViewportState, selectedSiteId]);

  const load = useCallback(async ({ sitewalkDesc = null, pageId = null, silent = false, useRemembered = true, preserveViewport = false } = {}) => {
    if (!token) {
      setLoading(false);
      setRefreshing(false);
      setError('Session is not ready yet. Go back and reopen the PDF Editor.');
      return;
    }
    const requestSeq = loadRequestSeqRef.current + 1;
    loadRequestSeqRef.current = requestSeq;
    const isLatestLoadRequest = () => requestSeq === loadRequestSeqRef.current;
    if (!silent) setLoading(true);
    setError('');
    try {
      let requestedSitewalkDesc = clean(sitewalkDesc);
      let requestedPageId = pageId;

      if (useRemembered && !requestedSitewalkDesc && !requestedPageId) {
        try {
          const raw = await AsyncStorage.getItem(selectionStorageKey);
          const remembered = raw ? JSON.parse(raw) : null;
          requestedSitewalkDesc = clean(remembered?.sitewalkDesc);
          requestedPageId = remembered?.pageId || null;
        } catch (_err) {
          requestedSitewalkDesc = '';
          requestedPageId = null;
        }
      }

      const effectiveStartupSitewalkDesc = requestedSitewalkDesc || currentSitewalkRef.current;
      const startupCached = !silent
        ? await findCachedRedlineDocument(portalUrl, selectedSiteId, selectedSiteName, effectiveStartupSitewalkDesc)
        : null;
      if (startupCached && isLatestLoadRequest()) {
        setPayload(startupCached);
        setLoading(false);
        setError('Loading latest copy; showing the saved redline copy on this device for now.');
      }

      let data = await loadMobileSiteWalkRedlines(portalUrl, token, {
        siteId: selectedSiteId,
        siteName: selectedSiteName,
        sitewalkDesc: effectiveStartupSitewalkDesc,
      });

      const loadedPages = Array.isArray(data?.pages) ? data.pages : [];
      const pageStillExists = requestedPageId && loadedPages.some((p) => String(p.id || p.page_id) === String(requestedPageId));
      if (pageStillExists) {
        const pageData = await loadMobileSiteWalkRedlinesPageData(portalUrl, token, requestedPageId);
        data = { ...data, ...pageData, page: pageData.page || data.page };
      }

      if (!data?.page && initialSnapshotPayload?.page) {
        const snapshotPageId = pageIdValue(initialSnapshotPayload.page);
        if (!requestedPageId || !snapshotPageId || String(snapshotPageId) === String(requestedPageId)) {
          data = initialSnapshotPayload;
        }
      }

      if (!isLatestLoadRequest()) return;
      const liveDataPageId = pageIdValue(data?.page);
      const userSelectedPageId = userSelectedPageIdRef.current;
      if (userSelectedPageId && liveDataPageId && String(userSelectedPageId) !== String(liveDataPageId)) {
        return;
      }
      setPayload(data);
      // If we showed a saved copy while the live request was loading, clear that
      // temporary warning as soon as the latest server copy finishes loading.
      // Otherwise the screen keeps saying it is showing a saved device copy even
      // when the app is online and the live payload loaded successfully.
      setError('');
      await writeJsonToStorage(redlineDocumentCacheKey(portalUrl, selectedSiteId, selectedSiteName, data?.selected_sitewalk_desc || requestedSitewalkDesc || currentSitewalkRef.current), data);
      if (data?.page) {
        const dataPageId = pageIdValue(data.page);
        const onlinePageCachePayload = { page: data.page, pins: data.pins || [], annotations: data.annotations || [] };
        await writeJsonToStorage(redlinePageDataCacheKey(portalUrl, selectedSiteId, selectedSiteName, data?.selected_sitewalk_desc || requestedSitewalkDesc || currentSitewalkRef.current, dataPageId), onlinePageCachePayload);
        await writeJsonToStorage(redlinePageDataAnySitewalkCacheKey(portalUrl, selectedSiteId, selectedSiteName, dataPageId), onlinePageCachePayload);
      }
      if (!preserveViewport) resetZoomAndPan();
      setSelectedPin(null);
      setSelectedAnn(null);
      setDraftStart(null);
      setDraftShape(null);
      drawRef.current = { active: false, start: null, end: null, points: [], tool: TOOL_SELECT };
    } catch (err) {
      if (!isLatestLoadRequest()) return;
      const effectiveSitewalkDesc = requestedSitewalkDesc || currentSitewalkRef.current;
      const cached = await findCachedRedlineDocument(portalUrl, selectedSiteId, selectedSiteName, effectiveSitewalkDesc);
      let cachedPageData = null;
      let nextCached = cached || null;

      if (requestedPageId) {
        const pageCacheSitewalk = clean(cached?.selected_sitewalk_desc) || effectiveSitewalkDesc;
        cachedPageData = await findCachedRedlinePageData(portalUrl, selectedSiteId, selectedSiteName, pageCacheSitewalk, requestedPageId);
        if (cachedPageData) {
          const cachedPages = Array.isArray(cached?.pages) ? cached.pages : [];
          const pageFromCachedList = cachedPages.find((p) => String(pageIdValue(p)) === String(requestedPageId)) || {};
          let cachedPage = { ...pageFromCachedList, ...(cachedPageData.page || {}) };
          const cachedLocalImage = clean(cachedPage.cached_image_uri) || clean(await AsyncStorage.getItem(redlineImagePageIndexKey(portalUrl, selectedSiteId, selectedSiteName, pageCacheSitewalk, requestedPageId))) || clean(await AsyncStorage.getItem(redlineImageAnySitewalkPageIndexKey(portalUrl, selectedSiteId, selectedSiteName, requestedPageId)));
          if (cachedLocalImage) cachedPage = { ...cachedPage, cached_image_uri: cachedLocalImage };
          nextCached = {
            ...(cached || {}),
            ...cachedPageData,
            selected_sitewalk_desc: pageCacheSitewalk || cachedPageData.selected_sitewalk_desc || cached?.selected_sitewalk_desc,
            sitewalks: Array.isArray(cached?.sitewalks) ? cached.sitewalks : (Array.isArray(cachedPageData.sitewalks) ? cachedPageData.sitewalks : []),
            pages: cachedPages.length
              ? cachedPages
              : (Array.isArray(cachedPageData.pages) && cachedPageData.pages.length ? cachedPageData.pages : (cachedPage?.id || cachedPage?.page_id ? [cachedPage] : [])),
            page: cachedPage,
            pins: Array.isArray(cachedPageData.pins) ? cachedPageData.pins : (Array.isArray(cached?.pins) ? cached.pins : []),
            annotations: Array.isArray(cachedPageData.annotations) ? cachedPageData.annotations : (Array.isArray(cached?.annotations) ? cached.annotations : []),
          };
        }
      }

      // If we came back from the photo viewer while fully offline, the restored
      // viewport can occasionally arrive before the current page has been
      // rehydrated.  In that case the document cache may contain the page list
      // but no `page` object, which rendered as "No redline pages found" even
      // though the PDF/page was saved locally.  Rebuild a usable page payload
      // from the cached page list and page-data cache before giving up.
      if (nextCached && !nextCached.page) {
        const cachedPages = Array.isArray(nextCached.pages) ? nextCached.pages : [];
        const fallbackPage = (requestedPageId
          ? cachedPages.find((p) => String(pageIdValue(p)) === String(requestedPageId))
          : null) || cachedPages[0] || null;
        const fallbackPageId = pageIdValue(fallbackPage);
        if (fallbackPageId) {
          const pageCacheSitewalk = clean(nextCached.selected_sitewalk_desc) || effectiveSitewalkDesc || clean(cached?.selected_sitewalk_desc);
          const fallbackPageData = await findCachedRedlinePageData(portalUrl, selectedSiteId, selectedSiteName, pageCacheSitewalk, fallbackPageId);
          let cachedPage = { ...(fallbackPage || {}), ...((fallbackPageData && fallbackPageData.page) || {}) };
          const cachedLocalImage = clean(cachedPage.cached_image_uri)
            || clean(await AsyncStorage.getItem(redlineImagePageIndexKey(portalUrl, selectedSiteId, selectedSiteName, pageCacheSitewalk, fallbackPageId)))
            || clean(await AsyncStorage.getItem(redlineImageAnySitewalkPageIndexKey(portalUrl, selectedSiteId, selectedSiteName, fallbackPageId)));
          if (cachedLocalImage) cachedPage = { ...cachedPage, cached_image_uri: cachedLocalImage };
          nextCached = {
            ...nextCached,
            ...(fallbackPageData || {}),
            selected_sitewalk_desc: pageCacheSitewalk || nextCached.selected_sitewalk_desc || fallbackPageData?.selected_sitewalk_desc,
            pages: cachedPages.length ? cachedPages : [cachedPage],
            page: cachedPage,
            pins: Array.isArray(fallbackPageData?.pins) ? fallbackPageData.pins : (Array.isArray(nextCached.pins) ? nextCached.pins : []),
            annotations: Array.isArray(fallbackPageData?.annotations) ? fallbackPageData.annotations : (Array.isArray(nextCached.annotations) ? nextCached.annotations : []),
          };
        }
      }

      if (!nextCached && initialSnapshotPayload?.page) {
        const snapshotPageId = pageIdValue(initialSnapshotPayload.page);
        if (!requestedPageId || !snapshotPageId || String(snapshotPageId) === String(requestedPageId)) {
          nextCached = initialSnapshotPayload;
        }
      }

      if (!isLatestLoadRequest()) return;
      if (nextCached) {
        setPayload(nextCached);
        if (nextCached.page) cachePageImage(nextCached.page, nextCached.selected_sitewalk_desc || effectiveSitewalkDesc).catch(() => {});
        setError('Offline mode: showing the saved copy on this device.');
        if (!preserveViewport) resetZoomAndPan();
      } else {
        const message = err?.message || 'Unable to load Site Walk Redlines.';
        setError(message);
        Alert.alert('Site Walk Redlines', message);
      }
    } finally {
      if (isLatestLoadRequest()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [initialSnapshotPayload, portalUrl, resetZoomAndPan, selectedSiteId, selectedSiteName, selectionStorageKey, token]);

  useEffect(() => {
    const startupKey = [
      selectedSiteId || selectedSiteName || '',
      initialViewportState?.sitewalk || '',
      initialViewportState?.pageId || '',
      initialSnapshotPayload?.savedAt || initialReturnSnapshot?.savedAt || '',
    ].join('|');
    if (allowSiteSelection && !selectedSiteId && !selectedSiteName) {
      return;
    }
    if (initialLoadKeyRef.current === startupKey) return;
    initialLoadKeyRef.current = startupKey;

    if (hasInitialViewportForCurrentSite()) {
      load({
        sitewalkDesc: initialViewportState?.sitewalk || null,
        pageId: initialViewportState?.pageId || null,
        useRemembered: false,
        preserveViewport: true,
      });
      return;
    }
    load();
  }, [allowSiteSelection, hasInitialViewportForCurrentSite, initialReturnSnapshot?.savedAt, initialSnapshotPayload?.savedAt, initialViewportState?.pageId, initialViewportState?.sitewalk, load, selectedSiteId, selectedSiteName]);

  useEffect(() => {
    let cancelled = false;
    async function loadMarkupPrefs() {
      const prefs = await readJsonFromStorage(redlineMarkupPrefsKey(portalUrl, selectedSiteId, selectedSiteName));
      if (!cancelled && prefs) {
        const savedColor = clean(prefs.strokeColor || prefs.stroke_color);
        const savedWidth = Number(prefs.strokeWidth ?? prefs.stroke_width);
        if (savedColor) setStrokeColor(savedColor);
        if (Number.isFinite(savedWidth) && savedWidth > 0) setStrokeWidth(savedWidth);
      }
      markupPrefsLoadedRef.current = true;
    }
    markupPrefsLoadedRef.current = false;
    loadMarkupPrefs();
    return () => { cancelled = true; };
  }, [portalUrl, selectedSiteId, selectedSiteName]);

  useEffect(() => {
    if (!markupPrefsLoadedRef.current) return;
    writeJsonToStorage(redlineMarkupPrefsKey(portalUrl, selectedSiteId, selectedSiteName), {
      strokeColor,
      strokeWidth,
      updatedAt: new Date().toISOString(),
    });
  }, [portalUrl, selectedSiteId, selectedSiteName, strokeColor, strokeWidth]);

  useEffect(() => {
    const pageId = page?.id || page?.page_id;
    if (!selectionStorageKey || !currentSitewalk || !pageId) return;
    AsyncStorage.setItem(selectionStorageKey, JSON.stringify({
      sitewalkDesc: currentSitewalk,
      pageId,
      pageName: page?.display_name || '',
      updatedAt: new Date().toISOString(),
    })).catch(() => {});
  }, [currentSitewalk, page?.display_name, page?.id, page?.page_id, selectionStorageKey]);

  useEffect(() => {
    if (!displayedImageUrl) return;
    const onSuccess = (w, h) => { if (w && h) setImageSize({ width: w, height: h }); };
    const onFailure = () => setImageSize({ width: 1100, height: 760 });
    const headers = token && !displayedImageIsLocal ? { Authorization: `Bearer ${token}` } : undefined;
    if (headers && typeof Image.getSizeWithHeaders === 'function') {
      Image.getSizeWithHeaders(displayedImageUrl, headers, onSuccess, onFailure);
      return;
    }
    Image.getSize(displayedImageUrl, onSuccess, onFailure);
  }, [displayedImageIsLocal, displayedImageUrl, token]);

  const cachePageImage = useCallback(async (pageItem, sitewalkDesc = currentSitewalk) => {
    const pageId = pageIdValue(pageItem);
    const pageIndexKey = pageId ? redlineImagePageIndexKey(portalUrl, selectedSiteId, selectedSiteName, sitewalkDesc, pageId) : '';
    const localCachedUri = clean(pageItem?.cached_image_uri || pageItem?.local_image_uri || pageItem?.offline_image_uri);
    if (pageId && localCachedUri && isLocalFileUri(localCachedUri)) {
      try {
        const info = await FileSystem.getInfoAsync(localCachedUri);
        if (info.exists) {
          await AsyncStorage.setItem(pageIndexKey, localCachedUri);
          setCachedImageByPage((prev) => (prev[pageIndexKey] === localCachedUri ? prev : { ...prev, [pageIndexKey]: localCachedUri }));
          return localCachedUri;
        }
      } catch (_err) {}
    }

    if (!pageId) return '';
    const existingIndexed = clean(cachedImageByPage[pageIndexKey]) || clean(await AsyncStorage.getItem(pageIndexKey));
    if (existingIndexed) {
      try {
        const info = await FileSystem.getInfoAsync(existingIndexed);
        if (info.exists && Number(info.size || 0) > 0) {
          setCachedImageByPage((prev) => (prev[pageIndexKey] === existingIndexed ? prev : { ...prev, [pageIndexKey]: existingIndexed }));
          return existingIndexed;
        }
      } catch (_err) {}
    }

    const remoteCandidates = pageImageUrlCandidates(portalUrl, pageItem).filter((item) => item && !isLocalFileUri(item) && !looksLikePdfUrl(item));
    if (!remoteCandidates.length || !token) return '';
    const dir = await ensureRedlineImageCacheDir();
    if (!dir) return '';

    for (const remoteUrl of remoteCandidates) {
      const key = redlineImageCacheKey(portalUrl, selectedSiteId, selectedSiteName, sitewalkDesc, pageId, remoteUrl);
      const finalUri = `${dir}${redlineImageFileName(portalUrl, selectedSiteId, selectedSiteName, sitewalkDesc, pageId, remoteUrl)}`;
      const existing = clean(cachedImageByPage[key]) || clean(await AsyncStorage.getItem(key));
      if (existing) {
        try {
          const info = await FileSystem.getInfoAsync(existing);
          if (info.exists && Number(info.size || 0) > 0) {
            await AsyncStorage.multiSet([[key, existing], [pageIndexKey, existing]]);
            setCachedImageByPage((prev) => (prev[key] === existing && prev[pageIndexKey] === existing ? prev : { ...prev, [key]: existing, [pageIndexKey]: existing }));
            return existing;
          }
        } catch (_err) {}
      }

      try {
        const finalInfo = await FileSystem.getInfoAsync(finalUri);
        if (finalInfo.exists && Number(finalInfo.size || 0) > 0) {
          await AsyncStorage.multiSet([[key, finalUri], [pageIndexKey, finalUri]]);
          setCachedImageByPage((prev) => (prev[key] === finalUri && prev[pageIndexKey] === finalUri ? prev : { ...prev, [key]: finalUri, [pageIndexKey]: finalUri }));
          return finalUri;
        }
      } catch (_err) {}

      const downloadedUri = await downloadRedlineImageToFile(remoteUrl, finalUri, token);
      if (downloadedUri) {
        const anySitewalkPageIndexKey = redlineImageAnySitewalkPageIndexKey(portalUrl, selectedSiteId, selectedSiteName, pageId);
        await AsyncStorage.multiSet([[key, downloadedUri], [pageIndexKey, downloadedUri], [anySitewalkPageIndexKey, downloadedUri]]);
        setCachedImageByPage((prev) => ({ ...prev, [key]: downloadedUri, [pageIndexKey]: downloadedUri, [anySitewalkPageIndexKey]: downloadedUri }));
        return downloadedUri;
      }
    }

    return '';
  }, [cachedImageByPage, currentSitewalk, portalUrl, selectedSiteId, selectedSiteName, token]);

  useEffect(() => {
    let cancelled = false;
    async function loadCachedImageForPage() {
      const keys = [imageCacheKey, imagePageIndexKey].filter(Boolean);
      const localCandidates = [cachedImageFromPage].filter(Boolean);
      if (!keys.length && !localCandidates.length) return;
      const pairs = keys.length ? await AsyncStorage.multiGet(keys) : [];
      for (const [key, rawUri] of pairs) {
        const stored = clean(rawUri);
        if (!stored || cancelled) continue;
        try {
          const info = await FileSystem.getInfoAsync(stored);
          if (info.exists && !cancelled) setCachedImageByPage((prev) => (prev[key] === stored ? prev : { ...prev, [key]: stored }));
        } catch (_err) {}
      }
      for (const stored of localCandidates) {
        if (!stored || cancelled || !imagePageIndexKey) continue;
        try {
          const info = await FileSystem.getInfoAsync(stored);
          if (info.exists && !cancelled) setCachedImageByPage((prev) => (prev[imagePageIndexKey] === stored ? prev : { ...prev, [imagePageIndexKey]: stored }));
        } catch (_err) {}
      }
    }
    loadCachedImageForPage();
    return () => { cancelled = true; };
  }, [cachedImageFromPage, imageCacheKey, imagePageIndexKey]);

  useEffect(() => {
    if (!page) return;
    cachePageImage(page).catch(() => {});
  }, [cachePageImage, page]);

  useEffect(() => {
    if (!token || !currentSitewalk || !pages.length) return;
    const runKey = [normalizePortalUrl(portalUrl).toLowerCase(), selectedSiteId || selectedSiteName, currentSitewalk, pages.map((item) => pageIdValue(item)).join(',')].join('|');
    if (precacheRunRef.current === runKey) return;
    precacheRunRef.current = runKey;

    async function precacheAllPages() {
      await writeJsonToStorage(redlineDocumentCacheKey(portalUrl, selectedSiteId, selectedSiteName, currentSitewalk), payload);
      for (const item of pages) {
        if (precacheRunRef.current !== runKey) return;
        const itemPageId = pageIdValue(item);
        if (!itemPageId) continue;
        try {
          const cachedFromList = await cachePageImage(item, currentSitewalk);
          const pageData = String(itemPageId) === String(currentPageId)
            ? { page: { ...(item || {}), ...(page || {}) }, pins, annotations: rawAnnotations }
            : await loadMobileSiteWalkRedlinesPageData(portalUrl, token, itemPageId, { signal: abortSignal });
          if (precacheRunRef.current !== runKey) return;
          const mergedPageBase = { ...(item || {}), ...(pageData?.page || {}) };
          const cachedFromPage = await cachePageImage(mergedPageBase, currentSitewalk);
          const cachedImageUriForPage = cachedFromPage || cachedFromList || clean(mergedPageBase.cached_image_uri);
          const mergedPage = cachedImageUriForPage ? { ...mergedPageBase, cached_image_uri: cachedImageUriForPage } : mergedPageBase;
          await writeJsonToStorage(redlinePageDataCacheKey(portalUrl, selectedSiteId, selectedSiteName, currentSitewalk, itemPageId), {
            ...pageData,
            page: mergedPage,
            cached_at: new Date().toISOString(),
          });
          await pause(180);
        } catch (_err) {
          await cachePageImage(item, currentSitewalk);
          await pause(180);
        }
      }
    }

    precacheAllPages().catch(() => {});
  }, [cachePageImage, currentPageId, currentSitewalk, page, pages, payload, pins, portalUrl, rawAnnotations, selectedSiteId, selectedSiteName, token]);


  const beginAnnotationMutation = useCallback(() => {
    annotationMutationRef.current += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      annotationMutationRef.current = Math.max(0, annotationMutationRef.current - 1);
    };
  }, []);

  const reloadPageData = useCallback(async (options = {}) => {
    const pageId = currentPageId || page?.id;
    if (!pageId || !token) return;
    if (annotationMutationRef.current > 0 && !options.force) return;
    try {
      const data = await loadMobileSiteWalkRedlinesPageData(portalUrl, token, pageId);
      setPayload((prev) => {
        const previous = prev || {};
        const previousPageId = pageIdValue(previous.page);
        if (previousPageId && String(previousPageId) !== String(pageId)) return previous;
        const incoming = data || {};
        const prevPage = previous.page || {};
        const incomingPage = incoming.page || null;
        const mergedPage = incomingPage ? {
          ...prevPage,
          ...incomingPage,
          image_api_url: clean(incomingPage.image_api_url) || prevPage.image_api_url,
          image_url: clean(incomingPage.image_url) || prevPage.image_url,
          storage_img: clean(incomingPage.storage_img) || prevPage.storage_img,
          image_url_candidates: Array.isArray(incomingPage.image_url_candidates) && incomingPage.image_url_candidates.some((item) => clean(item))
            ? incomingPage.image_url_candidates
            : prevPage.image_url_candidates,
        } : prevPage;
        const nextPayload = {
          ...previous,
          ...incoming,
          page: mergedPage,
        };
        const reloadPageCachePayload = { page: mergedPage, pins: nextPayload.pins || [], annotations: nextPayload.annotations || [] };
        writeJsonToStorage(redlinePageDataCacheKey(portalUrl, selectedSiteId, selectedSiteName, currentSitewalk, pageId), reloadPageCachePayload);
        writeJsonToStorage(redlinePageDataAnySitewalkCacheKey(portalUrl, selectedSiteId, selectedSiteName, pageId), reloadPageCachePayload);
        return nextPayload;
      });
    } catch (err) {
      const cached = await findCachedRedlinePageData(portalUrl, selectedSiteId, selectedSiteName, currentSitewalk, pageId);
      if (cached) {
        setPayload((prev) => {
          const previous = prev || {};
          const previousPageId = pageIdValue(previous.page);
          if (previousPageId && String(previousPageId) !== String(pageId)) return previous;
          return { ...previous, ...cached };
        });
        setError('Offline mode: showing the saved copy on this device.');
        return;
      }
      throw err;
    }
  }, [currentPageId, currentSitewalk, page?.id, portalUrl, selectedSiteId, selectedSiteName, token]);

  const replaceAnnotationLocal = useCallback((annotationId, patch) => {
    if (!annotationId) return null;
    let nextAnn = null;
    setPayload((prev) => {
      if (!prev || !Array.isArray(prev.annotations)) return prev;
      if (String(annotationId).startsWith('drawgroup:') && Array.isArray(patch?.__segments)) {
        const byId = new Map(patch.__segments.map((seg) => [String(seg.id), seg]));
        return {
          ...prev,
          annotations: prev.annotations.map((ann) => byId.has(String(ann.id)) ? { ...ann, ...byId.get(String(ann.id)) } : ann),
        };
      }
      return {
        ...prev,
        annotations: prev.annotations.map((ann) => {
          if (String(ann.id) !== String(annotationId)) return ann;
          nextAnn = { ...ann, ...patch };
          return nextAnn;
        }),
      };
    });
    setSelectedAnn((prev) => {
      if (!prev || String(prev.id) !== String(annotationId)) return prev;
      if (String(annotationId).startsWith('drawgroup:') && Array.isArray(patch?.__segments)) {
        const first = patch.__segments[0] || prev;
        const last = patch.__segments[patch.__segments.length - 1] || first;
        return { ...prev, x1: first.x1, y1: first.y1, x2: last.x2, y2: last.y2, __segments: patch.__segments };
      }
      return { ...prev, ...patch };
    });
    return nextAnn;
  }, []);

  const persistAnnotation = useCallback(async (ann, patch = {}) => {
    if (!ann?.id || !token) return;
    if (ann.__isFreehandGroup && Array.isArray(ann.__segments)) {
      await Promise.all(ann.__segments.map((seg) => updateMobileRedlineAnnotation(
        portalUrl,
        token,
        seg.id,
        annotationUpdatePayload(seg, {
          x1: seg.x1,
          y1: seg.y1,
          x2: seg.x2,
          y2: seg.y2,
          stroke_color: patch.stroke_color || ann.stroke_color || seg.stroke_color,
          stroke_width: patch.stroke_width || ann.stroke_width || seg.stroke_width,
          note: ann.__groupKey || ann.note || seg.note,
        }),
      )));
      return;
    }
    await updateMobileRedlineAnnotation(portalUrl, token, ann.id, annotationUpdatePayload(ann, patch));
  }, [portalUrl, token]);

  const applySelectedAnnotationStyle = useCallback(async (patch) => {
    const ann = liveSelectedAnn;
    if (!ann?.id || !editableAnnotationShape(ann.shape_type)) return;
    const nextPatch = {};
    if (patch.stroke_color) nextPatch.stroke_color = patch.stroke_color;
    if (patch.stroke_width) nextPatch.stroke_width = patch.stroke_width;
    if (ann.__isFreehandGroup && Array.isArray(ann.__segments)) {
      replaceAnnotationLocal(ann.id, { __segments: ann.__segments.map((seg) => ({ ...seg, ...nextPatch })) });
    } else {
      replaceAnnotationLocal(ann.id, nextPatch);
    }
    try {
      await persistAnnotation(ann, nextPatch);
    } catch (err) {
      Alert.alert('Update Markup Failed', err?.message || 'Unable to update markup.');
      await reloadPageData();
    }
  }, [liveSelectedAnn, persistAnnotation, reloadPageData, replaceAnnotationLocal]);

  const pointFromGesture = useCallback((evt) => {
    const { locationX, locationY } = evt.nativeEvent;
    return { x: clamp01(locationX / canvasWidth), y: clamp01(locationY / canvasHeight) };
  }, [canvasWidth, canvasHeight]);

  const pointFromTouchEvent = useCallback((evt) => {
    const native = evt?.nativeEvent || {};
    const localX = Number(native.locationX);
    const localY = Number(native.locationY);
    if (Number.isFinite(localX) && Number.isFinite(localY)) {
      return {
        x: clamp01(localX / Math.max(1, canvasWidth)),
        y: clamp01(localY / Math.max(1, canvasHeight)),
      };
    }

    const touches = native.touches || [];
    const touch = touches[0] || native;
    const viewport = viewportRef.current;
    const pageX = Number(touch.pageX ?? native.pageX);
    const pageY = Number(touch.pageY ?? native.pageY);
    if (Number.isFinite(pageX) && Number.isFinite(pageY)) {
      return {
        x: clamp01((pageX - viewport.pageX - panOffsetRef.current.x) / Math.max(1, canvasWidth)),
        y: clamp01((pageY - viewport.pageY - panOffsetRef.current.y) / Math.max(1, canvasHeight)),
      };
    }
    return pointFromGesture(evt);
  }, [canvasHeight, canvasWidth, pointFromGesture]);

  const pointFromResponderEvent = useCallback((evt) => pointFromTouchEvent(evt), [pointFromTouchEvent]);

  const appendOptimisticAnnotation = useCallback((ann) => {
    if (!ann) return;
    setPayload((prev) => {
      if (!prev) return prev;
      const existing = Array.isArray(prev.annotations) ? prev.annotations : [];
      return { ...prev, annotations: [...existing, ann] };
    });
  }, []);

  const appendOptimisticAnnotations = useCallback((items) => {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!list.length) return;
    setPayload((prev) => {
      if (!prev) return prev;
      const existing = Array.isArray(prev.annotations) ? prev.annotations : [];
      return { ...prev, annotations: [...existing, ...list] };
    });
  }, []);

  const removeAnnotationsLocal = useCallback((ids) => {
    const idSet = new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean).map((id) => String(id)));
    if (!idSet.size) return;
    setPayload((prev) => {
      if (!prev || !Array.isArray(prev.annotations)) return prev;
      return { ...prev, annotations: prev.annotations.filter((ann) => !idSet.has(String(ann.id))) };
    });
    setSelectedAnn((prev) => (prev && idSet.has(String(prev.id)) ? null : prev));
  }, []);

  const replaceOptimisticAnnotationsLocal = useCallback((tempIds, savedItems) => {
    const tempIdSet = new Set((Array.isArray(tempIds) ? tempIds : [tempIds]).filter(Boolean).map((id) => String(id)));
    const saved = (Array.isArray(savedItems) ? savedItems : [savedItems]).filter((ann) => ann?.id);
    if (!tempIdSet.size || !saved.length) return;
    setPayload((prev) => {
      if (!prev || !Array.isArray(prev.annotations)) return prev;
      const savedIds = new Set(saved.map((ann) => String(ann.id)));
      const next = [];
      let inserted = false;
      prev.annotations.forEach((ann) => {
        const annId = String(ann?.id);
        if (tempIdSet.has(annId)) {
          if (!inserted) {
            next.push(...saved);
            inserted = true;
          }
          return;
        }
        if (!savedIds.has(annId)) next.push(ann);
      });
      if (!inserted) next.push(...saved.filter((ann) => !next.some((item) => String(item?.id) === String(ann.id))));
      return { ...prev, annotations: next };
    });
    setSelectedAnn((prev) => (prev && tempIdSet.has(String(prev.id)) ? (saved[0] || null) : prev));
  }, []);

  const appendPinLocal = useCallback((pin) => {
    if (!pin?.id) return;
    setPayload((prev) => {
      if (!prev) return prev;
      const existing = Array.isArray(prev.pins) ? prev.pins : [];
      if (existing.some((item) => String(item.id) === String(pin.id))) return prev;
      return { ...prev, pins: [...existing, pin] };
    });
  }, []);

  const replacePinLocal = useCallback((pinId, patch) => {
    if (!pinId || !patch) return;
    setPayload((prev) => {
      if (!prev || !Array.isArray(prev.pins)) return prev;
      return {
        ...prev,
        pins: prev.pins.map((pin) => (String(pin.id) === String(pinId) ? { ...pin, ...patch } : pin)),
      };
    });
    setSelectedPin((prev) => (prev && String(prev.id) === String(pinId) ? { ...prev, ...patch } : prev));
    setNoteEditor((prev) => (prev?.pin && String(prev.pin.id) === String(pinId) ? { ...prev, pin: { ...prev.pin, ...patch } } : prev));
  }, []);

  const patchNotePinTextLocal = useCallback((pinId, text) => {
    if (!pinId) return;
    replacePinLocal(pinId, { __mobile_note_text: text, note: text, note_text: text, text });
  }, [replacePinLocal]);

  const upsertNoteAnnotationLocal = useCallback((pin, text, preferredId = null) => {
    if (!pin?.id) return null;
    const noteText = String(text || '');
    let nextAnn = null;
    setPayload((prev) => {
      if (!prev) return prev;
      const existing = Array.isArray(prev.annotations) ? prev.annotations : [];
      const pinId = String(pin.id);
      const idx = existing.findIndex((ann) => {
        const shape = clean(ann?.shape_type).toLowerCase();
        if (shape !== 'note') return false;
        return [ann?.note_pin_id, ann?.pin_id, ann?.linked_pin_id].some((value) => clean(value) && String(value) === pinId);
      });
      const base = {
        page_id: page?.id,
        shape_type: 'note',
        x1: clamp01(pin.x),
        y1: clamp01(pin.y),
        x2: clamp01(pin.x),
        y2: clamp01(pin.y),
        stroke_color: '#4b5cf0',
        stroke_width: 2,
        note: noteText,
        layer: 'primary',
        note_pin_id: pin.id,
        pin_id: pin.id,
        linked_pin_id: pin.id,
      };
      if (idx >= 0) {
        const annotations = existing.slice();
        nextAnn = { ...annotations[idx], ...base };
        annotations[idx] = nextAnn;
        return { ...prev, annotations };
      }
      nextAnn = { ...base, id: preferredId || `local_note_${pin.id}_${Date.now()}` };
      return { ...prev, annotations: [...existing, nextAnn] };
    });
    return nextAnn;
  }, [page?.id]);

  const removePinLocal = useCallback((pinId) => {
    if (!pinId) return;
    setPayload((prev) => {
      if (!prev || !Array.isArray(prev.pins)) return prev;
      return { ...prev, pins: prev.pins.filter((pin) => String(pin.id) !== String(pinId)) };
    });
    setSelectedPin((prev) => (prev && String(prev.id) === String(pinId) ? null : prev));
    setNoteEditor((prev) => (prev?.pin && String(prev.pin.id) === String(pinId) ? null : prev));
  }, []);

  const pointFromWindowEvent = useCallback((evt) => {
    const native = evt?.nativeEvent || {};
    const touches = native.touches || [];
    const touch = touches[0] || native;
    const viewport = viewportRef.current;
    const pageX = Number(touch.pageX ?? native.pageX);
    const pageY = Number(touch.pageY ?? native.pageY);
    if (Number.isFinite(pageX) && Number.isFinite(pageY)) {
      return {
        x: clamp01((pageX - viewport.pageX - panOffsetRef.current.x) / Math.max(1, canvasWidth)),
        y: clamp01((pageY - viewport.pageY - panOffsetRef.current.y) / Math.max(1, canvasHeight)),
      };
    }
    return pointFromTouchEvent(evt);
  }, [canvasHeight, canvasWidth, pointFromTouchEvent]);

  const offlineQueueBaseKey = useMemo(() => [
    'sitewalk_redlines_offline_queue_v1',
    safeStoragePart(normalizePortalUrl(portalUrl).toLowerCase()),
    safeStoragePart(selectedSiteId || selectedSiteName),
  ].join(':'), [portalUrl, selectedSiteId, selectedSiteName]);

  const offlineQueueKey = useMemo(() => [
    offlineQueueBaseKey,
    safeStoragePart(currentSitewalk || 'default'),
    safeStoragePart(page?.id || page?.page_id || 'page'),
  ].join(':'), [currentSitewalk, offlineQueueBaseKey, page?.id, page?.page_id]);
  const offlineQueueRef = useRef([]);
  const syncOfflineRef = useRef(false);
  const syncAllOfflineRef = useRef(false);
  const [offlineQueueVersion, setOfflineQueueVersion] = useState(0);
  const [offlineSyncStatus, setOfflineSyncStatus] = useState({ visible: false, text: '', done: 0, total: 0 });

  const writeOfflineQueue = useCallback(async (nextQueue) => {
    offlineQueueRef.current = Array.isArray(nextQueue) ? nextQueue : [];
    setOfflineQueueVersion((value) => value + 1);
    const count = offlineQueueRef.current.length;
    const uploads = queuedUploadCount(offlineQueueRef.current);
    setOfflineSyncStatus((prev) => {
      if (!count) return prev?.visible && prev?.text === 'Sync complete' ? prev : { visible: false, text: '', done: 0, total: 0 };
      if (prev?.text && String(prev.text).startsWith('Syncing')) return prev;
      const photoText = uploads ? `${uploads} photo${uploads === 1 ? '' : 's'}` : `${count} change${count === 1 ? '' : 's'}`;
      return { visible: true, text: `Offline changes saved — ${photoText} pending sync`, done: 0, total: count };
    });
    try {
      if (offlineQueueRef.current.length) await AsyncStorage.setItem(offlineQueueKey, JSON.stringify(offlineQueueRef.current));
      else await AsyncStorage.removeItem(offlineQueueKey);
    } catch (_err) {}
  }, [offlineQueueKey]);

  const queueOfflineOperation = useCallback(async (op) => {
    if (!op) return;
    const next = [
      ...offlineQueueRef.current,
      { ...op, op_id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, created_at: new Date().toISOString() },
    ];
    await writeOfflineQueue(next);
    setError('Saved on this device. It will sync when the connection is available.');
  }, [writeOfflineQueue]);

  const updateQueuedPinCreateLocal = useCallback(async (pinId, patch) => {
    if (!pinId || !patch) return false;
    let changed = false;
    const next = (offlineQueueRef.current || []).map((op) => {
      if (op?.type !== 'create_pin') return op;
      const matchesTemp = String(op.temp_id || '') === String(pinId);
      const matchesPin = String(op.pin?.id || '') === String(pinId);
      if (!matchesTemp && !matchesPin) return op;
      changed = true;
      return {
        ...op,
        payload: { ...(op.payload || {}), ...patch },
        pin: { ...(op.pin || {}), ...patch, id: op.pin?.id || op.temp_id || pinId },
      };
    });
    if (changed) {
      await writeOfflineQueue(next);
      setError('Saved on this device. It will sync when the connection is available.');
    }
    return changed;
  }, [writeOfflineQueue]);

  const updateQueuedAnnotationCreateLocal = useCallback(async (annotationId, patch) => {
    if (!annotationId || !patch) return false;
    let changed = false;
    const next = (offlineQueueRef.current || []).map((op) => {
      if (op?.type !== 'create_annotation') return op;
      if (String(op.temp_id || '') !== String(annotationId)) return op;
      changed = true;
      return { ...op, payload: { ...(op.payload || {}), ...patch } };
    });
    if (changed) {
      await writeOfflineQueue(next);
      setError('Saved on this device. It will sync when the connection is available.');
    }
    return changed;
  }, [writeOfflineQueue]);

  const removeQueuedCreatesForIds = useCallback(async (ids) => {
    const idSet = new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean).map((id) => String(id)));
    if (!idSet.size) return [];
    const remaining = [];
    const serverIds = [];
    offlineQueueRef.current.forEach((op) => {
      if (op?.type === 'create_annotation' && idSet.has(String(op.temp_id))) return;
      remaining.push(op);
    });
    idSet.forEach((id) => { if (!String(id).startsWith('temp_')) serverIds.push(id); });
    await writeOfflineQueue(remaining);
    return serverIds;
  }, [writeOfflineQueue]);

  const applyOfflineQueueToCurrentPayload = useCallback(() => {
    const activePageId = clean(page?.id || page?.page_id);
    const queue = (offlineQueueRef.current || []).filter((op) => {
      if (!op) return false;
      const opPageId = clean(op.page_id || op.payload?.page_id || op.pin?.page_id);
      return !activePageId || !opPageId || String(opPageId) === String(activePageId);
    });
    if (!queue.length) return;
    const queuedCreates = queue
      .filter((op) => op?.type === 'create_annotation' && op.payload)
      .map((op) => ({ ...op.payload, id: op.temp_id || op.payload.id }));
    const queuedPinCreates = queue
      .filter((op) => op?.type === 'create_pin' && op.pin)
      .map((op) => op.pin);
    const queuedPhotoByPin = new Map();
    const queued360ByPin = new Map();
    const queued360Deletes = new Set();
    queue.forEach((op) => {
      if (op?.type === 'delete_pin_360_photo' && op.pin_id) queued360Deletes.add(String(op.pin_id));
      if (op?.type === 'upload_pin_photo' && op.pin_id && op.local_uri) {
        const key = String(op.pin_id);
        const prev = queuedPhotoByPin.get(key) || [];
        prev.push(op);
        queuedPhotoByPin.set(key, prev);
      }
      if (op?.type === 'upload_pin_360_photo' && op.pin_id && op.local_uri) {
        const key = String(op.pin_id);
        const prev = queued360ByPin.get(key) || [];
        prev.push(op);
        queued360ByPin.set(key, prev);
      }
    });
    const queuedPinUpdates = new Map();
    queue.forEach((op) => {
      if (op?.type !== 'update_pin' || !op.pin_id || !op.payload) return;
      const key = String(op.pin_id);
      queuedPinUpdates.set(key, { ...(queuedPinUpdates.get(key) || {}), ...op.payload });
    });
    const queuedDeletes = new Set();
    queue.forEach((op) => {
      if (op?.type === 'delete_annotations') (op.ids || []).forEach((id) => queuedDeletes.add(String(id)));
    });
    if (!queuedCreates.length && !queuedDeletes.size && !queuedPinCreates.length && !queuedPhotoByPin.size && !queued360ByPin.size && !queuedPinUpdates.size) return;
    setPayload((prev) => {
      if (!prev) return prev;
      const existingAnnotations = Array.isArray(prev.annotations) ? prev.annotations : [];
      const existingAnnotationIds = new Set(existingAnnotations.map((ann) => String(ann.id)));
      const mergedAnnotations = existingAnnotations
        .filter((ann) => !queuedDeletes.has(String(ann.id)))
        .concat(queuedCreates.filter((ann) => !existingAnnotationIds.has(String(ann.id)) && !queuedDeletes.has(String(ann.id))));

      const existingPins = Array.isArray(prev.pins) ? prev.pins : [];
      const existingPinIds = new Set(existingPins.map((pin) => String(pin.id)));
      const mergedPins = existingPins
        .map((pin) => {
          const pendingUploads = queuedPhotoByPin.get(String(pin.id)) || [];
          const pendingUpdate = queuedPinUpdates.get(String(pin.id)) || null;
          let nextPin = pendingUpdate ? { ...pin, ...pendingUpdate, __offline_pending: true } : pin;
          const pending360Uploads = queued360ByPin.get(String(pin.id)) || [];
          if (pendingUploads.length) {
            const latest = pendingUploads[pendingUploads.length - 1];
            const localOfflinePhotoId = `offline_${pin.id}_${smallHash(latest.local_uri || latest.local_file_name || latest.op_id || Date.now())}`;
            nextPin = {
              ...nextPin,
              __offline_photo_pending: pendingUploads.length,
              __offline_local_photo_uri: latest.local_uri,
              __offline_previous_photo_id: nextPin.photo_id || nextPin.photoId || null,
              __offline_previous_photo_url: nextPin.photo_url || nextPin.public_url || '',
              __offline_previous_thumb_url: nextPin.thumb_url || nextPin.thumbnail_url || '',
              photo_id: localOfflinePhotoId,
              photoId: localOfflinePhotoId,
              photo_url: latest.local_uri,
              public_url: latest.local_uri,
              full_url: latest.local_uri,
              thumb_url: latest.local_uri,
              thumbnail_url: latest.local_uri,
              photo_name: latest.name || nextPin.photo_name,
              photo_count: Math.max(1, Number(nextPin.photo_count || 0) || 0),
            };
          }
          if (pending360Uploads.length) {
            const latest360 = pending360Uploads[pending360Uploads.length - 1];
            const offline360Id = latest360.offline_photo_id || `offline_360_${pin.id}_${smallHash(latest360.local_uri || latest360.local_file_name || latest360.op_id || Date.now())}`;
            nextPin = {
              ...nextPin,
              is_expected_360_photo: true,
              has_matching_360_photo: true,
              matching_360_photo_id: offline360Id,
              matching_360_photo_name: latest360.name || nextPin.matching_360_photo_name || nextPin.label,
              matching_360_photo_url: latest360.local_uri,
              matching_360_thumb_url: latest360.local_uri,
              __offline_360_pending: pending360Uploads.length,
              __offline_local_360_uri: latest360.local_uri,
              __offline_cached_360_uri: latest360.local_uri,
              __offline_cached_360_thumb_uri: latest360.local_uri,
            };
          }
          return nextPin;
        })
        .concat(queuedPinCreates.filter((pin) => !existingPinIds.has(String(pin.id))));

      return { ...prev, annotations: mergedAnnotations, pins: mergedPins };
    });
  }, [page?.id, page?.page_id]);

  useEffect(() => {
    let cancelled = false;
    // Page changes can happen while fully offline. Clear the in-memory queue
    // before loading the next page's queue so a stale queue from the previous
    // page cannot be merged onto the newly selected page for a single render.
    offlineQueueRef.current = [];
    setOfflineQueueVersion((value) => value + 1);
    AsyncStorage.getItem(offlineQueueKey).then((raw) => {
      if (cancelled) return;
      let queue = [];
      try { queue = raw ? JSON.parse(raw) : []; } catch (_err) { queue = []; }
      offlineQueueRef.current = Array.isArray(queue) ? queue : [];
      setOfflineQueueVersion((value) => value + 1);
      const count = offlineQueueRef.current.length;
      if (count) setOfflineSyncStatus({ visible: true, text: `Offline changes saved — ${queuedUploadCount(offlineQueueRef.current) || count} pending sync`, done: 0, total: count });
      applyOfflineQueueToCurrentPayload();
    });
    return () => { cancelled = true; };
  }, [applyOfflineQueueToCurrentPayload, offlineQueueKey]);

  useEffect(() => {
    applyOfflineQueueToCurrentPayload();
  }, [applyOfflineQueueToCurrentPayload, offlineQueueVersion, payload?.annotations?.length, payload?.pins?.length]);

  const syncOfflineQueueItems = useCallback(async (queueKey, queue, options = {}) => {
    const originalQueue = Array.isArray(queue) ? [...queue] : [];
    if (!token || !originalQueue.length) return { changed: false, remaining: originalQueue, completed: 0, total: originalQueue.length };

    const currentPageId = clean(page?.id || page?.page_id);
    const isCurrentPageOp = (op) => {
      const opPageId = clean(op?.page_id || op?.payload?.page_id || op?.pin?.page_id);
      return Boolean(currentPageId && opPageId && String(opPageId) === String(currentPageId));
    };

    const remaining = [];
    const tempPinMap = new Map();
    let completed = 0;
    const total = originalQueue.length;
    if (options.showStatus) setOfflineSyncStatus({ visible: true, text: `Syncing 0 of ${total}`, done: 0, total });

    for (const op of originalQueue) {
      const currentPageOp = isCurrentPageOp(op);
      try {
        if (op?.type === 'create_pin' && op.payload) {
          const response = await createMobileRedlinePin(portalUrl, token, op.payload);
          const serverPin = response?.item || response?.pin || null;
          if (serverPin?.id && op.temp_id) {
            tempPinMap.set(String(op.temp_id), serverPin.id);
            if (currentPageOp) {
              removePinLocal(op.temp_id);
              appendPinLocal(serverPin);
            }
          }
        } else if (op?.type === 'upload_pin_photo' && op.local_uri) {
          const resolvedPinId = tempPinMap.get(String(op.pin_id)) || op.pin_id;
          if (!resolvedPinId || isTempRedlineId(resolvedPinId)) throw new Error('Waiting for the offline pin to sync first.');
          const resolvedLocalUri = await resolveOfflinePhotoFileUri(op);
          if (!resolvedLocalUri) {
            throw new Error('The offline photo file is missing from this device. Other queued changes will continue syncing.');
          }
          const upload = await uploadMobileRedlinePinPhoto(portalUrl, token, resolvedPinId, {
            siteId: op.site_id || selectedSiteId,
            name: op.name || 'Pin photo',
            tag: op.tag || '',
            sitewalkDesc: op.sitewalk_desc || currentSitewalkRef.current,
            note: op.note || '',
            appendMode: Boolean(op.append_mode),
            clientOpId: op.op_id || '',
            file: { uri: resolvedLocalUri, name: op.file_name || fileNameFromUri(resolvedLocalUri) || 'redline-photo.jpg', type: op.file_type || 'image/jpeg' },
          });
          const serverPin = upload?.pin?.id ? upload.pin : null;
          const uploadedPhotoId = serverPin?.photo_id || upload?.photo_id || null;
          const offlineAnnotation = await readOfflineRedlinePhotoAnnotation(op.pin_id, resolvedLocalUri) || await readOfflineRedlinePhotoAnnotation(op.pin_id, op.local_uri);
          if (offlineAnnotation?.data_json && uploadedPhotoId) {
            await saveMobileRedlineSiteWalkPhotoAnnotation(portalUrl, token, uploadedPhotoId, {
              data_json: offlineAnnotation.data_json,
              version: offlineAnnotation.version,
            }, { pinId: resolvedPinId });
            await clearOfflineRedlinePhotoAnnotation(op.pin_id, resolvedLocalUri);
            if (resolvedLocalUri !== op.local_uri) await clearOfflineRedlinePhotoAnnotation(op.pin_id, op.local_uri);
          }
          if (currentPageOp) {
            const patch = serverPin ? {
              ...serverPin,
              photo_id: serverPin.photo_id || upload?.photo_id,
              photo_url: serverPin.photo_url || upload?.photo_url,
              thumb_url: serverPin.thumb_url || upload?.thumb_url,
              photo_name: serverPin.photo_name || upload?.name || op.name,
              photo_count: Math.max(1, Number(serverPin.photo_count || 0) || 0),
              __offline_photo_pending: 0,
              __offline_local_photo_uri: '',
            } : {
              photo_id: upload?.photo_id,
              photo_url: upload?.photo_url,
              thumb_url: upload?.thumb_url,
              photo_name: upload?.name || op.name,
              photo_count: 1,
              __offline_photo_pending: 0,
              __offline_local_photo_uri: '',
            };
            replacePinLocal(resolvedPinId, patch);
          }
          try { await FileSystem.deleteAsync(resolvedLocalUri, { idempotent: true }); } catch (_deleteErr) {}
        } else if (op?.type === 'upload_pin_360_photo' && op.local_uri) {
          const resolvedPinId = tempPinMap.get(String(op.pin_id)) || op.pin_id;
          if (!resolvedPinId || isTempRedlineId(resolvedPinId)) throw new Error('Waiting for the offline pin to sync first.');
          const resolvedLocalUri = await resolveOfflinePhotoFileUri(op);
          if (!resolvedLocalUri) {
            throw new Error('The offline 360 photo file is missing from this device. Other queued changes will continue syncing.');
          }
          const upload = await uploadMobileRedline360PinPhoto(portalUrl, token, resolvedPinId, {
            siteId: op.site_id || selectedSiteId,
            name: op.name || '360 Photo',
            tag: op.tag || '',
            sitewalkDesc: op.sitewalk_desc || currentSitewalkRef.current,
            note: op.note || '',
            clientOpId: op.op_id || '',
            file: { uri: resolvedLocalUri, name: op.file_name || fileNameFromUri(resolvedLocalUri) || 'site-walk-360.jpg', type: op.file_type || local360FileTypeFromUri(resolvedLocalUri) },
          });
          const serverPin = upload?.pin || upload?.item || upload?.redline_pin || upload?.data?.pin || null;
          const uploaded360PhotoId = serverPin?.matching_360_photo_id || upload?.photo?.id || upload?.item?.id || upload?.data?.photo?.id || upload?.photo_id || null;
          const offline360Annotation = await readCached360AnnotationsForSync(op.offline_photo_id) || await readCached360AnnotationsForSync(op.local_uri);
          if (offline360Annotation?.annotations && uploaded360PhotoId) {
            await saveMobileRedline360PhotoAnnotations(portalUrl, token, uploaded360PhotoId, { annotations: offline360Annotation.annotations });
            await clearCached360AnnotationsForSync(op.offline_photo_id);
            if (op.local_uri) await clearCached360AnnotationsForSync(op.local_uri);
          }
          if (currentPageOp) {
            const patch = serverPin?.id ? {
              ...serverPin,
              is_expected_360_photo: true,
              has_matching_360_photo: true,
              __offline_360_pending: 0,
              __offline_local_360_uri: '',
            } : {
              is_expected_360_photo: true,
              has_matching_360_photo: true,
              matching_360_photo_id: uploaded360PhotoId || true,
              matching_360_photo_url: upload?.photo?.photo_url || upload?.photo_url || '',
              matching_360_thumb_url: upload?.photo?.thumb_url || upload?.thumb_url || '',
              matching_360_photo_name: upload?.photo?.name || op.name || '360 Photo',
              __offline_360_pending: 0,
              __offline_local_360_uri: '',
              __offline_cached_360_uri: '',
              __offline_cached_360_thumb_uri: '',
            };
            replacePinLocal(resolvedPinId, patch);
          }
          try { await FileSystem.deleteAsync(resolvedLocalUri, { idempotent: true }); } catch (_deleteErr) {}
        } else if (op?.type === 'delete_pin_360_photo' && op.pin_id) {
          const resolvedPinId = tempPinMap.get(String(op.pin_id)) || op.pin_id;
          if (!resolvedPinId || isTempRedlineId(resolvedPinId)) throw new Error('Waiting for the offline pin to sync first.');
          if (op.photo_id && !isTempRedlineId(op.photo_id)) {
            await deleteMobileRedline360Photo(portalUrl, token, resolvedPinId, op.photo_id);
          } else {
            await deleteMobileRedline360Photo(portalUrl, token, resolvedPinId);
          }
          if (currentPageOp) {
            replacePinLocal(resolvedPinId, {
              is_expected_360_photo: false,
              has_matching_360_photo: false,
              matching_360_count: 0,
              matching_360_photo_id: null,
              matching_360_photo_name: '',
              matching_360_photo_url: '',
              matching_360_thumb_url: '',
              __offline_360_pending: 0,
              __offline_local_360_uri: '',
              __offline_cached_360_uri: '',
              __offline_cached_360_thumb_uri: '',
            });
          }
        } else if (op?.type === 'create_annotation' && op.payload) {
          const payloadToSave = { ...op.payload };
          delete payloadToSave.id;
          ['pin_id', 'note_pin_id', 'linked_pin_id'].forEach((key) => {
            const mapped = tempPinMap.get(String(payloadToSave[key] || ''));
            if (mapped) payloadToSave[key] = mapped;
          });
          await createMobileRedlineAnnotation(portalUrl, token, payloadToSave);
        } else if (op?.type === 'delete_annotations' && Array.isArray(op.ids)) {
          for (const id of op.ids) {
            if (!isTempRedlineId(id)) await deleteMobileRedlineAnnotation(portalUrl, token, id);
          }
        } else if (op?.type === 'update_annotation' && op.id && op.payload) {
          if (!isTempRedlineId(op.id)) await updateMobileRedlineAnnotation(portalUrl, token, op.id, op.payload);
        } else if (op?.type === 'update_pin' && op.pin_id && op.payload) {
          const resolvedPinId = tempPinMap.get(String(op.pin_id)) || op.pin_id;
          if (!resolvedPinId || isTempRedlineId(resolvedPinId)) throw new Error('Waiting for the offline pin to sync first.');
          const response = await updateMobileRedlinePin(portalUrl, token, resolvedPinId, op.payload);
          const serverPin = response?.item || response?.pin || null;
          if (currentPageOp) replacePinLocal(resolvedPinId, serverPin || { ...op.payload, __offline_pending: false });
        }
        completed += 1;
        if (options.showStatus) setOfflineSyncStatus({ visible: true, text: `Syncing ${completed} of ${total}`, done: completed, total });
      } catch (_err) {
        if ((op?.type === 'upload_pin_photo' || op?.type === 'upload_pin_360_photo' || op?.type === 'delete_pin_360_photo') && tempPinMap.has(String(op.pin_id))) {
          remaining.push({ ...op, pin_id: tempPinMap.get(String(op.pin_id)) });
        } else {
          remaining.push(op);
        }
      }
    }

    if (queueKey === offlineQueueKey) {
      await writeOfflineQueue(remaining);
    } else {
      try {
        if (remaining.length) await AsyncStorage.setItem(queueKey, JSON.stringify(remaining));
        else await AsyncStorage.removeItem(queueKey);
      } catch (_err) {}
    }

    return { changed: remaining.length !== originalQueue.length, remaining, completed, total };
  }, [appendPinLocal, offlineQueueKey, page?.id, page?.page_id, portalUrl, removePinLocal, replacePinLocal, selectedSiteId, token, writeOfflineQueue]);

  const syncOfflineQueue = useCallback(async () => {
    if (syncOfflineRef.current || !token || !page?.id || !offlineQueueRef.current.length) return false;
    syncOfflineRef.current = true;
    try {
      const result = await syncOfflineQueueItems(offlineQueueKey, offlineQueueRef.current, { showStatus: true });
      const hadItems = result.total;
      const remainingCount = result.remaining.length;
      if (!remainingCount) {
        setError('');
        setOfflineSyncStatus({ visible: true, text: 'Sync complete', done: hadItems, total: hadItems });
        setTimeout(() => setOfflineSyncStatus((prev) => (prev?.text === 'Sync complete' ? { visible: false, text: '', done: 0, total: 0 } : prev)), 2600);
      } else {
        setOfflineSyncStatus({ visible: true, text: `Sync paused — ${remainingCount} pending`, done: result.completed, total: result.total });
      }
      return result.changed;
    } finally {
      syncOfflineRef.current = false;
    }
  }, [offlineQueueKey, page?.id, syncOfflineQueueItems, token]);

  const syncAllOfflineQueues = useCallback(async () => {
    if (syncAllOfflineRef.current || syncOfflineRef.current || !token || !offlineQueueBaseKey) return false;
    syncAllOfflineRef.current = true;
    try {
      let keys = [];
      try { keys = await AsyncStorage.getAllKeys(); } catch (_err) { keys = []; }
      const prefix = `${offlineQueueBaseKey}:`;
      const queueKeys = keys.filter((key) => String(key || '').startsWith(prefix));
      if (!queueKeys.length) return false;

      const loaded = [];
      for (const key of queueKeys) {
        let queue = [];
        try {
          const raw = await AsyncStorage.getItem(key);
          queue = raw ? JSON.parse(raw) : [];
        } catch (_err) {
          queue = [];
        }
        if (Array.isArray(queue) && queue.length) loaded.push({ key, queue });
      }
      const total = loaded.reduce((sum, item) => sum + item.queue.length, 0);
      if (!total) return false;

      setOfflineSyncStatus({ visible: true, text: `Syncing 0 of ${total}`, done: 0, total });
      let done = 0;
      let remainingTotal = 0;
      let changed = false;
      for (const item of loaded) {
        const result = await syncOfflineQueueItems(item.key, item.queue, { showStatus: false });
        done += result.completed;
        remainingTotal += result.remaining.length;
        changed = changed || result.changed;
        setOfflineSyncStatus({ visible: true, text: `Syncing ${Math.min(done, total)} of ${total}`, done: Math.min(done, total), total });
      }

      if (!remainingTotal) {
        setError('');
        setOfflineSyncStatus({ visible: true, text: 'Sync complete', done: total, total });
        setTimeout(() => setOfflineSyncStatus((prev) => (prev?.text === 'Sync complete' ? { visible: false, text: '', done: 0, total: 0 } : prev)), 2600);
      } else {
        setOfflineSyncStatus({ visible: true, text: `Sync paused — ${remainingTotal} pending`, done, total });
      }
      return changed;
    } finally {
      syncAllOfflineRef.current = false;
    }
  }, [offlineQueueBaseKey, syncOfflineQueueItems, token]);

  useEffect(() => {
    if (!token || !offlineQueueBaseKey) return undefined;
    const runSync = () => {
      syncAllOfflineQueues().then((changed) => { if (changed) reloadPageData().catch(() => {}); }).catch(() => {});
    };
    const timer = setTimeout(runSync, 1200);
    const interval = setInterval(runSync, 15000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [offlineQueueBaseKey, offlineQueueVersion, reloadPageData, syncAllOfflineQueues, token]);

  const createPinAt = useCallback(async (point, overrides = {}) => {
    if (!canEdit || !page?.id) return;
    const baseType = tool === TOOL_NOTE ? 'note' : tool === TOOL_GRID ? 'site_record_dot' : tool === TOOL_PHOTO ? 'camera_misc' : tool === TOOL_LOCATION ? 'location' : 'photo';
    const defaultLabel = tool === TOOL_NOTE ? 'Note' : tool === TOOL_GRID ? 'Site Record Dot' : tool === TOOL_PHOTO ? '' : tool === TOOL_LOCATION ? 'Location' : 'Photo Pin';
    const pinPayload = {
      page_id: page.id,
      x: point.x,
      y: point.y,
      label: overrides.label ?? defaultLabel,
      tag: overrides.tag ?? (tool === TOOL_NOTE ? 'NOTE' : ''),
      pin_type: overrides.pin_type ?? baseType,
      sr_location: overrides.sr_location,
      sr_task: overrides.sr_task,
      sr_design_count: overrides.sr_design_count,
      is_expected_360_photo: Boolean(overrides.is_expected_360_photo),
    };
    try {
      const response = await createMobileRedlinePin(portalUrl, token, pinPayload);
      await reloadPageData();
      const createdPin = response?.item || null;
      setSelectedPin(createdPin);

      const createdKind = pinKind(createdPin || { pin_type: overrides.pin_type ?? baseType, tag: overrides.tag });
      if (createdKind === 'camera_misc' && createdPin) {
        setTool(TOOL_SELECT);
        setCameraPhotoPin(createdPin);
        return;
      }
      if (overrides.openEditorAfterCreate && createdPin) {
        setTool(TOOL_SELECT);
        setPinEditor(createdPin);
        return;
      }
      // Note pins use the dedicated note dialog instead of the generic pin editor.
    } catch (err) {
      const tempId = `temp_pin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const optimisticPin = {
        ...pinPayload,
        id: tempId,
        __offline_pending: true,
        __offline_created_at: new Date().toISOString(),
      };
      appendPinLocal(optimisticPin);
      setSelectedPin(optimisticPin);
      await queueOfflineOperation({ type: 'create_pin', temp_id: tempId, page_id: page.id, payload: pinPayload, pin: optimisticPin });
      const createdKind = pinKind(optimisticPin);
      if (createdKind === 'camera_misc') {
        setTool(TOOL_SELECT);
        setCameraPhotoPin(optimisticPin);
        return;
      }
      if (overrides.openEditorAfterCreate) {
        setTool(TOOL_SELECT);
        setPinEditor(optimisticPin);
      }
    }
  }, [appendPinLocal, canEdit, page?.id, portalUrl, queueOfflineOperation, reloadPageData, token, tool]);

  const createNoteAt = useCallback(async (point, text = null) => {
    if (!canEdit || !page?.id) return;
    const noteValue = String((text ?? pendingNoteTextRef.current) || '').trim();
    const pinPayload = {
      page_id: page.id,
      x: point.x,
      y: point.y,
      label: '',
      tag: 'NOTE',
      pin_type: 'note',
      layer: 'primary',
      is_expected_360_photo: false,
    };
    const annPayload = noteValue ? {
      page_id: page.id,
      shape_type: 'note',
      x1: point.x,
      y1: point.y,
      x2: point.x,
      y2: point.y,
      stroke_color: '#4b5cf0',
      stroke_width: 2,
      note: noteValue,
      layer: 'primary',
    } : null;

    try {
      const pinResponse = await createMobileRedlinePin(portalUrl, token, pinPayload);
      const newPin = pinResponse?.item || null;
      if (newPin?.id) {
        appendPinLocal({ ...newPin, __mobile_note_text: noteValue, note: noteValue, note_text: noteValue, text: noteValue });
      }
      let noteAnn = null;
      if (annPayload) {
        const linkedAnnPayload = newPin?.id
          ? { ...annPayload, note_pin_id: newPin.id, pin_id: newPin.id, linked_pin_id: newPin.id }
          : annPayload;
        const annResponse = await createMobileRedlineAnnotation(portalUrl, token, linkedAnnPayload);
        noteAnn = annResponse?.item || { ...linkedAnnPayload, id: annResponse?.id };
        if (noteAnn?.id) appendOptimisticAnnotation(noteAnn);
      }
      pendingNoteTextRef.current = '';
      setPendingNoteText('');
      setTool(TOOL_SELECT);
      if (newPin?.id) {
        const patchedPin = { ...newPin, __mobile_note_text: noteValue, note: noteValue, note_text: noteValue, text: noteValue };
        patchNotePinTextLocal(newPin.id, noteValue);
        if (noteValue) upsertNoteAnnotationLocal(patchedPin, noteValue, noteAnn?.id || null);
        setSelectedPin(patchedPin);
        setNoteEditor(null);
      }
      // Do not immediately reload here.  Some servers return the new pin before
      // the linked note annotation is visible in page-data, which made the first
      // note save appear blank until the user edited it a second time.
      setTimeout(() => reloadPageData().then(() => {
        if (newPin?.id && noteValue) {
          const patchedPin = { ...newPin, __mobile_note_text: noteValue, note: noteValue, note_text: noteValue, text: noteValue };
          patchNotePinTextLocal(newPin.id, noteValue);
          upsertNoteAnnotationLocal(patchedPin, noteValue, noteAnn?.id || null);
          setSelectedPin(patchedPin);
        }
      }).catch(() => {}), 700);
      if (!noteValue && newPin) {
        noteEditorTextRef.current = '';
        setNoteEditor({ pin: { ...newPin, __mobile_note_text: '', note: '', note_text: '', text: '' }, text: '' });
      }
    } catch (_err) {
      const tempPinId = `temp_pin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const optimisticPin = {
        ...pinPayload,
        id: tempPinId,
        __offline_pending: true,
        __mobile_note_text: noteValue,
        note: noteValue,
        note_text: noteValue,
        text: noteValue,
      };
      appendPinLocal(optimisticPin);
      await queueOfflineOperation({ type: 'create_pin', temp_id: tempPinId, page_id: page.id, payload: pinPayload, pin: optimisticPin });

      if (annPayload) {
        const tempAnnId = `temp_note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const optimisticAnn = {
          ...annPayload,
          id: tempAnnId,
          note_pin_id: tempPinId,
          pin_id: tempPinId,
          linked_pin_id: tempPinId,
          __offline_pending: true,
        };
        appendOptimisticAnnotation(optimisticAnn);
        await queueOfflineOperation({
          type: 'create_annotation',
          temp_id: tempAnnId,
          page_id: page.id,
          payload: { ...annPayload, note_pin_id: tempPinId, pin_id: tempPinId, linked_pin_id: tempPinId },
        });
      }

      pendingNoteTextRef.current = '';
      setPendingNoteText('');
      setTool(TOOL_SELECT);
      setSelectedPin(optimisticPin);
      if (!noteValue) {
        noteEditorTextRef.current = '';
        setNoteEditor({ pin: optimisticPin, text: '' });
      } else {
        setNoteEditor(null);
      }
    }
  }, [appendOptimisticAnnotation, appendPinLocal, canEdit, page?.id, patchNotePinTextLocal, portalUrl, queueOfflineOperation, reloadPageData, token, upsertNoteAnnotationLocal]);

  const openNoteEditorForPin = useCallback((pin) => {
    if (!pin) return;
    const text = noteTextForPin(pin, annotations);
    noteEditorTextRef.current = String(text || '');
    setSelectedPin(pin);
    setSelectedAnn(null);
    setPinEditor(null);
    setNoteEditor({ pin, text });
  }, [annotations]);

  const createShape = useCallback(async (start, end, shapeType) => {
    if (!canEdit || !page?.id) return;
    const optimisticAnn = {
      id: `temp_${shapeType}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      page_id: page.id,
      shape_type: shapeType,
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      stroke_color: strokeColor,
      stroke_width: strokeWidth,
      layer: 'primary',
    };
    appendOptimisticAnnotation(optimisticAnn);
    setTool(TOOL_SELECT);
    setDraftStart(null);
    setDraftShape(null);
    const releaseMutation = beginAnnotationMutation();
    try {
      const response = await createMobileRedlineAnnotation(portalUrl, token, {
        page_id: page.id,
        shape_type: shapeType,
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        stroke_color: strokeColor,
        stroke_width: strokeWidth,
        layer: 'primary',
      });
      const savedAnn = response?.item || null;
      if (savedAnn?.id) replaceOptimisticAnnotationsLocal([optimisticAnn.id], [savedAnn]);
      else await reloadPageData({ force: true });
    } catch (_err) {
      await queueOfflineOperation({
        type: 'create_annotation',
        temp_id: optimisticAnn.id,
        page_id: page.id,
        payload: { ...optimisticAnn, id: undefined },
      });
    } finally {
      releaseMutation();
    }
  }, [appendOptimisticAnnotation, beginAnnotationMutation, canEdit, page?.id, portalUrl, queueOfflineOperation, reloadPageData, replaceOptimisticAnnotationsLocal, strokeColor, strokeWidth, token]);

  const createFreehand = useCallback(async (points) => {
    if (!canEdit || !page?.id || !Array.isArray(points) || points.length < 2) return;
    const smoothPoints = smoothFreehandInputPoints(points);
    const groupId = `stroke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const segments = [];
    for (let i = 1; i < smoothPoints.length; i += 1) {
      const a = smoothPoints[i - 1];
      const b = smoothPoints[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (Math.sqrt((dx * dx) + (dy * dy)) >= 0.00015) {
        segments.push([a, b]);
      }
    }
    if (!segments.length) return;
    const optimisticItems = segments.map(([a, b], idx) => ({
      id: `temp_${groupId}_${idx}`,
      page_id: page.id,
      shape_type: 'draw',
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      stroke_color: strokeColor,
      stroke_width: strokeWidth,
      note: groupId,
      layer: 'primary',
    }));
    appendOptimisticAnnotations(optimisticItems);
    setTool(TOOL_SELECT);
    setDraftStart(null);
    setDraftShape(null);
    const releaseMutation = beginAnnotationMutation();
    const savedItems = [];
    try {
      for (const [a, b] of segments) {
        // Save sequentially so the server-created rows stay in draw order.
        // Parallel saves can come back out of order, which makes one pencil
        // stroke render as crossing segments after the refresh.
        const response = await createMobileRedlineAnnotation(portalUrl, token, {
          page_id: page.id,
          shape_type: 'draw',
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          stroke_color: strokeColor,
          stroke_width: strokeWidth,
          note: groupId,
          layer: 'primary',
        });
        if (response?.item?.id) savedItems.push(response.item);
      }
      if (savedItems.length === optimisticItems.length) {
        replaceOptimisticAnnotationsLocal(optimisticItems.map((item) => item.id), savedItems);
      } else {
        await reloadPageData({ force: true });
      }
    } catch (_err) {
      if (savedItems.length) {
        replaceOptimisticAnnotationsLocal(optimisticItems.slice(0, savedItems.length).map((item) => item.id), savedItems);
      }
      for (const item of optimisticItems.slice(savedItems.length)) {
        await queueOfflineOperation({ type: 'create_annotation', temp_id: item.id, page_id: page.id, payload: { ...item, id: undefined } });
      }
    } finally {
      releaseMutation();
    }
  }, [appendOptimisticAnnotations, beginAnnotationMutation, canEdit, page?.id, portalUrl, queueOfflineOperation, reloadPageData, replaceOptimisticAnnotationsLocal, strokeColor, strokeWidth, token]);

  const createPolylineSegment = useCallback(async (from, to, groupId) => {
    if (!canEdit || !page?.id || !from || !to || !groupId) return null;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.sqrt((dx * dx) + (dy * dy)) <= 0.0015) return null;
    const optimisticAnn = {
      id: `temp_${groupId}_${Date.now()}`,
      page_id: page.id,
      shape_type: 'draw',
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      stroke_color: strokeColor,
      stroke_width: strokeWidth,
      note: groupId,
      layer: 'primary',
    };
    appendOptimisticAnnotation(optimisticAnn);
    const payloadToSave = {
      page_id: page.id,
      shape_type: 'draw',
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      stroke_color: strokeColor,
      stroke_width: strokeWidth,
      note: groupId,
      layer: 'primary',
    };
    try {
      const saved = await createMobileRedlineAnnotation(portalUrl, token, payloadToSave);
      await reloadPageData();
      return saved;
    } catch (_err) {
      await queueOfflineOperation({ type: 'create_annotation', temp_id: optimisticAnn.id, page_id: page.id, payload: payloadToSave });
      return null;
    }
  }, [appendOptimisticAnnotation, canEdit, page?.id, portalUrl, queueOfflineOperation, reloadPageData, strokeColor, strokeWidth, token]);

  const resetPolylineDraft = useCallback(() => {
    polylineRef.current = { active: false, groupId: '', lastPoint: null, points: [] };
    setPolylineDraft(null);
  }, []);

  const createIconAt = useCallback(async (point, note = pendingIconNote) => {
    if (!canEdit || !page?.id) return;
    const optimisticAnn = {
      id: `temp_icon_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      page_id: page.id,
      shape_type: 'note',
      x1: point.x,
      y1: point.y,
      x2: point.x,
      y2: point.y,
      stroke_color: iconStrokeColor(note),
      stroke_width: strokeWidth,
      note,
      layer: 'primary',
    };
    appendOptimisticAnnotation(optimisticAnn);
    setTool(TOOL_SELECT);
    try {
      const payloadToSave = { ...optimisticAnn };
      delete payloadToSave.id;
      await createMobileRedlineAnnotation(portalUrl, token, payloadToSave);
      await reloadPageData();
    } catch (_err) {
      await queueOfflineOperation({ type: 'create_annotation', temp_id: optimisticAnn.id, page_id: page.id, payload: { ...optimisticAnn, id: undefined } });
    }
  }, [appendOptimisticAnnotation, canEdit, page?.id, pendingIconNote, portalUrl, queueOfflineOperation, reloadPageData, strokeWidth, token]);

  const createCloudAt = useCallback(async (point, text = pendingCloudText) => {
    const value = clean(text);
    if (!canEdit || !page?.id || !value) return;
    const optimisticAnn = {
      id: `temp_cloud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      page_id: page.id,
      shape_type: 'note',
      x1: point.x,
      y1: point.y,
      x2: point.x,
      y2: point.y,
      stroke_color: '#dc2626',
      stroke_width: strokeWidth,
      note: `cloud:${value}`,
      layer: 'primary',
    };
    appendOptimisticAnnotation(optimisticAnn);
    setPendingCloudText('');
    setCloudText('');
    setTool(TOOL_SELECT);
    try {
      const payloadToSave = { ...optimisticAnn };
      delete payloadToSave.id;
      await createMobileRedlineAnnotation(portalUrl, token, payloadToSave);
      await reloadPageData();
    } catch (_err) {
      await queueOfflineOperation({ type: 'create_annotation', temp_id: optimisticAnn.id, page_id: page.id, payload: { ...optimisticAnn, id: undefined } });
    }
  }, [appendOptimisticAnnotation, canEdit, page?.id, pendingCloudText, portalUrl, queueOfflineOperation, reloadPageData, strokeWidth, token]);

  const saveCloudText = useCallback(async () => {
    const value = clean(cloudText);
    if (!value) {
      Alert.alert(t("Cloud"), t("Enter cloud text first."));
      return;
    }
    if (editingCloudAnn?.id) {
      try {
        await updateMobileRedlineAnnotation(portalUrl, token, editingCloudAnn.id, annotationUpdatePayload(editingCloudAnn, { note: `cloud:${value}` }));
        setCloudVisible(false);
        setEditingCloudAnn(null);
        setCloudText('');
        await reloadPageData();
      } catch (err) {
        Alert.alert('Update Cloud Failed', err?.message || 'Unable to update cloud.');
      }
      return;
    }
    setPendingCloudText(value);
    setCloudVisible(false);
    setTool(TOOL_CLOUD);
  }, [cloudText, editingCloudAnn, portalUrl, reloadPageData, token]);

  const handleCanvasToolPress = useCallback(async (evt) => {
    if (suppressCanvasToolPressRef.current || Date.now() < suppressCanvasToolPressUntilRef.current) {
      suppressCanvasToolPressRef.current = false;
      return;
    }
    const point = pointFromWindowEvent(evt);
    setSelectedPin(null);
    setSelectedAnn(null);

    if (whiteboardEnabled) return;
    if (tool === TOOL_SELECT || tool === TOOL_SEARCH) return;
    if (tool === TOOL_CLOUD) {
      if (pendingCloudText) await createCloudAt(point, pendingCloudText);
      else setCloudVisible(true);
      return;
    }
    if (tool === TOOL_ICON) {
      await createIconAt(point);
      return;
    }
    if (tool === TOOL_NOTE) {
      pendingNoteTextRef.current = '';
      noteEditorTextRef.current = '';
      setPendingNoteText('');
      setSelectedPin(null);
      setSelectedAnn(null);
      setPinEditor(null);
      setNoteEditor(null);
      await createNoteAt(point, '');
      return;
    }
    if (tool === TOOL_PHOTO) {
      await createPinAt(point, { label: '', tag: 'MISC', pin_type: 'camera_misc' });
      return;
    }
    if (tool === TOOL_LOCATION) {
      // The teardrop toolbar button is the normal SiteWalk photo pin marker:
      // a hollow red/green ring with a label, not a location marker and not a camera pin.
      // Do not create the pin yet. The editor requires a pin name and tag;
      // Cancel should abandon the draft without placing anything on the PDF.
      setTool(TOOL_SELECT);
      setSelectedPin(null);
      setSelectedAnn(null);
      setNoteEditor(null);
      setPinEditor({
        __draft: true,
        x: point.x,
        y: point.y,
        label: '',
        tag: '',
        pin_type: 'photo',
        is_expected_360_photo: false,
      });
      return;
    }
    if (tool === TOOL_GRID) {
      setDraftStart(point);
      if (!dotOptions) {
        try { setDotOptions(await loadMobileRedlineDotOptions(portalUrl, token, selectedSiteId)); } catch (_err) { setDotOptions({ items: [] }); }
      }
      setDotVisible(true);
      return;
    }
    if (tool === TOOL_POLYLINE) {
      const state = polylineRef.current;
      if (!state.active || !state.lastPoint) {
        const groupId = `poly_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        polylineRef.current = { active: true, groupId, lastPoint: point, points: [point] };
        setPolylineDraft({ groupId, points: [point] });
        return;
      }
      const from = state.lastPoint;
      const nextPoints = [...(state.points || [from]), point];
      polylineRef.current = { ...state, lastPoint: point, points: nextPoints };
      setPolylineDraft({ groupId: state.groupId, points: nextPoints });
      await createPolylineSegment(from, point, state.groupId);
      setPolylineDraft({ groupId: state.groupId, points: [point] });
      return;
    }
  }, [createCloudAt, createIconAt, createNoteAt, createPinAt, createPolylineSegment, dotOptions, loadMobileRedlineDotOptions, pendingCloudText, pendingNoteText, pointFromWindowEvent, portalUrl, selectedSiteId, token, tool, whiteboardEnabled]);

  const handleCanvasPress = useCallback(async (evt) => {
    await handleCanvasToolPress(evt);
  }, [handleCanvasToolPress]);

  const handleCanvasPlacementPressIn = useCallback(async (evt) => {
    if (!isPinPlacementTool(tool)) return;
    await handleCanvasToolPress(evt);
  }, [handleCanvasToolPress, tool]);


  const drawingPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => isDrawShapeTool(tool) && canEdit && Boolean(page?.id),
    onStartShouldSetPanResponderCapture: () => isDrawShapeTool(tool) && canEdit && Boolean(page?.id),
    onMoveShouldSetPanResponder: () => isDrawShapeTool(tool) && canEdit && Boolean(page?.id),
    onMoveShouldSetPanResponderCapture: () => isDrawShapeTool(tool) && canEdit && Boolean(page?.id),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (evt) => {
      if (!isDrawShapeTool(tool) || !canEdit || !page?.id) return;
      const start = pointFromResponderEvent(evt);
      const shapeTool = tool;
      drawRef.current = { active: true, start, end: start, points: [start], tool: shapeTool };
      setSelectedPin(null);
      setSelectedAnn(null);
      setDraftStart(start);
      setDraftShape({ tool: shapeTool, start, end: start, points: [start] });
    },
    onPanResponderMove: (evt) => {
      const drawing = drawRef.current;
      if (!drawing.active || !isDrawShapeTool(drawing.tool)) return;
      const end = pointFromResponderEvent(evt);
      let points = drawing.points || [drawing.start];
      if (drawing.tool === TOOL_DRAW) {
        const last = points[points.length - 1] || drawing.start;
        const dx = end.x - last.x;
        const dy = end.y - last.y;
        if (Math.sqrt((dx * dx) + (dy * dy)) >= 0.00025) {
          points = [...points, end];
        }
      }
      drawRef.current = { ...drawing, end, points };
      setDraftShape({ tool: drawing.tool, start: drawing.start, end, points });
    },
    onPanResponderRelease: async (evt) => {
      const drawing = drawRef.current;
      if (!drawing.active || !drawing.start || !isDrawShapeTool(drawing.tool)) return;
      const end = pointFromResponderEvent(evt);
      drawRef.current = { active: false, start: null, end: null, points: [], tool: TOOL_SELECT };
      setDraftStart(null);
      const dx = Math.abs(end.x - drawing.start.x);
      const dy = Math.abs(end.y - drawing.start.y);
      if (Math.sqrt((dx * dx) + (dy * dy)) < 0.005) {
        setDraftShape(null);
        if (!whiteboardEnabled) setTool(TOOL_SELECT);
        return;
      }
      if (whiteboardEnabled) {
        appendWhiteboardStroke(drawing, end);
        setDraftShape(null);
        return;
      }
      if (drawing.tool === TOOL_DRAW) {
        const points = [...(drawing.points || [drawing.start]), end];
        // Keep the completed pencil preview visible while the stroke is saved
        // and refreshed, so it does not disappear for a few seconds.
        setDraftShape({ tool: TOOL_DRAW, start: drawing.start, end, points });
        await createFreehand(points);
        return;
      }
      setDraftShape(null);
      const saveEnd = drawing.tool === TOOL_CIRCLE ? circleEndFromDrag(drawing.start, end, canvasWidth, canvasHeight) : end;
      await createShape(drawing.start, saveEnd, shapeTypeForTool(drawing.tool));
    },
    onPanResponderTerminate: () => {
      drawRef.current = { active: false, start: null, end: null, points: [], tool: TOOL_SELECT };
      setDraftShape(null);
      setDraftStart(null);
    },
  }), [canEdit, canvasHeight, canvasWidth, createFreehand, createShape, page?.id, pointFromResponderEvent, tool, whiteboardEnabled, strokeColor, strokeWidth]);


  const annotationEditPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => Boolean(liveSelectedAnn?.id && editableAnnotationShape(liveSelectedAnn.shape_type)),
    onStartShouldSetPanResponderCapture: () => Boolean(liveSelectedAnn?.id && editableAnnotationShape(liveSelectedAnn.shape_type)),
    onMoveShouldSetPanResponder: () => Boolean(liveSelectedAnn?.id && editableAnnotationShape(liveSelectedAnn.shape_type)),
    onMoveShouldSetPanResponderCapture: () => Boolean(liveSelectedAnn?.id && editableAnnotationShape(liveSelectedAnn.shape_type)),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (evt) => {
      if (!liveSelectedAnn?.id) return;
      const mode = evt?.nativeEvent?.targetHandle || editRef.current.mode || 'move';
      editRef.current = {
        active: true,
        mode,
        startPoint: pointFromWindowEvent(evt),
        startAnn: { ...liveSelectedAnn },
        currentAnn: { ...liveSelectedAnn },
        startBox: annotationBounds(liveSelectedAnn),
      };
      gestureModeRef.current = 'edit-annotation';
    },
    onPanResponderMove: (evt) => {
      const edit = editRef.current;
      if (!edit.active || !edit.startAnn?.id || !edit.startPoint) return;
      const point = pointFromWindowEvent(evt);
      const shape = clean(edit.startAnn.shape_type).toLowerCase();
      let patch;
      if (edit.startAnn.__isFreehandGroup) {
        const dx = point.x - edit.startPoint.x;
        const dy = point.y - edit.startPoint.y;
        patch = { __freehandMove: { dx, dy } };
      } else if (shape === 'note' && isIconNote(edit.startAnn.note)) {
        const dx = point.x - edit.startPoint.x;
        const dy = point.y - edit.startPoint.y;
        const nextX = clampAnnCoord(Number(edit.startAnn.x1) + dx);
        const nextY = clampAnnCoord(Number(edit.startAnn.y1) + dy);
        patch = {
          x1: nextX,
          y1: nextY,
          x2: nextX,
          y2: nextY,
        };
      } else if (shape === 'note' && isCloudNote(edit.startAnn.note)) {
        const dx = point.x - edit.startPoint.x;
        const dy = point.y - edit.startPoint.y;
        patch = {
          x1: clampAnnCoord(Number(edit.startAnn.x1) + dx),
          y1: clampAnnCoord(Number(edit.startAnn.y1) + dy),
          x2: clampAnnCoord(Number(edit.startAnn.x2) + dx),
          y2: clampAnnCoord(Number(edit.startAnn.y2) + dy),
        };
      } else if (shape === 'line' || shape === 'arrow' || shape === 'measure' || shape === 'measure_line' || shape === 'draw') {
        if (edit.mode === 'start') {
          patch = { x1: point.x, y1: point.y };
        } else if (edit.mode === 'end') {
          patch = { x2: point.x, y2: point.y };
        } else {
          const dx = point.x - edit.startPoint.x;
          const dy = point.y - edit.startPoint.y;
          patch = {
            x1: clampAnnCoord(Number(edit.startAnn.x1) + dx),
            y1: clampAnnCoord(Number(edit.startAnn.y1) + dy),
            x2: clampAnnCoord(Number(edit.startAnn.x2) + dx),
            y2: clampAnnCoord(Number(edit.startAnn.y2) + dy),
          };
        }
      } else if (edit.mode === 'move') {
        const dx = point.x - edit.startPoint.x;
        const dy = point.y - edit.startPoint.y;
        patch = normalizeMovedBox(edit.startBox, dx, dy);
      } else {
        const isCircleShape = shape === 'ellipse' || shape === 'circle';
        patch = isCircleShape
          ? resizedCircleBoxFromHandle(edit.startBox, point, edit.mode, canvasWidth, canvasHeight)
          : resizedBoxFromHandle(edit.startBox, point, edit.mode);
      }
      const currentAnn = edit.startAnn.__isFreehandGroup
        ? movedFreehandGroupAnn(edit.startAnn, patch?.__freehandMove?.dx || 0, patch?.__freehandMove?.dy || 0)
        : { ...edit.startAnn, ...(edit.currentAnn || {}), ...patch };
      editRef.current = { ...edit, currentAnn };
      replaceAnnotationLocal(edit.startAnn.id, currentAnn.__isFreehandGroup ? { __segments: currentAnn.__segments } : patch);
    },
    onPanResponderRelease: async () => {
      const edit = editRef.current;
      editRef.current = { active: false, mode: null, startPoint: null, startAnn: null, currentAnn: null, startBox: null };
      gestureModeRef.current = 'idle';
      if (!edit.startAnn?.id) return;
      const latest = edit.currentAnn || annotations.find((ann) => String(ann.id) === String(edit.startAnn.id)) || selectedAnn || edit.startAnn;
      try {
        await persistAnnotation(latest);
      } catch (_err) {
        if (latest.__isFreehandGroup && Array.isArray(latest.__segments)) {
          for (const seg of latest.__segments) {
            if (!String(seg.id).startsWith('temp_')) {
              await queueOfflineOperation({ type: 'update_annotation', id: seg.id, page_id: page?.id, payload: annotationUpdatePayload(seg) });
            }
          }
        } else if (!String(latest.id).startsWith('temp_')) {
          await queueOfflineOperation({ type: 'update_annotation', id: latest.id, page_id: page?.id, payload: annotationUpdatePayload(latest) });
        }
      }
    },
    onPanResponderTerminate: async () => {
      const edit = editRef.current;
      editRef.current = { active: false, mode: null, startPoint: null, startAnn: null, currentAnn: null, startBox: null };
      gestureModeRef.current = 'idle';
      if (!edit.startAnn?.id) return;
      const latest = edit.currentAnn || annotations.find((ann) => String(ann.id) === String(edit.startAnn.id)) || selectedAnn || edit.startAnn;
      try {
        await persistAnnotation(latest);
      } catch (_err) {
        if (latest.__isFreehandGroup && Array.isArray(latest.__segments)) {
          for (const seg of latest.__segments) {
            if (!String(seg.id).startsWith('temp_')) {
              await queueOfflineOperation({ type: 'update_annotation', id: seg.id, page_id: page?.id, payload: annotationUpdatePayload(seg) });
            }
          }
        } else if (!String(latest.id).startsWith('temp_')) {
          await queueOfflineOperation({ type: 'update_annotation', id: latest.id, page_id: page?.id, payload: annotationUpdatePayload(latest) });
        }
      }
    },
  }), [annotations, canvasHeight, canvasWidth, liveSelectedAnn, page?.id, persistAnnotation, pointFromWindowEvent, queueOfflineOperation, reloadPageData, replaceAnnotationLocal, selectedAnn]);

  const persistPinPosition = useCallback(async (pin) => {
    if (!pin?.id) return;
    await updateMobileRedlinePin(portalUrl, token, pin.id, { x: pin.x, y: pin.y });
  }, [portalUrl, token]);


  const beginNotePinTouch = useCallback((pin, evt) => {
    if (!pin?.id) return;
    if (isPinPlacementTool(tool)) {
      handleCanvasToolPress(evt);
      return;
    }
    suppressNextCanvasToolPress();
    if (!canEdit || tool !== TOOL_SELECT) return;
    if (noteTouchRef.current.timer) clearTimeout(noteTouchRef.current.timer);
    const startPoint = pointFromWindowEvent(evt);
    const startAnn = pinKind(pin) === 'note' ? noteAnnotationForPin(pin, annotations) : null;
    noteTouchRef.current = {
      active: true,
      longPressed: false,
      moved: false,
      timer: null,
      pin,
      startPoint,
      startPagePoint: pagePointFromPressEvent(evt),
      startPin: pin,
      startAnn,
      currentPin: pin,
      currentAnn: startAnn,
    };
    noteTouchRef.current.timer = setTimeout(() => {
      const state = noteTouchRef.current;
      if (!state.active || String(state.startPin?.id) !== String(pin.id)) return;
      state.longPressed = true;
      noteLongPressRef.current = true;
      gestureModeRef.current = 'pin-drag';
      setSelectedPin(pin);
      setSelectedAnn(null);
      setPinEditor(null);
      setNoteEditor(null);
    }, REDLINE_PIN_DRAG_HOLD_MS);
  }, [annotations, canEdit, handleCanvasToolPress, pointFromWindowEvent, tool]);

  const moveNotePinTouch = useCallback((evt) => {
    suppressNextCanvasToolPress();
    const state = noteTouchRef.current;
    if (!state.active || !state.startPoint || !state.startPin?.id) return;
    const point = pointFromWindowEvent(evt);
    const dx = point.x - state.startPoint.x;
    const dy = point.y - state.startPoint.y;
    const movedEnough = pagePointMoved(state.startPagePoint, pagePointFromPressEvent(evt), REDLINE_PIN_DRAG_CANCEL_SLOP_PX) || Math.sqrt((dx * dx) + (dy * dy)) > 0.006;
    if (!state.longPressed) {
      if (movedEnough) {
        // Do not cancel the long-press timer here. A finger often shifts slightly
        // while the user is holding a pin; cancelling the timer made the hold feel
        // closer to 1.5 seconds or prevented drag mode from starting at all.
        noteTouchRef.current = { ...state, moved: true };
      }
      return;
    }
    state.moved = true;
    const nextPin = {
      ...state.startPin,
      x: clamp01(Number(state.startPin.x) + dx),
      y: clamp01(Number(state.startPin.y) + dy),
    };
    let nextAnn = state.startAnn;
    if (state.startAnn?.id) {
      nextAnn = {
        ...state.startAnn,
        x1: nextPin.x,
        y1: nextPin.y,
        x2: nextPin.x,
        y2: nextPin.y,
      };
      replaceAnnotationLocal(state.startAnn.id, { x1: nextPin.x, y1: nextPin.y, x2: nextPin.x, y2: nextPin.y });
    }
    noteTouchRef.current = { ...state, currentPin: nextPin, currentAnn: nextAnn };
    replacePinLocal(state.startPin.id, { x: nextPin.x, y: nextPin.y });
  }, [pointFromWindowEvent, replaceAnnotationLocal, replacePinLocal]);

  const finishNotePinTouch = useCallback(async () => {
    suppressNextCanvasToolPress();
    const state = noteTouchRef.current;
    if (state.timer) clearTimeout(state.timer);
    noteTouchRef.current = { active: false, longPressed: false, moved: false, timer: null, pin: null, startPoint: null, startPagePoint: null, startPin: null, startAnn: null, currentPin: null, currentAnn: null };
    gestureModeRef.current = 'idle';
    if (!state.active || !state.startPin?.id) return;
    if (state.longPressed && state.moved && state.currentPin?.id) {
      try {
        await persistPinPosition(state.currentPin);
        if (state.currentAnn?.id) await updateMobileRedlineAnnotation(portalUrl, token, state.currentAnn.id, annotationUpdatePayload(state.currentAnn));
        await reloadPageData();
      } catch (err) {
        Alert.alert('Move Pin Failed', err?.message || 'Unable to save pin position.');
        await reloadPageData();
      }
      return;
    }
    if (state.longPressed || state.moved) return;
    openPin(state.startPin);
  }, [persistPinPosition, portalUrl, reloadPageData, token]);

  const cancelNotePinTouch = useCallback(() => {
    suppressNextCanvasToolPress();
    const state = noteTouchRef.current;
    if (state.timer) clearTimeout(state.timer);
    noteTouchRef.current = { active: false, longPressed: false, moved: false, timer: null, pin: null, startPoint: null, startPagePoint: null, startPin: null, startAnn: null, currentPin: null, currentAnn: null };
    gestureModeRef.current = 'idle';
  }, []);

  const notePinDragPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => selectedPin?.id && canEdit,
    onMoveShouldSetPanResponder: (_evt, gestureState) => selectedPin?.id && canEdit && (Math.abs(gestureState.dx) > 2 || Math.abs(gestureState.dy) > 2),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (evt) => {
      if (!selectedPin?.id) return;
      gestureModeRef.current = 'pin-drag';
      const startAnn = pinKind(selectedPin) === 'note' ? noteAnnotationForPin(selectedPin, annotations) : null;
      pinDragRef.current = {
        active: true,
        startPoint: pointFromWindowEvent(evt),
        startPin: selectedPin,
        currentPin: selectedPin,
        startAnn,
        currentAnn: startAnn,
      };
    },
    onPanResponderMove: (evt) => {
      const edit = pinDragRef.current;
      if (!edit.active || !edit.startPoint || !edit.startPin?.id) return;
      const point = pointFromWindowEvent(evt);
      const dx = point.x - edit.startPoint.x;
      const dy = point.y - edit.startPoint.y;
      const nextPin = {
        ...edit.startPin,
        x: clamp01(Number(edit.startPin.x) + dx),
        y: clamp01(Number(edit.startPin.y) + dy),
      };
      let nextAnn = edit.currentAnn;
      if (edit.startAnn?.id) {
        nextAnn = {
          ...edit.startAnn,
          x1: nextPin.x,
          y1: nextPin.y,
          x2: nextPin.x,
          y2: nextPin.y,
        };
        replaceAnnotationLocal(edit.startAnn.id, { x1: nextPin.x, y1: nextPin.y, x2: nextPin.x, y2: nextPin.y });
      }
      pinDragRef.current = { ...edit, currentPin: nextPin, currentAnn: nextAnn };
      replacePinLocal(edit.startPin.id, { x: nextPin.x, y: nextPin.y });
    },
    onPanResponderRelease: async () => {
      const edit = pinDragRef.current;
      pinDragRef.current = { active: false, startPoint: null, startPin: null, currentPin: null, startAnn: null, currentAnn: null };
      gestureModeRef.current = 'idle';
      const latest = edit.currentPin;
      const latestAnn = edit.currentAnn;
      if (!latest?.id) return;
      try {
        await persistPinPosition(latest);
        if (latestAnn?.id) await updateMobileRedlineAnnotation(portalUrl, token, latestAnn.id, annotationUpdatePayload(latestAnn));
        await reloadPageData();
      } catch (err) {
        Alert.alert('Move Pin Failed', err?.message || 'Unable to save pin position.');
        await reloadPageData();
      }
    },
    onPanResponderTerminate: async () => {
      const edit = pinDragRef.current;
      pinDragRef.current = { active: false, startPoint: null, startPin: null, currentPin: null, startAnn: null, currentAnn: null };
      gestureModeRef.current = 'idle';
      const latest = edit.currentPin;
      const latestAnn = edit.currentAnn;
      if (!latest?.id) return;
      try {
        await persistPinPosition(latest);
        if (latestAnn?.id) await updateMobileRedlineAnnotation(portalUrl, token, latestAnn.id, annotationUpdatePayload(latestAnn));
        await reloadPageData();
      } catch (_err) {
        await reloadPageData();
      }
    },
  }), [annotations, canEdit, persistPinPosition, pointFromWindowEvent, portalUrl, reloadPageData, replaceAnnotationLocal, replacePinLocal, selectedPin, token]);

  function isTouchOnSelectedNotePin(evt) {
    if (!selectedPin?.id) return false;
    const native = evt?.nativeEvent || {};
    const touches = native.touches || [];
    const touch = touches[0] || native;
    const pageX = Number(touch.pageX ?? native.pageX);
    const pageY = Number(touch.pageY ?? native.pageY);
    if (!Number.isFinite(pageX) || !Number.isFinite(pageY)) return false;
    const viewport = viewportRef.current;
    const centerX = viewport.pageX + panOffsetRef.current.x + (clamp01(selectedPin.x) * canvasWidth);
    const centerY = viewport.pageY + panOffsetRef.current.y + (clamp01(selectedPin.y) * canvasHeight);
    const radius = Math.max(30, 18 * Math.min(1.35, Math.max(1, zoomScaleRef.current)));
    return Math.abs(pageX - centerX) <= radius && Math.abs(pageY - centerY) <= radius;
  }



  function isTouchOnAnyNotePin(evt) {
    const native = evt?.nativeEvent || {};
    const touches = native.touches || [];
    const touch = touches[0] || native;
    const pageX = Number(touch.pageX ?? native.pageX);
    const pageY = Number(touch.pageY ?? native.pageY);
    if (!Number.isFinite(pageX) || !Number.isFinite(pageY)) return false;
    const viewport = viewportRef.current;
    const radius = Math.max(30, 18 * Math.min(1.35, Math.max(1, zoomScaleRef.current)));
    return (visiblePins || []).some((pin) => {
      const centerX = viewport.pageX + panOffsetRef.current.x + (clamp01(pin.x) * canvasWidth);
      const centerY = viewport.pageY + panOffsetRef.current.y + (clamp01(pin.y) * canvasHeight);
      return Math.abs(pageX - centerX) <= radius && Math.abs(pageY - centerY) <= radius;
    });
  }

  function isTouchOnSelectedAnnotationEditArea(evt) {
    const ann = liveSelectedAnn;
    if (!ann?.id || !editableAnnotationShape(ann.shape_type)) return false;
    const native = evt?.nativeEvent || {};
    const touches = native.touches || [];
    const touch = touches[0] || native;
    const pageX = Number(touch.pageX ?? native.pageX);
    const pageY = Number(touch.pageY ?? native.pageY);
    if (!Number.isFinite(pageX) || !Number.isFinite(pageY)) return false;
    const viewport = viewportRef.current;
    const px = pageX - viewport.pageX - panOffsetRef.current.x;
    const py = pageY - viewport.pageY - panOffsetRef.current.y;
    const shape = clean(ann.shape_type).toLowerCase();
    if (shape === 'note' && isIconNote(ann.note)) {
      const baseIcon = iconLayoutMetrics(annotationStrokeWidth(ann.stroke_width, 1));
      const hitSize = Math.max(48, baseIcon.hitSize * zoomScaleRef.current);
      const cx = clamp01(ann.x1) * canvasWidth;
      const cy = clamp01(ann.y1) * canvasHeight;
      return Math.abs(px - cx) <= hitSize / 2 && Math.abs(py - cy) <= hitSize / 2;
    }
    if (shape === 'note' && isCloudNote(ann.note)) {
      const box = cloudAnnotationPixelBox(ann, canvasWidth, canvasHeight, zoomScaleRef.current);
      return px >= box.left && px <= box.left + box.width && py >= box.top && py <= box.top + box.height;
    }
    const b = annotationBounds(ann);
    const pad = Math.max(28, 18 * zoomScaleRef.current);
    const left = (b.left * canvasWidth) - pad;
    const top = (b.top * canvasHeight) - pad;
    const right = ((b.left + b.width) * canvasWidth) + pad;
    const bottom = ((b.top + b.height) * canvasHeight) + pad;
    return px >= left && px <= right && py >= top && py <= bottom;
  }

  async function selectPage(item) {
    const pageId = pageIdValue(item);
    if (!pageId) return;
    userSelectedPageIdRef.current = String(pageId);
    initialSnapshotAppliedRef.current = true;
    initialViewportConsumedRef.current = true;

    // Page changes are user-driven and must win over any in-flight initial
    // document refresh.  Without cancelling that older refresh, the live load
    // can finish after the user picks page 2/3/etc. and overwrite the payload
    // back to page 1, which looks like a flicker followed by staying on page 1.
    const pageRequestSeq = loadRequestSeqRef.current + 1;
    loadRequestSeqRef.current = pageRequestSeq;
    const isLatestPageRequest = () => pageRequestSeq === loadRequestSeqRef.current;

    const cacheKey = redlinePageDataCacheKey(portalUrl, selectedSiteId, selectedSiteName, currentSitewalk, pageId);
    let showedCached = false;

    try {
      const cached = await readJsonFromStorage(cacheKey);
      if (cached) {
        showedCached = true;
        let cachedPage = { ...(item || {}), ...(cached.page || {}) };
        const cachedLocalImage = clean(cachedPage.cached_image_uri) || clean(await AsyncStorage.getItem(redlineImagePageIndexKey(portalUrl, selectedSiteId, selectedSiteName, currentSitewalk, pageId)));
        if (cachedLocalImage) cachedPage = { ...cachedPage, cached_image_uri: cachedLocalImage };
        if (!isLatestPageRequest()) return;
        setPayload((prev) => ({ ...(prev || {}), ...cached, page: cachedPage }));
        cachePageImage(cachedPage, currentSitewalk).catch(() => {});
        resetZoomAndPan();
      } else {
        const pageOnly = { ...(item || {}) };
        if (!isLatestPageRequest()) return;
        setPayload((prev) => ({ ...(prev || {}), page: pageOnly, pins: [], annotations: [] }));
        cachePageImage(pageOnly, currentSitewalk).catch(() => {});
        resetZoomAndPan();
      }

      if (!token) {
        if (!showedCached) setError('Offline mode: this page has not been saved on this device yet.');
        return;
      }

      if (!isLatestPageRequest()) return;
      setLoading(!showedCached);
      const pageData = await loadMobileSiteWalkRedlinesPageData(portalUrl, token, pageId);
      if (!isLatestPageRequest()) return;
      const mergedPageBase = { ...(item || {}), ...(pageData?.page || {}) };
      const cachedLocalImage = await cachePageImage(mergedPageBase, currentSitewalk);
      if (!isLatestPageRequest()) return;
      const mergedPage = cachedLocalImage ? { ...mergedPageBase, cached_image_uri: cachedLocalImage } : mergedPageBase;
      const nextData = { ...(pageData || {}), page: mergedPage };
      await writeJsonToStorage(cacheKey, nextData);
      if (!isLatestPageRequest()) return;
      setPayload((prev) => {
        const previous = prev || {};
        if (userSelectedPageIdRef.current && String(userSelectedPageIdRef.current) !== String(pageId)) return previous;
        return {
          ...previous,
          ...nextData,
          selected_sitewalk_desc: previous.selected_sitewalk_desc || currentSitewalk,
          sitewalks: Array.isArray(previous.sitewalks) ? previous.sitewalks : [],
          pages: Array.isArray(previous.pages) ? previous.pages : [],
        };
      });
      setError('');
    } catch (err) {
      if (showedCached) {
        setError('Offline mode: showing the saved copy on this device. New changes will sync when service returns.');
      } else {
        const cached = await readJsonFromStorage(cacheKey);
        if (cached) {
          let cachedPage = { ...(item || {}), ...(cached.page || {}) };
          const cachedLocalImage = clean(cachedPage.cached_image_uri) || clean(await AsyncStorage.getItem(redlineImagePageIndexKey(portalUrl, selectedSiteId, selectedSiteName, currentSitewalk, pageId)));
          if (cachedLocalImage) cachedPage = { ...cachedPage, cached_image_uri: cachedLocalImage };
          if (!isLatestPageRequest()) return;
          setPayload((prev) => ({ ...(prev || {}), ...cached, page: cachedPage }));
          cachePageImage(cachedPage, currentSitewalk).catch(() => {});
          setError('Offline mode: showing the saved copy on this device.');
          resetZoomAndPan();
        } else {
          setError('Offline mode: this page has not finished saving on this device yet. Keep this PDF open with service for a bit so the app can finish caching every page.');
        }
      }
    } finally {
      if (isLatestPageRequest()) setLoading(false);
    }
  }


  function selectPageByIndex(index) {
    if (!pages.length) return;
    const safeIndex = Math.max(0, Math.min(pages.length - 1, index));
    const next = pages[safeIndex];
    if (next) selectPage(next);
  }

  function showGoPage() {
    setGoPageText(currentPageNumber ? String(currentPageNumber) : '');
    setGoPageVisible(true);
  }

  function submitGoPage() {
    const requested = Number.parseInt(String(goPageText || '').trim(), 10);
    if (!Number.isFinite(requested) || requested < 1 || requested > pageCount) {
      Alert.alert('Go to Page', `Enter a page number from 1 to ${pageCount || 1}.`);
      return;
    }
    setGoPageVisible(false);
    selectPageByIndex(requested - 1);
  }

  function openWhiteboardMode() {
    setPhotoOptionsPin(null);
    setSelectedPin(null);
    setSelectedAnn(null);
    setDraftStart(null);
    setDraftShape(null);
    resetPolylineDraft();
    setWhiteboardEnabled(true);
    setTool(TOOL_SELECT);
  }

  function disableWhiteboardMode() {
    setWhiteboardEnabled(false);
    setWhiteboardStrokes([]);
    setDraftStart(null);
    setDraftShape(null);
    drawRef.current = { active: false, start: null, end: null, points: [], tool: TOOL_SELECT };
    setTool(TOOL_SELECT);
  }

  function clearWhiteboardBoard() {
    setWhiteboardStrokes([]);
    setDraftStart(null);
    setDraftShape(null);
    drawRef.current = { active: false, start: null, end: null, points: [], tool: TOOL_SELECT };
  }

  function appendWhiteboardStroke(drawing, endPoint) {
    if (!drawing?.start || !isDrawShapeTool(drawing.tool)) return;
    const saveEnd = drawing.tool === TOOL_CIRCLE ? circleEndFromDrag(drawing.start, endPoint, canvasWidth, canvasHeight) : endPoint;
    const nextStroke = {
      id: `wb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tool: drawing.tool,
      start: drawing.start,
      end: saveEnd,
      points: drawing.tool === TOOL_DRAW ? [...(drawing.points || [drawing.start]), endPoint] : undefined,
      color: strokeColor || '#3b82f6',
      width: Math.max(1, Number(strokeWidth) || 2),
    };
    setWhiteboardStrokes((prev) => [...prev, nextStroke]);
  }

  function renderWhiteboardStroke(item) {
    if (!item) return null;
    const color = item.color || '#3b82f6';
    const width = Math.max(1, Number(item.width) || 2);
    if (item.tool === TOOL_DRAW) {
      const points = Array.isArray(item.points) ? item.points : [];
      return renderFreehandStroke(points, canvasWidth, canvasHeight, color, width, `wb-freehand-${item.id}`);
    }
    if (isLineLikeTool(item.tool)) {
      const start = item.start;
      const end = item.end;
      if (!start || !end) return null;
      const x1 = start.x * canvasWidth;
      const y1 = start.y * canvasHeight;
      const x2 = end.x * canvasWidth;
      const y2 = end.y * canvasHeight;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.max(1, Math.sqrt((dx * dx) + (dy * dy)));
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      const hitHeight = Math.max(24, width + 18);
      const arrowHead = arrowHeadMetrics(width);
      const arrowBackoff = item.tool === TOOL_ARROW ? Math.max(arrowHead.length * 0.62, 4.5) : 0;
      const lineDrawWidth = Math.max(1, len - arrowBackoff);
      return (
        <View key={`wb-line-${item.id}`} pointerEvents="none" style={[styles.lineHit, { left: ((x1 + x2) / 2) - (len / 2), top: ((y1 + y2) / 2) - (hitHeight / 2), width: len, height: hitHeight, transform: [{ rotateZ: `${angle}deg` }] }]}>
          <View style={[styles.lineShape, { left: 0, top: (hitHeight - width) / 2, width: lineDrawWidth, height: width, backgroundColor: color }]} />
          {item.tool === TOOL_ARROW ? renderArrowHead(width, hitHeight / 2, `whiteboard-arrow-head-${item.id}`) : null}
        </View>
      );
    }
    const start = item.start;
    const end = item.end;
    if (!start || !end) return null;
    const left = Math.min(start.x, end.x) * 100;
    const top = Math.min(start.y, end.y) * 100;
    const widthPct = Math.max(Math.abs(end.x - start.x) * 100, 0.6);
    const heightPct = Math.max(Math.abs(end.y - start.y) * 100, 0.6);
    return (
      <View
        key={`wb-shape-${item.id}`}
        pointerEvents="none"
        style={[styles.whiteboardShape, { left: `${left}%`, top: `${top}%`, width: `${widthPct}%`, height: `${heightPct}%`, borderColor: color, borderWidth: width, borderRadius: item.tool === TOOL_CIRCLE ? 999 : 2 }]}
      />
    );
  }

  function renderWhiteboardBadge() {
    if (!whiteboardEnabled) return null;
    return (
      <View pointerEvents="box-none" style={styles.whiteboardBadgeWrap}>
        <View style={styles.whiteboardBadge}>
          <Pressable style={styles.whiteboardBadgeBtn} onPress={clearWhiteboardBoard}><Text style={styles.whiteboardBadgeBtnText}>{t("Clear board")}</Text></Pressable>
          <View style={styles.whiteboardDot} />
          <Text style={styles.whiteboardBadgeLabel}>{t("Whiteboard mode")}</Text>
          <Pressable style={styles.whiteboardBadgeBtn} onPress={disableWhiteboardMode}><Text style={styles.whiteboardBadgeBtnText}>{t("Disable")}</Text></Pressable>
        </View>
      </View>
    );
  }

  async function savePinEditor() {
    if (!pinEditor) return;
    const labelToSave = clean(pinEditor.label);
    const tagToSave = clean(pinEditor.tag).toLowerCase();
    const validTags = new Set(CATEGORY_FILTERS.filter((item) => item.key !== 'all').map((item) => item.key));
    if (!labelToSave) {
      Alert.alert('Pin Name Required', 'Please enter a pin name before saving.');
      return;
    }
    if (!validTags.has(tagToSave)) {
      Alert.alert('Tag Required', 'Please select one of the tags before saving.');
      return;
    }

    const payloadToSave = {
      x: pinEditor.x,
      y: pinEditor.y,
      label: labelToSave,
      tag: tagToSave,
      pin_type: pinEditor.pin_type || 'photo',
      sr_location: pinEditor.sr_location || '',
      sr_task: pinEditor.sr_task || '',
      sr_design_count: pinEditor.sr_design_count,
      is_expected_360_photo: Boolean(pinEditor.is_expected_360_photo),
    };

    if (pinEditor.__draft) {
      if (!canEdit || !page?.id) return;
      const pinPayload = {
        page_id: page.id,
        ...payloadToSave,
      };
      setPinEditor(null);
      try {
        const response = await createMobileRedlinePin(portalUrl, token, pinPayload);
        await reloadPageData();
        const createdPin = response?.item || null;
        if (createdPin) setSelectedPin(createdPin);
      } catch (_err) {
        const tempId = `temp_pin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const optimisticPin = {
          ...pinPayload,
          id: tempId,
          __offline_pending: true,
          __offline_created_at: new Date().toISOString(),
        };
        appendPinLocal(optimisticPin);
        setSelectedPin(optimisticPin);
        await queueOfflineOperation({ type: 'create_pin', temp_id: tempId, page_id: page.id, payload: pinPayload, pin: optimisticPin });
      }
      return;
    }

    if (!pinEditor?.id) return;
    replacePinLocal(pinEditor.id, { ...payloadToSave, __offline_pending: isTempRedlineId(pinEditor.id) ? true : pinEditor.__offline_pending });
    setPinEditor(null);

    if (isTempRedlineId(pinEditor.id)) {
      await updateQueuedPinCreateLocal(pinEditor.id, payloadToSave);
      return;
    }

    try {
      await updateMobileRedlinePin(portalUrl, token, pinEditor.id, payloadToSave);
      await reloadPageData();
    } catch (err) {
      await queueOfflineOperation({ type: 'update_pin', pin_id: pinEditor.id, page_id: page?.id, payload: payloadToSave });
    }
  }

  async function saveNoteEditor() {
    const text = String(noteEditorTextRef.current ?? noteEditor?.text ?? '').trim();
    const pin = noteEditor?.pin || null;
    if (!pin?.id) {
      const point = noteEditor?.point || null;
      if (!text) {
        Alert.alert(t("Note"), t("Enter note text first."));
        return;
      }
      if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
        Alert.alert(t("Note"), t("Tap the page where you want to place this note first."));
        setNoteEditor(null);
        setTool(TOOL_NOTE);
        return;
      }
      setNoteEditor(null);
      await createNoteAt(point, text);
      return;
    }

    const existingAnn = noteAnnotationForPin(pin, annotations);
    try {
      // Keep the edited value on-screen immediately.  The mobile page-data refresh
      // can briefly return the older cached annotation, so the note pin carries a
      // local-only backup until the next full page pull confirms the server value.
      patchNotePinTextLocal(pin.id, text);

      if (existingAnn?.id) {
        replaceAnnotationLocal(existingAnn.id, { note: text });
        await updateMobileRedlineAnnotation(portalUrl, token, existingAnn.id, annotationUpdatePayload(existingAnn, { note: text }));
      } else if (text) {
        const annPayload = {
          page_id: page.id,
          shape_type: 'note',
          x1: clamp01(pin.x),
          y1: clamp01(pin.y),
          x2: clamp01(pin.x),
          y2: clamp01(pin.y),
          stroke_color: '#4b5cf0',
          stroke_width: 2,
          note: text,
          layer: 'primary',
          note_pin_id: pin.id,
          pin_id: pin.id,
          linked_pin_id: pin.id,
        };
        const response = await createMobileRedlineAnnotation(portalUrl, token, annPayload);
        upsertNoteAnnotationLocal(pin, text, response?.item?.id || response?.id || `note_${pin.id}_${Date.now()}`);
      }

      setNoteEditor(null);
      const patchedPin = { ...pin, __mobile_note_text: text, note: text, note_text: text, text };
      patchNotePinTextLocal(pin.id, text);
      upsertNoteAnnotationLocal(patchedPin, text, existingAnn?.id || null);
      setSelectedPin(patchedPin);
      setTimeout(() => reloadPageData().then(() => {
        patchNotePinTextLocal(pin.id, text);
        upsertNoteAnnotationLocal(patchedPin, text, existingAnn?.id || null);
        setSelectedPin(patchedPin);
      }).catch(() => {}), 700);
    } catch (_err) {
      patchNotePinTextLocal(pin.id, text);
      if (existingAnn?.id) {
        replaceAnnotationLocal(existingAnn.id, { note: text });
        if (isTempRedlineId(existingAnn.id)) {
          await updateQueuedAnnotationCreateLocal(existingAnn.id, { note: text });
        } else {
          await queueOfflineOperation({ type: 'update_annotation', id: existingAnn.id, page_id: page?.id, payload: annotationUpdatePayload(existingAnn, { note: text }) });
        }
      } else if (text) {
        const tempAnnId = `temp_note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const annPayload = {
          page_id: page.id,
          shape_type: 'note',
          x1: clamp01(pin.x),
          y1: clamp01(pin.y),
          x2: clamp01(pin.x),
          y2: clamp01(pin.y),
          stroke_color: '#4b5cf0',
          stroke_width: 2,
          note: text,
          layer: 'primary',
          note_pin_id: pin.id,
          pin_id: pin.id,
          linked_pin_id: pin.id,
        };
        upsertNoteAnnotationLocal(pin, text, tempAnnId);
        await queueOfflineOperation({ type: 'create_annotation', temp_id: tempAnnId, page_id: page?.id, payload: annPayload });
      }
      setNoteEditor(null);
    }
  }

  async function deleteNotePin(pin = noteEditor?.pin || selectedPin) {
    if (!pin?.id) {
      setNoteEditor(null);
      setPendingNoteText('');
      if (tool === TOOL_NOTE) setTool(TOOL_SELECT);
      return;
    }
    const existingAnn = noteAnnotationForPin(pin, annotations);
    try {
      if (existingAnn?.id) {
        removeAnnotationsLocal(existingAnn.id);
        await deleteMobileRedlineAnnotation(portalUrl, token, existingAnn.id);
      }
      removePinLocal(pin.id);
      await deleteMobileRedlinePin(portalUrl, token, pin.id);
      setNoteEditor(null);
      await reloadPageData();
    } catch (err) {
      Alert.alert('Delete Note Failed', err?.message || 'Unable to delete note.');
      await reloadPageData();
    }
  }

  async function deleteSelected() {
    // Subcontractor editor: pins are not deletable from mobile. The trash button
    // only removes drawn annotations that the subcontractor is allowed to edit.
    if (selectedPin?.id) {
      setSelectedPin(null);
      return;
    }
    if (!selectedAnn?.id) return;
    const ids = selectedAnn.__isFreehandGroup && Array.isArray(selectedAnn.__groupIds) ? selectedAnn.__groupIds : [selectedAnn.id];
    removeAnnotationsLocal(ids);
    setSelectedAnn(null);
    const serverIds = await removeQueuedCreatesForIds(ids);
    if (!serverIds.length) return;
    const releaseMutation = beginAnnotationMutation();
    try {
      await Promise.all(serverIds.map((id) => deleteMobileRedlineAnnotation(portalUrl, token, id)));
      await syncOfflineQueue();
    } catch (_err) {
      await queueOfflineOperation({ type: 'delete_annotations', ids: serverIds, page_id: page?.id });
    } finally {
      releaseMutation();
    }
  }

  function pinHasAnyLinkedPhoto(pin) {
    // For camera_misc pins, only treat the pin as openable when it has a
    // concrete linked photo id or URL. A broad photo_query/photo_count can route
    // into the full site-photo list and may show the wrong project's image.
    const hasDirectPhoto = Boolean(pin?.photo_url || pin?.thumb_url || pin?.photo_id || pin?.photoId);
    if (pinKind(pin) === 'camera_misc') return hasDirectPhoto;
    return Boolean(hasDirectPhoto || Number(pin?.photo_count || 0) > 0 || pin?.navigation?.photo_query);
  }

  async function cleanupEmptyCameraPin(pin) {
    if (!pin?.id || pinKind(pin) !== 'camera_misc' || pinHasAnyLinkedPhoto(pin)) return;
    try {
      removePinLocal(pin.id);
      await deleteMobileRedlinePin(portalUrl, token, pin.id);
      await reloadPageData();
    } catch (_err) {
      await reloadPageData();
    }
  }

  function closeCameraPhotoPrompt(pin = cameraPhotoPin) {
    setCameraPhotoPin(null);
    cleanupEmptyCameraPin(pin);
  }

  function openPin(pin) {
    suppressNextCanvasToolPress();
    setSelectedPin(pin);
    setSelectedAnn(null);
    if (tool !== TOOL_SELECT) {
      setTool(TOOL_SELECT);
      return;
    }
    const kind = pinKind(pin);
    if (kind === 'note') {
      openNoteEditorForPin(pin);
      return;
    }
    if (kind === 'camera_misc') {
      if (pinHasAnyLinkedPhoto(pin)) {
        viewPhotoPin(pin);
        return;
      }
      setCameraPhotoPin(pin);
      return;
    }
    if (kind === 'photo' || kind === 'photo360') {
      setPhotoOptionsPin(pin);
      return;
    }
    setPinEditor(pin);
  }


  function imageAssetToUploadFile(asset) {
    if (!asset?.uri) return null;
    const uri = asset.uri;
    const filename = clean(asset.fileName) || uri.split('/').pop() || `redline-photo-${Date.now()}.jpg`;
    const ext = (filename.split('.').pop() || 'jpg').toLowerCase();
    const type = asset.mimeType || asset.type || (ext === 'png' ? 'image/png' : ext === 'heic' ? 'image/heic' : 'image/jpeg');
    return { uri, name: filename, type };
  }

  function queueCameraPhotoForPin(pin, source = 'camera', appendMode = false) {
    if (!pin?.id) return;
    setPendingPhotoPicker({ pin, source, appendMode, requestedAt: Date.now() });
    setCameraPhotoPin(null);
    setPhotoOptionsPin(null);
  }

  async function queueLocalPhotoUploadForPin(pin, asset, source = 'camera', appendMode = false) {
    const localPhoto = await copyImageAssetToOfflineFile(asset, {
      portalUrl,
      selectedSiteId,
      selectedSiteName,
      pageId: page?.id,
      pinId: pin?.id,
    });
    const displayName = pinDisplayLabel(pin) || (pinKind(pin) === 'camera_misc' ? 'Redline Photo' : 'Pin Photo');
    replacePinLocal(pin.id, {
      __offline_photo_pending: Number(pin.__offline_photo_pending || 0) + 1,
      __offline_local_photo_uri: localPhoto.uri,
      __offline_previous_photo_id: pin.photo_id || pin.photoId || null,
      __offline_previous_photo_url: pin.photo_url || pin.public_url || '',
      __offline_previous_thumb_url: pin.thumb_url || pin.thumbnail_url || '',
      photo_id: `offline_${pin.id}_${localPhoto.localId}`,
      photoId: `offline_${pin.id}_${localPhoto.localId}`,
      photo_url: localPhoto.uri,
      public_url: localPhoto.uri,
      full_url: localPhoto.uri,
      thumb_url: localPhoto.uri,
      thumbnail_url: localPhoto.uri,
      photo_name: displayName,
      site_id: selectedSiteId || pin.site_id,
      photo_count: Math.max(1, Number(pin.photo_count || 0) || 0),
    });
    await queueOfflineOperation({
      type: 'upload_pin_photo',
      pin_id: pin.id,
      page_id: page?.id,
      site_id: selectedSiteId,
      name: displayName,
      tag: pin.tag || '',
      sitewalk_desc: currentSitewalk,
      append_mode: appendMode,
      source,
      local_uri: localPhoto.uri,
      local_file_name: fileNameFromUri(localPhoto.uri),
      file_name: localPhoto.name,
      file_type: localPhoto.type,
    });
    setSelectedPin((prev) => (prev && String(prev.id) === String(pin.id) ? {
      ...prev,
      __offline_photo_pending: Number(prev.__offline_photo_pending || 0) + 1,
      __offline_local_photo_uri: localPhoto.uri,
      __offline_previous_photo_id: prev.photo_id || prev.photoId || null,
      __offline_previous_photo_url: prev.photo_url || prev.public_url || '',
      __offline_previous_thumb_url: prev.thumb_url || prev.thumbnail_url || '',
      photo_id: `offline_${pin.id}_${localPhoto.localId}`,
      photoId: `offline_${pin.id}_${localPhoto.localId}`,
      photo_url: localPhoto.uri,
      public_url: localPhoto.uri,
      full_url: localPhoto.uri,
      thumb_url: localPhoto.uri,
      thumbnail_url: localPhoto.uri,
      photo_name: displayName,
      site_id: selectedSiteId || prev.site_id,
      photo_count: Math.max(1, Number(prev.photo_count || 0) || 0),
    } : prev));
    return localPhoto;
  }

  async function pickCameraPhotoForPin(pin, source = 'camera', appendMode = false) {
    if (!pin?.id) return;
    const modalPinId = pin.id;
    const isCameraSource = source === 'camera';

    // Close the redline prompt before opening the native camera/photo picker.
    // On some Android/iOS builds the native picker will not appear reliably
    // while our transparent React Native modal is still mounted.
    setCameraPhotoPin(null);
    setPhotoOptionsPin(null);
    await pauseForNativePicker();

    try {
      if (isCameraSource) {
        const hasCameraPermission = await ensureCameraPermission();
        if (!hasCameraPermission) return;
      } else {
        const hasLibraryPermission = await ensureMediaLibraryPermission();
        if (!hasLibraryPermission) return;
      }

      const result = await launchImagePickerForSource(isCameraSource ? 'camera' : 'library', { quality: 0.78 });

      if (result?.canceled || !result?.assets?.length) return;

      const asset = result.assets[0];
      const file = imageAssetToUploadFile(asset);
      if (!file) {
        Alert.alert(t("Photo Save Failed"), t("The selected image did not include a usable file path."));
        return;
      }

      if (isTempRedlineId(modalPinId)) {
        await queueLocalPhotoUploadForPin(pin, asset, source, appendMode);
        setError('Saved on this device. The photo will sync when service is available.');
        return;
      }

      try {
        const upload = await uploadMobileRedlinePinPhoto(portalUrl, token, modalPinId, {
          siteId: selectedSiteId,
          name: pinDisplayLabel(pin) || (pinKind(pin) === 'camera_misc' ? 'Redline Photo' : 'Pin Photo'),
          tag: pin.tag || '',
          sitewalkDesc: currentSitewalk,
          note: '',
          appendMode,
          file,
        });
        const serverPin = upload?.pin?.id ? upload.pin : null;
        const uploadedPin = serverPin
          ? {
              ...pin,
              ...serverPin,
              photo_id: serverPin.photo_id || upload?.photo_id || pin.photo_id,
              photo_url: serverPin.photo_url || upload?.photo_url || pin.photo_url,
              thumb_url: serverPin.thumb_url || upload?.thumb_url || pin.thumb_url,
              photo_name: serverPin.photo_name || upload?.name || pin.photo_name,
              site_id: serverPin.site_id || selectedSiteId || pin.site_id,
              photo_count: Math.max(1, Number(serverPin.photo_count || pin.photo_count || 0) || 0),
              __offline_photo_pending: 0,
              __offline_local_photo_uri: '',
            }
          : {
              ...pin,
              photo_id: upload?.photo_id || pin.photo_id,
              photo_url: upload?.photo_url || pin.photo_url,
              thumb_url: upload?.thumb_url || pin.thumb_url,
              photo_name: upload?.name || pin.photo_name,
              site_id: selectedSiteId || pin.site_id,
              photo_count: Math.max(1, Number(pin.photo_count || 0) || 0),
              __offline_photo_pending: 0,
              __offline_local_photo_uri: '',
            };
        if (uploadedPin?.id) {
          replacePinLocal(uploadedPin.id, uploadedPin);
          setSelectedPin(uploadedPin);
        }
        await reloadPageData();
        if (pinKind(pin) === 'camera_misc' && uploadedPin?.id) {
          viewPhotoPin(uploadedPin);
        }
      } catch (_uploadErr) {
        await queueLocalPhotoUploadForPin(pin, asset, source, appendMode);
        setError('Saved on this device. The photo will sync when service is available.');
      }
    } catch (err) {
      Alert.alert('Photo Save Failed', err?.message || 'Unable to open the camera/photo picker or save the photo.');
    }
  }

  function viewPhotoPin(pin) {
    if (!pin?.id) return;
    setPhotoOptionsPin(null);
    const viewportState = reportViewportState();
    const returnSnapshot = buildReturnSnapshot(viewportState);
    if (onOpenPhotoPin) onOpenPhotoPin(pin, viewportState, returnSnapshot);
    else Alert.alert(t("Photo"), t("The mobile SiteWalk photo markup screen is ready to connect."));
  }

  function view360Pin(pin) {
    if (!pin?.id) return;
    setPhotoOptionsPin(null);
    const viewportState = reportViewportState();
    const returnSnapshot = buildReturnSnapshot(viewportState);
    if (onOpen360Pin) onOpen360Pin(pin, viewportState, returnSnapshot);
    else Alert.alert(t("360 Photo"), t("The mobile SiteWalk 360 viewer is ready to connect."));
  }

  function open360CaptureForPin(pin) {
    if (!pin?.id || camera360CaptureBusy) return;
    captureAndUpload360ForPin(pin);
  }

  function local360FileNameFromUrl(url) {
    const ext = extFromUrl(url) || '.jpg';
    return `x4-360-${Date.now()}-${smallHash(url)}${ext}`;
  }

  function local360FileTypeFromUri(uri) {
    const lower = String(uri || '').toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.insp')) return 'application/octet-stream';
    return 'image/jpeg';
  }

  function looksLikeRawX4Photo(uri) {
    return String(uri || '').toLowerCase().includes('.insp');
  }

  async function queueLocal360UploadForPin(pin, local360, { displayName = '', note = '' } = {}) {
    if (!pin?.id || !local360?.uri) return null;
    const offlinePhotoId = `offline_360_${pin.id}_${local360.localId || smallHash(local360.uri)}`;
    const patch = {
      is_expected_360_photo: true,
      has_matching_360_photo: true,
      matching_360_photo_id: offlinePhotoId,
      matching_360_photo_name: displayName || pinDisplayLabel(pin) || `360 Photo - ${selectedSiteName || 'Site'}`,
      matching_360_photo_url: local360.uri,
      matching_360_thumb_url: local360.uri,
      __offline_360_pending: Number(pin.__offline_360_pending || 0) + 1,
      __offline_local_360_uri: local360.uri,
      __offline_cached_360_uri: local360.uri,
      __offline_cached_360_thumb_uri: local360.uri,
    };
    replacePinLocal(pin.id, patch);
    setSelectedPin((prev) => (prev?.id && String(prev.id) === String(pin.id) ? { ...prev, ...patch } : prev));
    setPhotoOptionsPin((prev) => (prev?.id && String(prev.id) === String(pin.id) ? { ...prev, ...patch } : prev));
    await queueOfflineOperation({
      type: 'upload_pin_360_photo',
      pin_id: pin.id,
      page_id: page?.id,
      site_id: selectedSiteId,
      name: patch.matching_360_photo_name,
      tag: pin?.tag || '',
      sitewalk_desc: currentSitewalk,
      note,
      local_uri: local360.uri,
      local_file_name: fileNameFromUri(local360.uri),
      file_name: local360.name || fileNameFromUri(local360.uri) || 'site-walk-360.jpg',
      file_type: local360.type || local360FileTypeFromUri(local360.uri),
      offline_photo_id: offlinePhotoId,
    });
    return { ...pin, ...patch };
  }

  async function captureAndUpload360ForPin(pin) {
    if (!pin?.id) return;

    setCamera360CaptureBusy(true);
    setCamera360CaptureStatus('Checking X4 Wi-Fi connection...');

    try {
      const status = await refreshInsta360CameraStatus();
      if (!status?.osc?.reachable) {
        setCamera360CaptureStatus(status?.osc?.error || 'X4 Wi-Fi is not reachable from this device.');
        Alert.alert(
          'X4 Not Connected',
          'Connect this iPhone to the X4 Wi-Fi network first. The network usually appears like "X4 0QB5CJ.OSC" after the camera is in pairing/Wi-Fi mode.'
        );
        return;
      }

      setCamera360CaptureStatus('Setting X4 on-device stitching and taking 360 photo...');
      const capture = await takeX4OscPhoto();
      const imageUrl = capture?.imageUrl;
      if (!imageUrl) throw new Error('The X4 did not return a downloadable photo URL.');
      if (looksLikeRawX4Photo(imageUrl)) {
        throw new Error('The X4 returned a raw .insp file instead of a stitched 360 JPG. Capture was stopped so a dual-fisheye image would not be uploaded.');
      }

      setCamera360CaptureStatus('Downloading stitched 360 photo from X4...');
      const downloadName = local360FileNameFromUrl(imageUrl);
      const localUri = `${FileSystem.cacheDirectory || FileSystem.documentDirectory}${downloadName}`;
      const downloaded = await FileSystem.downloadAsync(imageUrl, localUri, {
        headers: { Accept: '*/*' },
      });

      if (!downloaded?.uri) throw new Error('The 360 photo download did not return a local file.');
      if (looksLikeRawX4Photo(downloaded.uri || imageUrl)) {
        throw new Error('The downloaded X4 file is raw .insp instead of a stitched 360 JPG. Capture was stopped so a dual-fisheye image would not be uploaded.');
      }

      const durableLocal360 = await copyLocalFileToOffline360File(downloaded.uri, {
        portalUrl,
        selectedSiteId,
        selectedSiteName,
        pageId: page?.id,
        pinId: pin.id,
        fileName: downloadName,
      });
      const displayName = pinDisplayLabel(pin) || `360 Photo - ${selectedSiteName || 'Site'}`;
      const note = pin?.sr_location || pin?.sr_task || pin?.label || '';

      // Do not block the field workflow on a live ERP upload.
      // When the phone is attached to the X4 Wi-Fi, or when cellular has one weak bar,
      // the backend request can hang for minutes before failing.  The safe workflow is:
      // capture from X4 -> copy to durable device storage -> update the pin locally ->
      // enqueue upload for the existing background redline sync loop.
      await queueLocal360UploadForPin(pin, durableLocal360, { displayName, note });
      setCamera360CaptureStatus('360 photo captured and saved on this device. Upload will continue in the background when the portal is reachable.');
      setCamera360CapturePin(null);
      Alert.alert('360 Photo Saved', 'The stitched X4 360 photo was saved on this device. You can keep working now; it will upload automatically in the background when the portal is reachable.');
      return;
    } catch (err) {
      const message = err?.message || 'Unable to capture the 360 photo from the X4.';
      setCamera360CaptureStatus(message);
      Alert.alert('360 Capture Failed', message);
    } finally {
      setCamera360CaptureBusy(false);
    }
  }

  function openWhiteboardForPin(pin) {
    if (!pin) return;
    setPhotoOptionsPin(null);
    setSelectedPin(null);
    setSelectedAnn(null);
    setPinWhiteboardPin(pin);
  }

  async function togglePinExpected360(pin) {
    if (!pin?.id) return;
    const nextValue = !pinIsExpected360(pin);
    const payloadToSave = { is_expected_360_photo: nextValue };
    const localPin = { ...pin, ...payloadToSave };
    replacePinLocal(pin.id, localPin);
    setPhotoOptionsPin(localPin);
    setSelectedPin((prev) => (prev?.id && String(prev.id) === String(pin.id) ? localPin : prev));

    if (isTempRedlineId(pin.id)) {
      await updateQueuedPinCreateLocal(pin.id, payloadToSave);
      return;
    }

    try {
      const response = await updateMobileRedlinePin(portalUrl, token, pin.id, payloadToSave);
      const updatedPin = response?.item || response?.pin || localPin;
      replacePinLocal(pin.id, updatedPin);
      setPhotoOptionsPin(updatedPin);
      setSelectedPin((prev) => (prev?.id && String(prev.id) === String(pin.id) ? updatedPin : prev));
      await reloadPageData();
    } catch (_err) {
      const queuedPin = { ...localPin, __offline_pending: true };
      replacePinLocal(pin.id, queuedPin);
      setPhotoOptionsPin(queuedPin);
      setSelectedPin((prev) => (prev?.id && String(prev.id) === String(pin.id) ? queuedPin : prev));
      await queueOfflineOperation({ type: 'update_pin', pin_id: pin.id, page_id: page?.id, payload: payloadToSave });
    }
  }

  async function deletePhotoPin(pin) {
    if (!pin?.id) return;
    setPhotoOptionsPin(null);
    try {
      removePinLocal(pin.id);
      await deleteMobileRedlinePin(portalUrl, token, pin.id);
      await reloadPageData();
    } catch (err) {
      Alert.alert('Delete Pin Failed', err?.message || 'Unable to delete the pin.');
      await reloadPageData();
    }
  }


  function updateOfflinePrecacheProgress(patch) {
    if (offlinePrecacheCancelRef.current) return;
    setOfflinePrecache((prev) => (prev.active ? { ...prev, ...patch } : prev));
  }

  function throwIfOfflinePrecacheCancelled() {
    if (offlinePrecacheCancelRef.current) {
      const err = new Error('Offline sync stopped.');
      err.offlineSyncCancelled = true;
      throw err;
    }
  }

  function stopOfflineModePrecache() {
    if (!offlinePrecache.active) return;
    offlinePrecacheCancelRef.current = true;
    offlinePrecacheRunIdRef.current += 1;
    try { offlinePrecacheAbortRef.current?.abort?.(); } catch (_err) {}
    offlinePrecacheAbortRef.current = null;
    setOfflinePrecache((prev) => ({
      ...prev,
      active: false,
      cancelling: false,
      complete: false,
      error: '',
      label: 'Offline sync stopped',
    }));
    setTimeout(() => {
      setOfflinePrecache((prev) => (prev.active || prev.label !== 'Offline sync stopped' ? prev : { ...prev, label: '', error: '', complete: false }));
    }, 1800);
  }

  async function startOfflineModePrecache() {
    if (offlinePrecache.active) return;
    if (!token || !selectedSiteId) {
      Alert.alert(t("Offline Mode"), t("Open the site while you still have service before syncing offline files."));
      return;
    }

    offlinePrecacheCancelRef.current = false;
    offlinePrecacheRunIdRef.current += 1;
    const runId = offlinePrecacheRunIdRef.current;
    try { offlinePrecacheAbortRef.current?.abort?.(); } catch (_err) {}
    const abortController = new AbortController();
    offlinePrecacheAbortRef.current = abortController;
    const abortSignal = abortController.signal;
    setOfflinePrecache({ active: true, cancelling: false, done: 0, total: 1, label: 'Preparing offline sync...', error: '', complete: false });

    try {
      throwIfOfflinePrecacheCancelled();
      const manifest = await loadMobileSiteWalkOfflineManifest(portalUrl, token, { siteId: selectedSiteId, siteName: selectedSiteName, signal: abortSignal }).catch((err) => {
        if (err?.requestCancelled || abortSignal.aborted) throwIfOfflinePrecacheCancelled();
        return null;
      });
      if (runId !== offlinePrecacheRunIdRef.current) throwIfOfflinePrecacheCancelled();
      if (manifest?.ok) {
        const manifestSets = Array.isArray(manifest.sitewalk_sets) ? manifest.sitewalk_sets : [];
        const manifestPageData = Array.isArray(manifest.page_data) ? manifest.page_data : [];
        const manifestSitePhotos = Array.isArray(manifest.site_walk_photos) ? manifest.site_walk_photos : [];
        const manifestAssets = Array.isArray(manifest.photo_assets) ? manifest.photo_assets : [];
        const manifest360 = Array.isArray(manifest.site_walk_360) ? manifest.site_walk_360 : [];
        const manifestSitewalks = Array.isArray(manifest.sitewalks) && manifest.sitewalks.length
          ? manifest.sitewalks
          : manifestSets.map((set) => clean(set.sitewalk_desc)).filter(Boolean);

        let done = 0;
        const total = Math.max(1, manifestPageData.length + manifestSitePhotos.length + manifestAssets.length + manifest360.length + manifestSets.length);
        updateOfflinePrecacheProgress({ done, total, label: `Syncing full site manifest: ${total} item${total === 1 ? '' : 's'}` });

        const pageDataByDesc = {};
        for (const item of manifestPageData) {
          const desc = clean(item?.selected_sitewalk_desc || item?.page?.sitewalk_desc || 'Site Walk');
          if (!pageDataByDesc[desc]) pageDataByDesc[desc] = [];
          pageDataByDesc[desc].push(item);
        }

        for (const set of manifestSets) {
          throwIfOfflinePrecacheCancelled();
          const desc = clean(set?.sitewalk_desc || 'Site Walk');
          const setPages = Array.isArray(set?.pages) ? set.pages : [];
          const firstData = (pageDataByDesc[desc] || [])[0] || {};
          const docPayload = {
            site: manifest.site || { id: selectedSiteId, site_id: selectedSiteId, site_name: selectedSiteName },
            sitewalks: manifestSitewalks,
            selected_sitewalk_desc: desc,
            pages: setPages,
            page: firstData.page || setPages[0] || null,
            pins: Array.isArray(firstData.pins) ? firstData.pins : [],
            annotations: Array.isArray(firstData.annotations) ? firstData.annotations : [],
            cached_at: new Date().toISOString(),
            offline_manifest_summary: manifest.summary || {},
          };
          await writeJsonToStorage(redlineDocumentCacheKey(portalUrl, selectedSiteId, selectedSiteName, desc), docPayload);
          done += 1;
          updateOfflinePrecacheProgress({ done, label: `Cached PDF set: ${desc}` });
          await pause(35);
        }

        for (let i = 0; i < manifestPageData.length; i += 1) {
          throwIfOfflinePrecacheCancelled();
          const item = manifestPageData[i] || {};
          const itemPage = item.page || {};
          const itemPageId = pageIdValue(itemPage);
          const desc = clean(item.selected_sitewalk_desc || itemPage.sitewalk_desc || 'Site Walk');
          updateOfflinePrecacheProgress({ label: `Caching PDFs/pages ${i + 1} of ${manifestPageData.length}` });
          const cachedImage = await cachePageImage(itemPage, desc).catch(() => clean(itemPage.cached_image_uri || itemPage.local_image_uri || itemPage.offline_image_uri));
          let nextPins = Array.isArray(item.pins) ? item.pins : [];
          if (nextPins.length) {
            const mediaPins = [];
            for (const pin of nextPins) {
              throwIfOfflinePrecacheCancelled();
              mediaPins.push(await cacheLinkedRedlineMedia({ portalUrl, token, pin, siteId: selectedSiteId, siteName: selectedSiteName, sitewalkDesc: desc, pageId: itemPageId }).catch(() => pin));
              await pause(20);
            }
            nextPins = mediaPins;
          }
          const mergedPage = cachedImage ? { ...itemPage, cached_image_uri: cachedImage, offline_image_uri: cachedImage } : itemPage;
          const pageCachePayload = {
            ...item,
            page: mergedPage,
            pins: nextPins,
            annotations: Array.isArray(item.annotations) ? item.annotations : [],
            selected_sitewalk_desc: desc,
            cached_at: new Date().toISOString(),
          };
          if (itemPageId) {
            await writeJsonToStorage(redlinePageDataCacheKey(portalUrl, selectedSiteId, selectedSiteName, desc, itemPageId), pageCachePayload);
            await writeJsonToStorage(redlinePageDataAnySitewalkCacheKey(portalUrl, selectedSiteId, selectedSiteName, itemPageId), pageCachePayload);
          }
          if (String(desc) === String(currentSitewalk) && String(itemPageId) === String(currentPageId)) {
            setPayload((prev) => ({ ...(prev || {}), page: mergedPage, pins: nextPins, annotations: pageCachePayload.annotations }));
          }
          done += 1;
          updateOfflinePrecacheProgress({ done });
          await pause(45);
        }

        const cachedSiteWalkPhotos = [];
        for (let i = 0; i < manifestSitePhotos.length; i += 1) {
          throwIfOfflinePrecacheCancelled();
          updateOfflinePrecacheProgress({ label: `Caching redline/sitewalk photos ${i + 1} of ${manifestSitePhotos.length}` });
          cachedSiteWalkPhotos.push(await cacheManifestImageObject({ portalUrl, token, item: manifestSitePhotos[i], kindPrefix: 'site_walk_photo' }).catch(() => manifestSitePhotos[i]));
          done += 1;
          updateOfflinePrecacheProgress({ done });
          await pause(25);
        }
        await writeJsonToStorage(`sitewalk_redlines_all_site_walk_photos_manifest_v1:${cacheSafePart(normalizePortalUrl(portalUrl).toLowerCase())}:${cacheSafePart(selectedSiteId || selectedSiteName)}`, { items: cachedSiteWalkPhotos, savedAt: Date.now() });

        const cachedAssets = [];
        for (let i = 0; i < manifestAssets.length; i += 1) {
          throwIfOfflinePrecacheCancelled();
          updateOfflinePrecacheProgress({ label: `Caching site photos ${i + 1} of ${manifestAssets.length}` });
          cachedAssets.push(await cachePhotoAssetForOfflinePrecache({ portalUrl, token, asset: manifestAssets[i] }).catch(() => manifestAssets[i]));
          done += 1;
          updateOfflinePrecacheProgress({ done });
          await pause(25);
        }
        const assetsByCategory = {};
        for (const asset of cachedAssets) {
          const cat = clean(asset?.category || 'all').toLowerCase();
          if (!assetsByCategory[cat]) assetsByCategory[cat] = [];
          assetsByCategory[cat].push(asset);
        }
        for (const categoryKey of SITE_PHOTO_PREFETCH_CATEGORIES) {
          throwIfOfflinePrecacheCancelled();
          const rows = categoryKey === 'all' ? cachedAssets : (assetsByCategory[categoryKey] || []);
          await AsyncStorage.setItem(photoListStorageKey(selectedSiteId, categoryKey), JSON.stringify({
            items: rows,
            nextCursor: null,
            counts: {},
            savedAt: Date.now(),
            ttlMs: PHOTO_ASSET_LIST_CACHE_TTL_MS,
          }));
        }

        const cached360 = [];
        for (let i = 0; i < manifest360.length; i += 1) {
          throwIfOfflinePrecacheCancelled();
          updateOfflinePrecacheProgress({ label: `Caching 360 photos ${i + 1} of ${manifest360.length}` });
          const cachedItem = await cacheManifestImageObject({ portalUrl, token, item: manifest360[i], kindPrefix: 'site_walk_360' }).catch(() => manifest360[i]);
          cached360.push(cachedItem);
          try {
            if (cachedItem?.id && Array.isArray(manifest360[i]?.annotations)) {
              await AsyncStorage.setItem(`sitewalk_360_annotation_cache_v1:${cacheSafePart(cachedItem.id)}`, JSON.stringify({
                annotations: manifest360[i].annotations,
                saved_at: new Date().toISOString(),
                pending: false,
              }));
            }
          } catch (_err) {}
          done += 1;
          updateOfflinePrecacheProgress({ done });
          await pause(25);
        }
        await writeJsonToStorage(`sitewalk_360_manifest_cache_v1:${cacheSafePart(normalizePortalUrl(portalUrl).toLowerCase())}:${cacheSafePart(selectedSiteId || selectedSiteName)}`, { items: cached360, savedAt: Date.now() });

        if (runId !== offlinePrecacheRunIdRef.current) throwIfOfflinePrecacheCancelled();
      setOfflinePrecache((prev) => ({ ...prev, active: false, complete: true, done: Math.max(done, prev.total || done), total: Math.max(done, prev.total || done), label: 'Offline mode ready — full site synced', error: '' }));
        setTimeout(() => setOfflinePrecache((prev) => prev.active ? prev : { ...prev, complete: false }), 4500);
        return;
      }

      const sitewalkNames = Array.from(new Set([
        currentSitewalk,
        ...sitewalks.map((item) => clean(item?.value ?? item?.label ?? item?.sitewalk_desc ?? item)),
      ].filter(Boolean)));
      const targetSitewalks = sitewalkNames.length ? sitewalkNames : [currentSitewalk || 'Site Walk'];
      const roughTotal = Math.max(1, targetSitewalks.length + SITE_PHOTO_PREFETCH_CATEGORIES.length + 2);
      let done = 0;
      updateOfflinePrecacheProgress({ done, total: roughTotal, label: `Syncing ${targetSitewalks.length} PDF set${targetSitewalks.length === 1 ? '' : 's'}...` });

      for (const sitewalkDesc of targetSitewalks) {
        throwIfOfflinePrecacheCancelled();
        updateOfflinePrecacheProgress({ label: `Loading PDF: ${sitewalkDesc}` });
        let doc = null;
        try {
          doc = await loadMobileSiteWalkRedlines(portalUrl, token, { siteId: selectedSiteId, siteName: selectedSiteName, sitewalkDesc, signal: abortSignal });
        } catch (_err) {
          doc = await readJsonFromStorage(redlineDocumentCacheKey(portalUrl, selectedSiteId, selectedSiteName, sitewalkDesc));
        }
        if (!doc) {
          done += 1;
          updateOfflinePrecacheProgress({ done, label: `Skipped PDF: ${sitewalkDesc}` });
          continue;
        }

        await writeJsonToStorage(redlineDocumentCacheKey(portalUrl, selectedSiteId, selectedSiteName, doc?.selected_sitewalk_desc || sitewalkDesc), doc);
        const docPages = Array.isArray(doc?.pages) ? doc.pages : [];
        const docTotal = roughTotal + docPages.length;
        setOfflinePrecache((prev) => ({ ...prev, total: Math.max(docTotal, prev.total || 1) }));

        for (let pageIndex = 0; pageIndex < docPages.length; pageIndex += 1) {
          throwIfOfflinePrecacheCancelled();
          const listPage = docPages[pageIndex];
          const itemPageId = pageIdValue(listPage);
          if (!itemPageId) continue;
          updateOfflinePrecacheProgress({ label: `Caching ${sitewalkDesc} page ${pageIndex + 1} of ${docPages.length}` });
          let pageData = null;
          try {
            pageData = String(itemPageId) === String(currentPageId)
              ? { page: { ...(listPage || {}), ...(page || {}) }, pins, annotations: rawAnnotations }
              : await loadMobileSiteWalkRedlinesPageData(portalUrl, token, itemPageId, { signal: abortSignal });
          } catch (_err) {
            pageData = await findCachedRedlinePageData(portalUrl, selectedSiteId, selectedSiteName, sitewalkDesc, itemPageId);
          }
          const pageBase = { ...(listPage || {}), ...(pageData?.page || {}) };
          const cachedFromList = await cachePageImage(listPage, sitewalkDesc).catch(() => '');
          const cachedFromPage = await cachePageImage(pageBase, sitewalkDesc).catch(() => '');
          const cachedImage = cachedFromPage || cachedFromList || clean(pageBase.cached_image_uri || pageBase.local_image_uri || pageBase.offline_image_uri);
          let nextPins = Array.isArray(pageData?.pins) ? pageData.pins : [];
          if (nextPins.length) {
            const mediaPins = [];
            for (const pin of nextPins) {
              throwIfOfflinePrecacheCancelled();
              mediaPins.push(await cacheLinkedRedlineMedia({ portalUrl, token, pin, siteId: selectedSiteId, siteName: selectedSiteName, sitewalkDesc, pageId: itemPageId }));
              await pause(40);
            }
            nextPins = mediaPins;
          }
          const mergedPage = cachedImage ? { ...pageBase, cached_image_uri: cachedImage, offline_image_uri: cachedImage } : pageBase;
          const pageCachePayload = {
            ...(pageData || {}),
            page: mergedPage,
            pins: nextPins,
            annotations: Array.isArray(pageData?.annotations) ? pageData.annotations : [],
            selected_sitewalk_desc: sitewalkDesc,
            cached_at: new Date().toISOString(),
          };
          await writeJsonToStorage(redlinePageDataCacheKey(portalUrl, selectedSiteId, selectedSiteName, sitewalkDesc, itemPageId), pageCachePayload);
          await writeJsonToStorage(redlinePageDataAnySitewalkCacheKey(portalUrl, selectedSiteId, selectedSiteName, itemPageId), pageCachePayload);
          if (String(sitewalkDesc) === String(currentSitewalk) && String(itemPageId) === String(currentPageId)) {
            setPayload((prev) => ({ ...(prev || doc || {}), page: mergedPage, pins: nextPins, annotations: pageCachePayload.annotations }));
          }
          done += 1;
          updateOfflinePrecacheProgress({ done });
          await pause(90);
        }
      }

      updateOfflinePrecacheProgress({ label: 'Caching site photos...', total: Math.max(roughTotal + 10, done + SITE_PHOTO_PREFETCH_CATEGORIES.length) });
      const unseen = await loadMobilePhotoAssetUnseenCounts(portalUrl, token, selectedSiteId, { signal: abortSignal }).catch((err) => {
        if (err?.requestCancelled || abortSignal.aborted) throwIfOfflinePrecacheCancelled();
        return null;
      });
      for (const photoCategory of SITE_PHOTO_PREFETCH_CATEGORIES) {
        throwIfOfflinePrecacheCancelled();
        let cursor = null;
        let allRows = [];
        let pageGuard = 0;
        updateOfflinePrecacheProgress({ label: `Caching site photos: ${photoCategory}` });
        do {
          pageGuard += 1;
          const list = await loadMobilePhotoAssets(portalUrl, token, { siteId: selectedSiteId, category: photoCategory, cursor, limit: 100, signal: abortSignal });
          const rows = Array.isArray(list?.items) ? list.items : [];
          for (const asset of rows) {
            throwIfOfflinePrecacheCancelled();
            const cachedAsset = await cachePhotoAssetForOfflinePrecache({ portalUrl, token, asset }).catch(() => asset);
            allRows.push(cachedAsset || asset);
            if (allRows.length % 5 === 0) updateOfflinePrecacheProgress({ label: `Caching site photos: ${photoCategory} (${allRows.length})` });
            await pause(35);
          }
          cursor = list?.next_cursor || null;
        } while (cursor && pageGuard < 20);
        await AsyncStorage.setItem(photoListStorageKey(selectedSiteId, photoCategory), JSON.stringify({
          items: allRows,
          nextCursor: null,
          counts: unseen?.counts || {},
          savedAt: Date.now(),
          ttlMs: PHOTO_ASSET_LIST_CACHE_TTL_MS,
        }));
        done += 1;
        updateOfflinePrecacheProgress({ done });
      }

      if (runId !== offlinePrecacheRunIdRef.current) throwIfOfflinePrecacheCancelled();
      setOfflinePrecache((prev) => ({ ...prev, active: false, complete: true, done: Math.max(done, prev.total || done), label: 'Offline mode ready', error: '' }));
      setTimeout(() => setOfflinePrecache((prev) => prev.active ? prev : { ...prev, complete: false }), 4500);
    } catch (error) {
      if (error?.offlineSyncCancelled || abortSignal.aborted) {
        setOfflinePrecache((prev) => (prev.label === 'Offline sync stopped' ? prev : { ...prev, active: false, cancelling: false, error: '', label: 'Offline sync stopped', complete: false }));
        setTimeout(() => setOfflinePrecache((prev) => prev.active ? prev : { ...prev, label: '', error: '', complete: false }), 2500);
        return;
      }
      setOfflinePrecache((prev) => ({ ...prev, active: false, cancelling: false, error: error?.message || 'Offline sync failed.', label: 'Offline sync paused', complete: false }));
    } finally {
      if (runId === offlinePrecacheRunIdRef.current) {
        offlinePrecacheCancelRef.current = false;
        offlinePrecacheAbortRef.current = null;
      }
    }
  }

  function selectSitewalkPdf(item) {
    const nextSitewalk = clean(item?.value ?? item?.label ?? item?.sitewalk_desc ?? item);
    if (!nextSitewalk) return;
    if (nextSitewalk === currentSitewalk && !loading) return;
    setPagesVisible(false);
    setSelectedPin(null);
    setSelectedAnn(null);
    load({ sitewalkDesc: nextSitewalk, pageId: null, useRemembered: false, preserveViewport: false });
  }

  function selectRedlineSite(item) {
    if (!allowSiteSelection || !item || item.type === 'header') return;

    const nextSiteId = siteId(item);
    const nextSiteName = siteName(item);
    if (!nextSiteId && !nextSiteName) return;

    const currentSiteId = siteId(selectedRedlineSite) || selectedSiteId;
    const currentSiteName = siteName(selectedRedlineSite) || selectedSiteName;
    const sameSite = nextSiteId
      ? String(nextSiteId) === String(currentSiteId || '')
      : nextSiteName === currentSiteName;
    if (sameSite && !loading) return;

    userSelectedRedlineSiteRef.current = true;
    rememberLastPdfEditorSite(portalUrl, item);
    setSelectedRedlineSite(item);
    setPayload(null);
    setError('');
    setCategory('all');
    setQuery('');
    setPagesVisible(false);
    setSearchVisible(false);
    setMenuVisible(false);
    setSelectedPin(null);
    setSelectedAnn(null);
    setDraftStart(null);
    setDraftShape(null);
    userSelectedPageIdRef.current = '';
    initialSnapshotAppliedRef.current = false;
    initialLoadKeyRef.current = '';
    currentSitewalkRef.current = '';
    drawRef.current = { active: false, start: null, end: null, points: [], tool: TOOL_SELECT };
    resetZoomAndPan();
  }

  function renderTopControls({ compact = false } = {}) {
    const pageItems = pages.map((p, idx) => ({ ...p, label: p.display_name || `Page ${idx + 1}` }));
    return (
      <View style={[styles.topPanel, allowSiteSelection && styles.topPanelSiteWalkAdmin, compact && styles.topPanelCompact]}>
        <View style={[styles.identityRow, compact && styles.identityRowCompact]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{session?.employee?.name || session?.employee?.friendly_name || session?.email || 'Employee'}</Text>
            <Text style={styles.roleText}>{selectedSiteName}</Text>
          </View>
          <View style={styles.headerActionsRow}><Pressable style={[styles.headerBtn, styles.homeHeaderBtn]} onPress={onBack}><Text style={styles.headerBtnText}>{t("Back")}</Text></Pressable>{typeof onHome === 'function' ? <Pressable style={[styles.headerBtn, styles.homeHeaderBtn]} onPress={onHome}><Text style={styles.headerBtnText}>{t("Home")}</Text></Pressable> : null}
          </View>
        </View>
        {!compact && <View style={styles.controlsRow}>
          {allowSiteSelection ? (
            <Dropdown
              label="SITE"
              value={selectedSiteName || (redlineSitesLoading ? 'Loading sites...' : 'Select site')}
              items={groupedRedlineSiteItems}
              onSelect={selectRedlineSite}
              disabled={false}
              searchValue={redlineSiteQuery}
              onSearchChange={setRedlineSiteQuery}
              searchPlaceholder="Search sites..."
            />
          ) : null}
          <Dropdown label="PDF" value={currentSitewalk || 'Site Walk'} items={sitewalks.map((sw) => ({ label: sw, value: sw }))} onSelect={selectSitewalkPdf} disabled={allowSiteSelection && !selectedSiteId && !selectedSiteName} />
          <Dropdown label="PAGE" value={page?.display_name || 'Page'} items={pageItems} onSelect={selectPage} disabled={allowSiteSelection && !selectedSiteId && !selectedSiteName} />
          <View style={styles.tagsControlWrap}>
            <Text style={styles.controlLabel}>{t("TAGS")}</Text>
            <Pressable style={[styles.tagsTopBtn, category !== 'all' && styles.tagsTopBtnActive]} onPress={() => setTagsVisible(true)}>
              <Text style={[styles.tagsTopBtnText, category !== 'all' && styles.tagsTopBtnTextActive]}>{t("Tags")}</Text>
              {category !== 'all' ? <Text style={styles.tagsTopBtnSub} numberOfLines={1}>{selectedCategoryLabel}</Text> : null}
            </Pressable>
          </View>
        </View>}
        {!compact && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersRow}>
          {allowSiteSelection ? (
            <Pressable style={styles.refreshBtn} onPress={() => setMenuVisible(true)}><Text style={styles.refreshBtnText}>{t("Menu")}</Text></Pressable>
          ) : null}
          <View style={styles.opacityWrap}>
            <Text style={styles.opacityLabel}>{t("PIN OPACITY")}</Text>
            {[0, 0.5, 1].map((value) => (
              <Pressable key={value} style={[styles.opacityBtn, pinOpacity === value && styles.opacityBtnActive]} onPress={() => setPinOpacity(value)}>
                <Text style={[styles.opacityBtnText, pinOpacity === value && styles.opacityBtnTextActive]}>{value === 1 ? 'Full' : value === 0 ? '0' : `${Math.round(value * 100)}%`}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={[styles.offlineModeBtn, offlinePrecache.active && styles.offlineModeBtnActive]} onPress={startOfflineModePrecache} disabled={offlinePrecache.active}>
            <Text style={styles.offlineModeBtnText}>{offlinePrecache.active ? 'Syncing\n...' : 'Offline\nMode'}</Text>
          </Pressable>
          {offlinePrecache.active ? (
            <Pressable style={styles.stopSyncBtn} onPress={stopOfflineModePrecache}>
              <Text style={styles.stopSyncBtnText}>{t("Stop\\nSync")}</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.refreshBtn} onPress={() => { setRefreshing(true); load({ sitewalkDesc: currentSitewalk, pageId: page?.id || page?.page_id, silent: true, useRemembered: false, preserveViewport: true }); }}><Text style={styles.refreshBtnText}>{t("Refresh")}</Text></Pressable>
        </ScrollView>}
      </View>
    );
  }


  function renderSelectedAnnotationControls() {
    const ann = liveSelectedAnn;
    if (!ann?.id || !editableAnnotationShape(ann.shape_type)) return null;
    const shape = clean(ann.shape_type).toLowerCase();
    const b = annotationBounds(ann);
    // Keep resize handles finger-friendly without letting them balloon when the
    // page is zoomed in.  The canvas already grows with zoomScale, so multiplying
    // handle size by zoomScale made the resize pop-up controls look oversized.
    const handleSize = Math.max(14, Math.min(20, 14.4 + ((zoomScale - MIN_ZOOM) * 1.2)));
    const handleOffset = handleSize / 2;
    const leftPx = b.left * canvasWidth;
    const topPx = b.top * canvasHeight;
    const widthPx = Math.max(1, b.width * canvasWidth);
    const heightPx = Math.max(1, b.height * canvasHeight);
    const isCloudAnnotation = shape === 'note' && isCloudNote(ann.note);
    const cloudMoveBox = isCloudAnnotation ? cloudAnnotationPixelBox(ann, canvasWidth, canvasHeight, zoomScale) : null;

    const makeHandle = (key, style) => (
      <View
        key={key}
        onTouchStart={() => { editRef.current = { ...editRef.current, mode: key }; }}
        style={[styles.editHandle, { width: handleSize, height: handleSize, borderRadius: handleOffset }, style]}
        {...annotationEditPanResponder.panHandlers}
      />
    );

    if (isCloudAnnotation && cloudMoveBox) {
      return (
        <View pointerEvents="box-none" style={styles.annotationEditOverlay}>
          <View
            onTouchStart={() => { editRef.current = { ...editRef.current, mode: 'move' }; }}
            style={[
              styles.editMoveHit,
              {
                left: cloudMoveBox.left,
                top: cloudMoveBox.top,
                width: cloudMoveBox.width,
                height: cloudMoveBox.height,
                borderRadius: 12 * zoomScale,
              },
            ]}
            {...annotationEditPanResponder.panHandlers}
          />
        </View>
      );
    }

    if (ann.__isFreehandGroup) {
      return (
        <View pointerEvents="box-none" style={styles.annotationEditOverlay}>
          <View
            onTouchStart={() => { editRef.current = { ...editRef.current, mode: 'move' }; }}
            style={[
              styles.editMoveLineHit,
              {
                left: leftPx - handleSize,
                top: topPx - handleSize,
                width: widthPx + handleSize * 2,
                height: heightPx + handleSize * 2,
              },
            ]}
            {...annotationEditPanResponder.panHandlers}
          />
        </View>
      );
    }

    if (shape === 'note' && isIconNote(ann.note)) {
      const baseIcon = iconLayoutMetrics(annotationStrokeWidth(ann.stroke_width, 1));
      const hitSize = Math.max(44, baseIcon.hitSize * zoomScale);
      return (
        <View pointerEvents="box-none" style={styles.annotationEditOverlay}>
          <View
            onTouchStart={() => { editRef.current = { ...editRef.current, mode: 'move' }; }}
            style={[
              styles.editMoveHit,
              {
                left: (clamp01(ann.x1) * canvasWidth) - (hitSize / 2),
                top: (clamp01(ann.y1) * canvasHeight) - (hitSize / 2),
                width: hitSize,
                height: hitSize,
                borderRadius: hitSize / 2,
              },
            ]}
            {...annotationEditPanResponder.panHandlers}
          />
        </View>
      );
    }

    if (shape === 'line' || shape === 'arrow' || shape === 'measure' || shape === 'measure_line' || shape === 'draw') {
      const startLeft = clamp01(ann.x1) * canvasWidth;
      const startTop = clamp01(ann.y1) * canvasHeight;
      const endLeft = clamp01(ann.x2) * canvasWidth;
      const endTop = clamp01(ann.y2) * canvasHeight;
      return (
        <View pointerEvents="box-none" style={styles.annotationEditOverlay}>
          <View
            onTouchStart={() => { editRef.current = { ...editRef.current, mode: 'move' }; }}
            style={[styles.editMoveLineHit, { left: Math.min(startLeft, endLeft) - handleSize, top: Math.min(startTop, endTop) - handleSize, width: Math.abs(endLeft - startLeft) + handleSize * 2, height: Math.abs(endTop - startTop) + handleSize * 2 }]}
            {...annotationEditPanResponder.panHandlers}
          />
          {makeHandle('start', { left: startLeft - handleOffset, top: startTop - handleOffset })}
          {makeHandle('end', { left: endLeft - handleOffset, top: endTop - handleOffset })}
        </View>
      );
    }

    const edgeMoveWidth = Math.max(18, annotationStrokeWidth(ann.stroke_width, 3) + 14);
    const makeMoveEdge = (key, style) => (
      <View
        key={key}
        onTouchStart={() => { editRef.current = { ...editRef.current, mode: 'move' }; }}
        style={[styles.editMoveHit, style]}
        {...annotationEditPanResponder.panHandlers}
      />
    );

    return (
      <View pointerEvents="box-none" style={styles.annotationEditOverlay}>
        {boxEdgeHitStyles(leftPx, topPx, widthPx, heightPx, edgeMoveWidth).map((style, idx) => makeMoveEdge(`move-edge-${idx}`, style))}
        {makeHandle('nw', { left: leftPx - handleOffset, top: topPx - handleOffset })}
        {makeHandle('se', { left: leftPx + widthPx - handleOffset, top: topPx + heightPx - handleOffset })}
      </View>
    );
  }

  function renderCanvas() {
    if (!page) {
      return <View style={styles.emptyCanvas}><Text style={styles.emptyTitle}>{t("No redline pages found for this site.")}</Text></View>;
    }
    const drawingToolActive = isDrawShapeTool(tool) && canEdit && Boolean(page?.id);
    return (
      <View
        ref={canvasViewportRef}
        style={styles.canvasOuter}
        onLayout={rememberViewport}
        {...zoomPanResponder.panHandlers}
        collapsable={false}
      >
        <View
          style={[
            styles.canvasPanLayer,
            { transform: [{ translateX: panOffset.x }, { translateY: panOffset.y }] },
          ]}
        >
          <View style={[styles.canvas, { width: canvasWidth, height: canvasHeight }]}>
            {imageSource ? (
              <Image
                source={imageSource}
                style={styles.pageImage}
                resizeMode="stretch"
                onLoad={() => {
                  if (error === 'No page image available from the saved cache or server.') setError('');
                }}
                onError={() => {
                  const failedUrl = clean(displayedImageUrl);
                  const remaining = displayImageCandidates.some((item) => clean(item) && clean(item) !== failedUrl && !failedImageUrls[clean(item)]);
                  if (failedUrl) setFailedImageUrls((prev) => ({ ...prev, [failedUrl]: true }));
                  if (!remaining) setError('No page image available from the saved cache or server.');
                }}
              />
            ) : (
              <View style={styles.noImage}><Text style={styles.noImageText}>{t("No page image available")}</Text></View>
            )}
            {!drawingToolActive && (
              <Pressable
                style={styles.canvasTouchLayer}
                onPress={isPinPlacementTool(tool) ? undefined : handleCanvasPress}
                onPressIn={isPinPlacementTool(tool) ? handleCanvasPlacementPressIn : undefined}
              />
            )}
            {annotations.map((ann) => (
              <Annotation
                key={`ann-${ann.id}`}
                ann={ann}
                canvasWidth={canvasWidth}
                canvasHeight={canvasHeight}
                zoomScale={zoomScale}
                selected={liveSelectedAnn?.id === ann.id}
                onPress={(evt) => {
                  if (tool !== TOOL_SELECT) {
                    handleCanvasToolPress(evt);
                    return;
                  }
                  setSelectedAnn(ann);
                  setSelectedPin(null);
                  setStrokeColor(clean(ann.stroke_color) || strokeColor);
                  setStrokeWidth(annotationStrokeWidth(ann.stroke_width, strokeWidth));
                }}
              />
            ))}
            {polylineDraft?.points?.length ? (
              <View pointerEvents="none" style={styles.annotationEditOverlay}>
                {renderPolylineStroke(polylineDraft.points, canvasWidth, canvasHeight, strokeColor, Math.max(1, strokeWidth), 'draft-polyline')}
              </View>
            ) : null}
            {renderSelectedAnnotationControls()}
            {whiteboardStrokes.length ? (
              <View pointerEvents="none" style={styles.whiteboardLayer}>
                {whiteboardStrokes.map((item) => <View key={item.id} pointerEvents="none" style={StyleSheet.absoluteFill}>{renderWhiteboardStroke(item)}</View>)}
              </View>
            ) : null}
            {visiblePins.map((pin) => {
              const kind = pinKind(pin);
              const isNotePin = kind === 'note';
              const isCameraMisc = kind === 'camera_misc';
              const isPhotoPin = kind === 'photo' || kind === 'photo360';
              const isSiteRecordDot = kind === 'site_record_dot';
              const isSelectedNote = isNotePin && String(selectedPin?.id) === String(pin.id);
              const zoomProgress = Math.max(0, Math.min(1, (zoomScale - MIN_ZOOM) / Math.max(1, MAX_ZOOM - MIN_ZOOM)));
              // Keep pins readable/tappable while zooming in. The previous logic reduced
              // pinZoomScale as the canvas zoom increased, so pins became too small
              // relative to the zoomed page. Grow them slightly with zoom, but cap the
              // increase so they do not cover too much of the drawing.
              const pinZoomScale = Math.max(1, Math.min(1.28, 1 + (zoomProgress * 0.28)));
              const noteSize = Math.max(22.4, 22.4 * pinZoomScale);
              const siteDotSize = Math.max(10, 10 * pinZoomScale);
              const photoRingSize = Math.max(18, 18 * pinZoomScale);
              const cameraSize = Math.max(27, 27 * pinZoomScale);
              const pinSize = isNotePin ? noteSize : isSiteRecordDot ? siteDotSize : isCameraMisc ? cameraSize : photoRingSize;
              const pinBorder = Math.max(1.4, 2 * pinZoomScale);
              const label = pinDisplayLabel(pin);
              const labelWidth = label ? Math.max(54 * pinZoomScale, Math.min(170 * pinZoomScale, (String(label).length * 6.2 * pinZoomScale) + (14 * pinZoomScale))) : 0;
              const photoBorder = photoPinBorderColor(pin);
              return (
                <Pressable
                  key={`pin-${pin.id}`}
                  delayLongPress={REDLINE_PIN_DRAG_HOLD_MS}
                  style={[
                    styles.pin,
                    isNotePin && styles.notePin,
                    isPhotoPin && styles.photoPinWrap,
                    isCameraMisc && styles.cameraMiscPinWrap,
                    {
                      left: `${clamp01(pin.x) * 100}%`,
                      top: `${clamp01(pin.y) * 100}%`,
                      minWidth: pinSize,
                      height: pinSize,
                      borderRadius: isCameraMisc ? cameraSize / 2 : pinSize / 2,
                      borderWidth: isPhotoPin || isCameraMisc ? 0 : pinBorder,
                      opacity: pinOpacity,
                      borderColor: selectedPin?.id === pin.id ? '#facc15' : '#ffffff',
                      backgroundColor: isPhotoPin || isCameraMisc ? 'transparent' : pinColor(pin),
                      transform: [{ translateX: -(pinSize / 2) }, { translateY: -(pinSize / 2) }],
                    },
                  ]}
                  {...{
                    onTouchStart: (evt) => beginNotePinTouch(pin, evt),
                    onTouchMove: moveNotePinTouch,
                    onTouchEnd: finishNotePinTouch,
                    onTouchCancel: cancelNotePinTouch,
                  }}
                >
                  {isPhotoPin ? (
                    <View style={[
                      styles.photoPinRing,
                      {
                        width: photoRingSize,
                        height: photoRingSize,
                        borderRadius: photoRingSize / 2,
                        borderWidth: pinBorder,
                        borderColor: photoBorder,
                      },
                    ]}>
                      {pinHas360Photo(pin) ? <View style={[styles.photoPin360Ring, { borderColor: '#2563eb', inset: -5 * pinZoomScale, borderRadius: (photoRingSize / 2) + (5 * pinZoomScale), borderWidth: Math.max(1.2, 1.8 * pinZoomScale) }]} /> : null}
                    </View>
                  ) : isCameraMisc ? (
                    <View style={[styles.cameraMiscPin, { width: cameraSize, height: cameraSize, borderRadius: cameraSize / 2, borderColor: selectedPin?.id === pin.id ? '#facc15' : '#ffffff' }]}>
                      <Text style={[styles.cameraMiscIcon, { fontSize: Math.max(10.5, 13 * pinZoomScale), lineHeight: Math.max(15, 18 * pinZoomScale) }]}>📷</Text>
                    </View>
                  ) : (
                    <Text style={[styles.pinIcon, isNotePin && styles.notePinIcon, { fontSize: Math.max(isNotePin ? 8.5 : 8, (isNotePin ? 10.5 : 10) * pinZoomScale) }]}>{isNotePin ? '📝' : isSiteRecordDot ? '•' : ''}</Text>
                  )}
                  {!isNotePin && !isCameraMisc && !!label && (
                    <Text
                      style={[
                        styles.pinLabel,
                        {
                          top: (pinSize / 2) + (2 * pinZoomScale),
                          left: (pinSize / 2) - (labelWidth / 2),
                          width: labelWidth,
                          maxWidth: 170 * pinZoomScale,
                          borderRadius: 999,
                          paddingHorizontal: 4 * pinZoomScale,
                          paddingVertical: 1.5 * pinZoomScale,
                          fontSize: Math.max(8.5, 10.5 * pinZoomScale),
                          lineHeight: Math.max(11, 13 * pinZoomScale),
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {label}
                    </Text>
                  )}
                </Pressable>
              );
            })}
            {draftShape && (() => {
              const draftEnd = draftShape.tool === TOOL_CIRCLE ? circleEndFromDrag(draftShape.start, draftShape.end, canvasWidth, canvasHeight) : draftShape.end;
              if (isLineLikeTool(draftShape.tool)) {
                const rawPoints = draftShape.tool === TOOL_DRAW ? (draftShape.points || [draftShape.start, draftEnd]) : [draftShape.start, draftEnd];
                const points = rawPoints.length > 1 ? rawPoints : [draftShape.start, draftEnd];
                if (draftShape.tool === TOOL_DRAW) {
                  const smoothPreviewPoints = renderSmoothFreehandPoints(points, 220);
                  return (
                    <View pointerEvents="none" style={styles.annotationEditOverlay}>
                      {renderFreehandStroke(smoothPreviewPoints, canvasWidth, canvasHeight, strokeColor, Math.max(1, strokeWidth), 'draft-freehand')}
                    </View>
                  );
                }
                return (
                  <View pointerEvents="none" style={styles.annotationEditOverlay}>
                    {points.slice(1).map((pt, idx) => {
                      const prev = points[idx];
                      const x1 = prev.x * canvasWidth;
                      const y1 = prev.y * canvasHeight;
                      const x2 = pt.x * canvasWidth;
                      const y2 = pt.y * canvasHeight;
                      const dx = x2 - x1;
                      const dy = y2 - y1;
                      const len = Math.max(1, Math.sqrt((dx * dx) + (dy * dy)));
                      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                      const hitHeight = Math.max(24, strokeWidth + 18);
                      const arrowHead = arrowHeadMetrics(strokeWidth);
                      const arrowBackoff = draftShape.tool === TOOL_ARROW ? Math.max(arrowHead.length * 0.62, 4.5) : 0;
                      const lineDrawWidth = Math.max(1, len - arrowBackoff);
                      return (
                        <View key={`draft-line-${idx}`} style={[styles.lineHit, { left: ((x1 + x2) / 2) - (len / 2), top: ((y1 + y2) / 2) - (hitHeight / 2), width: len, height: hitHeight, transform: [{ rotateZ: `${angle}deg` }] }]}>
                          <View style={[styles.lineShape, { left: 0, top: (hitHeight - Math.max(1, strokeWidth)) / 2, width: lineDrawWidth, height: Math.max(1, strokeWidth), backgroundColor: strokeColor }]} />
                          {draftShape.tool === TOOL_ARROW && idx === points.length - 2 ? renderArrowHead(strokeWidth, hitHeight / 2, `draft-arrow-head-${idx}`) : null}
                        </View>
                      );
                    })}
                  </View>
                );
              }
              const left = Math.min(draftShape.start.x, draftEnd.x) * 100;
              const top = Math.min(draftShape.start.y, draftEnd.y) * 100;
              const widthPct = Math.max(Math.abs(draftEnd.x - draftShape.start.x) * 100, 0.6);
              const heightPct = Math.max(Math.abs(draftEnd.y - draftShape.start.y) * 100, 0.6);
              const isEllipse = draftShape.tool === TOOL_CIRCLE;
              const isCloudBox = draftShape.tool === TOOL_CLOUD;
              return (
                <View
                  pointerEvents="none"
                  style={[
                    styles.draftShape,
                    {
                      left: `${left}%`,
                      top: `${top}%`,
                      width: `${widthPct}%`,
                      height: `${heightPct}%`,
                      borderColor: strokeColor,
                      borderWidth: Math.max(1, strokeWidth),
                      borderRadius: isEllipse ? 999 : isCloudBox ? 18 * zoomScale : 2,
                      borderStyle: isCloudBox ? 'dashed' : 'solid',
                    },
                  ]}
                />
              );
            })()}
            {draftStart && !draftShape && <View style={[styles.draftPoint, { left: `${draftStart.x * 100}%`, top: `${draftStart.y * 100}%`, width: 14 * zoomScale, height: 14 * zoomScale, borderRadius: 7 * zoomScale, borderWidth: Math.max(2, 2 * zoomScale), transform: [{ translateX: -(7 * zoomScale) }, { translateY: -(7 * zoomScale) }] }]} />}
            {drawingToolActive && <View pointerEvents="auto" style={styles.canvasTouchLayer} {...drawingPanResponder.panHandlers} />}
          </View>
        </View>
      </View>
    );
  }

  function renderRightRail() {
    return (
      <View pointerEvents="box-none" style={[styles.rightRail, { width: sideRailWidth }]}>
        <View style={[styles.toolRailBubble, { maxHeight: toolRailMaxHeight }]}>
          <ScrollView
            style={[styles.toolScroll, { maxHeight: toolScrollMaxHeight }]}
            contentContainerStyle={styles.toolScrollContent}
            showsVerticalScrollIndicator={false}
          >
          {MARKUP_TOOLS.map((item) => (
              <ToolButton
                key={item.key}
                item={item}
                active={tool === item.key}
                onPress={() => {
                  if (tool === item.key) {
                    setTool(TOOL_SELECT);
                    setPendingCloudText('');
                    setCloudVisible(false);
                    setEditingCloudAnn(null);
                    if (item.key === TOOL_POLYLINE) resetPolylineDraft();
                    if (item.key === TOOL_ICON) setIconPickerVisible(false);
                    if (item.key === TOOL_NOTE) {
                      setNoteEditor(null);
                      pendingNoteTextRef.current = '';
                      setPendingNoteText('');
                    }
                    return;
                  }
                  if (tool === TOOL_POLYLINE) resetPolylineDraft();
                  setSelectedPin(null);
                  if (item.key === TOOL_ICON) {
                    setIconPickerVisible(true);
                    setTool(item.key);
                    return;
                  }
                  if (item.key === TOOL_CLOUD) {
                    const selectedIsCloud = selectedAnn?.shape_type === 'note' && isCloudNote(selectedAnn.note);
                    if (selectedIsCloud) {
                      setEditingCloudAnn(selectedAnn);
                      setCloudText(cloudParse(selectedAnn.note).text || '');
                    } else {
                      setEditingCloudAnn(null);
                      setCloudText('');
                    }
                    setCloudVisible(true);
                    setTool(item.key);
                    return;
                  }
                  if (item.key === TOOL_NOTE) {
                    setPinEditor(null);
                    setNoteEditor(null);
                    pendingNoteTextRef.current = '';
                    setPendingNoteText('');
                    setTool(item.key);
                    return;
                  }
                  setPendingCloudText('');
                  setCloudVisible(false);
                  setEditingCloudAnn(null);
                  setTool(item.key);
                }}
              />
            ))}
          </ScrollView>
          <View style={styles.toolDivider} />
          <View style={styles.toolFixedGroup}>
            {allowSiteSelection ? (
              <Pressable style={styles.toolBtn} onPress={() => setMenuVisible(true)}><Text style={styles.wrenchToolIcon}>🔧</Text></Pressable>
            ) : null}
            <Pressable style={styles.toolBtn} onPress={() => setColorVisible(true)}>
              <View style={[styles.colorWheelIcon, { borderColor: strokeColor }]}><View style={[styles.colorWheelDot, { backgroundColor: strokeColor }]} /></View>
            </Pressable>
            <Pressable style={styles.toolBtn} onPress={() => setWidthVisible(true)}>
              <View style={styles.widthGlyph}>
                <View style={[styles.widthGlyphLine, { height: 1 }]} />
                <View style={[styles.widthGlyphLine, { height: 3 }]} />
                <View style={[styles.widthGlyphLine, { height: 5 }]} />
              </View>
              <Text style={styles.widthToolPill}>{strokeWidth}</Text>
            </Pressable>
            <View style={styles.toolDivider} />
            <Pressable style={[styles.deleteBtn, !selectedAnn && styles.disabled]} disabled={!selectedAnn} onPress={deleteSelected}><Text style={styles.deleteBtnText}>🗑</Text></Pressable>
          </View>
        </View>
      </View>
    );
  }

  function renderPageNav() {
    const canGoPrev = currentPageIndex > 0;
    const canGoNext = currentPageIndex >= 0 && currentPageIndex < pages.length - 1;
    return (
      <View pointerEvents="box-none" style={styles.pageNavOverlay}>
        <Pressable
          style={[styles.pageArrowBtn, !canGoPrev && styles.pageArrowBtnDisabled]}
          disabled={!canGoPrev}
          onPress={() => selectPageByIndex(currentPageIndex - 1)}
        >
          <Text style={styles.pageArrowText}>←</Text>
        </Pressable>
        <View style={styles.pageNavCenter}>
          <Pressable style={styles.pageCountBtn} onPress={showGoPage} disabled={!pageCount}>
            <Text style={styles.pageCountText}>{currentPageNumber || 0} / {pageCount || 0}</Text>
            <Text style={styles.pageCountSub}>{t("Go...")}</Text>
          </Pressable>
          <Pressable style={styles.fullScreenBtn} onPress={() => setFullScreen((prev) => !prev)}>
            <Text style={styles.fullScreenBtnText}>{fullScreen ? 'Exit Full Screen' : 'Full Screen'}</Text>
          </Pressable>
        </View>
        <Pressable
          style={[styles.pageArrowBtn, !canGoNext && styles.pageArrowBtnDisabled]}
          disabled={!canGoNext}
          onPress={() => selectPageByIndex(currentPageIndex + 1)}
        >
          <Text style={styles.pageArrowText}>→</Text>
        </Pressable>
      </View>
    );
  }

  function renderCloudModal() {
    return (
      <Modal visible={cloudVisible} transparent animationType="fade" onRequestClose={() => { setCloudVisible(false); setEditingCloudAnn(null); }}>
        <KeyboardAvoidingView
          style={styles.keyboardModalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => { setCloudVisible(false); setEditingCloudAnn(null); }} />
          <Pressable style={styles.cloudModal} onPress={(event) => event.stopPropagation?.()}>
            <Text style={styles.modalTitle}>{editingCloudAnn?.id ? 'Edit Cloud' : 'Add Cloud'}</Text>
            <Text style={styles.resultText}>{editingCloudAnn?.id ? 'Update the cloud text.' : 'Enter the cloud text, then tap the page to place it.'}</Text>
            <TextInput
              value={cloudText}
              onChangeText={setCloudText}
              placeholder={t("Cloud text")}
              autoCapitalize="none"
              style={styles.cloudInput}
              multiline
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.secondaryModalBtn} onPress={() => { setCloudVisible(false); setEditingCloudAnn(null); setCloudText(''); if (!pendingCloudText) setTool(TOOL_SELECT); }}>
                <Text style={styles.secondaryModalBtnText}>{t("Cancel")}</Text>
              </Pressable>
              <Pressable style={styles.primaryModalBtn} onPress={saveCloudText}>
                <Text style={styles.primaryModalBtnText}>{editingCloudAnn?.id ? 'Save' : 'Place'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  function renderGoPageModal() {
    return (
      <Modal visible={goPageVisible} transparent animationType="fade" onRequestClose={() => setGoPageVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setGoPageVisible(false)}>
          <Pressable style={styles.goPageModal} onPress={(event) => event.stopPropagation?.()}>
            <Text style={styles.modalTitle}>{t("Go to Page")}</Text>
            <Text style={styles.resultText}>Enter a page number from 1 to {pageCount || 1}.</Text>
            <TextInput
              style={[styles.textInput, styles.goPageInput]}
              keyboardType="number-pad"
              value={goPageText}
              onChangeText={setGoPageText}
              placeholder={t("Page number")}
              placeholderTextColor="#94a3b8"
              autoFocus
            />
            <View style={[styles.sideActions, styles.goPageActions]}>
              <Pressable style={[styles.cancelBtn, styles.goPageActionBtn]} onPress={() => setGoPageVisible(false)}><Text style={styles.cancelBtnText}>{t("Cancel")}</Text></Pressable>
              <Pressable style={[styles.saveBtn, styles.goPageActionBtn]} onPress={submitGoPage}><Text style={styles.saveBtnText}>{t("Go")}</Text></Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  function renderTags() {
    return (
      <Modal visible={tagsVisible} transparent animationType="fade" onRequestClose={() => setTagsVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setTagsVisible(false)}>
          <View style={styles.tagsModal}>
            <Text style={styles.modalTitle}>{t("Tags")}</Text>
            <View style={styles.tagsGrid}>
              {CATEGORY_FILTERS.map((item) => (
                <Pressable
                  key={item.key}
                  style={[styles.tagOption, category === item.key && styles.tagOptionActive, item.key !== 'all' && category === item.key && styles.tagOptionFiltered]}
                  onPress={() => { setCategory(item.key); setTagsVisible(false); }}
                >
                  <Text style={[styles.tagOptionText, category === item.key && styles.tagOptionTextActive]}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>
    );
  }

  function renderColorPicker() {
    return (
      <Modal visible={colorVisible} transparent animationType="fade" onRequestClose={() => setColorVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setColorVisible(false)}>
          <View style={styles.pickerModal}>
            <Text style={styles.modalTitle}>{t("Color")}</Text>
            <View style={styles.colorGrid}>
              {MARKUP_COLORS.map((value) => (
                <Pressable
                  key={value}
                  style={[styles.colorOption, { backgroundColor: value }, strokeColor === value && styles.colorOptionActive]}
                  onPress={() => { setStrokeColor(value); applySelectedAnnotationStyle({ stroke_color: value }); setColorVisible(false); }}
                />
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>
    );
  }

  function renderWidthPicker() {
    return (
      <Modal visible={widthVisible} transparent animationType="fade" onRequestClose={() => setWidthVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setWidthVisible(false)}>
          <View style={styles.pickerModal}>
            <Text style={styles.modalTitle}>{t("Line Width")}</Text>
            {MARKUP_WIDTHS.map((value) => (
              <Pressable
                key={value}
                style={[styles.widthOption, strokeWidth === value && styles.widthOptionActive]}
                onPress={() => { setStrokeWidth(value); applySelectedAnnotationStyle({ stroke_width: value }); setWidthVisible(false); }}
              >
                <View style={[styles.widthPreviewLine, { height: value, borderRadius: value / 2, backgroundColor: strokeColor }]} />
                <Text style={[styles.widthOptionText, strokeWidth === value && styles.widthOptionTextActive]}>{value}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    );
  }

  function renderIconPicker() {
    return (
      <Modal visible={iconPickerVisible} transparent animationType="fade" onRequestClose={() => setIconPickerVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setIconPickerVisible(false)}>
          <View style={[styles.pickerModal, styles.iconPickerModal]}>
            <Text style={[styles.modalTitle, styles.iconPickerTitle]}>{t("Icon")}</Text>
            <View style={styles.iconPickerGrid}>
              <Pressable
                style={[styles.iconChoice, pendingIconNote === ICON_NOTE_CHECK && styles.iconChoiceActive]}
                onPress={() => { setPendingIconNote(ICON_NOTE_CHECK); setTool(TOOL_ICON); setIconPickerVisible(false); }}
              >
                <Text style={[styles.iconChoiceText, { color: '#16a34a' }]}>✓</Text>
                <Text style={styles.iconChoiceLabel}>{t("Check")}</Text>
              </Pressable>
              <Pressable
                style={[styles.iconChoice, pendingIconNote === ICON_NOTE_X && styles.iconChoiceActive]}
                onPress={() => { setPendingIconNote(ICON_NOTE_X); setTool(TOOL_ICON); setIconPickerVisible(false); }}
              >
                <Text style={[styles.iconChoiceText, { color: '#dc2626' }]}>×</Text>
                <Text style={styles.iconChoiceLabel}>X</Text>
              </Pressable>
              <Pressable
                style={[styles.iconChoice, pendingIconNote === ICON_NOTE_OUTLET && styles.iconChoiceActive]}
                onPress={() => { setPendingIconNote(ICON_NOTE_OUTLET); setTool(TOOL_ICON); setIconPickerVisible(false); }}
              >
                <OutletIconMark size={32} color="#dc2626" />
                <Text style={styles.iconChoiceLabel}>{t("Outlet")}</Text>
              </Pressable>
              <Pressable
                style={[styles.iconChoice, pendingIconNote === ICON_NOTE_BREAKER && styles.iconChoiceActive]}
                onPress={() => { setPendingIconNote(ICON_NOTE_BREAKER); setTool(TOOL_ICON); setIconPickerVisible(false); }}
              >
                <BreakerBoxIconMark size={32} color="#dc2626" />
                <Text style={styles.iconChoiceLabel}>{t("Breaker")}</Text>
              </Pressable>
              <Pressable
                style={[styles.iconChoice, pendingIconNote === ICON_NOTE_BLUEPRINT && styles.iconChoiceActive]}
                onPress={() => { setPendingIconNote(ICON_NOTE_BLUEPRINT); setTool(TOOL_ICON); setIconPickerVisible(false); }}
              >
                <BlueLayoutIconMark size={32} color="#2563eb" />
                <Text style={styles.iconChoiceLabel}>{t("Drywall Patch")}</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    );
  }

  function renderMenu() {
    if (!allowSiteSelection) return null;
    const actions = [];
    if (canRename) actions.push({ label: 'Rename / Reorder Pages', onPress: () => { setMenuVisible(false); setPagesVisible(true); } });
    actions.push({ label: 'Search Pins', onPress: () => { setMenuVisible(false); setSearchVisible(true); } });
    const perm = payload?.sitewalk_permission || {};
    const toggleMenuPerm = async (key) => {
      if (!selectedSiteId && !selectedSiteName) {
        Alert.alert(t("SiteWalk Access"), t("Select a site before changing access settings."));
        return;
      }
      const nextPerm = { ...perm, [key]: !Boolean(perm[key]) };
      setPayload((prev) => ({ ...(prev || {}), sitewalk_permission: nextPerm }));
      try {
        const response = await saveMobileRedlineSitewalkPermission(portalUrl, token, { site_id: selectedSiteId, sitewalk_desc: currentSitewalk, ...nextPerm });
        setPayload((prev) => ({ ...(prev || {}), sitewalk_permission: response.sitewalk_permission || nextPerm }));
      } catch (err) {
        setPayload((prev) => ({ ...(prev || {}), sitewalk_permission: perm }));
        Alert.alert('Save Rights Failed', err?.message || 'Unable to save SiteWalk permissions.');
      }
    };
    return (
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setMenuVisible(false)}>
          <Pressable style={styles.menuModal} onPress={(event) => event.stopPropagation?.()}>
            <Text style={styles.modalTitle}>{t("Menu")}</Text>
            {canRights ? (
              <View style={styles.menuRightsBlock}>
                <Text style={styles.menuSectionTitle}>{t("SiteWalk Access")}</Text>
                {[
                  ['allow_field_workers_edit', 'Allow tech edit'],
                  ['allow_customers', 'Allow customer'],
                  ['allow_subcontractors', 'Allow subcontractor'],
                ].map(([key, label]) => (
                  <Pressable key={key} style={styles.checkRow} onPress={() => toggleMenuPerm(key)}>
                    <Text style={styles.checkBox}>{perm[key] ? '☑' : '☐'}</Text>
                    <Text style={styles.checkText}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {actions.map((action) => <Pressable key={action.label} style={styles.menuAction} onPress={action.onPress}><Text style={styles.menuActionText}>{action.label}</Text></Pressable>)}
          </Pressable>
        </Pressable>
      </Modal>
    );
  }


  function openWifiSettingsForX4() {
    if (Platform.OS === 'android' && typeof Linking.sendIntent === 'function') {
      Linking.sendIntent('android.settings.WIFI_SETTINGS').catch(() => {
        Linking.openSettings?.().catch(() => {});
      });
      return;
    }

    Linking.openURL('App-Prefs:WIFI').catch(() => {
      Linking.openSettings?.().catch(() => {});
    });
  }

  function renderCamera360Manager() {
    return (
      <Modal visible={camera360Visible} transparent animationType="fade" onRequestClose={() => setCamera360Visible(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setCamera360Visible(false)} />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 18 : 0}
            style={styles.camera360KeyboardAvoider}
          >
            <View style={styles.camera360Modal}>
              <View style={styles.pinOptionsHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>{t("360 Camera")}</Text>
                  <Text style={styles.pinOptionsSubtitle}>Insta360 X4 Wi-Fi / OSC</Text>
                </View>
                <Pressable style={styles.pinOptionsCloseBtn} onPress={() => setCamera360Visible(false)}><Text style={styles.pinOptionsCloseText}>×</Text></Pressable>
              </View>

              <ScrollView
                style={styles.camera360Scroll}
                contentContainerStyle={styles.camera360ScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
              >
                <View style={styles.camera360StatusCard}>
                  {insta360Status ? (
                    formatInsta360StatusLines(insta360Status).map((line) => (
                      <Text key={line} style={styles.camera360StatusText}>{line}</Text>
                    ))
                  ) : (
                    <Text style={styles.camera360StatusText}>No status checked yet.</Text>
                  )}
                </View>

                {insta360Status?.osc?.reachable ? (
                  <View style={styles.camera360ConnectedBanner}>
                    <Text style={styles.camera360ConnectedIcon}>✓</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.camera360ConnectedTitle}>X4 connected</Text>
                      <Text style={styles.camera360ConnectedText}>OSC is reachable from this device.</Text>
                    </View>
                  </View>
                ) : null}

                <View style={styles.camera360WifiForm}>
                  <Text style={styles.camera360FieldLabel}>Camera Wi-Fi Name</Text>
                  <Text style={styles.camera360HelpText}>Leave blank to ask iOS to join the first visible X4 network. If the camera is not advertising Wi-Fi, open the camera Wi-Fi/password screen first or connect once from iOS Settings.</Text>
                  <TextInput
                    style={styles.camera360Input}
                    value={insta360WifiSsid}
                    onChangeText={setInsta360WifiSsid}
                    placeholder="X4 0QB5CJ.OSC"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    returnKeyType="next"
                  />
                  <Text style={styles.camera360FieldLabel}>Camera Wi-Fi Password</Text>
                  <TextInput
                    style={styles.camera360Input}
                    value={insta360WifiPassword}
                    onChangeText={setInsta360WifiPassword}
                    placeholder="Password"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                  />
                </View>

                {insta360ConnectMessage ? <Text style={styles.camera360ConnectMessage}>{insta360ConnectMessage}</Text> : null}

                <View style={styles.camera360ActionRow}>
                  <Pressable style={[styles.camera360PrimaryBtn, (insta360Connecting || insta360Checking) && styles.disabled]} disabled={insta360Connecting || insta360Checking} onPress={handleConnectInsta360Camera}>
                    <Text style={styles.camera360PrimaryBtnText}>{insta360Connecting ? 'Connecting...' : (Platform.OS === 'android' ? 'Open Wi-Fi Settings' : 'Connect to Camera')}</Text>
                  </Pressable>
                  <Pressable style={[styles.camera360SoftBtn, insta360Checking && styles.disabled]} disabled={insta360Checking} onPress={() => refreshInsta360CameraStatus({ showAlert: false })}>
                    <Text style={styles.camera360SoftBtnText}>{insta360Checking ? 'Checking...' : 'Check Status'}</Text>
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    );
  }

  function render360CaptureModal() {
    const pin = camera360CapturePin;
    if (!pin) return null;
    const label = pinDisplayLabel(pin) || (pin?.id ? `Pin ${pin.id}` : 'Pin');
    return (
      <Modal visible={!!pin} transparent animationType="slide" onRequestClose={() => setCamera360CapturePin(null)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => { if (!camera360CaptureBusy) setCamera360CapturePin(null); }} />
          <View style={styles.camera360CaptureModal}>
            <View style={styles.pinOptionsHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>{t("Capture 360 Photo")}</Text>
                <Text style={styles.pinOptionsSubtitle}>{label}</Text>
              </View>
              <Pressable style={[styles.pinOptionsCloseBtn, camera360CaptureBusy && styles.disabled]} disabled={camera360CaptureBusy} onPress={() => setCamera360CapturePin(null)}><Text style={styles.pinOptionsCloseText}>×</Text></Pressable>
            </View>


            <View style={styles.camera360StatusCard}>
              {insta360Status ? (
                <>
                  <Text style={styles.camera360StatusText}>X4 Wi-Fi reachable: {insta360Status.osc?.reachable ? 'Yes' : 'No'}</Text>
                  <Text style={styles.camera360StatusText}>Model: {insta360Status.osc?.model || 'Unknown'}</Text>
                  <Text style={styles.camera360StatusText}>Connected: {insta360Status.connected ? 'Yes' : 'No'}</Text>
                </>
              ) : (
                <Text style={styles.camera360StatusText}>Press Check Connection before capturing.</Text>
              )}
              {!!camera360CaptureStatus && <Text style={styles.camera360CaptureStatus}>{camera360CaptureStatus}</Text>}
            </View>

            <View style={styles.camera360ActionRow}>
              <Pressable style={[styles.camera360SoftBtn, (insta360Checking || camera360CaptureBusy) && styles.disabled]} disabled={insta360Checking || camera360CaptureBusy} onPress={() => refreshInsta360CameraStatus({ showAlert: false })}>
                <Text style={styles.camera360SoftBtnText}>{insta360Checking ? 'Checking...' : 'Check Connection'}</Text>
              </Pressable>
              <Pressable style={[styles.camera360PrimaryBtn, camera360CaptureBusy && styles.disabled]} disabled={camera360CaptureBusy} onPress={() => captureAndUpload360ForPin(pin)}>
                <Text style={styles.camera360PrimaryBtnText}>{camera360CaptureBusy ? 'Capturing...' : 'Capture'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  function renderCameraPhotoPrompt() {
    const pin = cameraPhotoPin;
    return (
      <Modal visible={!!pin} transparent animationType="fade" onRequestClose={() => closeCameraPhotoPrompt(pin)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => closeCameraPhotoPrompt(pin)} />
          <View style={styles.photoPromptModal}>
            <Text style={styles.modalTitle}>{t("Add Photo")}</Text>
            <Text style={styles.photoPromptText}>{t("Choose how you want to attach the photo.")}</Text>
            <View style={styles.photoPromptActions}>
              <Pressable style={styles.photoPromptBtn} onPress={(event) => { event?.stopPropagation?.(); queueCameraPhotoForPin(pin, 'camera', false); }}><Text style={styles.photoPromptBtnText}>{t("Take Photo")}</Text></Pressable>
              <Pressable style={styles.photoPromptBtn} onPress={(event) => { event?.stopPropagation?.(); queueCameraPhotoForPin(pin, 'library', false); }}><Text style={styles.photoPromptBtnText}>{t("Upload Image")}</Text></Pressable>
              <Pressable style={[styles.photoPromptBtn, styles.photoPromptCancel]} onPress={(event) => { event?.stopPropagation?.(); closeCameraPhotoPrompt(pin); }}><Text style={styles.photoPromptCancelText}>{t("Cancel")}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  function renderPhotoPinOptions() {
    const pin = photoOptionsPin;
    if (!pin) return null;
    const label = pinDisplayLabel(pin) || (pinKind(pin) === 'camera_misc' ? 'Photo' : `Pin ${pin.id}`);
    const hasRegularPhoto = pinHasRegularPhoto(pin);
    const has360 = pinHas360Photo(pin);
    return (
      <Modal visible={!!pin} transparent animationType="fade" onRequestClose={() => setPhotoOptionsPin(null)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPhotoOptionsPin(null)} />
          <View style={styles.pinOptionsModal}>
            <View style={styles.pinOptionsHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>{t("Pin Options")}</Text>
                <Text style={styles.pinOptionsSubtitle}>{label}</Text>
              </View>
              <Pressable style={styles.pinOptionsCloseBtn} onPress={() => setPhotoOptionsPin(null)}><Text style={styles.pinOptionsCloseText}>×</Text></Pressable>
            </View>
            <View style={styles.pinOptionsGrid}>
              {hasRegularPhoto ? (
                <Pressable style={styles.pinOptionsMarkupBtn} onPress={() => viewPhotoPin(pin)}><Text style={styles.pinOptionsMarkupText}>{t("View / Markup Photo")}</Text></Pressable>
              ) : (
                <View style={styles.pinOptionsReadOnlyCard}>
                  <Text style={styles.pinOptionsReadOnlyTitle}>{t("No photo linked")}</Text>
                </View>
              )}
            </View>
            <View style={styles.pinOptions360Row}>
              <View style={styles.pinOptions360Info}>
                <Text style={styles.pinOptions360Title}>{t("360 Photo")}</Text>
                <Text style={styles.pinOptions360Sub}>{has360 ? 'Photo linked' : 'No 360 photo linked'}</Text>
              </View>
              <View style={styles.pinOptions360Actions}>
                {has360 ? (
                  <Pressable style={styles.pinOptions360ViewBtn} onPress={() => view360Pin(pin)}><Text style={styles.pinOptions360ViewText}>{t("View 360 Photo")}</Text></Pressable>
                ) : null}
              </View>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  function renderPinWhiteboard() {
    const pin = pinWhiteboardPin;
    if (!pin) return null;
    const label = pinDisplayLabel(pin) || clean(pin?.label || pin?.name || pin?.pin_name || pin?.title) || (pin?.id ? `Pin ${pin.id}` : 'Pin');
    const maxFontSize = isTablet ? 170 : 96;
    return (
      <Modal visible={!!pin} animationType="fade" presentationStyle="fullScreen" onRequestClose={() => setPinWhiteboardPin(null)}>
        <SafeAreaView style={styles.pinNameWhiteboardScreen}>
          <View style={styles.pinNameWhiteboardStage}>
            <Text
              style={[styles.pinNameWhiteboardText, { fontSize: maxFontSize }]}
              numberOfLines={3}
              adjustsFontSizeToFit
              minimumFontScale={0.18}
            >
              {label}
            </Text>
          </View>
          <Pressable style={styles.pinNameWhiteboardExitBtn} onPress={() => setPinWhiteboardPin(null)}>
            <Text style={styles.pinNameWhiteboardExitText}>×</Text>
          </Pressable>
        </SafeAreaView>
      </Modal>
    );
  }

  function renderPinEditor() {
    const kind = pinKind(pinEditor);
    const isPhotoStylePin = kind === 'photo' || kind === 'photo360' || kind === 'camera_misc';
    const tagOptions = CATEGORY_FILTERS.filter((item) => item.key !== 'all');
    const currentTag = clean(pinEditor?.tag).toLowerCase();
    const pinEditorNameValid = Boolean(clean(pinEditor?.label));
    const pinEditorTagValid = tagOptions.some((item) => item.key === currentTag);
    const pinEditorCanSave = pinEditorNameValid && pinEditorTagValid;
    return (
      <Modal visible={!!pinEditor} transparent animationType="fade" onRequestClose={() => setPinEditor(null)}>
        <KeyboardAvoidingView
          style={styles.pinEditorBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPinEditor(null)} />
          <Pressable style={styles.pinEditorModal} onPress={(event) => event.stopPropagation?.()}>
            <View style={styles.pinEditorHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.pinEditorTitle}>{t("Edit Pin")}</Text>
                <Text style={styles.pinEditorSubtitle}>{pinDisplayLabel(pinEditor) || 'Pin details'}</Text>
              </View>
              <Pressable style={styles.pinEditorCloseBtn} onPress={() => setPinEditor(null)}>
                <Text style={styles.pinEditorCloseText}>×</Text>
              </Pressable>
            </View>

            <ScrollView
              style={styles.pinEditorScroll}
              contentContainerStyle={styles.pinEditorScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.fieldLabel}>{t("Pin Name")}</Text>
              <TextInput
                style={[styles.textInput, styles.pinEditorInput, !pinEditorNameValid && styles.pinEditorInputRequired]}
                value={pinEditor?.label || ''}
                onChangeText={(text) => setPinEditor((prev) => ({ ...(prev || {}), label: text }))}
                placeholder={t("Enter pin name")}
                placeholderTextColor="#94a3b8"
              />
              {!pinEditorNameValid ? <Text style={styles.pinEditorRequiredText}>{t("Pin name is required.")}</Text> : null}

              <Text style={styles.fieldLabel}>{t("Tag")}</Text>
              <View style={styles.pinEditorTagGrid}>
                {tagOptions.map((item) => {
                  const active = currentTag === item.key;
                  return (
                    <Pressable key={item.key} style={[styles.pinEditorTagOption, !pinEditorTagValid && styles.pinEditorTagOptionRequired, active && styles.pinEditorTagOptionActive]} onPress={() => setPinEditor((prev) => ({ ...(prev || {}), tag: item.key }))}>
                      <Text style={[styles.pinEditorTagOptionText, active && styles.pinEditorTagOptionTextActive]}>{item.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {!pinEditorTagValid ? <Text style={styles.pinEditorRequiredText}>{t("Please select a tag.")}</Text> : null}

              {!isPhotoStylePin ? (
                <>
                  <Text style={styles.fieldLabel}>{t("Task")}</Text>
                  <TextInput
                    style={[styles.textInput, styles.pinEditorInput]}
                    value={pinEditor?.sr_task || ''}
                    onChangeText={(text) => setPinEditor((prev) => ({ ...(prev || {}), sr_task: text }))}
                  />
                  <Text style={styles.fieldLabel}>{t("Location")}</Text>
                  <TextInput
                    style={[styles.textInput, styles.pinEditorInput]}
                    value={pinEditor?.sr_location || ''}
                    onChangeText={(text) => setPinEditor((prev) => ({ ...(prev || {}), sr_location: text }))}
                  />
                </>
              ) : null}
            </ScrollView>

            <View style={styles.pinEditorActions}>
              <Pressable style={styles.pinEditorCancelBtn} onPress={() => setPinEditor(null)}><Text style={styles.pinEditorCancelText}>{t("Cancel")}</Text></Pressable>
              <Pressable style={[styles.pinEditorSaveBtn, !pinEditorCanSave && styles.pinEditorSaveBtnDisabled]} disabled={!pinEditorCanSave} onPress={savePinEditor}><Text style={styles.pinEditorSaveText}>{t("Save")}</Text></Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  function renderNoteEditor() {
    const isExisting = !!noteEditor?.pin?.id;
    return (
      <Modal visible={!!noteEditor} transparent animationType="fade" onRequestClose={() => setNoteEditor(null)}>
        <KeyboardAvoidingView
          style={styles.noteKeyboardAvoidingWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <Pressable style={styles.centerModalBackdrop} onPress={() => { setNoteEditor(null); if (!isExisting && !pendingNoteTextRef.current && !pendingNoteText) setTool(TOOL_SELECT); }}>
            <Pressable style={styles.noteModalCard} onPress={(event) => event.stopPropagation?.()}>
              <Text style={styles.noteModalTitle}>{isExisting ? 'Note' : 'New Note'}</Text>
              <Text style={styles.fieldLabel}>{t("Text")}</Text>
              <TextInput
                style={[styles.textInput, styles.noteTextInput]}
                multiline
                textAlignVertical="top"
                value={noteEditor?.text || ''}
                onChangeText={(text) => {
                  noteEditorTextRef.current = text;
                  setNoteEditor((prev) => ({ ...(prev || {}), text }));
                }}
                placeholder={isExisting ? 'Enter note text' : 'Enter note text'}
                placeholderTextColor="#94a3b8"
              />
              <View style={styles.noteModalActions}>
                <Pressable style={[styles.noteActionBtn, styles.noteCloseBtn]} onPress={() => { setNoteEditor(null); if (!isExisting && !pendingNoteTextRef.current && !pendingNoteText) setTool(TOOL_SELECT); }}><Text style={styles.noteCloseBtnText}>{t("Close")}</Text></Pressable>
                {isExisting ? <Pressable style={[styles.noteActionBtn, styles.noteDeleteBtn]} onPress={() => deleteNotePin(noteEditor?.pin)}><Text style={styles.noteDeleteBtnText}>{t("Delete")}</Text></Pressable> : null}
                <Pressable style={[styles.noteActionBtn, styles.noteSaveBtn]} onPress={saveNoteEditor}><Text style={styles.noteSaveBtnText}>{isExisting ? 'Save' : 'Save Note'}</Text></Pressable>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  function renderRights() {
    const perm = payload?.sitewalk_permission || {};
    const toggle = async (key) => {
      if (!selectedSiteId && !selectedSiteName) {
        Alert.alert(t("SiteWalk Access"), t("Select a site before changing access settings."));
        return;
      }
      const nextPerm = { ...perm, [key]: !Boolean(perm[key]) };
      setPayload((prev) => ({ ...(prev || {}), sitewalk_permission: nextPerm }));
      try {
        const response = await saveMobileRedlineSitewalkPermission(portalUrl, token, { site_id: selectedSiteId, sitewalk_desc: currentSitewalk, ...nextPerm });
        setPayload((prev) => ({ ...(prev || {}), sitewalk_permission: response.sitewalk_permission || nextPerm }));
      } catch (err) {
        setPayload((prev) => ({ ...(prev || {}), sitewalk_permission: perm }));
        Alert.alert('Save Rights Failed', err?.message || 'Unable to save page rights.');
      }
    };
    return (
      <Modal visible={rightsVisible} transparent animationType="slide" onRequestClose={() => setRightsVisible(false)}>
        <View style={styles.sideModalBackdrop}>
          <View style={styles.sidePanel}>
            <Text style={styles.modalTitle}>{t("Page Rights")}</Text>
            {[['allow_field_workers_edit', 'Field workers can edit'], ['allow_customers', 'Customers can view'], ['allow_subcontractors', 'Subcontractors can view']].map(([key, label]) => (
              <Pressable key={key} style={styles.checkRow} onPress={() => toggle(key)}><Text style={styles.checkBox}>{perm[key] ? '☑' : '☐'}</Text><Text style={styles.checkText}>{label}</Text></Pressable>
            ))}
            <View style={styles.sideActions}>
              <Pressable style={styles.cancelBtn} onPress={() => setRightsVisible(false)}><Text style={styles.cancelBtnText}>{t("Close")}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  function renderPageManager() {
    const localPages = pages;
    const setLocalPages = (next) => setPayload((prev) => ({ ...(prev || {}), pages: next }));
    const movePage = (index, direction) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= localPages.length) return;
      const next = [...localPages];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      setLocalPages(next);
    };
    async function savePages() {
      try {
        await saveMobileRedlinePageOrder(portalUrl, token, { site_id: selectedSiteId, sitewalk_desc: currentSitewalk, updates: localPages.map((p) => ({ page_id: p.id, display_name: p.display_name })), order_ids: localPages.map((p) => p.id) });
        setPagesVisible(false);
        await load({ sitewalkDesc: currentSitewalk, silent: true });
      } catch (err) {
        Alert.alert('Save Pages Failed', err?.message || 'Unable to save pages.');
      }
    }
    return (
      <Modal visible={pagesVisible} transparent animationType="fade" onRequestClose={() => setPagesVisible(false)}>
        <KeyboardAvoidingView style={styles.centeredModalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.centeredPanelWide}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>{t("Rename / Reorder Pages")}</Text>
              <Pressable style={styles.modalClosePill} onPress={() => setPagesVisible(false)}><Text style={styles.modalClosePillText}>{t("Close")}</Text></Pressable>
            </View>
            <Text style={styles.modalHelpText}>{t("Use the arrows to move pages up or down. Rename pages in the shorter text field, then press Save.")}</Text>
            <ScrollView style={styles.pageManagerList} keyboardShouldPersistTaps="handled">
              {localPages.map((p, idx) => (
                <View key={p.id} style={styles.pageEditRowCompact}>
                  <Text style={styles.pageEditIndex}>{idx + 1}</Text>
                  <View style={styles.pageMoveButtons}>
                    <Pressable style={[styles.pageMoveBtn, idx === 0 && styles.pageMoveBtnDisabled]} disabled={idx === 0} onPress={() => movePage(idx, -1)}><Text style={styles.pageMoveBtnText}>↑</Text></Pressable>
                    <Pressable style={[styles.pageMoveBtn, idx === localPages.length - 1 && styles.pageMoveBtnDisabled]} disabled={idx === localPages.length - 1} onPress={() => movePage(idx, 1)}><Text style={styles.pageMoveBtnText}>↓</Text></Pressable>
                  </View>
                  <TextInput
                    style={[styles.textInput, styles.pageNameInput]}
                    value={p.display_name || ''}
                    onChangeText={(text) => setLocalPages(localPages.map((row) => row.id === p.id ? { ...row, display_name: text } : row))}
                    placeholder={`Page ${idx + 1}`}
                    placeholderTextColor="#94a3b8"
                  />
                </View>
              ))}
            </ScrollView>
            <View style={styles.sideActions}>
              <Pressable style={styles.cancelBtn} onPress={() => setPagesVisible(false)}><Text style={styles.cancelBtnText}>{t("Cancel")}</Text></Pressable>
              <Pressable style={styles.saveBtn} onPress={savePages}><Text style={styles.saveBtnText}>{t("Save")}</Text></Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  function renderSearch() {
    return (
      <Modal visible={searchVisible} transparent animationType="fade" onRequestClose={() => setSearchVisible(false)}>
        <KeyboardAvoidingView style={styles.centeredModalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.centeredPanel}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>{t("Search Pins")}</Text>
              <Pressable style={styles.modalClosePill} onPress={() => setSearchVisible(false)}><Text style={styles.modalClosePillText}>{t("Close")}</Text></Pressable>
            </View>
            <TextInput style={[styles.textInput, styles.searchPinsInput]} placeholder={t("Search label, task, location")} placeholderTextColor="#94a3b8" value={query} onChangeText={setQuery} />
            <Text style={styles.resultText}>{visiblePins.length} matching pins</Text>
            <ScrollView style={styles.searchPinsList} keyboardShouldPersistTaps="handled">
              {visiblePins.slice(0, 80).map((pin) => (
                <Pressable key={pin.id} style={styles.searchResult} onPress={() => { setSelectedPin(pin); setSearchVisible(false); }}>
                  <Text style={styles.searchResultTitle}>{pin.label || `Pin ${pin.id}`}</Text>
                  <Text style={styles.searchResultSub}>{pin.sr_task || pin.tag || pin.pin_type}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  function renderDotPicker() {
    const items = Array.isArray(dotOptions?.items) ? dotOptions.items : [];
    return (
      <Modal visible={dotVisible} transparent animationType="slide" onRequestClose={() => { setDotVisible(false); setDraftStart(null); }}>
        <View style={styles.sideModalBackdrop}>
          <View style={styles.sidePanelWide}>
            <Text style={styles.modalTitle}>{t("Site Record Dot")}</Text>
            <ScrollView>
              {items.slice(0, 150).map((item, idx) => (
                <Pressable key={`${item.task}-${item.name}-${idx}`} style={styles.searchResult} onPress={async () => { await createPinAt(draftStart || { x: 0.5, y: 0.5 }, { label: item.name, pin_type: 'site_record_dot', sr_location: item.location, sr_task: item.task, sr_design_count: item.design_amount }); setDotVisible(false); setDraftStart(null); }}>
                  <Text style={styles.searchResultTitle}>{item.name}</Text>
                  <Text style={styles.searchResultSub}>{item.location} · {item.task}</Text>
                </Pressable>
              ))}
              {!items.length && <Text style={styles.resultText}>{t("No site record options found.")}</Text>}
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  }

  if (loading && allowSiteSelection && !selectedSiteId && !selectedSiteName) {
    return (
      <SafeAreaView style={[styles.screen, allowSiteSelection && styles.screenSiteWalkAdmin]}>
        {renderTopControls()}
        <View style={styles.loading}>
          {redlineSitesLoading ? <ActivityIndicator size="large" color="#4f46e5" /> : null}
          <Text style={styles.loadingText}>{redlineSitesLoading ? 'Loading SiteWalk redline sites...' : 'Select a site to open SiteWalk redlines.'}</Text>
          {!!error && redlineSites.length > 0 ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return <SafeAreaView style={[styles.screen, allowSiteSelection && styles.screenSiteWalkAdmin]}><View style={styles.loading}><ActivityIndicator size="large" color="#4f46e5" /><Text style={styles.loadingText}>{t("Loading PDF Editor...")}</Text></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={[styles.screen, allowSiteSelection && styles.screenSiteWalkAdmin]}>
      {renderTopControls({ compact: fullScreen })}
      {(offlinePrecache.active || offlinePrecache.complete || offlinePrecache.error) && (
        <View style={[styles.offlineSyncBar, styles.offlineModeBar]}>
          <View style={styles.offlineSyncHeader}>
            <Text style={styles.offlineSyncText}>{offlinePrecache.error || offlinePrecache.label || 'Offline mode sync'}</Text>
            <View style={styles.offlineSyncHeaderActions}>
              {!!offlinePrecache.total && <Text style={styles.offlineSyncCount}>{offlinePrecache.done || 0}/{offlinePrecache.total}</Text>}
              {offlinePrecache.active ? (
                <Pressable style={styles.offlineSyncStopPill} onPress={stopOfflineModePrecache}>
                  <Text style={styles.offlineSyncStopPillText}>{t("Stop Sync")}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
          {!!offlinePrecache.total && (
            <View style={styles.offlineSyncTrack}>
              <View style={[styles.offlineSyncFill, { width: `${Math.max(4, Math.min(100, ((offlinePrecache.done || 0) / Math.max(1, offlinePrecache.total)) * 100))}%` }]} />
            </View>
          )}
        </View>
      )}
      {offlineSyncStatus.visible && (
        <View style={styles.offlineSyncBar}>
          <View style={styles.offlineSyncHeader}>
            <Text style={styles.offlineSyncText}>{offlineSyncStatus.text}</Text>
            {!!offlineSyncStatus.total && <Text style={styles.offlineSyncCount}>{offlineSyncStatus.done || 0}/{offlineSyncStatus.total}</Text>}
          </View>
          {!!offlineSyncStatus.total && (
            <View style={styles.offlineSyncTrack}>
              <View style={[styles.offlineSyncFill, { width: `${Math.max(4, Math.min(100, ((offlineSyncStatus.done || 0) / Math.max(1, offlineSyncStatus.total)) * 100))}%` }]} />
            </View>
          )}
        </View>
      )}
      {!!error && <Text style={styles.errorText}>{error}</Text>}
      <View style={styles.workArea}>
        <View style={styles.canvasWrap}>
          {renderCanvas()}
        </View>
        {renderRightRail()}
      </View>
      {renderPageNav()}
      {renderGoPageModal()}
      {renderCloudModal()}
      {renderTags()}
      {renderColorPicker()}
      {renderWidthPicker()}
      {renderIconPicker()}
      {renderMenu()}
      {renderCameraPhotoPrompt()}
      {renderPhotoPinOptions()}
      {renderPinEditor()}
      {renderNoteEditor()}
      {renderRights()}
      {renderPageManager()}
      {renderSearch()}
      {renderDotPicker()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#e5e7eb' },
  screenSiteWalkAdmin: { backgroundColor: '#f1f5f9' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 12, color: '#334155', fontWeight: '700' },
  topPanel: { backgroundColor: 'rgba(4,8,18,.92)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,.08)', paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8 },
  topPanelSiteWalkAdmin: { backgroundColor: '#1e293b', borderBottomColor: 'rgba(148,163,184,.30)' },
  topPanelCompact: { paddingBottom: 6 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  identityRowCompact: { marginBottom: 0 },
  userName: { color: '#e8eefc', fontSize: 15, fontWeight: '900' },
  roleText: { color: 'rgba(232,238,252,.68)', fontSize: 11, fontWeight: '700' },
  headerActionsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(122,162,255,0.45)', backgroundColor: 'rgba(122,162,255,0.12)' },
  homeHeaderBtn: { backgroundColor: 'rgba(37,99,235,.22)', borderColor: 'rgba(147,197,253,.55)' },
  headerBtnText: { color: '#dfe7ff', fontWeight: '900', fontSize: 14 },
  controlsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dropdownWrap: { flexGrow: 1, minWidth: 142, maxWidth: 360 },
  controlLabel: { color: 'rgba(232,238,252,.74)', fontSize: 10, fontWeight: '900', marginLeft: 4, marginBottom: 2 },
  dropdown: { height: 36, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center' },
  disabled: { opacity: 0.45 },
  dropdownText: { color: '#0f172a', fontSize: 13, fontWeight: '800', flex: 1 },
  dropdownCaret: { color: '#334155', fontSize: 16, fontWeight: '900' },
  emptyDropdownText: { color: '#64748b', fontSize: 13, fontWeight: '800', paddingVertical: 16, textAlign: 'center' },
  tagsControlWrap: { minWidth: 92, maxWidth: 120, flexGrow: 0 },
  tagsTopBtn: { minHeight: 36, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  tagsTopBtnActive: { backgroundColor: '#dc2626', borderColor: '#b91c1c' },
  tagsTopBtnText: { color: '#0f172a', fontSize: 13, fontWeight: '900' },
  tagsTopBtnTextActive: { color: '#ffffff' },
  tagsTopBtnSub: { maxWidth: 44, color: '#fee2e2', fontSize: 10, fontWeight: '900' },
  filtersRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 6 },
  chip: { height: 30, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff', justifyContent: 'center' },
  chipActive: { backgroundColor: '#4f46e5', borderColor: '#4f46e5' },
  chipText: { color: '#334155', fontSize: 12, fontWeight: '800' },
  chipTextActive: { color: '#fff' },
  opacityWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 6 },
  opacityLabel: { color: '#475569', fontSize: 10, fontWeight: '900' },
  opacityBtn: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  opacityBtnActive: { backgroundColor: '#0f172a' },
  opacityBtnText: { color: '#334155', fontSize: 11, fontWeight: '800' },
  opacityBtnTextActive: { color: '#fff' },
  menuBtn: { backgroundColor: '#4f46e5', borderRadius: 9, paddingHorizontal: 13, paddingVertical: 7 },
  menuBtnText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  refreshBtn: { backgroundColor: '#6366f1', borderRadius: 9, paddingHorizontal: 13, paddingVertical: 7 },
  refreshBtnText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  offlineModeBtn: { backgroundColor: '#7c3aed', borderRadius: 9, minWidth: 64, paddingHorizontal: 9, paddingVertical: 4, alignItems: 'center', justifyContent: 'center' },
  offlineModeBtnActive: { backgroundColor: '#475569' },
  offlineModeBtnText: { color: '#fff', fontSize: 10, lineHeight: 11, fontWeight: '900', textAlign: 'center' },
  stopSyncBtn: { backgroundColor: '#dc2626', borderRadius: 9, minWidth: 64, paddingHorizontal: 9, paddingVertical: 4, alignItems: 'center', justifyContent: 'center' },
  stopSyncBtnText: { color: '#fff', fontSize: 10, lineHeight: 11, fontWeight: '900', textAlign: 'center' },
  errorText: { color: '#b91c1c', backgroundColor: '#fee2e2', paddingHorizontal: 10, paddingVertical: 5, fontWeight: '800' },
  insta360TestBar: { backgroundColor: '#e0f2fe', borderBottomWidth: 1, borderBottomColor: '#bae6fd', paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  insta360TestBtn: { alignSelf: 'flex-start', backgroundColor: '#2563eb', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  insta360TestBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  insta360TestStatus: { color: '#0f172a', fontSize: 12, fontWeight: '800' },
  camera360KeyboardAvoider: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  camera360Modal: { width: '92%', maxWidth: 540, maxHeight: '82%', backgroundColor: '#ffffff', borderRadius: 16, padding: 10 },
  camera360Scroll: { width: '100%' },
  camera360ScrollContent: { paddingBottom: 4 },
  camera360CaptureModal: { width: '94%', maxWidth: 620, maxHeight: '88%', backgroundColor: '#ffffff', borderRadius: 18, padding: 16 },
  camera360StatusCard: { backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, padding: 9, gap: 3, marginTop: 8 },
  camera360StatusText: { color: '#0f172a', fontSize: 11, fontWeight: '800' },
  camera360HelpText: { color: '#475569', fontSize: 12, fontWeight: '700', lineHeight: 17, marginTop: 10 },
  camera360ConnectedBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#dcfce7', borderWidth: 1, borderColor: '#86efac', borderRadius: 12, padding: 8, marginTop: 8 },
  camera360ConnectedIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#16a34a', color: '#ffffff', fontSize: 17, fontWeight: '900', textAlign: 'center', lineHeight: 26 },
  camera360ConnectedTitle: { color: '#14532d', fontSize: 13, fontWeight: '900' },
  camera360ConnectedText: { color: '#166534', fontSize: 11, fontWeight: '800', marginTop: 1 },
  camera360WifiForm: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#dbe4ef', borderRadius: 12, padding: 8, marginTop: 8, gap: 4 },
  camera360FieldLabel: { color: '#475569', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.35 },
  camera360Input: { minHeight: 38, borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#ffffff', paddingHorizontal: 10, color: '#0f172a', fontSize: 13, fontWeight: '800' },
  camera360MiniHelp: { color: '#64748b', fontSize: 11, fontWeight: '700', lineHeight: 15, marginTop: 2 },
  camera360ConnectMessage: { color: '#0f172a', fontSize: 11, fontWeight: '800', backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 10, padding: 8, marginTop: 8 },
  camera360ActionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  camera360PrimaryBtn: { flexGrow: 1, minHeight: 38, borderRadius: 11, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  camera360PrimaryBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  camera360SoftBtn: { flexGrow: 1, minHeight: 38, borderRadius: 11, backgroundColor: '#e0f2fe', borderWidth: 1, borderColor: '#7dd3fc', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  camera360SoftBtnText: { color: '#075985', fontSize: 13, fontWeight: '900' },
  camera360PreviewBox: { minHeight: 180, borderRadius: 16, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center', padding: 18, marginTop: 12 },
  camera360PreviewTitle: { color: '#e0f2fe', fontSize: 16, fontWeight: '900', marginBottom: 8 },
  camera360PreviewText: { color: '#cbd5e1', fontSize: 12, fontWeight: '700', lineHeight: 18, textAlign: 'center' },
  camera360CaptureStatus: { color: '#0369a1', fontSize: 12, fontWeight: '900', marginTop: 8 },
  offlineSyncBar: { backgroundColor: '#0f172a', paddingHorizontal: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.12)' },
  offlineModeBar: { backgroundColor: '#064e3b' },
  offlineSyncHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  offlineSyncHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  offlineSyncText: { color: '#ffffff', fontSize: 12, fontWeight: '900', flex: 1 },
  offlineSyncCount: { color: '#cbd5e1', fontSize: 11, fontWeight: '900' },
  offlineSyncStopPill: { backgroundColor: '#dc2626', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  offlineSyncStopPillText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  offlineSyncTrack: { height: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden', marginTop: 5 },
  offlineSyncFill: { height: '100%', borderRadius: 999, backgroundColor: '#22c55e' },
  workArea: { flex: 1, position: 'relative' },
  canvasWrap: { flex: 1 },
  whiteboardBadgeWrap: { position: 'absolute', left: 0, right: 0, top: 10, alignItems: 'center', zIndex: 300, elevation: 300 },
  whiteboardBadge: { maxWidth: '94%', minHeight: 42, borderRadius: 999, backgroundColor: 'rgba(15,23,42,0.92)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', paddingHorizontal: 8, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 7, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, elevation: 12 },
  whiteboardBadgeBtn: { minHeight: 30, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(255,255,255,0.10)', paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  whiteboardBadgeBtnText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  whiteboardBadgeLabel: { color: '#ffffff', fontSize: 11, fontWeight: '900', letterSpacing: 0.2, textTransform: 'uppercase' },
  whiteboardDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' },
  canvasOuter: { flex: 1, backgroundColor: '#f1f5f9', overflow: 'hidden' },
  canvasPanLayer: { position: 'absolute', left: 0, top: 0 },
  canvas: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#9ca3af', overflow: 'hidden' },
  pageImage: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  canvasTouchLayer: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  noImage: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9' },
  noImageText: { color: '#64748b', fontSize: 18, fontWeight: '900' },
  emptyCanvas: { minHeight: 360, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { color: '#334155', fontSize: 18, fontWeight: '900', textAlign: 'center' },
  pageNavOverlay: { position: 'absolute', left: 0, right: 0, bottom: withAndroidNavBottom(12), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  pageArrowBtn: { width: 51, height: 51, borderRadius: 25.5, backgroundColor: 'rgba(15,23,42,0.88)', alignItems: 'center', justifyContent: 'center' },
  pageArrowBtnDisabled: { opacity: 0.28 },
  pageArrowText: { color: '#ffffff', fontSize: 28, fontWeight: '800', lineHeight: 32 },
  pageNavCenter: { flexDirection: 'row', alignItems: 'center', gap: 9, maxWidth: '72%' },
  pageCountBtn: { minWidth: 98, minHeight: 45, borderRadius: 22.5, backgroundColor: 'rgba(15,23,42,0.88)', paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center' },
  pageCountText: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
  pageCountSub: { color: '#cbd5e1', fontSize: 10, fontWeight: '900', marginTop: -1 },
  fullScreenBtn: { minHeight: 45, borderRadius: 22.5, backgroundColor: '#2563eb', paddingHorizontal: 23, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, elevation: 4 },
  fullScreenBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  goPageModal: { width: '100%', maxWidth: 356, backgroundColor: '#fff', borderRadius: 17, padding: 15 },
  rightRail: { position: 'absolute', right: 0, top: 0, bottom: 0, backgroundColor: 'transparent', paddingVertical: 0, alignItems: 'center', justifyContent: 'center', zIndex: 30, elevation: 30 },
  toolRailBubble: { width: 46, maxHeight: 430, borderRadius: 17, paddingVertical: 5, paddingHorizontal: 4, alignItems: 'center', backgroundColor: 'rgba(248,250,252,0.96)', borderWidth: 1, borderColor: 'rgba(203,213,225,0.95)', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, elevation: 8, overflow: 'hidden' },
  toolScroll: { width: '100%', maxHeight: 226, flexGrow: 0, flexShrink: 1 },
  toolScrollContent: { alignItems: 'center', gap: 6, paddingBottom: 2 },
  toolDivider: { width: 28, height: 1, backgroundColor: '#e2e8f0', marginVertical: 4 },
  toolFixedGroup: { width: '100%', alignItems: 'center', gap: 6 },
  toolBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(243,244,255,0.95)', borderWidth: 1, borderColor: 'rgba(15,23,42,0.10)', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
  toolBtnActive: { backgroundColor: '#111827', borderColor: '#111827' },
  toolIcon: { color: '#111827', fontSize: 18, fontWeight: '900' },
  toolIconActive: { color: '#fff' },
  glyphLine: { width: 28, height: 3, borderRadius: 999 },
  glyphArrowWrap: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  glyphPolylineWrap: { width: 30, height: 30, position: 'relative' },
  glyphPolylineSegA: { position: 'absolute', left: 3, top: 16.5, width: 14, height: 3, borderRadius: 999, transform: [{ rotateZ: '-48deg' }] },
  glyphPolylineSegB: { position: 'absolute', left: 13, top: 13, width: 13, height: 3, borderRadius: 999, transform: [{ rotateZ: '35deg' }] },
  glyphPolylineDot: { position: 'absolute', width: 5, height: 5, borderRadius: 2.5 },
  glyphArrowAxis: { width: 28, height: 14, position: 'relative', transform: [{ rotateZ: '-38deg' }] },
  glyphArrowLine: { position: 'absolute', left: 2, top: 5.5, width: 18.5, height: 3, borderRadius: 999, backgroundColor: '#e11d48' },
  glyphArrowHead: { position: 'absolute', left: 19.5, top: 1.5, width: 0, height: 0, borderTopWidth: 5.5, borderBottomWidth: 5.5, borderLeftWidth: 9, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: '#111827' },
  glyphPencil: { fontSize: 28, fontWeight: '900', lineHeight: 30, marginTop: -1 },
  glyphSquare: { width: 17, height: 17, borderWidth: 2, borderRadius: 3 },
  glyphCircle: { width: 19, height: 19, borderWidth: 2, borderRadius: 10 },
  glyphCloud: { fontSize: 22, fontWeight: '900', lineHeight: 24, marginTop: -2 },
  glyphCameraBody: { width: 22, height: 16, borderWidth: 2, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  glyphCameraTop: { position: 'absolute', left: 5, top: -4, width: 8, height: 4, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  glyphCameraLens: { width: 8, height: 8, borderWidth: 2, borderRadius: 4 },
  glyphCameraDot: { position: 'absolute', right: 3, top: 3, width: 2.5, height: 2.5, borderRadius: 2 },
  glyphPinWrap: { width: 20, height: 24, alignItems: 'center' },
  glyphPinHead: { width: 16, height: 16, borderWidth: 2, borderRadius: 8 },
  glyphPinTail: { position: 'absolute', top: 13, width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 9, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  glyphPinDot: { position: 'absolute', top: 6, width: 4, height: 4, borderRadius: 2 },
  glyphGrid: { width: 20, height: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  glyphGridCell: { width: 9, height: 9, borderWidth: 1.8, borderRadius: 2 },
  glyphNotePage: { width: 19, height: 23, borderWidth: 2, borderRadius: 3, paddingTop: 7, paddingLeft: 3, gap: 3 },
  glyphNoteFold: { position: 'absolute', right: -1, top: -1, width: 7, height: 7, borderLeftWidth: 2, borderBottomWidth: 2 },
  glyphNoteLine: { height: 2, borderRadius: 1 },
  wrenchToolIcon: { color: '#111827', fontSize: 17, fontWeight: '900' },
  whiteboardToolIcon: { color: '#111827', fontSize: 11, fontWeight: '900', letterSpacing: 0.2 },
  whiteboardToolIconActive: { color: '#ffffff' },
  colorWheelIcon: { width: 23, height: 23, borderRadius: 12, borderWidth: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  colorWheelDot: { width: 7, height: 7, borderRadius: 4 },
  widthGlyph: { width: 22, height: 18, justifyContent: 'space-between' },
  widthGlyphLine: { width: 20, borderRadius: 999, backgroundColor: '#111827' },
  widthToolPill: { position: 'absolute', right: 2, bottom: 2, minWidth: 13, minHeight: 13, borderRadius: 7, overflow: 'hidden', backgroundColor: '#111827', color: '#ffffff', fontSize: 8, fontWeight: '900', textAlign: 'center' },
  deleteBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center', shadowColor: '#dc2626', shadowOpacity: 0.18, shadowRadius: 5, elevation: 3 },
  deleteBtnText: { color: '#fff', fontSize: 16 },
  pin: { position: 'absolute', minWidth: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center', transform: [{ translateX: -14 }, { translateY: -14 }], shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 4, elevation: 4 },
  notePin: { backgroundColor: '#f59e0b' },
  photoPinWrap: { backgroundColor: 'transparent', shadowOpacity: 0, elevation: 0, overflow: 'visible' },
  photoPinRing: { backgroundColor: 'transparent', borderStyle: 'solid', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 3, elevation: 3 },
  photoPin360Ring: { position: 'absolute', backgroundColor: 'transparent', borderStyle: 'solid' },
  cameraMiscPinWrap: { backgroundColor: 'transparent', shadowOpacity: 0, elevation: 0, overflow: 'visible' },
  cameraMiscPin: { backgroundColor: '#2563eb', borderWidth: 2, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.26, shadowRadius: 4, elevation: 4 },
  cameraMiscIcon: { color: '#ffffff', lineHeight: 18, textAlign: 'center' },
  pinIcon: { color: '#fff', fontSize: 10, fontWeight: '900' },
  notePinIcon: { color: '#111827', textShadowColor: '#ffffff', textShadowRadius: 1 },
  pinLabel: { position: 'absolute', color: '#fff', backgroundColor: 'rgba(15,23,42,0.86)', borderRadius: 999, paddingHorizontal: 4, paddingVertical: 1.5, fontSize: 10.5, fontWeight: '800', textAlign: 'center', overflow: 'hidden' },
  shapeAnn: { position: 'absolute', backgroundColor: 'transparent' },
  shapeAnnSelected: { shadowColor: '#facc15', shadowOpacity: 0.95, shadowRadius: 8, elevation: 5 },
  boxEdgeHit: { position: 'absolute', backgroundColor: 'transparent' },
  lineHit: { position: 'absolute' },
  lineShape: { position: 'absolute', borderRadius: 999 },
  arrowHeadTriangle: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  arrowHead: { position: 'absolute', fontSize: 18, fontWeight: '900' },
  selectedOutline: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderWidth: 2, borderColor: '#facc15', borderRadius: 8 },
  noteAnn: { position: 'absolute', backgroundColor: 'rgba(15,23,42,0.86)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, maxWidth: 180 },
  noteAnnText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  iconAnnHit: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  iconAnnHitSelected: { borderWidth: 1, borderColor: '#111827', borderStyle: 'dashed', borderRadius: 12 },
  iconAnnMark: { backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 2, elevation: 2 },
  outletIconWrap: { backgroundColor: 'transparent', position: 'relative', alignItems: 'center', justifyContent: 'center' },
  outletIconSlot: { position: 'absolute' },
  outletIconGround: { position: 'absolute' },
  breakerIconWrap: { backgroundColor: 'transparent', position: 'relative', overflow: 'hidden' },
  breakerIconDoorLine: { position: 'absolute', top: 0, bottom: '52%' },
  breakerIconDiag: { position: 'absolute' },
  breakerIconDot: { position: 'absolute' },
  blueLayoutIconWrap: { backgroundColor: 'transparent', position: 'relative', overflow: 'hidden' },
  blueLayoutIconVLine: { position: 'absolute', top: 0, bottom: '44%' },
  blueLayoutIconSweep: { position: 'absolute' },
  blueLayoutIconDot: { position: 'absolute' },
  iconAnnText: { fontWeight: '900', textAlign: 'center', textShadowColor: '#ffffff', textShadowRadius: 1.5 },
  iconCheckStroke: { position: 'absolute', borderRadius: 999 },
  iconCheckStrokeShort: { transform: [{ rotateZ: '45deg' }] },
  iconCheckStrokeLong: { transform: [{ rotateZ: '-48deg' }] },
  iconXStroke: { position: 'absolute', borderRadius: 999, transform: [{ rotateZ: '45deg' }] },
  iconXStrokeReverse: { transform: [{ rotateZ: '-45deg' }] },
  cloudAnn: { position: 'absolute', backgroundColor: '#ffffff', paddingHorizontal: 0, paddingVertical: 0, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 3, elevation: 2 },
  cloudAnnSelected: { borderColor: '#111827', borderStyle: 'dashed' },
  cloudAnnText: { color: '#dc2626', fontWeight: '800', textAlign: 'center' },
  draftShape: { position: 'absolute', backgroundColor: 'transparent' },
  draftPoint: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#facc15', borderWidth: 2, borderColor: '#111827', transform: [{ translateX: -7 }, { translateY: -7 }] },
  annotationEditOverlay: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 50, elevation: 50 },
  whiteboardLayer: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 45, elevation: 45 },
  whiteboardShape: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.03)' },
  editMoveHit: { position: 'absolute', backgroundColor: 'transparent' },
  editMoveLineHit: { position: 'absolute', backgroundColor: 'transparent' },
  editHandle: { position: 'absolute', backgroundColor: '#ffffff', borderWidth: 2, borderColor: '#2563eb', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 3, elevation: 5 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)', alignItems: 'center', justifyContent: 'center', padding: 18 },
  keyboardModalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingTop: 44, paddingBottom: Platform.OS === 'android' ? 34 : 18 },
  dropdownModal: { width: '100%', maxWidth: 520, backgroundColor: '#fff', borderRadius: 18, padding: 14 },
  dropdownSearchInput: { marginBottom: 8, color: '#111827', backgroundColor: '#f8fafc', borderColor: '#cbd5e1' },
  dropdownOptionsScroll: { maxHeight: 420 },
  dropdownGroupHeader: { marginTop: 6, marginBottom: 2, paddingHorizontal: 10, paddingVertical: 5, color: '#1d4ed8', backgroundColor: '#dbeafe', borderRadius: 9, fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8, overflow: 'hidden' },
  tagsModal: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 18, padding: 16 },
  pickerModal: { width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 18, padding: 16 },
  iconPickerModal: { maxWidth: 330, borderRadius: 15, padding: 12 },
  cloudModal: { width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 18, padding: 16 },
  cloudInput: { minHeight: 84, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: '#111827', fontSize: 16, fontWeight: '700', textAlignVertical: 'top', backgroundColor: '#f8fafc' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  secondaryModalBtn: { minHeight: 42, borderRadius: 12, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e5e7eb' },
  secondaryModalBtnText: { color: '#111827', fontWeight: '900' },
  primaryModalBtn: { minHeight: 42, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#4f46e5' },
  primaryModalBtnText: { color: '#ffffff', fontWeight: '900' },

  photoPromptModal: { width: '100%', maxWidth: 330, backgroundColor: '#fff', borderRadius: 18, padding: 16 },
  photoPromptText: { color: '#64748b', fontSize: 13, fontWeight: '700', marginTop: 4, marginBottom: 12 },
  photoPromptActions: { gap: 9 },
  photoPromptBtn: { minHeight: 44, borderRadius: 13, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  photoPromptBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  photoPromptCancel: { backgroundColor: '#e5e7eb' },
  photoPromptCancelText: { color: '#111827', fontSize: 14, fontWeight: '900' },
  pinOptionsModal: { width: '100%', maxWidth: 430, alignSelf: 'center', backgroundColor: '#fff', borderRadius: 16, padding: 12 },
  pinOptionsHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 9 },
  pinOptionsSubtitle: { color: '#64748b', fontSize: 12, fontWeight: '700', marginTop: 1 },
  pinOptionsWhiteboardBtn: { backgroundColor: '#2563eb', borderRadius: 11, paddingHorizontal: 12, minHeight: 34, alignItems: 'center', justifyContent: 'center' },
  pinOptionsWhiteboardText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  pinNameWhiteboardScreen: { flex: 1, backgroundColor: '#ffffff' },
  pinNameWhiteboardStage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 80 },
  pinNameWhiteboardText: { color: '#111827', fontWeight: '900', textAlign: 'center', includeFontPadding: false },
  pinNameWhiteboardExitBtn: { position: 'absolute', top: 16, right: 16, width: 58, height: 58, borderRadius: 29, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, elevation: 8 },
  pinNameWhiteboardExitText: { color: '#ffffff', fontSize: 38, lineHeight: 42, fontWeight: '900' },
  pinOptionsCloseBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center' },
  pinOptionsCloseText: { color: '#ffffff', fontSize: 22, fontWeight: '900', lineHeight: 24 },
  pinOptionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pinOptionsButtonRow: { width: '100%', flexDirection: 'row', gap: 8 },
  pinOptionsSoftBtn: { flexGrow: 1, flexBasis: '45%', minHeight: 42, borderRadius: 11, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9 },
  pinOptionsMarkupBtn: { width: '100%', minHeight: 44, borderRadius: 11, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  pinOptionsMarkupText: { color: '#ffffff', fontSize: 12, fontWeight: '900', textAlign: 'center' },
  pinOptionsPrimaryBtn: { flexGrow: 1, flexBasis: '45%', minHeight: 42, borderRadius: 11, backgroundColor: '#4f46e5', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9 },
  pinOptionsPrimaryHalfBtn: { flex: 1, minHeight: 42, borderRadius: 11, backgroundColor: '#4f46e5', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9 },
  pinOptions360ViewBtn: { minHeight: 34, borderRadius: 17, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 11 },
  pinOptions360ViewText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  pinOptions360CaptureBtn: { minHeight: 34, borderRadius: 17, backgroundColor: '#059669', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 11 },
  pinOptions360CaptureText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  pinOptions360Actions: { flexShrink: 0, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 7, maxWidth: '70%' },
  pinOptionsDangerBtn: { flexGrow: 1, flexBasis: '45%', minHeight: 42, borderRadius: 11, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9 },
  pinOptionsCancelBtn: { flexGrow: 1, flexBasis: '45%', minHeight: 42, borderRadius: 11, backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9 },
  pinOptionsBtnText: { color: '#111827', fontSize: 12, fontWeight: '900', textAlign: 'center' },
  pinOptionsReadOnlyCard: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#dbe4ef', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11 },
  pinOptionsReadOnlyTitle: { color: '#0f172a', fontSize: 13, fontWeight: '900' },
  pinOptionsReadOnlyText: { color: '#64748b', fontSize: 11, fontWeight: '800', lineHeight: 15 },
  pinOptionsPrimaryText: { color: '#ffffff', fontSize: 12, fontWeight: '900', textAlign: 'center' },
  pinOptionsDangerText: { color: '#ffffff', fontSize: 12, fontWeight: '900', textAlign: 'center' },
  pinOptions360Row: { marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pinOptions360Info: { flex: 1, minWidth: 0 },
  pinOptions360Title: { color: '#64748b', fontSize: 12, fontWeight: '900' },
  pinOptions360Sub: { color: '#111827', fontSize: 12, fontWeight: '900', marginTop: 1 },
  pinOptions360Status: { color: '#0369a1', fontSize: 11, fontWeight: '900', marginTop: 7, lineHeight: 15 },
  pinOptions360Toggle: { minWidth: 54, minHeight: 32, borderRadius: 16, backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  pinOptions360ToggleOn: { backgroundColor: '#2563eb' },
  pinOptions360ToggleText: { color: '#111827', fontSize: 12, fontWeight: '900' },
  pinOptions360ToggleTextOn: { color: '#ffffff' },
  iconPickerTitle: { fontSize: 16, marginBottom: 8 },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  colorOption: { width: 42, height: 42, borderRadius: 21, borderWidth: 3, borderColor: '#ffffff' },
  colorOptionActive: { borderColor: '#0f172a' },
  widthOption: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#f8fafc', paddingHorizontal: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
  widthOptionActive: { backgroundColor: '#111827', borderColor: '#111827' },
  widthPreviewLine: { flex: 1, backgroundColor: '#ef4444' },
  widthOptionText: { width: 24, color: '#0f172a', fontWeight: '900', textAlign: 'center' },
  widthOptionTextActive: { color: '#ffffff' },
  iconPickerRow: { flexDirection: 'row', gap: 8 },
  iconPickerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  iconChoice: { flexBasis: '30%', flexGrow: 1, minHeight: 70, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center' },
  iconChoiceActive: { borderColor: '#111827', borderWidth: 2 },
  iconChoiceText: { fontSize: 30, fontWeight: '900', lineHeight: 32 },
  iconChoiceLabel: { color: '#0f172a', fontSize: 11, fontWeight: '900', marginTop: 2 },
  tagsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tagOption: { minWidth: '46%', flexGrow: 1, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#f8fafc', alignItems: 'center' },
  tagOptionActive: { backgroundColor: '#4f46e5', borderColor: '#4f46e5' },
  tagOptionFiltered: { backgroundColor: '#dc2626', borderColor: '#b91c1c' },
  tagOptionText: { color: '#0f172a', fontSize: 15, fontWeight: '900' },
  tagOptionTextActive: { color: '#ffffff' },
  pinEditorBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.42)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 26 },
  pinEditorModal: { width: '94%', maxWidth: 440, maxHeight: '82%', backgroundColor: '#ffffff', borderRadius: 24, padding: 16, shadowColor: '#020617', shadowOpacity: 0.24, shadowRadius: 28, shadowOffset: { width: 0, height: 16 }, elevation: 12 },
  pinEditorHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  pinEditorTitle: { color: '#0f172a', fontSize: 22, fontWeight: '900' },
  pinEditorSubtitle: { color: '#64748b', fontSize: 12, fontWeight: '800', marginTop: 2 },
  pinEditorCloseBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' },
  pinEditorCloseText: { color: '#dc2626', fontSize: 26, lineHeight: 28, fontWeight: '900' },
  pinEditorScroll: { maxHeight: 430 },
  pinEditorScrollContent: { paddingBottom: 2 },
  pinEditorInput: { minHeight: 46, borderRadius: 14, marginBottom: 8 },
  pinEditorInputRequired: { borderColor: '#dc2626', backgroundColor: '#fff7f7' },
  pinEditorRequiredText: { color: '#dc2626', fontSize: 12, fontWeight: '800', marginTop: -2, marginBottom: 8 },
  pinEditorTagGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  pinEditorTagOption: { flexGrow: 1, flexBasis: '45%', minHeight: 40, borderRadius: 14, borderWidth: 1, borderColor: '#dbe3ee', backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  pinEditorTagOptionRequired: { borderColor: '#dc2626', backgroundColor: '#fff7f7' },
  pinEditorTagOptionActive: { backgroundColor: '#2563eb', borderColor: '#2563eb', shadowColor: '#2563eb', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  pinEditorTagOptionText: { color: '#0f172a', fontSize: 13, fontWeight: '900' },
  pinEditorTagOptionTextActive: { color: '#ffffff' },
  pinEditorActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  pinEditorCancelBtn: { flex: 1, minHeight: 46, borderRadius: 15, backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  pinEditorCancelText: { color: '#334155', fontWeight: '900', fontSize: 14 },
  pinEditorSaveBtn: { flex: 1, minHeight: 46, borderRadius: 15, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, shadowColor: '#2563eb', shadowOpacity: 0.24, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  pinEditorSaveBtnDisabled: { backgroundColor: '#94a3b8', opacity: 0.7, shadowOpacity: 0 },
  pinEditorSaveText: { color: '#ffffff', fontWeight: '900', fontSize: 14 },
  centeredModalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.38)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 34 },
  centeredPanel: { width: '94%', maxWidth: 460, maxHeight: '82%', backgroundColor: '#fff', borderRadius: 22, padding: 16, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  centeredPanelWide: { width: '94%', maxWidth: 560, maxHeight: '84%', backgroundColor: '#fff', borderRadius: 22, padding: 16, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
  modalClosePill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#e2e8f0' },
  modalClosePillText: { color: '#0f172a', fontWeight: '900' },
  modalHelpText: { color: '#64748b', fontWeight: '700', lineHeight: 18, marginBottom: 10 },
  pageManagerList: { maxHeight: 430 },
  pageEditRowCompact: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  pageMoveButtons: { flexDirection: 'row', gap: 4 },
  pageMoveBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },
  pageMoveBtnDisabled: { opacity: 0.35 },
  pageMoveBtnText: { color: '#1d4ed8', fontSize: 18, fontWeight: '900' },
  pageNameInput: { flex: 1, minHeight: 38, maxHeight: 40, paddingHorizontal: 10, borderRadius: 10, fontSize: 13 },
  searchPinsInput: { minHeight: 42, marginBottom: 8 },
  searchPinsList: { maxHeight: 440 },
  modalTitle: { color: '#0f172a', fontSize: 20, fontWeight: '900', marginBottom: 12 },
  dropdownOption: { paddingVertical: 6, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  dropdownOptionText: { color: '#0f172a', fontSize: 13, fontWeight: '800' },
  menuModal: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 18, padding: 16 },
  menuRightsBlock: { borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc', borderRadius: 14, padding: 12, marginBottom: 12 },
  menuSectionTitle: { color: '#334155', fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  menuSaveAction: { backgroundColor: '#16a34a', marginTop: 8, marginBottom: 0 },
  menuSaveActionText: { color: '#ffffff' },
  menuAction: { backgroundColor: '#f1f5f9', borderRadius: 12, padding: 14, marginBottom: 8 },
  menuActionText: { color: '#0f172a', fontWeight: '900' },
  sideModalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.28)', alignItems: 'flex-end', justifyContent: 'stretch' },
  sidePanel: { width: '88%', maxWidth: 420, height: '100%', backgroundColor: '#fff', padding: 18 },
  sidePanelWide: { width: '94%', maxWidth: 560, height: '100%', backgroundColor: '#fff', padding: 18 },
  noteKeyboardAvoidingWrap: { flex: 1 },
  centerModalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.34)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 18 },
  noteModalCard: { width: '92%', maxWidth: 420, maxHeight: '86%', backgroundColor: '#fff', borderRadius: 20, padding: 16, shadowColor: '#0f172a', shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 10 },
  noteModalTitle: { fontSize: 22, fontWeight: '900', color: '#0f172a', marginBottom: 10 },
  noteModalActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  noteActionBtn: { flex: 1, minHeight: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  noteCloseBtn: { backgroundColor: '#e2e8f0' },
  noteCloseBtnText: { color: '#334155', fontWeight: '900', fontSize: 15 },
  noteDeleteBtn: { backgroundColor: '#dc2626' },
  noteDeleteBtnText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  noteSaveBtn: { backgroundColor: '#2563eb' },
  noteSaveBtnText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  fieldLabel: { color: '#475569', fontSize: 12, fontWeight: '900', marginBottom: 5, marginTop: 8 },
  textInput: { minHeight: 44, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, paddingHorizontal: 12, color: '#0f172a', fontWeight: '700', backgroundColor: '#fff' },
  noteTextInput: { minHeight: 120, maxHeight: 220, paddingTop: 12, paddingBottom: 12, fontSize: 16, lineHeight: 21 },
  goPageInput: { minHeight: 41, borderRadius: 11, paddingHorizontal: 11 },
  goPageActions: { marginTop: 14, gap: 9 },
  goPageActionBtn: { minHeight: 43, borderRadius: 11 },
  sideActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  cancelBtn: { flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  cancelBtnText: { color: '#334155', fontWeight: '900' },
  saveBtn: { flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  saveBtnText: { color: '#fff', fontWeight: '900' },
  deleteNoteBtn: { flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  deleteNoteBtnText: { color: '#fff', fontWeight: '900' },
  checkRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  checkBox: { fontSize: 22, color: '#2563eb', width: 34 },
  checkText: { color: '#0f172a', fontWeight: '800', fontSize: 15 },
  pageEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  pageEditIndex: { width: 30, color: '#64748b', fontWeight: '900' },
  resultText: { color: '#475569', fontWeight: '800', marginVertical: 10 },
  searchResult: { paddingVertical: 12, paddingHorizontal: 10, backgroundColor: '#f8fafc', borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  searchResultTitle: { color: '#0f172a', fontWeight: '900' },
  searchResultSub: { color: '#64748b', fontSize: 12, marginTop: 2, fontWeight: '700' },
});


export default function SubcontractorPdfEditorScreen({ session, project, page, onBack, onHome, onOpenPhotoPin, onOpen360Pin, initialViewportState = null, initialReturnSnapshot = null }) {
  const normalizedSession = {
    ...(session || {}),
    accessToken: session?.accessToken || session?.access_token || session?.token || '',
    employee: session?.employee || session?.user || { name: session?.name || session?.email || 'Subcontractor' },
  };
  const selectedSite = project || page?.project || null;
  return (
    <SiteWalkRedlinesNative
      portalUrl={session?.portalUrl || session?.portal_url || ''}
      session={normalizedSession}
      site={selectedSite}
      onBack={onBack}
      onHome={onHome}
      onOpenPhotoPin={onOpenPhotoPin}
      onOpen360Pin={onOpen360Pin}
      initialViewportState={initialViewportState}
      initialReturnSnapshot={initialReturnSnapshot}
      allowSiteSelection={false}
    />
  );
}

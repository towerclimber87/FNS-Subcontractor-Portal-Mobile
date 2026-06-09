const SERVER_INFO_PATH = '/mobile/subcontractor/api/server-info';
const LOGIN_PATH = '/mobile/subcontractor/api/auth/login';
const LOGOUT_PATH = '/mobile/subcontractor/api/auth/logout';
const FORGOT_PASSWORD_PATH = '/mobile/subcontractor/api/auth/forgot-password';
const HOME_PATH = '/mobile/subcontractor/api/home';
const PROJECTS_PATH = '/mobile/subcontractor/api/projects';
const SESSION_WEBVIEW_PATH = '/mobile/subcontractor/api/session';

const SITE_DOCUMENTS_PATH = '/mobile/subcontractor/api/site-documents/files';
const SITE_DOCUMENT_DELETE_PATH = '/mobile/subcontractor/api/site-documents/delete';
const SUBCONTRACTOR_MATERIAL_TRACKER_PATH = '/mobile/subcontractor/api/material-tracker';
const SUBCONTRACTOR_SITE_DAILY_TRACKER_PATH = '/mobile/subcontractor/api/site-daily-tracker';

export function normalizePortalUrl(value) {
  let raw = String(value || '').trim();
  if (!raw) return '';
  raw = raw.replace(/\s+/g, '');
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  raw = raw.replace(/\/+$/g, '');
  return raw;
}

export function buildApiUrl(portalUrl, path) {
  return `${normalizePortalUrl(portalUrl)}${path.startsWith('/') ? path : `/${path}`}`;
}

async function parseJsonResponse(response) {
  let data = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_error) {
      data = { detail: text };
    }
  }
  if (!response.ok) {
    const detail = data?.detail || data?.error || data?.message || `Request failed (${response.status})`;
    throw new Error(detail);
  }
  return data || {};
}

export async function validatePortalUrl(portalUrl) {
  const url = normalizePortalUrl(portalUrl);
  if (!url) throw new Error('Enter the company portal URL first.');
  const response = await fetch(buildApiUrl(url, SERVER_INFO_PATH), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const data = await parseJsonResponse(response);
  if (!data?.ok || data?.portal_type !== 'subcontractor') {
    throw new Error('That server did not respond as the FNS Subcontractor Portal.');
  }
  return { portalUrl: url, data };
}

export async function loginSubcontractor(portalUrl, { email, password }) {
  const response = await fetch(buildApiUrl(portalUrl, LOGIN_PATH), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, user_type: 'Subcontractor' }),
  });
  return parseJsonResponse(response);
}

export async function forgotPasswordSubcontractor(portalUrl, { email }) {
  const response = await fetch(buildApiUrl(portalUrl, FORGOT_PASSWORD_PATH), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return parseJsonResponse(response);
}

export async function logoutSubcontractor(portalUrl, accessToken) {
  if (!portalUrl || !accessToken) return { ok: true };
  try {
    const response = await fetch(buildApiUrl(portalUrl, LOGOUT_PATH), {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    });
    return parseJsonResponse(response);
  } catch (_error) {
    return { ok: true };
  }
}

export async function loadSubcontractorHome(portalUrl, accessToken) {
  const response = await fetch(buildApiUrl(portalUrl, HOME_PATH), {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonResponse(response);
}

export async function loadSubcontractorProjects(portalUrl, accessToken, query = '') {
  const qs = query ? `?q=${encodeURIComponent(query)}` : '';
  const response = await fetch(buildApiUrl(portalUrl, `${PROJECTS_PATH}${qs}`), {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonResponse(response);
}

export function buildWebSessionUrl(portalUrl, accessToken, nextPath) {
  const next = nextPath || '/subcontractor_home?only_active=1';
  const url = buildApiUrl(portalUrl, SESSION_WEBVIEW_PATH);
  return `${url}?token=${encodeURIComponent(accessToken)}&next=${encodeURIComponent(next)}`;
}

export function sitePagePath(page, site) {
  const siteName = site?.site_name || site?.name || '';
  const subName = site?.subcontractor_name || '';
  const siteQ = encodeURIComponent(siteName);
  const subQ = encodeURIComponent(subName);
  const withSite = (base) => `${base}${base.includes('?') ? '&' : '?'}site_name=${siteQ}${subName ? `&subcontractor_name=${subQ}` : ''}`;

  switch (page?.key) {
    case 'site_daily_tracker':
      return withSite('/subcontractor/site');
    case 'daily_reports':
      return withSite('/subcontractor/daily_report');
    case 'photo_repository':
      return withSite('/subcontractor_photo_asset');
    case 'site_cds':
      return withSite('/subcontractor_site_docs/site_prints');
    case 'material_tracker':
      return withSite('/subcontractor_material_tracker');
    case 'site_walk_redlines':
      return withSite('/site_walk_redlines_subcontractor');
    case 'site_walk_photos':
      return withSite('/site_walk_photos_subcontractor');
    case 'site_walk_360':
      return withSite('/site_walk_360');
    case 'sow_documents':
      return withSite('/subcontractor/site_scope_of_work');
    case 'accounting_contacts':
      return '/subcontractor_home?accounting=1';
    default:
      return withSite(page?.path || '/subcontractor/site');
  }
}


export async function loadSubcontractorSiteDocuments(portalUrl, accessToken, siteName) {
  const qs = `?site_name=${encodeURIComponent(siteName || '')}`;
  const response = await fetch(buildApiUrl(portalUrl, `${SITE_DOCUMENTS_PATH}${qs}`), {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonResponse(response);
}

export async function deleteSubcontractorSiteDocument(portalUrl, accessToken, { siteName, section, bucket, filename }) {
  const params = new URLSearchParams();
  params.set('site_name', siteName || '');
  params.set('section', section || '');
  params.set('bucket', bucket || '');
  params.set('filename', filename || '');
  const response = await fetch(buildApiUrl(portalUrl, `${SITE_DOCUMENT_DELETE_PATH}?${params.toString()}`), {
    method: 'DELETE',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonResponse(response);
}

export async function loadSubcontractorMaterialTracker(portalUrl, accessToken, siteName) {
  const qs = `?site_name=${encodeURIComponent(siteName || '')}`;
  const response = await fetch(buildApiUrl(portalUrl, `${SUBCONTRACTOR_MATERIAL_TRACKER_PATH}${qs}`), {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonResponse(response);
}

export async function updateSubcontractorMaterialTrackerItem(portalUrl, accessToken, itemId, payload) {
  const response = await fetch(buildApiUrl(portalUrl, `${SUBCONTRACTOR_MATERIAL_TRACKER_PATH}/items/${encodeURIComponent(itemId)}`), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload || {}),
  });
  return parseJsonResponse(response);
}


export async function createSubcontractorMaterialTrackerItem(portalUrl, accessToken, payload) {
  const response = await fetch(buildApiUrl(portalUrl, `${SUBCONTRACTOR_MATERIAL_TRACKER_PATH}/items`), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload || {}),
  });
  return parseJsonResponse(response);
}

export async function uploadSubcontractorMaterialTrackerPhotos(portalUrl, accessToken, itemId, photos, clientId) {
  const response = await fetch(buildApiUrl(portalUrl, `${SUBCONTRACTOR_MATERIAL_TRACKER_PATH}/items/${encodeURIComponent(itemId)}/photos`), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ client_id: clientId, photos: photos || [] }),
  });
  return parseJsonResponse(response);
}

export function buildSiteDocumentDownloadPath({ siteName, section, bucket, filename }) {
  const params = new URLSearchParams();
  params.set('site_name', siteName || '');
  params.set('section', section || '');
  params.set('bucket', bucket || '');
  params.set('filename', filename || '');
  return `/subcontractor/site_documents/api/download?${params.toString()}`;
}


export async function loadSubcontractorSiteDailyTracker(portalUrl, accessToken, siteName) {
  const qs = `?site_name=${encodeURIComponent(siteName || '')}`;
  const response = await fetch(buildApiUrl(portalUrl, `${SUBCONTRACTOR_SITE_DAILY_TRACKER_PATH}${qs}`), {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonResponse(response);
}

export async function updateSubcontractorSiteDailyTrackerRecord(portalUrl, accessToken, recordUid, payload) {
  const response = await fetch(buildApiUrl(portalUrl, `${SUBCONTRACTOR_SITE_DAILY_TRACKER_PATH}/records/${encodeURIComponent(recordUid)}/update`), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload || {}),
  });
  return parseJsonResponse(response);
}

export async function uploadSubcontractorSiteDailyTrackerPhoto(portalUrl, accessToken, { siteId, recordUid, caption, asset, filenameBase }) {
  const form = new FormData();
  form.append('site_id', String(siteId || ''));
  form.append('record_uid', String(recordUid || ''));
  form.append('category', 'subcontractor');
  if (caption) form.append('caption', caption);
  form.append('files', {
    uri: asset.uri,
    name: filenameBase ? `${filenameBase}.jpg` : (asset.fileName || `site-tracker-${Date.now()}.jpg`),
    type: asset.mimeType || 'image/jpeg',
  });

  const response = await fetch(buildApiUrl(portalUrl, `${SUBCONTRACTOR_SITE_DAILY_TRACKER_PATH}/photo-upload`), {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  return parseJsonResponse(response);
}


export async function loadSubcontractorSiteWalkRedlineSummary(portalUrl, accessToken, siteName) {
  const qs = `?site_name=${encodeURIComponent(siteName || '')}`;
  const response = await fetch(buildApiUrl(portalUrl, `/mobile/subcontractor/api/site-walk-redlines${qs}`), {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonResponse(response);
}

export async function loadSubcontractorSiteWalkPhotos(portalUrl, accessToken, { siteName, sitewalk = '', tag = '', q = '' } = {}) {
  const params = new URLSearchParams();
  params.set('site_name', siteName || '');
  if (sitewalk) params.set('sitewalk', sitewalk);
  if (tag && tag !== 'All') params.set('tag', tag);
  if (q) params.set('q', q);
  const response = await fetch(buildApiUrl(portalUrl, `/mobile/subcontractor/api/site-walk-photos?${params.toString()}`), {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonResponse(response);
}

export async function loadSubcontractorSiteWalk360(portalUrl, accessToken, { siteName, sitewalk = '', tag = '', q = '' } = {}) {
  const params = new URLSearchParams();
  params.set('site_name', siteName || '');
  if (sitewalk) params.set('sitewalk', sitewalk);
  if (tag && tag !== 'All') params.set('tag', tag);
  if (q) params.set('q', q);
  const response = await fetch(buildApiUrl(portalUrl, `/mobile/subcontractor/api/site-walk-360?${params.toString()}`), {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonResponse(response);
}

export async function loadSubcontractorSiteWalk360Annotations(portalUrl, accessToken, photoId) {
  const response = await fetch(buildApiUrl(portalUrl, `/mobile/subcontractor/api/site-walk-360/${encodeURIComponent(String(photoId || ''))}/annotations`), {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonResponse(response);
}

export function subcontractorMediaUrl(portalUrl, path) {
  const raw = String(path || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) || raw.startsWith('file:') || raw.startsWith('data:')) return raw;
  return `${normalizePortalUrl(portalUrl)}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

// -----------------------------------------------------------------------------
// Native SiteWalk PDF Editor API aliases for the subcontractor mobile app.
// These intentionally use the same function names as the employee native editor
// so the subcontractor PDF editor can reuse that proven native implementation.
// -----------------------------------------------------------------------------
const SUBCONTRACTOR_REDLINE_PATH = '/mobile/subcontractor/api/site-walk-redlines';
const SUBCONTRACTOR_PHOTO_ASSETS_PATH = '/mobile/subcontractor/api/photo-assets';

async function subcontractorMobileFetch(portalUrl, path, { method = 'GET', token, body, timeoutMs = 45000, signal } = {}) {
  const controller = signal ? null : new AbortController();
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(buildApiUrl(portalUrl, path), {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body || {}) : undefined,
      signal: signal || controller?.signal,
    });
    return await parseJsonResponse(response);
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('The portal did not respond in time.');
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function loadMobileSiteWalkRedlineSites(portalUrl, token) {
  return subcontractorMobileFetch(portalUrl, `${SUBCONTRACTOR_REDLINE_PATH}/sites`, { token, timeoutMs: 45000 });
}

export function loadMobileSiteWalkRedlines(portalUrl, token, { siteId, siteName, sitewalkDesc, signal } = {}) {
  const params = [];
  if (siteId !== undefined && siteId !== null && siteId !== '') params.push(`site_id=${encodeURIComponent(String(siteId))}`);
  if (siteName) params.push(`site_name=${encodeURIComponent(siteName)}`);
  if (sitewalkDesc) params.push(`sitewalk_desc=${encodeURIComponent(sitewalkDesc)}`);
  const qs = params.length ? `?${params.join('&')}` : '';
  return subcontractorMobileFetch(portalUrl, `${SUBCONTRACTOR_REDLINE_PATH}${qs}`, { token, timeoutMs: 45000, signal });
}

export function loadMobileSiteWalkRedlinesPageData(portalUrl, token, pageId, { signal } = {}) {
  return subcontractorMobileFetch(portalUrl, `${SUBCONTRACTOR_REDLINE_PATH}/page-data?page_id=${encodeURIComponent(String(pageId || ''))}`, { token, timeoutMs: 45000, signal });
}

export function loadMobileSiteWalkOfflineManifest(portalUrl, token, { siteId, siteName, signal } = {}) {
  const params = [];
  if (siteId !== undefined && siteId !== null && siteId !== '') params.push(`site_id=${encodeURIComponent(String(siteId))}`);
  if (siteName) params.push(`site_name=${encodeURIComponent(siteName)}`);
  const qs = params.length ? `?${params.join('&')}` : '';
  return subcontractorMobileFetch(portalUrl, `${SUBCONTRACTOR_REDLINE_PATH}/offline-manifest${qs}`, { token, timeoutMs: 120000, signal });
}

export function createMobileRedlinePin(portalUrl, token, payload) {
  return subcontractorMobileFetch(portalUrl, `${SUBCONTRACTOR_REDLINE_PATH}/pins`, { method: 'POST', token, body: payload, timeoutMs: 45000 });
}

export function updateMobileRedlinePin(portalUrl, token, pinId, payload) {
  return subcontractorMobileFetch(portalUrl, `${SUBCONTRACTOR_REDLINE_PATH}/pins/${encodeURIComponent(String(pinId))}`, { method: 'POST', token, body: payload, timeoutMs: 45000 });
}

export function deleteMobileRedlinePin(portalUrl, token, pinId) {
  return subcontractorMobileFetch(portalUrl, `${SUBCONTRACTOR_REDLINE_PATH}/pins/${encodeURIComponent(String(pinId))}`, { method: 'DELETE', token, timeoutMs: 45000 });
}

export async function uploadMobileRedlinePinPhoto(portalUrl, token, pinId, { siteId, name, tag, sitewalkDesc, note, appendMode = false, file, timeoutMs = 45000, clientOpId = '' } = {}) {
  const form = new FormData();
  form.append('site_id', String(siteId || ''));
  form.append('name', String(name || 'Pin photo'));
  if (tag !== undefined && tag !== null) form.append('tag', String(tag || ''));
  if (sitewalkDesc !== undefined && sitewalkDesc !== null) form.append('sitewalk_desc', String(sitewalkDesc || ''));
  if (note !== undefined && note !== null) form.append('note', String(note || ''));
  if (clientOpId) form.append('client_op_id', String(clientOpId));
  form.append('append_mode', appendMode ? 'true' : 'false');
  if (!file?.uri) throw new Error('No image selected.');
  form.append('file', { uri: file.uri, name: file.name || `redline-photo-${Date.now()}.jpg`, type: file.type || 'image/jpeg' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${normalizePortalUrl(portalUrl)}${SUBCONTRACTOR_REDLINE_PATH}/pins/${encodeURIComponent(String(pinId))}/photo`, {
      method: 'POST',
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: form,
      signal: controller.signal,
    });
    return await parseJsonResponse(response);
  } finally {
    clearTimeout(timeout);
  }
}

export function createMobileRedlineAnnotation(portalUrl, token, payload) {
  return subcontractorMobileFetch(portalUrl, `${SUBCONTRACTOR_REDLINE_PATH}/annotations`, { method: 'POST', token, body: payload, timeoutMs: 45000 });
}

export function updateMobileRedlineAnnotation(portalUrl, token, annotationId, payload) {
  return subcontractorMobileFetch(portalUrl, `${SUBCONTRACTOR_REDLINE_PATH}/annotations/${encodeURIComponent(String(annotationId))}`, { method: 'POST', token, body: payload, timeoutMs: 45000 });
}

export function deleteMobileRedlineAnnotation(portalUrl, token, annotationId) {
  return subcontractorMobileFetch(portalUrl, `${SUBCONTRACTOR_REDLINE_PATH}/annotations/${encodeURIComponent(String(annotationId))}`, { method: 'DELETE', token, timeoutMs: 45000 });
}

export function saveMobileRedlineSitewalkPermission(_portalUrl, _token, _payload) {
  return Promise.resolve({ ok: true, readonly: true });
}

export function saveMobileRedlinePageOrder(_portalUrl, _token, _payload) {
  return Promise.resolve({ ok: true, readonly: true });
}

export function loadMobileRedlineDotOptions(_portalUrl, _token, _siteId) {
  return Promise.resolve({ ok: true, tasks: [], locations: [] });
}

export function loadMobilePhotoAssetUnseenCounts(_portalUrl, _token, _siteId) {
  return Promise.resolve({ ok: true, counts: {}, items: [] });
}

export function loadMobilePhotoAssets(_portalUrl, _token, _opts = {}) {
  return Promise.resolve({ ok: true, items: [] });
}

export async function uploadMobileRedline360PinPhoto(portalUrl, token, pinId, { siteId, name, tag, sitewalkDesc, note, file, timeoutMs = 45000, clientOpId = '' } = {}) {
  const form = new FormData();
  form.append('site_id', String(siteId || ''));
  form.append('name', String(name || '360 Photo'));
  if (tag !== undefined && tag !== null) form.append('tag', String(tag || ''));
  if (sitewalkDesc !== undefined && sitewalkDesc !== null) form.append('sitewalk_desc', String(sitewalkDesc || ''));
  if (note !== undefined && note !== null) form.append('note', String(note || ''));
  if (clientOpId) form.append('client_op_id', String(clientOpId));
  if (!file?.uri) throw new Error('No 360 image selected.');
  form.append('file', { uri: file.uri, name: file.name || `site-walk-360-${Date.now()}.jpg`, type: file.type || 'image/jpeg' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${normalizePortalUrl(portalUrl)}${SUBCONTRACTOR_REDLINE_PATH}/pins/${encodeURIComponent(String(pinId))}/360`, {
      method: 'POST',
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: form,
      signal: controller.signal,
    });
    return await parseJsonResponse(response);
  } finally {
    clearTimeout(timeout);
  }
}

export function deleteMobileRedline360Photo(portalUrl, token, pinId, photoId) {
  const params = photoId ? `?photo_id=${encodeURIComponent(String(photoId))}` : '';
  return subcontractorMobileFetch(portalUrl, `${SUBCONTRACTOR_REDLINE_PATH}/pins/${encodeURIComponent(String(pinId))}/360${params}`, { method: 'DELETE', token, timeoutMs: 45000 });
}

export function saveMobileRedline360PhotoAnnotations(portalUrl, token, photoId, payload) {
  return subcontractorMobileFetch(portalUrl, `${SUBCONTRACTOR_REDLINE_PATH}/360/${encodeURIComponent(String(photoId))}/annotations`, { method: 'POST', token, body: payload, timeoutMs: 45000 });
}

export function saveMobileRedlineSiteWalkPhotoAnnotation(portalUrl, token, photoId, payload, { pinId = null } = {}) {
  const path = pinId
    ? `${SUBCONTRACTOR_REDLINE_PATH}/pins/${encodeURIComponent(String(pinId))}/photo/annotation${photoId ? `?photo_id=${encodeURIComponent(String(photoId))}` : ''}`
    : `${SUBCONTRACTOR_REDLINE_PATH}/site-walk-photos/${encodeURIComponent(String(photoId))}/annotation`;
  return subcontractorMobileFetch(portalUrl, path, { method: 'POST', token, body: payload, timeoutMs: 45000 });
}

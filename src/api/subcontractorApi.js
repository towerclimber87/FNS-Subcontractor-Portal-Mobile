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

export async function uploadSubcontractorSiteDailyTrackerPhoto(portalUrl, accessToken, { siteId, recordUid, caption, asset }) {
  const form = new FormData();
  form.append('site_id', String(siteId || ''));
  form.append('record_uid', String(recordUid || ''));
  form.append('category', 'subcontractor');
  if (caption) form.append('caption', caption);
  form.append('files', {
    uri: asset.uri,
    name: asset.fileName || `site-tracker-${Date.now()}.jpg`,
    type: asset.mimeType || 'image/jpeg',
  });

  const response = await fetch(buildApiUrl(portalUrl, `${SUBCONTRACTOR_SITE_DAILY_TRACKER_PATH}/photo-upload`), {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  return parseJsonResponse(response);
}

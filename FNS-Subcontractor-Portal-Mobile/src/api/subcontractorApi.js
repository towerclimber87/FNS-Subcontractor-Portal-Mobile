const SERVER_INFO_PATH = '/mobile/subcontractor/api/server-info';
const LOGIN_PATH = '/mobile/subcontractor/api/auth/login';
const LOGOUT_PATH = '/mobile/subcontractor/api/auth/logout';
const HOME_PATH = '/mobile/subcontractor/api/home';
const PROJECTS_PATH = '/mobile/subcontractor/api/projects';
const SESSION_WEBVIEW_PATH = '/mobile/subcontractor/api/session';

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
      return withSite('/subcontractor/site_documents');
    case 'accounting_contacts':
      return '/subcontractor_home?accounting=1';
    default:
      return withSite(page?.path || '/subcontractor/site');
  }
}

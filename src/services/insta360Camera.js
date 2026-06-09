import { NativeModules, Platform } from 'react-native';

const bridge = NativeModules.Insta360CameraBridge;
const X4_OSC_BASE_URL = 'http://192.168.42.1';
const DEFAULT_TIMEOUT_MS = 6000;

function describeCameraState(cameraState) {
  const numericState = Number(cameraState);

  if (!Number.isFinite(numericState)) return 'Unknown';

  switch (numericState) {
    case 0:
      return 'Found';
    case 1:
      return 'Synchronized';
    case 2:
      return 'Connected';
    case 3:
      return 'Connect Failed';
    case 4:
      return 'No Connection';
    default:
      return `Unknown (${numericState})`;
  }
}

function makeTimeoutController(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeout };
}

async function readJsonResponse(response) {
  const text = await response.text();
  let json = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch (_err) {
    json = null;
  }

  if (!response.ok) {
    const error = new Error(json?.error?.message || json?.message || text.slice(0, 180) || `HTTP ${response.status}`);
    error.status = response.status;
    error.body = text;
    error.json = json;
    throw error;
  }

  return json;
}

async function fetchJsonWithTimeout(path, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const { controller, timeout } = makeTimeoutController(timeoutMs);

  try {
    const response = await fetch(`${X4_OSC_BASE_URL}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json', 'X-XSRF-Protected': '1' } : {}),
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });

    return await readJsonResponse(response);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Timed out reaching X4 Wi-Fi endpoint. Make sure this iPhone is connected to the X4 Wi-Fi network.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractFirstUrl(value) {
  if (!value) return '';

  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) return value;
    return '';
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractFirstUrl(item);
      if (found) return found;
    }
    return '';
  }

  if (typeof value === 'object') {
    const preferredKeys = ['fileUrl', '_fileUrl', 'url', 'uri', 'href', 'photoUrl', 'imageUrl'];
    for (const key of preferredKeys) {
      const found = extractFirstUrl(value[key]);
      if (found) return found;
    }
    for (const item of Object.values(value)) {
      const found = extractFirstUrl(item);
      if (found) return found;
    }
  }

  return '';
}

export async function getX4OscInfo() {
  try {
    const json = await fetchJsonWithTimeout('/osc/info', { method: 'GET' }, DEFAULT_TIMEOUT_MS);

    return {
      reachable: true,
      status: 200,
      model: json?.model || null,
      manufacturer: json?.manufacturer || null,
      serialNumber: json?.serialNumber || null,
      firmwareVersion: json?.firmwareVersion || null,
      apiLevel: Array.isArray(json?.apiLevel) ? json.apiLevel.join(', ') : null,
      raw: json,
      error: null,
    };
  } catch (error) {
    return {
      reachable: false,
      status: error?.status || null,
      model: null,
      manufacturer: null,
      serialNumber: null,
      firmwareVersion: null,
      apiLevel: null,
      raw: null,
      error: error?.message || String(error),
    };
  }
}

export async function getX4OscState() {
  try {
    // OSC state is app-style POST on many cameras. Safari GET may fail even when the camera is reachable.
    const json = await fetchJsonWithTimeout('/osc/state', { method: 'POST', body: '{}' }, DEFAULT_TIMEOUT_MS);
    return { ok: true, raw: json, error: null };
  } catch (error) {
    return { ok: false, raw: null, error: error?.message || String(error) };
  }
}

export async function executeX4OscCommand(name, parameters = {}) {
  return await fetchJsonWithTimeout('/osc/commands/execute', {
    method: 'POST',
    body: JSON.stringify({ name, parameters }),
  }, 12000);
}

export async function getX4OscCommandStatus(commandId) {
  if (!commandId) throw new Error('No OSC command id was returned by the camera.');

  return await fetchJsonWithTimeout('/osc/commands/status', {
    method: 'POST',
    body: JSON.stringify({ id: commandId }),
  }, 12000);
}


async function waitForX4OscCommand(start, { pollAttempts = 18, pollIntervalMs = 700, label = 'camera command' } = {}) {
  const commandId = start?.id;
  if (!commandId) return start;

  let latest = start;
  const initialState = String(start?.state || '').toLowerCase();
  if ((initialState === 'done' || initialState === 'completed') && (start?.results || start?.result)) {
    return start;
  }

  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    latest = await getX4OscCommandStatus(commandId);
    const state = String(latest?.state || '').toLowerCase();

    if (state === 'done' || state === 'completed') return latest;
    if (state === 'error' || state === 'failed') {
      throw new Error(latest?.error?.message || latest?.error || `The X4 reported an error while running ${label}.`);
    }
  }

  throw new Error(`Timed out waiting for the X4 to finish ${label}.`);
}

function extractOscOptions(value) {
  const candidates = [
    value?.results?.options,
    value?.result?.options,
    value?.results,
    value?.result,
    value?.options,
    value,
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return candidate;
    }
  }

  return {};
}

function optionValueIncludes(value, expected) {
  const target = String(expected || '').toLowerCase();
  if (!target) return false;

  if (Array.isArray(value)) {
    return value.some((item) => optionValueIncludes(item, expected));
  }

  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => optionValueIncludes(item, expected));
  }

  return String(value || '').toLowerCase() === target || String(value || '').toLowerCase().includes(target);
}

export async function getX4OscOptions(optionNames = []) {
  const start = await executeX4OscCommand('camera.getOptions', { optionNames });
  const finished = await waitForX4OscCommand(start, { label: 'reading camera options' });
  return { options: extractOscOptions(finished), raw: finished };
}

export async function setX4OscOptions(options = {}) {
  const start = await executeX4OscCommand('camera.setOptions', { options });
  const finished = await waitForX4OscCommand(start, { label: 'setting camera options' });
  return { options: extractOscOptions(finished), raw: finished };
}

export async function ensureX4OnDevicePhotoStitching() {
  const before = await getX4OscOptions(['photoStitchingSupport', 'photoStitching']);
  const support = before.options?.photoStitchingSupport;

  if (support !== undefined && support !== null && !optionValueIncludes(support, 'ondevice')) {
    throw new Error('This X4 did not report on-device photo stitching support through OSC. Capture was stopped so a raw dual-fisheye file would not be uploaded.');
  }

  if (!optionValueIncludes(before.options?.photoStitching, 'ondevice')) {
    await setX4OscOptions({ photoStitching: 'ondevice' });
  }

  const after = await getX4OscOptions(['photoStitchingSupport', 'photoStitching']);
  const finalValue = after.options?.photoStitching;

  if (finalValue !== undefined && finalValue !== null && !optionValueIncludes(finalValue, 'ondevice')) {
    throw new Error('The X4 would not switch to on-device photo stitching. Capture was stopped so a raw dual-fisheye file would not be uploaded.');
  }

  return { ok: true, before: before.options, after: after.options, raw: after.raw };
}

export async function takeX4OscPhoto({ pollAttempts = 24, pollIntervalMs = 1250 } = {}) {
  await ensureX4OnDevicePhotoStitching();
  const start = await executeX4OscCommand('camera.takePicture');
  const commandId = start?.id;
  let latest = start;

  if (!commandId) {
    const immediateUrl = extractFirstUrl(start?.results || start?.result || start);
    if (immediateUrl) return { ok: true, imageUrl: immediateUrl, commandId: null, raw: start };
    throw new Error('The X4 did not return a command id for camera.takePicture.');
  }

  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    latest = await getX4OscCommandStatus(commandId);

    const state = String(latest?.state || '').toLowerCase();
    const imageUrl = extractFirstUrl(latest?.results || latest?.result || latest);

    if (state === 'done' || state === 'completed' || imageUrl) {
      if (!imageUrl) {
        throw new Error('The X4 completed capture, but did not return a downloadable photo URL.');
      }
      return { ok: true, imageUrl, commandId, raw: latest };
    }

    if (state === 'error' || state === 'failed') {
      throw new Error(latest?.error?.message || latest?.error || 'The X4 reported a capture error.');
    }
  }

  throw new Error('Timed out waiting for the X4 to finish taking the 360 photo.');
}


export async function requestX4WifiConnection({ ssid = '', password = '' } = {}) {
  if (Platform.OS !== 'ios') {
    return {
      ok: true,
      available: true,
      platform: Platform.OS,
      manualWifiRequired: true,
      message: 'Open Wi-Fi settings, connect to the X4 camera network, then return and check status.',
    };
  }

  if (!bridge?.connectX4Wifi) {
    return {
      ok: false,
      available: false,
      platform: Platform.OS,
      message: 'The iOS X4 Wi-Fi connector is not available in this build. Connect to the X4 Wi-Fi from iOS Settings, then return and check status.',
    };
  }

  return await bridge.connectX4Wifi(String(ssid || '').trim(), String(password || ''));
}

export async function getInsta360CameraStatus() {
  const osc = await getX4OscInfo();
  const oscState = osc.reachable ? await getX4OscState() : { ok: false, raw: null, error: null };

  if (Platform.OS !== 'ios') {
    return {
      available: false,
      platform: Platform.OS,
      managerClass: null,
      cameraState: null,
      cameraStateLabel: 'Unavailable',
      connected: Boolean(osc.reachable),
      osc,
      oscState,
      error: null,
    };
  }

  if (!bridge || typeof bridge.getStatus !== 'function') {
    return {
      available: false,
      platform: Platform.OS,
      managerClass: null,
      cameraState: null,
      cameraStateLabel: 'Unavailable',
      connected: Boolean(osc.reachable),
      osc,
      oscState,
      error: null,
    };
  }

  try {
    const status = await bridge.getStatus();

    return {
      available: Boolean(status?.available),
      platform: Platform.OS,
      managerClass: status?.managerClass ?? null,
      cameraState: status?.cameraState ?? null,
      cameraStateLabel: status?.mode === 'hotspot-osc-only' ? 'Hotspot/OSC only' : describeCameraState(status?.cameraState),
      connected: Number(status?.cameraState) === 2 || Boolean(osc.reachable),
      osc,
      oscState,
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      platform: Platform.OS,
      managerClass: null,
      cameraState: null,
      cameraStateLabel: 'Error',
      connected: Boolean(osc.reachable),
      osc,
      oscState,
      error: error?.message || String(error),
    };
  }
}

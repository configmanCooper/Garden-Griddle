const KEY = 'gg_save_v1';

function defaults() {
  return {
    version: 1,
    playerName: '',
    campaign: window.GG.Schema.normalizeCampaign({}),
    settings: { sfx: true, vibration: true, reducedMotion: false, highContrast: false }
  };
}

export function load() {
  const base = defaults();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return base;
    return {
      version: 1,
      playerName: String(raw.playerName || '').slice(0, 20),
      campaign: window.GG.Schema.normalizeCampaign(raw.campaign),
      settings: Object.assign(base.settings, raw.settings || {})
    };
  } catch (_error) {
    return base;
  }
}

export function write(save) {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || 'null');
    const storedRevision = stored && stored.campaign ? Number(stored.campaign.revision) || 0 : -1;
    const incomingRevision = save && save.campaign ? Number(save.campaign.revision) || 0 : 0;
    if (storedRevision > incomingRevision) save.campaign = window.GG.Schema.normalizeCampaign(stored.campaign);
    localStorage.setItem(KEY, JSON.stringify(save));
    return true;
  } catch (_error) {
    return false;
  }
}

export function acceptCampaign(current, incoming) {
  const local = window.GG.Schema.normalizeCampaign(current);
  const next = window.GG.Schema.normalizeCampaign(incoming);
  return next.revision >= local.revision ? next : local;
}

export function sessionFor(code) {
  try { return localStorage.getItem('gg_session_' + code) || ''; } catch (_error) { return ''; }
}

export function storeSession(code, token) {
  try { localStorage.setItem('gg_session_' + code, token); } catch (_error) {}
}

export function serverUrl() {
  try { return localStorage.getItem('gg_server_url') || ''; } catch (_error) { return ''; }
}

export function storeServerUrl(url) {
  try {
    if (url) localStorage.setItem('gg_server_url', url);
    else localStorage.removeItem('gg_server_url');
  } catch (_error) {}
}

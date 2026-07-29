// ============================================================
// ILIMITADO LOV Extension - v4.4.7
// Thin Client Shell + LOV-ULTRA Backend
// ============================================================

const EXTENSION_VERSION = '5.1.0-NEON-NOIR'; // versÃ£o exibida para o usuÃ¡rio
const EXTENSION_API_VERSION = '5.1.0';      // versÃ£o enviada ao backend (whitelist)
console.log(`ðŸš€ Ilimitado Lov Extension v${EXTENSION_VERSION} (NEON NOIR) iniciando...`);

const SUPABASE_URL = ((e,k)=>e.map(c=>String.fromCharCode(c^k)).join(''))([47, 51, 51, 55, 52, 125, 104, 104, 40, 43, 51, 42, 61, 44, 63, 54, 40, 32, 49, 50, 36, 33, 33, 38, 32, 47, 46, 63, 105, 52, 50, 55, 38, 37, 38, 52, 34, 105, 36, 40], 71);
const SUPABASE_ANON_KEY = 'sb_publishable_VgPUvr8V3p8VPVWz_FZMmw_ysNnFoOM';
const REMOTE_ORIGIN = SUPABASE_URL;
const WHATSAPP_FALLBACK_URL = 'https://w.app/lovableilimitado';

// Session state
let licenseSessionToken = null;
let licenseKey = null;
let licenseInfo = null;
let cachedHwid = null;
let whatsappUrl = null;

// Cache de validaÃ§Ã£o de licenÃ§a â€” evita chamadas excessivas ao servidor
let _licenseCache = null;       // { valid, session_token }
let _licenseCacheTime = 0;
const LICENSE_CACHE_TTL = 10 * 60 * 1000; // 10 minutos

// ========== UTILITY FUNCTIONS ==========

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = 'toast ' + type;
  toast.offsetHeight;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

async function generateHWID() {
  if (cachedHwid) return cachedHwid;
  // Usa APENAS o deviceId estÃ¡vel gerado pelo background.js (crypto.randomUUID)
  // NÃƒO usar fingerprint do browser â€” muda entre sessÃµes e causa "outro dispositivo"
  const stored = await chrome.storage.local.get(['settings']);
  if (stored.settings?.deviceId) {
    cachedHwid = stored.settings.deviceId;
    return cachedHwid;
  }
  // Fallback: gera UUID estÃ¡vel se background.js ainda nÃ£o rodou.
  // RE-LÃŠ o storage IMEDIATAMENTE antes de gravar â€” se o background.js gerou o
  // deviceId nesse meio-tempo, usa o dele (nunca sobrescreve com um novo UUID).
  // Isso evita o deviceId "trocar" (que faz o servidor ver outro dispositivo e
  // deslogar) e evita clobbar o settings com uma cÃ³pia velha.
  const latest = await chrome.storage.local.get(['settings']);
  if (latest.settings?.deviceId) {
    cachedHwid = latest.settings.deviceId;
    return cachedHwid;
  }
  const deviceId = crypto.randomUUID();
  cachedHwid = deviceId;
  await chrome.storage.local.set({ settings: { ...(latest.settings || {}), deviceId } });
  console.log('[NEON NOIR] HWID gerado via sidepanel fallback:', deviceId);
  return cachedHwid;
}

// ========== LICENSE â€” mapeamento de erros amigÃ¡veis ==========

/**
 * Converte mensagens de erro brutas do servidor em mensagens claras para o usuÃ¡rio.
 */
function friendlyLicenseError(raw) {
  const msg = String(raw || '').toLowerCase();

  // SessÃ£o ativa / dispositivo jÃ¡ ativado (acontece ao sair e reconectar sem reset)
  if (/already.*(activ|session|connect)|activ.*already|session.*exists|session.*active|active.*session|jÃ¡.*ativ|ativ.*jÃ¡|already.*use|in.*use|concurrent|simultÃ¢neo/i.test(raw)) {
    return '\u26a0\ufe0f Esta licenÃ§a jÃ¡ possui uma sessÃ£o ativa. Acesse o painel do cliente e clique em "Reset Device" para liberar, depois tente novamente.';
  }

  // Dispositivo jÃ¡ registrado / limite de dispositivos
  if (/device.*already|already.*device|device.*registered|registered.*device|hwid.*mismatch|mismatch.*hwid|device.*limit|limit.*device|max.*device|device.*max|outro.*dispositivo|different.*device|device.*differ|dispositivo/i.test(raw)) {
    return '\u26a0\ufe0f LicenÃ§a vinculada a outro dispositivo. Acesse o painel do cliente e clique em "Reset Device" para liberar.';
  }

  // LicenÃ§a expirada
  if (/expired|expirada|expirou/i.test(raw)) {
    return '\u23f0 Sua licenÃ§a expirou. Renove no painel do cliente.';
  }

  // LicenÃ§a nÃ£o encontrada / invÃ¡lida
  if (/not found|not_found|invalid|invÃ¡lida|invÃ¡lido|inexistente/i.test(raw)) {
    return '\u274c Chave de licenÃ§a invÃ¡lida. Verifique se digitou corretamente.';
  }

  // LicenÃ§a suspensa / revogada
  if (/suspend|revok|blocked|bloqueada|suspensa/i.test(raw)) {
    return '\ud83d\udeab LicenÃ§a suspensa ou revogada. Entre em contato com o suporte.';
  }

  // Erro de banco / sessÃ£o pendente no servidor
  if (/database|db error|connection|timeout/i.test(raw)) {
    return '\u26a0\ufe0f SessÃ£o anterior ainda ativa no servidor. Acesse o painel do cliente e clique em "Reset Device" para liberar, depois tente novamente.';
  }

  // Mensagem genÃ©rica do servidor (exibe diretamente)
  if (raw && raw.length > 3 && raw.length < 200) return '\u274c ' + raw;

  return '\u274c LicenÃ§a invÃ¡lida. Verifique a chave e tente novamente.';
}

// ========== LICENSE â€” validaÃ§Ã£o direta via validate-license-v2 ==========
async function validateLicense(key) {
  const hwid = await generateHWID();
  const deviceInfo = {
    screen: `${screen.width}x${screen.height}`,
    color_depth: screen.colorDepth,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    platform: navigator.platform,
    cores: navigator.hardwareConcurrency || 0,
  };

  // Retry atÃ© 4x com backoff para erros transitÃ³rios (DB + rede/Failed to fetch)
  const DELAYS = [0, 1500, 3000, 5000];
  let lastResult = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      console.warn(`âš ï¸ validateLicense retry ${attempt}/3 apÃ³s ${DELAYS[attempt]}ms...`);
      await new Promise(r => setTimeout(r, DELAYS[attempt]));
    }
    try {
      console.log('ðŸ” Validando licenÃ§a:', key.substring(0, 8) + '***', `(tentativa ${attempt + 1})`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // timeout 30s
      const response = await fetch(`${SUPABASE_URL}/functions/v1/validate-license-v2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify({ license_key: key, hwid: hwid, device_info: deviceInfo }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      lastResult = await response.json();
      // Sucesso â€” retorna imediatamente
      if (lastResult.status === 'valid') return lastResult;
      // Supabase pode retornar o erro em 'message' ou em 'error'
      const errText = String(lastResult.message || lastResult.error || '');
      const isRetryable = /database|db error|connection|timeout|internal|server error|503|502|504/i.test(errText);
      if (!isRetryable) return lastResult; // Erro definitivo (licenca invalida, expirada etc) - nao retry
    } catch (e) {
      console.error('âŒ Erro ao validar licenÃ§a:', e?.message || e);
      lastResult = { status: 'error', message: e?.name === 'AbortError' ? 'Timeout na validaÃ§Ã£o' : (e?.message || 'Erro de conexÃ£o') };
      // Erros de rede (Failed to fetch, AbortError) â†’ retry
      if (attempt < 3) continue;
    }
  }
  return lastResult;
}

async function revalidateLicense(force = false) {
  if (!licenseKey) {
    const storage = await chrome.storage.local.get(['licenseKey']);
    licenseKey = storage.licenseKey;
  }
  if (!licenseKey) return { valid: false, message: 'Nenhuma licenÃ§a ativada' };

  // Usa cache em memÃ³ria se ainda vÃ¡lido (evita hammering do servidor a cada mensagem)
  if (!force && _licenseCache && (Date.now() - _licenseCacheTime) < LICENSE_CACHE_TTL) {
    console.log('ðŸ”‘ Usando cache de licenÃ§a (vÃ¡lido por mais', Math.round((LICENSE_CACHE_TTL - (Date.now() - _licenseCacheTime)) / 60000), 'min)');
    return _licenseCache;
  }

  const result = await validateLicense(licenseKey);
  if (result.status === 'valid') {
    licenseSessionToken = result.session_token;
    // Salva licenseState em settings para que o content.js (gateLicense) reconheÃ§a a licenÃ§a
    const cur = (await chrome.storage.local.get('settings')).settings || {};
    await chrome.storage.local.set({
      licenseSessionToken: result.session_token,
      settings: { ...cur, licenseState: { status: 'valid' }, licenseKey: licenseKey },
    });
    licenseInfo = { days_remaining: result.days_remaining, hours_remaining: result.hours_remaining, license_id: result.license_id };
    // Atualiza cache
    _licenseCache = { valid: true, session_token: result.session_token };
    _licenseCacheTime = Date.now();
    return _licenseCache;
  }
  // Erro: invalida cache mas nÃ£o remove licenÃ§a salva se for erro transitÃ³rio
  const isTransient = typeof result.message === 'string' && /database|db error|connection|timeout/i.test(result.message);
  if (!isTransient) {
    _licenseCache = null;
  } else if (licenseSessionToken) {
    // Erro transitorio do banco mas temos token salvo -> modo graca (nao bloqueia envios)
    console.warn('[revalidateLicense] Erro transitorio - usando token em cache de emergencia por 2min');
    _licenseCache = { valid: true, session_token: licenseSessionToken };
    _licenseCacheTime = Date.now() - LICENSE_CACHE_TTL + (2 * 60 * 1000); // expira em 2min
    return _licenseCache;
  }
  return { valid: false, message: result.message };
}

async function loadSupportInfo() {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/get-support-info`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'apikey': SUPABASE_ANON_KEY }
    });
    if (response.ok) {
      const data = await response.json();
      if (data.whatsapp_url) {
        whatsappUrl = data.whatsapp_url;
        const btn = document.getElementById('whatsappSupport');
        if (btn) btn.classList.remove('loading');
      }
    }
  } catch (error) { console.error('âŒ Erro ao carregar suporte:', error); }
}

function openWhatsAppSupport() {
  const url = whatsappUrl || WHATSAPP_FALLBACK_URL;
  try {
    chrome.runtime.sendMessage({ action: 'openUrl', url }, (response) => {
      if (chrome.runtime.lastError) {
        try { chrome.tabs.create({ url }); } catch { window.open(url, '_blank'); }
      }
    });
  } catch { window.open(url || WHATSAPP_FALLBACK_URL, '_blank'); }
}

// ========== CHROME API HELPERS (for bridge) ==========

async function getAuthData() {
  try {
    // Tenta o token capturado via webRequest (background.js novo captura em lovable_api_token)
    const stored = await chrome.storage.local.get([
      'lovable_api_token', 'lovable_api_token_ts', 'lovable_git_sha',
      'settings'
    ]);

    if (stored.lovable_api_token) {
      const age = Date.now() - (stored.lovable_api_token_ts || 0);
      if (age < 3600000) {
        const rawToken = stored.lovable_api_token.replace(/^Bearer\s+/i, '');
        return {
          token: rawToken,
          sessionId: stored.settings?.lovableSessionId || null,
          gitSha: stored.lovable_git_sha || stored.settings?.lovableClientGitSha || null,
          source: 'captured'
        };
      }
    }

    // Tenta o token do storage LOV-ULTRA (capturado pelo inject.js)
    if (stored.settings?.lovableToken && stored.settings?.lovableTokenAt) {
      const age = Date.now() - stored.settings.lovableTokenAt;
      if (age < 3600000) {
        return {
          token: stored.settings.lovableToken,
          sessionId: stored.settings.lovableSessionId || null,
          gitSha: stored.settings.lovableClientGitSha || null,
          source: 'settings'
        };
      }
    }

    let token = null, sessionId = null;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && tab.url && /lovable\.dev|lovableproject\.com/.test(tab.url)) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          func: () => {
            const collected = [];
            const safeParse = (value) => {
              if (typeof value !== 'string') return null;
              try { return JSON.parse(value); } catch { return null; }
            };
            const walk = (value, key, source, found = []) => {
              if (!value) return found;
              if (typeof value === 'string') {
                const parsed = safeParse(value);
                if (parsed) walk(parsed, key, source, found);
                return found;
              }
              if (Array.isArray(value)) {
                for (const item of value) walk(item, key, source, found);
                return found;
              }
              if (typeof value !== 'object') return found;
              const accessToken = value.access_token || value.accessToken || value.token || value.jwt || value.stsTokenManager?.accessToken || null;
              const refreshToken = value.refresh_token || value.refreshToken || value.stsTokenManager?.refreshToken || null;
              const userId = value.user?.id || value.user_id || value.sub || null;
              if (accessToken || refreshToken) found.push({ key, source, accessToken, refreshToken, userId });
              for (const [childKey, childValue] of Object.entries(value)) {
                if (typeof childValue === 'object' || typeof childValue === 'string') {
                  walk(childValue, `${key}.${childKey}`, source, found);
                }
              }
              return found;
            };
            const scanStorage = (storage, source) => {
              for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                if (!key) continue;
                const lowerKey = key.toLowerCase();
                if (lowerKey.includes('auth-token') || lowerKey.includes('access_token') ||
                    lowerKey.includes('supabase') || lowerKey.includes('session') || lowerKey.startsWith('sb-')) {
                  const raw = storage.getItem(key);
                  walk(raw, key, source, collected);
                }
              }
            };
            try { scanStorage(localStorage, 'localStorage'); } catch {}
            try { scanStorage(sessionStorage, 'sessionStorage'); } catch {}
            return collected;
          }
        });

        const candidates = results
          .flatMap((entry) => Array.isArray(entry.result) ? entry.result : [])
          .filter((candidate) => candidate?.accessToken || candidate?.refreshToken);

        const bestCandidate = candidates.sort((a, b) => {
          const score = (item) => {
            let points = 0;
            if (item?.refreshToken) points += 100;
            if (item?.accessToken) points += 50;
            if (String(item?.key || '').startsWith('sb-')) points += 25;
            if (String(item?.source || '') === 'localStorage') points += 10;
            return points;
          };
          return score(b) - score(a);
        })[0];

        if (bestCandidate?.accessToken) {
          token = bestCandidate.accessToken;
          sessionId = bestCandidate.userId || null;
        }
      } catch (storageError) {
        console.warn('[Auth] Falha ao capturar token do storage:', storageError);
      }
    }

    const cookies = await chrome.cookies.getAll({ domain: 'lovable.dev' });
    for (const cookie of cookies) {
      if ((cookie.name === 'lovable-session-id.id' || cookie.name === 'lovable-session-id' || cookie.name === 'lovable-session-id.insecure') && !token) {
        token = cookie.value;
        try {
          const parts = cookie.value.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1]));
            sessionId = sessionId || payload.user_id || payload.sub || payload.session_id;
          }
        } catch {}
      }
      if (cookie.name === 'sb-api-auth-token' && !token) {
        try { const p = JSON.parse(decodeURIComponent(cookie.value)); token = p.access_token || p[0]?.access_token || cookie.value; } catch { token = cookie.value; }
      }
      if (!sessionId && cookie.name.includes('session')) {
        try { const p = JSON.parse(decodeURIComponent(cookie.value)); sessionId = p.session_id || p[0]?.session_id; } catch {}
      }
    }

    if (token && !sessionId) {
      try {
        const jwt = token.startsWith('Bearer ') ? token.slice(7) : token;
        const parts = jwt.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]));
          sessionId = payload.session_id || payload.user_id || payload.sub || null;
        }
      } catch {}
    }

    return { token, sessionId, gitSha: stored?.lovable_git_sha || stored?.settings?.lovableClientGitSha || null, source: 'fallback' };
  } catch (e) {
    console.error('Error getting auth data:', e);
    return { token: null, sessionId: null, gitSha: null, source: 'error' };
  }
}

// content script. O content script pode nÃ£o estar injetado/pronto na aba ativa
// (â†’ "content script nÃ£o respondeu. Recarregue a aba"). O background estÃ¡ sempre
// disponÃ­vel e faz o upload server-side (Origin lovable.dev) + o envio. Mesma
// metodologia da extensÃ£o principal.
async function uploadAndSendViaBackground({ projectId, message, token, sessionId, gitSha, files }) {
  const uploaded = [];   // { file_id, file_name, type:'user_upload', mime_type }
  const imageUrls = [];  // download_urls de imagens â†’ optimisticImageUrls
  for (const f of files) {
    if (!f || !f.dataB64) {
      return { ok: false, error: 'Arquivo sem dados. Anexe novamente.' };
    }
    const up = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'UPLOAD_ATTACHMENT_PROXY',
        projectId, token, sessionId, gitSha,
        fileName:    f.name || 'file',
        contentType: f.mime || 'application/octet-stream',
        fileData:    f.dataB64,
      }, (resp) => { void chrome.runtime.lastError; resolve(resp || { ok: false, error: 'background nÃ£o respondeu' }); });
    });
    if (!up || !up.ok) {
      return { ok: false, error: 'Falha no upload de "' + (f.name || 'arquivo') + '": ' + ((up && up.error) || 'erro desconhecido') };
    }
    uploaded.push({
      file_id:   up.file_id,
      file_name: up.file_name || f.name || 'file',
      type:      'user_upload',
      mime_type: up.mime_type || f.mime || 'application/octet-stream',
    });
    if (up.download_url && (f.mime || '').startsWith('image/')) imageUrls.push(up.download_url);
  }

  const sendResult = await new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type:      'SEND_MESSAGE_PROXY',
      message:   message || (uploaded.length ? `(${uploaded.length} arquivo${uploaded.length > 1 ? 's' : ''} enviado${uploaded.length > 1 ? 's' : ''})` : ''),
      projectId, token, sessionId, gitSha,
      files:     uploaded,
      imageUrls,
    }, (resp) => { void chrome.runtime.lastError; resolve(resp || { ok: false, error: 'background nÃ£o respondeu' }); });
  });

  return (sendResult && sendResult.ok)
    ? { ok: true }
    : { ok: false, error: (sendResult && sendResult.error) || 'Falha ao enviar mensagem com arquivo' };
}

async function getProjectFromActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return null;
    const match = tab.url.match(/lovable\.dev\/projects\/([a-f0-9-]+)/);
    if (match) return match[1];
    const subdomainMatch = tab.url.match(/([a-f0-9-]+)\.lovableproject\.com/);
    if (subdomainMatch) return subdomainMatch[1];
    return null;
  } catch { return null; }
}

// ========== BRIDGE: postMessage proxy for remote iframe ==========

function setupBridge(iframe) {
  const ALLOWED_ORIGIN = REMOTE_ORIGIN;

  window.addEventListener('message', async (event) => {
    const { requestId, command, payload } = event.data || {};
    if (!requestId || !command) return;

    console.log(`[Bridge] Command: ${command}`, payload);

    let result = null;
    let error = null;

    try {
      switch (command) {
        // ---- Storage ----
        case 'storage.get': {
          const keys = payload?.keys || [];
          result = await chrome.storage.local.get(keys);
          break;
        }
        case 'storage.set': {
          await chrome.storage.local.set(payload?.data || {});
          result = { ok: true };
          break;
        }

        // ---- Cookies ----
        case 'cookies.getAll': {
          const domain = payload?.domain || 'lovable.dev';
          result = await chrome.cookies.getAll({ domain });
          break;
        }

        // ---- Tabs ----
        case 'tabs.query': {
          result = await chrome.tabs.query(payload?.queryInfo || { active: true, currentWindow: true });
          break;
        }

        // ---- Auth ----
        case 'auth.getToken': {
          result = await getAuthData();
          break;
        }

        // ---- Project ----
        case 'project.getActive': {
          const projectId = await getProjectFromActiveTab();
          result = { projectId };
          break;
        }

        // ---- License ----
        case 'license.getInfo': {
          result = { licenseInfo, licenseSessionToken, licenseKey };
          break;
        }
        case 'license.revalidate': {
          result = await revalidateLicense();
          break;
        }
        case 'license.logout': {
          // Limpa via background.js (novo formato)
          await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'CLEAR_LICENSE' }, () => {
              void chrome.runtime.lastError;
              resolve();
            });
          });
          // Limpa tambÃ©m o formato legado
          await chrome.storage.local.remove(['licenseKey', 'licenseSessionToken']);
          licenseKey = null;
          licenseSessionToken = null;
          licenseInfo = null;
          showLicenseScreen();
          result = { ok: true };
          break;
        }

        // ---- Send message (via backend LOV-ULTRA) ----
        case 'lovable.sendMessage': {
          const auth = await getAuthData();
          const pId = payload?.projectId || await getProjectFromActiveTab();
          const rawFiles = Array.isArray(payload?.files) ? payload.files : [];
          const hasFiles = rawFiles.length > 0;
          const msgText  = payload?.message || '';

          if (!auth.token) {
            error = 'Token nÃ£o encontrado. FaÃ§a login no Lovable.dev';
            break;
          }
          if (!pId) {
            error = 'Abra um projeto no Lovable.dev primeiro';
            break;
          }
          if (!msgText && !hasFiles) {
            error = 'Mensagem ou arquivo obrigatÃ³rio';
            break;
          }

          // Revalida licenÃ§a
          const check = await revalidateLicense();
          if (!check.valid) {
            error = check.message || 'LicenÃ§a invÃ¡lida';
            break;
          }

          const storage = await chrome.storage.local.get(['settings']);
          const sessionId = auth.sessionId || storage.settings?.lovableSessionId || '';
          const gitSha    = auth.gitSha    || storage.settings?.lovableClientGitSha || '';

          if (hasFiles) {
            // â”€â”€ Normaliza arquivos para {dataB64, name, mime} â”€â”€
            // A UI remota pode enviar em vÃ¡rios formatos:
            //   â€¢ {dataB64, name, mime}  â† jÃ¡ correto
            //   â€¢ {data: ArrayBuffer, name, mime}
            //   â€¢ {data: Uint8Array, name, mime}
            //   â€¢ {data: base64string, name, mime}
            //   â€¢ {url: blobUrl, name, mime}  â† nÃ£o funciona cross-context
            const normalizeFile = async (f) => {
              // JÃ¡ estÃ¡ no formato correto?
              if (f.dataB64 && typeof f.dataB64 === 'string' && f.dataB64.length > 0) {
                return { dataB64: f.dataB64, name: f.name || 'file', mime: f.mime || 'application/octet-stream' };
              }

              // data como ArrayBuffer ou Uint8Array
              if (f.data instanceof ArrayBuffer || ArrayBuffer.isView(f.data)) {
                const bytes = f.data instanceof ArrayBuffer ? new Uint8Array(f.data) : f.data;
                let binary = '';
                for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
                return { dataB64: btoa(binary), name: f.name || 'file', mime: f.mime || 'application/octet-stream' };
              }

              // data como string base64 (com ou sem data URL prefix)
              if (typeof f.data === 'string' && f.data.length > 0) {
                const b64 = f.data.includes(',') ? f.data.split(',')[1] : f.data;
                return { dataB64: b64, name: f.name || 'file', mime: f.mime || 'application/octet-stream' };
              }

              // data64 ou base64 como campo alternativo
              const altB64 = f.base64 || f.data64 || f.content;
              if (typeof altB64 === 'string' && altB64.length > 0) {
                const b64 = altB64.includes(',') ? altB64.split(',')[1] : altB64;
                return { dataB64: b64, name: f.name || 'file', mime: f.mime || 'application/octet-stream' };
              }

              // Sem dados vÃ¡lidos
              console.error('[Bridge] arquivo sem dataB64:', f);
              return null;
            };

            const normalized = (await Promise.all(rawFiles.map(normalizeFile))).filter(Boolean);

            if (normalized.length === 0) {
              error = 'Nenhum arquivo com dados vÃ¡lidos. Tente anexar novamente.';
              break;
            }

            const upSend = await uploadAndSendViaBackground({
              projectId: pId, message: msgText, token: auth.token, sessionId, gitSha, files: normalized,
            });
            if (upSend.ok) {
              result = { message: 'âœ… Mensagem enviada! O Lovable estÃ¡ processando...' };
            } else {
              error = upSend.error || 'Falha ao enviar mensagem com arquivo';
            }
          } else {
            const bgResult = await new Promise((resolve) => {
              chrome.runtime.sendMessage({
                type:      'SEND_MESSAGE_PROXY',
                message:   msgText,
                projectId: pId,
                token:     auth.token,
                sessionId,
                gitSha,
                files:     [],
                imageUrls: [],
              }, (resp) => {
                void chrome.runtime.lastError;
                resolve(resp || { ok: false, error: 'background nÃ£o respondeu' });
              });
            });
            if (bgResult.ok) {
              result = { message: 'âœ… Mensagem enviada! O Lovable estÃ¡ processando...' };
            } else {
              error = bgResult.error || `HTTP ${bgResult.status || 500}`;
            }
          }
          break;
        }


        // ---- Publish ----
        case 'lovable.publish': {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.url?.includes('lovable.dev')) {
            error = 'VocÃª precisa estar no Lovable.dev!';
            break;
          }
          const pId2 = await getProjectFromActiveTab();
          if (!pId2) { error = 'Abra um projeto no Lovable.dev primeiro'; break; }
          const auth2 = await getAuthData();

          result = await new Promise((resolve) => {
            chrome.tabs.sendMessage(tab.id, {
              action: 'publishProject', projectId: pId2, authToken: auth2.token
            }, (response) => {
              if (chrome.runtime.lastError) {
                resolve({ success: false, error: 'Erro ao publicar. Recarregue a pÃ¡gina.' });
              } else {
                resolve(response || { success: true });
              }
            });
          });
          break;
        }

        // ---- Templates ----
        case 'templates.getAll': {
          const tplResponse = await fetch(`${SUPABASE_URL}/functions/v1/get-templates`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              'apikey': SUPABASE_ANON_KEY,
              'x-session-token': licenseSessionToken
            }
          });
          if (!tplResponse.ok) throw new Error(`HTTP ${tplResponse.status}`);
          result = await tplResponse.json();
          break;
        }

        // ---- AI Prompt Enhancer (Gemini 3.5 Flash) ----
        case 'ai.enhancePrompt': {
          const userPrompt = String(payload?.prompt || '').trim();
          if (!userPrompt) { error = 'Prompt vazio'; break; }

          const GEMINI_KEY = 'AIzaSyBtO3177dm1mPkgVqiWP92TUFU8Jw8IRpI';
          const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

          const promptText =
            `VocÃª Ã© um engenheiro de software sÃªnior e especialista em desenvolvimento web com 15 anos de experiÃªncia.\n` +
            `Sua tarefa Ã© transformar a instruÃ§Ã£o abaixo em um prompt profissional e extremamente detalhado para a plataforma Lovable (gerador de apps React + Tailwind + TypeScript com IA).\n\n` +
            `O prompt deve:\n` +
            `- Descrever EXATAMENTE o que deve ser implementado com detalhes tÃ©cnicos\n` +
            `- Especificar componentes React, estrutura de layout, hierarquia de elementos\n` +
            `- Definir cores, tipografia, espaÃ§amentos e estilo visual (dark mode, gradientes, etc.)\n` +
            `- Mencionar comportamentos interativos (hover, animaÃ§Ãµes, transiÃ§Ãµes, responsividade mobile)\n` +
            `- Incluir boas prÃ¡ticas de UX/UI e performance quando relevante\n` +
            `- Ser escrito em linguagem imperativa e tÃ©cnica ("Implemente...", "Crie...", "Adicione...")\n` +
            `- Ter entre 3 e 6 frases tÃ©cnicas e completas\n` +
            `- Responder NO MESMO IDIOMA da instruÃ§Ã£o original\n` +
            `- Conter APENAS o prompt reescrito, sem explicaÃ§Ãµes, sem tÃ­tulos, sem prefixos\n\n` +
            `InstruÃ§Ã£o original: "${userPrompt}"\n\n` +
            `Prompt profissional:`;

          const body = {
            contents: [{ role: 'user', parts: [{ text: promptText }] }],
            generationConfig: {
              temperature: 0.6,
              maxOutputTokens: 800,
            },
          };

          try {
            const gemResp = await fetch(GEMINI_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });

            if (!gemResp.ok) {
              const errTxt = await gemResp.text().catch(() => '');
              error = `Gemini erro ${gemResp.status}: ${errTxt.slice(0, 200)}`;
              break;
            }

            const gemJson = await gemResp.json().catch(() => null);

            // Coleta texto de todos os parts (com ou sem thoughtSignature)
            let enhanced = '';
            const parts = gemJson?.candidates?.[0]?.content?.parts;
            if (Array.isArray(parts)) {
              enhanced = parts.map(p => p.text || '').join('').trim();
            }

            if (!enhanced) {
              console.error('[enhancePrompt] JSON completo:', JSON.stringify(gemJson));
              error = 'Gemini nÃ£o retornou texto. Tente novamente.';
              break;
            }

            // Remove aspas envolventes se o modelo as adicionou
            enhanced = enhanced.replace(/^["']|["']$/g, '').trim();

            result = {
              improved:        enhanced,
              enhanced_prompt: enhanced,
              prompt:          enhanced,
              original_prompt: userPrompt,
            };
          } catch (fetchErr) {
            error = 'Erro ao conectar com Gemini: ' + (fetchErr?.message || String(fetchErr));
          }
          break;
        }


        // ---- Download Project (via background CORS-free) ----
        case 'lovable.downloadProject': {
          const auth = await getAuthData();
          const pId3 = payload?.projectId || await getProjectFromActiveTab();

          if (!auth.token) { error = 'Token nÃ£o encontrado. FaÃ§a login no Lovable.dev'; break; }
          if (!pId3) { error = 'Abra um projeto no Lovable.dev primeiro'; break; }

          const check3 = await revalidateLicense();
          if (!check3.valid) { error = check3.message || 'LicenÃ§a invÃ¡lida'; break; }

          const sendProgress = (msg) => {
            iframe.contentWindow?.postMessage({
              requestId: 'progress_' + Date.now(),
              command: 'download.progress',
              payload: { message: msg }
            }, '*');
          };

          sendProgress('ðŸ“¡ Buscando arquivos do projeto...');

          const sourceResult = await new Promise((resolve) => {
            chrome.runtime.sendMessage(
              { action: 'downloadSourceCode', projectId: pId3, token: auth.token },
              (response) => resolve(response)
            );
          });

          if (!sourceResult?.success || !sourceResult.files) {
            error = sourceResult?.error || 'Falha ao obter cÃ³digo-fonte';
            break;
          }

          const files = sourceResult.files;
          sendProgress(`ðŸ“¦ Empacotando ${files.length} arquivos...`);

          const zip = new JSZip();
          const IMAGE_EXT = /\.(png|jpg|jpeg|gif|svg|ico|webp|bmp|zip|woff|woff2|ttf|eot|mp3|mp4|pdf)$/i;
          const binaryFiles = [];

          for (const file of files) {
            const filePath = file.path || file.name || file.filename;
            if (!filePath) continue;
            const content = file.contents ?? file.content ?? file.code ?? file.text ?? file.body;
            if (content != null && typeof content === 'string' && content.length > 0) {
              if (file.binary) { zip.file(filePath, content, { base64: true }); }
              else { zip.file(filePath, content); }
            } else if (file.sizeExceeded) {
              console.warn('[Download] Skipping oversized file:', filePath);
            } else if (IMAGE_EXT.test(filePath) || content == null) {
              binaryFiles.push(filePath);
            }
          }

          if (binaryFiles.length > 0) {
            sendProgress(`â¬‡ï¸ Baixando ${binaryFiles.length} assets...`);
            const BATCH = 10;
            for (let i = 0; i < binaryFiles.length; i += BATCH) {
              const batch = binaryFiles.slice(i, i + BATCH);
              const results = await Promise.all(
                batch.map(fp => new Promise((resolve) => {
                  chrome.runtime.sendMessage(
                    { action: 'fetchRawFile', projectId: pId3, filePath: fp, token: auth.token },
                    (resp) => resolve({ path: fp, ...resp })
                  );
                }))
              );
              for (const r of results) {
                if (r.success && r.data) {
                  if (r.type === 'binary') { zip.file(r.path, r.data, { base64: true }); }
                  else { zip.file(r.path, r.data); }
                }
              }
            }
          }

          sendProgress('ðŸ—œï¸ Comprimindo...');
          const zipBlob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
          });

          const timestamp = new Date().toISOString().split('T')[0];
          const url = URL.createObjectURL(zipBlob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `lovable-${pId3.slice(0, 8)}-${timestamp}.zip`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 5000);

          result = { success: true, message: 'âœ… Download concluÃ­do!' };
          break;
        }

        // ---- Open URL ----
        case 'runtime.openUrl': {
          const targetUrl = payload?.url;
          if (targetUrl) {
            try { chrome.runtime.sendMessage({ action: 'openUrl', url: targetUrl }); } catch { chrome.tabs.create({ url: targetUrl }); }
          }
          result = { ok: true };
          break;
        }

        default:
          error = `Unknown command: ${command}`;
      }
    } catch (e) {
      console.error(`[Bridge] Error on ${command}:`, e);
      error = e.message;
    }

    // Reply back to iframe
    iframe.contentWindow?.postMessage({ requestId, ok: !error, payload: result, error }, '*');
  });

  // Listen for captured chat messages from content script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'chatCapturedRelay' && message.content) {
      iframe.contentWindow?.postMessage({
        requestId: 'capture_' + Date.now(),
        command: 'chat.captured',
        payload: { content: message.content, source: message.source, timestamp: message.timestamp }
      }, '*');
    }
    if (message.action === 'suggestionsCapturedRelay' && Array.isArray(message.items)) {
      iframe.contentWindow?.postMessage({
        requestId: 'sugg_' + Date.now(),
        command: 'lovable.suggestions',
        payload: { items: message.items }
      }, '*');
    }
    // Repassa revogaÃ§Ã£o de licenÃ§a para o iframe
    if (message.type === 'LICENSE_REVOKED') {
      iframe.contentWindow?.postMessage({
        requestId: 'license_' + Date.now(),
        command: 'license.revoked',
        payload: {}
      }, '*');
    }
  });

  console.log('[Bridge] Setup complete');
}

// ========== UI NAVIGATION ==========

function showLicenseScreen() {
  const ls = document.getElementById('licenseScreen');
  const mainApp = document.getElementById('mainApp');
  if (ls) ls.style.display = 'flex';
  if (mainApp) { mainApp.style.display = 'none'; }
}

async function fetchRemoteUiHtml() {
  const url = `${SUPABASE_URL}/functions/v1/serve-extension-ui?sessionToken=${encodeURIComponent(licenseSessionToken)}&extVersion=${EXTENSION_API_VERSION}`;

  // Retry atÃ© 3x com backoff para evitar Failed to Fetch
  const RETRY_DELAYS = [0, 2000, 4000];
  let response = null;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      console.warn(`[NEON NOIR] fetchRemoteUiHtml retry ${attempt}/2 apÃ³s ${RETRY_DELAYS[attempt]}ms...`);
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // timeout 20s
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'apikey': SUPABASE_ANON_KEY,
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (response.ok) break; // sucesso
      // Erro HTTP: retenta em erros de servidor (5xx)
      if (response.status >= 500 && attempt < 2) continue;
      break; // Erro 4xx ou esgotou tentativas
    } catch (e) {
      lastError = e;
      console.error(`[NEON NOIR] fetchRemoteUiHtml erro tentativa ${attempt + 1}:`, e?.message || e);
      if (attempt === 2) break; // esgotou tentativas
    }
  }

  if (!response || !response.ok) {
    throw lastError || new Error(`Falha ao carregar interface remota (${response?.status || 'sem resposta'})`);
  }

  const html = await response.text();
  if (!html || !html.toLowerCase().includes('<html')) {
    throw new Error('HTML remoto invÃ¡lido');
  }

  const runtimeUrl = chrome.runtime.getURL('remote-ui.js');
  const sanitizedHtml = html
    .replace(/<script\b[^>]*src=["'][^"']*["'][^>]*>\s*<\/script>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

  const runtimeScript = `<script src="${runtimeUrl}"></script>`;
  const normalizedHtml = /<\/body>/i.test(sanitizedHtml)
    ? sanitizedHtml.replace(/<\/body>/i, `${runtimeScript}</body>`)
    : `${sanitizedHtml}${runtimeScript}`;

  // LOV 3.1 NEON NOIR â€” Premium CSS + Chat layout fix
  // FIX PRINCIPAL: #enhanceBtn removido do fluxo flex via position:absolute
  // para nÃ£o espremera textarea. Flutua acima da area de input.
  var lov3css = `<style id="lov3-btns">
@keyframes lov3-glow{0%,100%{box-shadow:0 0 8px rgba(168,85,247,.3)}50%{box-shadow:0 0 18px rgba(168,85,247,.55)}}

/* â”€â”€ CHAT INPUT AREA FIX â”€â”€ */
/* O container pai do textarea/botoes precisa ser position:relative para ancorar o enhanceBtn */
textarea#message {
  flex:1 1 auto!important;
  min-width:0!important;
  min-height:42px!important;
  max-height:45vh!important;
  resize:none!important;
  word-wrap:break-word!important;
  word-break:break-word!important;
  overflow-wrap:break-word!important;
  white-space:pre-wrap!important;
  overflow-y:auto!important;
  box-sizing:border-box!important;
  padding:10px 12px!important;
  font-size:13.5px!important;
  line-height:1.5!important;
}

/* Enhance/Otimizar com IA â€” POSITION ABSOLUTE: sai do fluxo, flutua acima */
#enhanceBtn{
  position:absolute!important;
  bottom:100%!important;
  right:0!important;
  margin-bottom:6px!important;
  z-index:10!important;
  background:rgba(168,85,247,.08)!important;
  border:1px solid rgba(168,85,247,.25)!important;
  color:#c084fc!important;
  border-radius:14px!important;
  padding:3px 9px!important;
  font-size:10px!important;
  font-weight:600!important;
  cursor:pointer!important;
  display:inline-flex!important;
  align-items:center!important;
  gap:3px!important;
  transition:all .25s cubic-bezier(.4,0,.2,1)!important;
  white-space:nowrap!important;
  backdrop-filter:blur(4px)!important;
  letter-spacing:.2px!important;
}
#enhanceBtn:hover{background:rgba(168,85,247,.18)!important;border-color:rgba(168,85,247,.4)!important;box-shadow:0 3px 14px rgba(168,85,247,.2)!important;transform:translateY(-1px)!important}
#enhanceBtn:active{transform:scale(.97)!important}
#enhanceBtn.loading{opacity:.6!important;pointer-events:none!important}

/* O pai direto do enhanceBtn precisa ser position:relative para o absolute funcionar */
#enhanceBtn ~ *, #enhanceBtn + *, textarea#message {
  /* nada - apenas para especificidade */
}

/* Send button */
#sendBtn,button.send-btn{background:linear-gradient(135deg,#7c3aed,#a855f7)!important;color:#fff!important;border:none!important;border-radius:12px!important;width:38px!important;height:38px!important;min-width:38px!important;display:flex!important;align-items:center!important;justify-content:center!important;cursor:pointer!important;padding:0!important;flex-shrink:0!important;box-shadow:0 4px 18px rgba(168,85,247,.45)!important;transition:all .25s cubic-bezier(.4,0,.2,1)!important}
#sendBtn:hover{transform:scale(1.08)!important;box-shadow:0 6px 24px rgba(168,85,247,.6)!important}
#sendBtn:active{transform:scale(.95)!important}
#sendBtn:disabled{background:rgba(168,85,247,.12)!important;box-shadow:none!important;transform:none!important;cursor:not-allowed!important}

/* Attach button */
#attachBtn,button#attachBtn{background:rgba(168,85,247,.08)!important;border:1.5px solid rgba(168,85,247,.28)!important;color:#a855f7!important;border-radius:12px!important;width:38px!important;height:38px!important;min-width:38px!important;display:flex!important;align-items:center!important;justify-content:center!important;cursor:pointer!important;padding:0!important;flex-shrink:0!important;transition:all .25s cubic-bezier(.4,0,.2,1)!important;backdrop-filter:blur(4px)!important}
#attachBtn:hover{background:rgba(168,85,247,.18)!important;border-color:rgba(168,85,247,.45)!important;transform:scale(1.06)!important;box-shadow:0 3px 14px rgba(168,85,247,.25)!important}

/* Publish button */
#publishBtn{background:linear-gradient(135deg,#059669,#10b981)!important;color:#fff!important;border:none!important;border-radius:20px!important;padding:5px 14px!important;font-size:11.5px!important;font-weight:700!important;cursor:pointer!important;transition:all .25s cubic-bezier(.4,0,.2,1)!important;letter-spacing:.3px!important;box-shadow:0 3px 12px rgba(16,185,129,.35)!important}
#publishBtn:hover{transform:translateY(-1px)!important;box-shadow:0 5px 18px rgba(16,185,129,.5)!important}
#publishBtn:active{transform:scale(.97)!important}

/* Download button */
#downloadBtn{background:rgba(168,85,247,.06)!important;border:1.5px solid rgba(168,85,247,.2)!important;color:#c084fc!important;border-radius:20px!important;padding:5px 12px!important;font-size:11.5px!important;cursor:pointer!important;transition:all .25s cubic-bezier(.4,0,.2,1)!important;backdrop-filter:blur(4px)!important}
#downloadBtn:hover{background:rgba(168,85,247,.14)!important;border-color:rgba(168,85,247,.38)!important;transform:translateY(-1px)!important}

/* Logout button */
#logoutBtn{background:rgba(239,68,68,.05)!important;border:1.5px solid rgba(239,68,68,.18)!important;color:rgba(248,113,113,.75)!important;border-radius:20px!important;padding:5px 12px!important;font-size:11px!important;cursor:pointer!important;transition:all .25s cubic-bezier(.4,0,.2,1)!important;backdrop-filter:blur(4px)!important}
#logoutBtn:hover{background:rgba(239,68,68,.14)!important;border-color:rgba(239,68,68,.35)!important;color:#f87171!important;transform:translateY(-1px)!important}

/* Remove watermark button */
#removeWatermarkBtn{background:rgba(239,68,68,.05)!important;border:1.5px solid rgba(239,68,68,.2)!important;color:#f87171!important;border-radius:20px!important;padding:5px 12px!important;font-size:11px!important;font-weight:600!important;cursor:pointer!important;transition:all .25s cubic-bezier(.4,0,.2,1)!important;backdrop-filter:blur(4px)!important}
#removeWatermarkBtn:hover{background:rgba(239,68,68,.14)!important;transform:translateY(-1px)!important;box-shadow:0 3px 10px rgba(239,68,68,.2)!important}

/* Clear button */
#clearBtn{background:transparent!important;border:1px solid rgba(255,255,255,.08)!important;color:rgba(200,180,220,.45)!important;border-radius:20px!important;padding:4px 10px!important;font-size:11px!important;cursor:pointer!important;transition:all .2s!important}
#clearBtn:hover{border-color:rgba(255,255,255,.16)!important;color:rgba(200,180,220,.7)!important}

/* Download mode buttons */
.dl-mode-btn{border-radius:20px!important;transition:all .25s cubic-bezier(.4,0,.2,1)!important;font-weight:600!important}
.dl-mode-btn.active{background:linear-gradient(135deg,#7c3aed,#a855f7)!important;color:#fff!important;box-shadow:0 3px 14px rgba(168,85,247,.35)!important}
.dl-mode-btn:hover:not(.active){background:rgba(168,85,247,.1)!important}

/* License info */
#licenseInfo{border-radius:20px!important;font-weight:600!important}

/* Tab buttons */
#tabChat,#tabTemplates{transition:all .2s cubic-bezier(.4,0,.2,1)!important;font-weight:600!important}
#tabChat:hover,#tabTemplates:hover{color:#c084fc!important}

/* Textarea focus glow */
textarea#message:focus{border-color:rgba(168,85,247,.45)!important;box-shadow:0 0 0 3px rgba(168,85,247,.08)!important}

/* Message bubbles: garantir word-break */
.bubble, .message-bubble, [class*="bubble"], [class*="message-content"] {
  word-wrap:break-word!important;
  word-break:break-word!important;
  overflow-wrap:break-word!important;
  max-width:100%!important;
}
</style>`;
  var finalHtml = normalizedHtml;
    // Inject CSS into head
  if (/<\/head>/i.test(finalHtml)) {
    finalHtml = finalHtml.replace(/<\/head>/i, lov3css + '</head>');
  } else {
    finalHtml = lov3css + finalHtml;
  }
  return finalHtml;
}

async function showMainApp() {
  const ls = document.getElementById('licenseScreen');
  const mainApp = document.getElementById('mainApp');
  if (!mainApp) return;

  if (ls) ls.style.display = 'none';
  mainApp.style.display = 'flex';

  // Inicializa a UI do chat diretamente (sem iframe)
  initDirectChat();
}

// ========== DIRECT CHAT UI (no iframe, no bridge) ==========
let _chatInitialized = false;

async function callCommand(command, payload) {
  // Reutiliza toda a lÃ³gica do bridge diretamente
  let result = null;
  let error = null;

  try {
    switch (command) {
      case 'storage.get': {
        result = await chrome.storage.local.get(payload?.keys || []);
        break;
      }
      case 'storage.set': {
        await chrome.storage.local.set(payload?.data || {});
        result = { ok: true };
        break;
      }
      case 'license.getInfo': {
        result = { licenseInfo, licenseSessionToken, licenseKey };
        break;
      }
      case 'license.revalidate': {
        result = await revalidateLicense();
        break;
      }
      case 'license.logout': {
        await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'CLEAR_LICENSE' }, () => {
            void chrome.runtime.lastError;
            resolve();
          });
        });
        await chrome.storage.local.remove(['licenseKey', 'licenseSessionToken']);
        licenseKey = null;
        licenseSessionToken = null;
        licenseInfo = null;
        showLicenseScreen();
        result = { ok: true };
        break;
      }
      case 'lovable.sendMessage': {
        const auth = await getAuthData();
        const pId = payload?.projectId || await getProjectFromActiveTab();
        const rawFiles = Array.isArray(payload?.files) ? payload.files : [];
        const hasFiles = rawFiles.length > 0;
        const msgText = payload?.message || '';

        if (!auth.token) { error = 'Token nÃ£o encontrado. FaÃ§a login no Lovable.dev'; break; }
        if (!pId) { error = 'Abra um projeto no Lovable.dev primeiro'; break; }
        if (!msgText && !hasFiles) { error = 'Mensagem ou arquivo obrigatÃ³rio'; break; }

        const check = await revalidateLicense();
        if (!check.valid) { error = check.message || 'LicenÃ§a invÃ¡lida'; break; }

        const storage = await chrome.storage.local.get(['settings']);
        const sessionId = auth.sessionId || storage.settings?.lovableSessionId || '';
        const gitSha = auth.gitSha || storage.settings?.lovableClientGitSha || '';

        if (hasFiles) {
          const normalizeFile = async (f) => {
            if (f.dataB64 && typeof f.dataB64 === 'string' && f.dataB64.length > 0) {
              return { dataB64: f.dataB64, name: f.name || 'file', mime: f.mime || 'application/octet-stream' };
            }
            if (f.data instanceof ArrayBuffer || ArrayBuffer.isView(f.data)) {
              const bytes = f.data instanceof ArrayBuffer ? new Uint8Array(f.data) : f.data;
              let binary = '';
              for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
              return { dataB64: btoa(binary), name: f.name || 'file', mime: f.mime || 'application/octet-stream' };
            }
            if (typeof f.data === 'string' && f.data.length > 0) {
              return { dataB64: f.data, name: f.name || 'file', mime: f.mime || 'application/octet-stream' };
            }
            return null;
          };
          const normalized = (await Promise.all(rawFiles.map(normalizeFile))).filter(Boolean);
          if (normalized.length === 0) { error = 'Nenhum arquivo vÃ¡lido encontrado'; break; }

          const upSend = await uploadAndSendViaBackground({
            projectId: pId, message: msgText, token: auth.token, sessionId, gitSha, files: normalized,
          });
          if (upSend.ok) {
            result = { message: 'âœ… Mensagem enviada! O Lovable estÃ¡ processando...' };
          } else {
            error = upSend.error || 'Falha ao enviar mensagem';
          }
        } else {
          const bgResult = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
              type: 'SEND_MESSAGE_PROXY',
              message: msgText, projectId: pId,
              token: auth.token, sessionId, gitSha,
              files: [], imageUrls: [],
            }, (resp) => {
              void chrome.runtime.lastError;
              resolve(resp || { ok: false, error: 'background nÃ£o respondeu' });
            });
          });
          if (bgResult.ok) {
            result = { message: 'âœ… Mensagem enviada! O Lovable estÃ¡ processando...' };
          } else {
            error = bgResult.error || `HTTP ${bgResult.status || 500}`;
          }
        }
        break;
      }
      case 'lovable.publish': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url?.includes('lovable.dev')) { error = 'VocÃª precisa estar no Lovable.dev!'; break; }
        const pId2 = await getProjectFromActiveTab();
        if (!pId2) { error = 'Abra um projeto no Lovable.dev primeiro'; break; }
        const auth2 = await getAuthData();
        result = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'publishProject', projectId: pId2, authToken: auth2.token
          }, (response) => {
            if (chrome.runtime.lastError) resolve({ success: false, error: 'Erro ao publicar.' });
            else resolve(response || { success: true });
          });
        });
        break;
      }
      case 'templates.getAll': {
        try {
          const tplResponse = await fetch(`${SUPABASE_URL}/functions/v1/get-templates`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'apikey': SUPABASE_ANON_KEY },
            body: JSON.stringify({ session_token: licenseSessionToken }),
          });
          if (!tplResponse.ok) throw new Error(`HTTP ${tplResponse.status}`);
          result = await tplResponse.json();
        } catch (e) {
          error = e.message;
        }
        break;
      }
      case 'ai.enhancePrompt': {
        const userPrompt = String(payload?.prompt || '').trim();
        if (!userPrompt) { error = 'Prompt vazio'; break; }
        const GEMINI_KEY = 'AIzaSyBtO3177dm1mPkgVqiWP92TUFU8Jw8IRpI';
        const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
        const promptText =
          `VocÃª Ã© um especialista em prompts para a plataforma Lovable.dev.\n` +
          `Receba o prompt do usuÃ¡rio e retorne uma versÃ£o otimizada, mais clara e detalhada.\n` +
          `Mantenha o idioma original. Responda APENAS com o prompt melhorado, sem explicaÃ§Ãµes.\n\n` +
          `Prompt original:\n${userPrompt}`;
        try {
          const geminiRes = await fetch(GEMINI_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: promptText }] }],
              generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
            }),
          });
          if (!geminiRes.ok) throw new Error(`Gemini HTTP ${geminiRes.status}`);
          const geminiData = await geminiRes.json();
          const improved = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (!improved) throw new Error('Resposta vazia do Gemini');
          result = { improved };
        } catch (e) {
          error = e.message;
        }
        break;
      }
      case 'lovable.downloadProject': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url?.includes('lovable.dev')) { error = 'Abra o Lovable.dev!'; break; }
        const pId3 = await getProjectFromActiveTab();
        if (!pId3) { error = 'Projeto nÃ£o encontrado'; break; }
        const auth3 = await getAuthData();
        result = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'downloadProject', projectId: pId3, authToken: auth3.token,
            mode: payload?.mode || 'zip',
          }, (response) => {
            if (chrome.runtime.lastError) resolve({ success: false, error: 'Erro. Recarregue a pÃ¡gina.' });
            else resolve(response || { success: true });
          });
        });
        break;
      }
      default:
        error = `Comando desconhecido: ${command}`;
    }
  } catch (e) {
    error = e.message || 'Erro interno';
  }

  if (error) return { error };
  return result;
}

function initDirectChat() {
  if (_chatInitialized) return;
  _chatInitialized = true;

  // Language state â€” declared early so handleSend() can access it
  let currentLang = 'pt';
  // Resolved lazily so UI_LABELS (defined later) is always current
  const getLang = () => (typeof UI_LABELS !== 'undefined' ? UI_LABELS[currentLang] || UI_LABELS.pt : null);

  const historyEl = document.getElementById('history');
  const messageEl = document.getElementById('message');
  const sendBtn = document.getElementById('sendBtn');
  const statusEl = document.getElementById('status');
  const clearBtn = document.getElementById('clearBtn');
  const publishBtn = document.getElementById('publishBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const licenseInfoEl = document.getElementById('licenseInfo');
  const attachBtn = document.getElementById('attachBtn');
  const fileInput = document.getElementById('fileInput');
  const filePreview = document.getElementById('filePreview');
  const enhanceBtn = document.getElementById('enhanceBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const removeWatermarkBtn = document.getElementById('removeWatermarkBtn');
  const tabChat = document.getElementById('tabChat');
  const tabTemplates = document.getElementById('tabTemplates');
  const chatPanel = document.getElementById('chatPanel');
  const templatesPanel = document.getElementById('templatesPanel');

  let history = [];
  let pendingFiles = [];

  function updateStatus(text) { if (statusEl) statusEl.textContent = text; }

  function addMessage(role, text) {
    history.push({ role, text });
    callCommand('storage.set', { data: { history } });
    renderHistory();
  }

  function renderHistory() {
    if (!historyEl) return;
    if (history.length === 0) {
      historyEl.innerHTML = '<div class="empty-state"><h3>Pronto para comeÃ§ar</h3><p>Envie uma mensagem para interagir</p></div>';
      return;
    }
    historyEl.innerHTML = history.map(m =>
      `<div class="message-wrapper ${m.role}"><div class="bubble ${m.role}">${escapeHtml(m.text)}</div></div>`
    ).join('');
    historyEl.scrollTop = historyEl.scrollHeight;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderFilePreview() {
    if (!filePreview) return;
    if (pendingFiles.length === 0) {
      filePreview.style.display = 'none';
      filePreview.innerHTML = '';
      return;
    }
    filePreview.style.display = 'flex';
    filePreview.innerHTML = pendingFiles.map((f, i) => {
      const isImage = f.mime && f.mime.startsWith('image/');
      if (isImage) {
        const src = `data:${f.mime};base64,${f.dataB64}`;
        return `<div class="file-chip is-image" data-idx="${i}">
          <img class="file-chip-thumb" src="${src}" alt="${escapeHtml(f.name)}">
          <div class="file-chip-name">${escapeHtml(f.name)}</div>
          <button class="file-chip-remove" data-idx="${i}" title="Remover">&times;</button>
        </div>`;
      }
      return `<div class="file-chip" data-idx="${i}">
        <span>\u{1F4CE} ${escapeHtml(f.name)}</span>
        <button class="file-chip-remove" data-idx="${i}" title="Remover">&times;</button>
      </div>`;
    }).join('');
    filePreview.querySelectorAll('.file-chip-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        pendingFiles.splice(parseInt(btn.dataset.idx), 1);
        renderFilePreview();
      });
    });
  }

  // Load history
  callCommand('storage.get', { keys: ['history'] }).then(data => {
    if (data?.history) history = data.history;
    renderHistory();
  });

  // License info
  if (licenseInfoEl && licenseInfo) {
    const d = licenseInfo.days_remaining ?? 999;
    licenseInfoEl.textContent = `${d} dias`;
  }

  // Textarea auto-resize
  messageEl?.addEventListener('input', () => {
    messageEl.style.height = 'auto';
    messageEl.style.height = Math.min(messageEl.scrollHeight, 300) + 'px';
  });

  // Send
  async function handleSend() {
    if (!messageEl) return;
    const msg = messageEl.value.trim();
    if (!msg && pendingFiles.length === 0) return;

    sendBtn && (sendBtn.disabled = true);
    updateStatus('ðŸ“¤ Enviando...');

    if (msg) addMessage('user', msg);

    const files = pendingFiles.map(f => ({
      dataB64: f.dataB64, name: f.name, mime: f.mime
    }));

    try {
      const res = await callCommand('lovable.sendMessage', { message: msg, files });
      if (res?.error) {
        addMessage('bot', '\u274C ' + res.error);
        updateStatus('\u274C Erro');
      } else {
        const L = getLang();
        addMessage('bot', L ? L.msgSent : '\u2705 Mensagem enviada! O Lovable est\u00e1 processando...');
        updateStatus('');
      }
    } catch (e) {
      addMessage('bot', 'âŒ ' + (e?.message || 'Erro'));
      updateStatus('âŒ Erro');
    }

    messageEl.value = '';
    messageEl.style.height = 'auto';
    pendingFiles = [];
    renderFilePreview();
    sendBtn && (sendBtn.disabled = false);
  }

  sendBtn?.addEventListener('click', handleSend);
  messageEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Attach
  attachBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    if (!fileInput.files?.length) return;
    for (const file of fileInput.files) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1] || '';
        pendingFiles.push({ dataB64: base64, name: file.name, mime: file.type || 'application/octet-stream' });
        renderFilePreview();
      };
      reader.readAsDataURL(file);
    }
    fileInput.value = '';
  });

  // â”€â”€ DRAG & DROP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function handleDroppedFiles(files) {
    if (!files || files.length === 0) return;
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1] || '';
        pendingFiles.push({ dataB64: base64, name: file.name, mime: file.type || 'application/octet-stream' });
        renderFilePreview();
      };
      reader.readAsDataURL(file);
    }
  }

  const dropZone = document.getElementById('chatPanel');
  if (dropZone) {
    const dropOverlay = document.createElement('div');
    dropOverlay.id = 'lkp-drop-overlay';
    dropOverlay.style.cssText = 'display:none;position:absolute;inset:0;z-index:500;background:rgba(220,20,60,.13);border:2px dashed rgba(220,20,60,.6);border-radius:12px;align-items:center;justify-content:center;pointer-events:none;backdrop-filter:blur(2px);';
    dropOverlay.innerHTML = '<div style="text-align:center;color:#FF4060;font-family:Outfit,sans-serif;font-weight:700;font-size:14px;"><div style="font-size:30px;margin-bottom:6px;">&#128206;</div>Solte para anexar</div>';
    dropZone.style.position = 'relative';
    dropZone.appendChild(dropOverlay);
    let dragCounter = 0;
    dropZone.addEventListener('dragenter', (e) => { e.preventDefault(); dragCounter++; dropOverlay.style.display = 'flex'; });
    dropZone.addEventListener('dragleave', () => { dragCounter--; if (dragCounter <= 0) { dragCounter = 0; dropOverlay.style.display = 'none'; } });
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    dropZone.addEventListener('drop', (e) => { e.preventDefault(); dragCounter = 0; dropOverlay.style.display = 'none'; handleDroppedFiles(e.dataTransfer.files); });
  }

  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    let hasImage = false;
    for (const item of items) {
      if (item.kind === 'file') { hasImage = true; const f = item.getAsFile(); if (f) handleDroppedFiles([f]); }
    }
    if (hasImage && document.activeElement !== messageEl) e.preventDefault();
  });


  enhanceBtn?.addEventListener('click', async () => {
    if (!messageEl) return;
    const original = messageEl.value.trim();
    if (!original) { updateStatus('âš ï¸ Digite algo para melhorar'); return; }
    enhanceBtn.disabled = true;
    enhanceBtn.classList.add('loading');
    const label = enhanceBtn.querySelector('span');
    const prevLabel = label?.textContent;
    if (label) label.textContent = 'Otimizando...';
    updateStatus('âœ¨ Melhorando prompt...');
    try {
      const result = await callCommand('ai.enhancePrompt', { prompt: original });
      if (result?.improved) {
        messageEl.value = result.improved;
        messageEl.style.height = 'auto';
        messageEl.style.height = Math.min(messageEl.scrollHeight, 300) + 'px';
        messageEl.focus();
        updateStatus('âœ… Prompt otimizado');
      } else {
        throw new Error(result?.error || 'Resposta vazia');
      }
    } catch (err) {
      addMessage('bot', 'âŒ ' + (err?.message || 'Erro ao melhorar prompt'));
      updateStatus('âŒ Erro');
    } finally {
      enhanceBtn.disabled = false;
      enhanceBtn.classList.remove('loading');
      if (label && prevLabel) label.textContent = prevLabel;
    }
  });

  // Publish
  publishBtn?.addEventListener('click', async () => {
    updateStatus('ðŸ“¡ Publicando...');
    try {
      const res = await callCommand('lovable.publish', {});
      if (res?.error) { updateStatus('âŒ ' + res.error); showToast(res.error, 'error'); }
      else { updateStatus('âœ… Publicado!'); showToast('Projeto publicado!', 'success'); }
    } catch (e) { updateStatus('âŒ Erro'); }
  });

  // Download
  downloadBtn?.addEventListener('click', async () => {
    updateStatus('â¬‡ Baixando projeto...');
    try {
      const res = await callCommand('lovable.downloadProject', { mode: 'zip' });
      if (res?.error) { updateStatus('âŒ ' + res.error); }
      else { updateStatus('âœ… Download concluÃ­do!'); showToast('Download concluÃ­do!', 'success'); }
    } catch (e) { updateStatus('âŒ Erro'); }
  });

  // Remove watermark
  removeWatermarkBtn?.addEventListener('click', () => {
    if (!messageEl) return;
    messageEl.value = `Adicione esse cÃ³digo no final do cÃ³digo do index.css:\n\n#lovable-badge {\n  display: none !important;\n}`;
    handleSend();
  });

  // Clear
  clearBtn?.addEventListener('click', () => {
    history = [];
    callCommand('storage.set', { data: { history: [] } });
    renderHistory();
  });

  // Logout
  logoutBtn?.addEventListener('click', () => callCommand('license.logout', {}));

  // ========== VOICE TO TEXT (via Offscreen Document) ==========
  const micBtn = document.getElementById('micBtn');
  if (micBtn) {
    let _voiceRecording = false;

    micBtn.addEventListener('click', () => {
      if (_voiceRecording) {
        chrome.runtime.sendMessage({ type: 'VOICE_STOP' }, () => void chrome.runtime.lastError);
        _voiceRecording = false;
        micBtn.classList.remove('recording');
        updateStatus('');
      } else {
        updateStatus('ðŸŽ¤ Iniciando...');
        micBtn.classList.add('recording');
        chrome.runtime.sendMessage({
          type: 'VOICE_START',
          lang: 'pt-BR',
          existingText: messageEl?.value || ''
        }, () => void chrome.runtime.lastError);
      }
    });

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'VOICE_STATUS') {
        if (msg.status === 'started') {
          _voiceRecording = true;
          micBtn.classList.add('recording');
          updateStatus('ðŸŽ¤ Ouvindo... fale agora');
        } else if (msg.status === 'ended') {
          _voiceRecording = false;
          micBtn.classList.remove('recording');
          updateStatus(messageEl?.value?.trim() ? 'âœ… Texto transcrito' : '');
          messageEl?.focus();
        }
      } else if (msg.type === 'VOICE_RESULT' && messageEl) {
        messageEl.value = msg.text || '';
        messageEl.style.height = 'auto';
        messageEl.style.height = Math.min(messageEl.scrollHeight, 300) + 'px';
      } else if (msg.type === 'VOICE_ERROR') {
        _voiceRecording = false;
        micBtn.classList.remove('recording');
        const errMap = {
          'not-allowed': 'âŒ Microfone bloqueado. Permita em chrome://settings/content/microphone',
          'no-speech': 'âš ï¸ Nenhuma fala detectada. Tente novamente.',
          'audio-capture': 'âŒ Microfone nÃ£o encontrado',
          'not-supported': 'âŒ Navegador nÃ£o suporta reconhecimento de voz',
        };
        updateStatus(errMap[msg.error] || 'âŒ Erro: ' + msg.error);
      }
    });
  }

  // ========== SUB-ACTION FROM FLOATING BALL ==========
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.action === 'executeSubAction' && msg.actionId) {
      const prompt = QA_PROMPTS[msg.actionId];
      if (!prompt) return;
      (async () => {
        try {
          await callCommand('lovable.sendMessage', { message: prompt, files: [] });
          addMessage('bot', `âœ… ${msg.actionId.toUpperCase()} enviado! O Lovable estÃ¡ processando...`);
        } catch (e) {
          addMessage('bot', 'âŒ ' + (e?.message || 'Erro'));
        }
      })();
    }
  });

  // Tabs
  tabChat?.addEventListener('click', () => {
    tabChat.classList.add('active');
    tabTemplates?.classList.remove('active');
    if (chatPanel) chatPanel.style.display = 'flex';
    if (templatesPanel) templatesPanel.style.display = 'none';
  });
  tabTemplates?.addEventListener('click', async () => {
    tabTemplates.classList.add('active');
    tabChat?.classList.remove('active');
    if (chatPanel) chatPanel.style.display = 'none';
    if (templatesPanel) { templatesPanel.style.display = 'block'; }
    // Load templates
    templatesPanel.innerHTML = '<div class="templates-empty">Carregando...</div>';
    try {
      const data = await callCommand('templates.getAll', {});
      if (data?.error) throw new Error(data.error);
      const templates = data?.templates || data || [];
      if (!Array.isArray(templates) || templates.length === 0) {
        templatesPanel.innerHTML = '<div class="templates-empty">Nenhum template disponÃ­vel</div>';
        return;
      }
      templatesPanel.innerHTML = templates.map(t => `
        <div class="template-card" data-prompt="${escapeHtml(t.prompt || t.description || '')}">
          <div class="template-bottom">
            <div><div class="template-name">${escapeHtml(t.name || 'Template')}</div>
            <div class="template-desc">${escapeHtml(t.description || '')}</div></div>
            <button class="template-use">Usar</button>
          </div>
        </div>
      `).join('');
      templatesPanel.querySelectorAll('.template-use').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const card = e.target.closest('.template-card');
          const prompt = card?.dataset.prompt;
          if (prompt && messageEl) {
            messageEl.value = prompt;
            messageEl.style.height = 'auto';
            messageEl.style.height = Math.min(messageEl.scrollHeight, 300) + 'px';
            tabChat?.click();
            messageEl.focus();
          }
        });
      });
    } catch (e) {
      templatesPanel.innerHTML = `<div class="templates-empty">Erro: ${e.message}</div>`;
    }
  });

  // ========== QUICK ACTION BUTTONS ==========
  const QA_PROMPTS = {
    corrigir: `Analise completamente todo o projeto e identifique TODOS os bugs, erros, falhas, comportamentos inesperados e possÃ­veis problemas existentes na aplicaÃ§Ã£o.

Seu objetivo Ã© realizar uma auditoria tÃ©cnica profunda no sistema inteiro, corrigindo problemas de lÃ³gica, frontend, backend, integraÃ§Ã£o, renderizaÃ§Ã£o, estado, banco de dados, responsividade e performance.

Antes de modificar qualquer coisa:
- Analise toda a estrutura do projeto
- Analise rotas, componentes, hooks, estados globais
- Analise integraÃ§Ãµes, Supabase, APIs, banco de dados
- Analise autenticaÃ§Ã£o, permissÃµes, carregamentos
- Analise console errors, warnings, logs
- Analise comportamento da interface, responsividade
- Analise possÃ­veis falhas silenciosas, seguranÃ§a bÃ¡sica
- Analise fluxos completos do sistema

Identifique e corrija:
- Bugs visuais e de navegaÃ§Ã£o
- Erros de console e warnings
- Loops infinitos, problemas de renderizaÃ§Ã£o
- Re-renderizaÃ§Ãµes desnecessÃ¡rias
- Falhas de autenticaÃ§Ã£o, sessÃ£o, permissÃµes
- Problemas de loading, estado, sincronizaÃ§Ã£o
- Problemas de responsividade, formulÃ¡rios, validaÃ§Ã£o
- Problemas em chamadas API e queries Supabase
- Problemas de realtime, cache, tipagem, imports
- Problemas de performance, UX, mobile, acessibilidade
- Memory leaks, requests duplicados, condiÃ§Ãµes de corrida
- Falhas silenciosas, tratamento incorreto de erros

Verifique especialmente:
- Fluxos de login/logout e persistÃªncia de sessÃ£o
- ProteÃ§Ã£o de rotas e navegaÃ§Ã£o entre pÃ¡ginas
- CRUDs completos, uploads, modais
- Estados assÃ­ncronos, atualizaÃ§Ãµes em tempo real
- Compatibilidade mobile e responsividade geral
- Componentes reutilizÃ¡veis, integraÃ§Ãµes externas

Regras importantes:
- NÃƒO remover funcionalidades sem necessidade
- NÃƒO alterar design sem motivo
- NÃƒO criar soluÃ§Ãµes temporÃ¡rias
- Sempre aplicar soluÃ§Ãµes profissionais
- Priorizar estabilidade, seguranÃ§a e confiabilidade
- Garantir cÃ³digo limpo e sustentÃ¡vel

O resultado final deve deixar a aplicaÃ§Ã£o estÃ¡vel, confiÃ¡vel, sem erros visÃ­veis, fluida, responsiva e pronta para produÃ§Ã£o.`,

    refatorar: `Analise todo o projeto de forma completa antes de realizar qualquer alteraÃ§Ã£o e execute uma refatoraÃ§Ã£o profunda e estruturada em toda a base de cÃ³digo.

Seu objetivo Ã© melhorar a qualidade interna do sistema sem alterar funcionalidades ou comportamento visÃ­vel da aplicaÃ§Ã£o.

A refatoraÃ§Ã£o deve tornar o cÃ³digo mais limpo, organizado, escalÃ¡vel, padronizado e fÃ¡cil de manter.

Realize uma revisÃ£o completa de:
- Estrutura de pastas e organizaÃ§Ã£o do projeto
- Componentes e sua reutilizaÃ§Ã£o
- Hooks customizados, lÃ³gica de estado
- Services e camadas de API
- IntegraÃ§Ã£o com Supabase, queries
- Fluxos de autenticaÃ§Ã£o, rotas
- Tipagem, lÃ³gica duplicada ou redundante
- FunÃ§Ãµes grandes ou mal divididas
- Acoplamento excessivo entre componentes
- Imports desorganizados
- Regras de negÃ³cio misturadas com UI

Objetivos principais:
- Reduzir duplicaÃ§Ã£o de cÃ³digo
- Melhorar legibilidade e separaÃ§Ã£o de responsabilidades
- Melhorar reutilizaÃ§Ã£o de componentes
- Criar padrÃµes consistentes no projeto
- Facilitar manutenÃ§Ã£o futura
- Reduzir complexidade desnecessÃ¡ria
- Melhorar escalabilidade

Diretrizes:
- NÃƒO alterar funcionalidades existentes
- NÃƒO mudar comportamento da interface
- NÃƒO quebrar fluxos jÃ¡ existentes
- Priorizar separaÃ§Ã£o de responsabilidades (UI / lÃ³gica / dados)
- ComponentizaÃ§Ã£o inteligente e reutilizaÃ§Ã£o
- NomeaÃ§Ã£o clara e consistente
- OrganizaÃ§Ã£o por domÃ­nio ou feature

Resultado esperado: projeto muito mais organizado, fÃ¡cil de entender e manter, escalÃ¡vel, livre de duplicaÃ§Ãµes, com arquitetura profissional e padrÃµes consistentes.`,

    melhorar: `Analise completamente toda a aplicaÃ§Ã£o antes de realizar qualquer alteraÃ§Ã£o e execute uma melhoria profunda de UI/UX em todo o sistema.

Seu objetivo Ã© elevar o nÃ­vel visual e de experiÃªncia do usuÃ¡rio para um padrÃ£o moderno, premium e altamente intuitivo, sem alterar funcionalidades existentes.

Transformar a interface em uma experiÃªncia mais clara, intuitiva, moderna, consistente, agradÃ¡vel e profissional visualmente.

Antes de modificar, analise:
- Estrutura visual geral, hierarquia de informaÃ§Ã£o
- ConsistÃªncia de componentes, layouts
- EspaÃ§amentos, alinhamentos, tipografia, legibilidade
- Cores, contraste, botÃµes e elementos interativos
- Fluxos de navegaÃ§Ã£o, estados (loading, empty, error, success)
- Responsividade, feedback visual, microinteraÃ§Ãµes
- Usabilidade geral, clareza dos formulÃ¡rios
- Densidade visual

Melhorias de UI:
- Melhorar hierarquia visual, padronizar espaÃ§amentos
- Melhorar composiÃ§Ã£o visual, proporÃ§Ãµes, tipografia
- Padronizar paleta de cores, melhorar estados
- Padronizar botÃµes, cards, inputs, modais

Melhorias de UX:
- Tornar navegaÃ§Ã£o mais intuitiva
- Reduzir fricÃ§Ã£o em fluxos importantes
- Melhorar feedback ao usuÃ¡rio e estados de carregamento
- Simplificar interaÃ§Ãµes complexas

MicrointeraÃ§Ãµes:
- Hover suaves, feedback visual de cliques
- TransiÃ§Ãµes entre estados, animaÃ§Ãµes leves
- Garantir fluidez visual

Regras: NÃƒO alterar funcionalidades, NÃƒO remover features, NÃƒO quebrar fluxos atuais. Priorizar consistÃªncia. O sistema deve parecer mais profissional, moderno, polido e fÃ¡cil de usar.`,

    otimizar: `Analise completamente todo o projeto antes de realizar qualquer alteraÃ§Ã£o.

Quero que vocÃª faÃ§a uma otimizaÃ§Ã£o profunda em toda a aplicaÃ§Ã£o com foco total em performance, fluidez de navegaÃ§Ã£o, velocidade de carregamento e experiÃªncia do usuÃ¡rio.

Transformar o sistema em uma aplicaÃ§Ã£o extremamente rÃ¡pida, leve, fluida e responsiva.

Analise:
- Estrutura do projeto, rotas, componentes, hooks
- Estados globais, queries, integraÃ§Ãµes com Supabase
- Chamadas API, renderizaÃ§Ãµes desnecessÃ¡rias
- Bundle size, assets, imagens, CSS, scripts
- Consumo de memÃ³ria, gargalos de performance
- Problemas de carregamento, hidrataÃ§Ã£o, reatividade

Otimize:
- FRONTEND: Lazy loading, code splitting, memoizaÃ§Ã£o, re-renderizaÃ§Ãµes, imports desnecessÃ¡rios, cache, prefetch, Suspense/loading states
- NAVEGAÃ‡ÃƒO: TransiÃ§Ãµes fluidas entre pÃ¡ginas, reduzir delays, evitar piscadas visuais
- SUPABASE/BACKEND: Otimizar queries, reduzir requests desnecessÃ¡rios, melhorar paginaÃ§Ã£o, realtime, cache
- IMAGENS/ASSETS: CompressÃ£o, lazy loading, formatos otimizados
- CSS/UI: Remover CSS redundante, otimizar animaÃ§Ãµes, melhorar fluidez
- AVANÃ‡ADO: Core Web Vitals, Lighthouse, FPS, memory leaks, tempo de interaÃ§Ã£o

Regras: NÃƒO quebrar funcionalidades, NÃƒO remover recursos, NÃƒO alterar design sem necessidade. O resultado deve ser uma aplicaÃ§Ã£o muito mais rÃ¡pida, fluida, leve e otimizada para produÃ§Ã£o.`,

    seguranca: `Analise completamente toda a aplicaÃ§Ã£o antes de realizar qualquer alteraÃ§Ã£o e execute uma auditoria profunda de SEGURANÃ‡A e BANCO DE DADOS em todo o sistema.

Identificar vulnerabilidades, falhas de seguranÃ§a, riscos de exposiÃ§Ã£o de dados, problemas de autenticaÃ§Ã£o/autorizaÃ§Ã£o e otimizar toda a estrutura do banco de dados.

Analise:
- Estrutura completa do banco de dados, tabelas, relaÃ§Ãµes
- PolÃ­ticas de acesso (RLS no Supabase), queries
- Endpoints, APIs, autenticaÃ§Ã£o, sessÃ£o
- AutorizaÃ§Ã£o e permissÃµes por role
- ExposiÃ§Ã£o de dados sensÃ­veis, validaÃ§Ã£o de inputs
- Upload de arquivos, storage, logs
- Tokens e chaves de API, variÃ¡veis de ambiente
- PossÃ­veis pontos de injeÃ§Ã£o

SeguranÃ§a (prioridade mÃ¡xima):
- Falhas de autenticaÃ§Ã£o e autorizaÃ§Ã£o
- RLS mal configuradas, exposiÃ§Ã£o de dados no frontend
- Queries inseguras, endpoints sem validaÃ§Ã£o
- Upload sem validaÃ§Ã£o, acesso direto a tabelas
- Vazamento de IDs/emails, tokens expostos
- Falta de expiraÃ§Ã£o de sessÃ£o e proteÃ§Ã£o de rotas

Banco de dados:
- NormalizaÃ§Ã£o, relaÃ§Ãµes corretas, foreign keys
- IndexaÃ§Ã£o, remoÃ§Ã£o de redundÃ¢ncia
- OtimizaÃ§Ã£o de queries pesadas, paginaÃ§Ã£o
- Evitar N+1 queries

Supabase: Revisar RLS, policies por role, Storage policies, realtime subscriptions, service_role usage.

Regras: NUNCA expor secrets no frontend, SEMPRE validar no backend/banco, princÃ­pio de menor privilÃ©gio, proteger dados sensÃ­veis. O sistema deve estar seguro, protegido, com banco otimizado e pronto para produÃ§Ã£o.`,

    responsivo: `Analise toda a aplicaÃ§Ã£o antes de realizar qualquer alteraÃ§Ã£o e torne TODAS as pÃ¡ginas, componentes e fluxos 100% responsivos em todos os dispositivos.

Garantir que o sistema funcione perfeitamente em qualquer tamanho de tela: mobile, tablets, notebooks, desktops e ultrawide, sem quebras de layout, overflow ou perda de usabilidade.

Analise:
- Todas as pÃ¡ginas e rotas, layouts, componentes
- Containers, grids, breakpoints atuais
- Width/height fixos, overflow, elementos quebrando
- Tipografia, botÃµes, formulÃ¡rios em diferentes telas
- Modais, dropdowns, menus, imagens, tabelas
- NavegaÃ§Ã£o, sidebar, espaÃ§amentos

Melhorias obrigatÃ³rias:
- LAYOUT: Substituir widths fixos, usar Flexbox/Grid, breakpoints consistentes
- MOBILE (prioridade): EspaÃ§amentos, botÃµes adequados para toque, menus mobile, simplificar layouts, tabelas responsivas
- TIPOGRAFIA: Tamanhos por breakpoint, legibilidade, line-height responsivo
- IMAGENS: Fluidas (max-width:100%), sem distorÃ§Ã£o
- COMPONENTES: Cards responsivos, modais fullscreen no mobile, dropdowns adaptÃ¡veis
- FORMULÃRIOS: Inputs largura correta, botÃµes full-width quando necessÃ¡rio
- NAVEGAÃ‡ÃƒO: Sidebar colapsÃ¡vel, menus responsivos

Breakpoints: Mobile atÃ© 480px, Tablet atÃ© 768px, Laptop atÃ© 1024px, Desktop 1280px+

Regras: NÃƒO quebrar funcionalidades, NÃƒO remover features, NÃƒO alterar design base. Priorizar adaptaÃ§Ã£o. O sistema deve estar 100% responsivo, sem quebras, com excelente UX mobile e pronto para produÃ§Ã£o.`
  };

  // ========== LANGUAGE SYSTEM (UI only) ==========
  // Translates sidebar labels + placeholder. Prompts always sent in PT.
  const UI_LABELS = {
    pt: {
      placeholder: 'Digite sua mensagem...',
      sending:  (a) => `\u{1F680} Enviando ${a}...`,
      sent:     (a) => `\u2705 ${a.toUpperCase()} enviado! O Lovable est\u00e1 processando...`,
      msgSent:  '\u2705 Mensagem enviada! O Lovable est\u00e1 processando...',
      errStatus: '\u274C Erro',
      actions: {
        chat: 'Chat', corrigir: 'Corrigir', refatorar: 'Refatorar',
        melhorar: 'Melhorar', otimizar: 'Otimizar', seguranca: 'Seguran\u00e7a',
        responsivo: 'Responsivo', publish: 'Publish', download: 'Download',
        watermark: 'Sem Marca d\u2019\u00c1gua', clear: 'Limpar Chat',
        logout: 'Sair', lang: 'Idioma'
      }
    },
    en: {
      placeholder: 'Type your message...',
      sending:  (a) => `\u{1F680} Sending ${a}...`,
      sent:     (a) => `\u2705 ${a.toUpperCase()} sent! Lovable is processing...`,
      msgSent:  '\u2705 Message sent! Lovable is processing...',
      errStatus: '\u274C Error',
      actions: {
        chat: 'Chat', corrigir: 'Fix Bugs', refatorar: 'Refactor',
        melhorar: 'Improve UI', otimizar: 'Optimize', seguranca: 'Security',
        responsivo: 'Responsive', publish: 'Publish', download: 'Download',
        watermark: 'Remove Watermark', clear: 'Clear Chat',
        logout: 'Logout', lang: 'Language'
      }
    },
    es: {
      placeholder: 'Escribe tu mensaje...',
      sending:  (a) => `\u{1F680} Enviando ${a}...`,
      sent:     (a) => `\u2705 ${a.toUpperCase()} enviado! Lovable est\u00e1 procesando...`,
      msgSent:  '\u2705 \u00a1Mensaje enviado! Lovable est\u00e1 procesando...',
      errStatus: '\u274C Error',
      actions: {
        chat: 'Chat', corrigir: 'Corregir', refatorar: 'Refactorizar',
        melhorar: 'Mejorar UI', otimizar: 'Optimizar', seguranca: 'Seguridad',
        responsivo: 'Responsivo', publish: 'Publicar', download: 'Descargar',
        watermark: 'Sin Marca de Agua', clear: 'Limpiar Chat',
        logout: 'Salir', lang: 'Idioma'
      }
    }
  };

  // (currentLang declared at top of initDirectChat)

  function applyUILang(lang) {
    currentLang = lang;
    const L = UI_LABELS[lang] || UI_LABELS.pt;

    // Textarea placeholder
    if (messageEl) messageEl.placeholder = L.placeholder;

    // Action buttons (.lkp-sb-action) labels
    document.querySelectorAll('.lkp-sb-action').forEach(btn => {
      const key = btn.dataset.action;
      const span = btn.querySelector('.lkp-btn-label');
      if (span && L.actions[key]) span.textContent = L.actions[key];
    });

    // Fixed button labels by id
    const idMap = {
      'sb-chat': 'chat', publishBtn: 'publish', downloadBtn: 'download',
      removeWatermarkBtn: 'watermark', clearBtn: 'clear', logoutBtn: 'logout'
    };
    Object.entries(idMap).forEach(([id, key]) => {
      const span = document.getElementById(id)?.querySelector('.lkp-btn-label');
      if (span && L.actions[key]) span.textContent = L.actions[key];
    });

    // Lang button label
    const langLbl = document.getElementById('langBtnLabel');
    if (langLbl) langLbl.textContent = L.actions.lang;

    // Mark active option
    document.querySelectorAll('.lang-opt').forEach(o =>
      o.classList.toggle('active', o.dataset.lang === lang));

    // Persist
    try { chrome.storage.local.set({ lkp_lang: lang }); } catch (_) {}
  }

  // Lang dropdown toggle
  const langBtn = document.getElementById('langBtn');
  const langDropdown = document.getElementById('langDropdown');
  if (langBtn && langDropdown) {
    langBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      langDropdown.classList.toggle('open');
    });
    langDropdown.querySelectorAll('.lang-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        applyUILang(opt.dataset.lang);
        langDropdown.classList.remove('open');
      });
    });
    document.addEventListener('click', () => langDropdown.classList.remove('open'));
  }

  // Restore saved language on load
  try {
    chrome.storage.local.get(['lkp_lang'], (r) => { if (r?.lkp_lang) applyUILang(r.lkp_lang); });
  } catch (_) {}

  // Wire up quick action buttons
  document.querySelectorAll('.lkp-sb-action').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      const prompt = QA_PROMPTS[action];
      if (!prompt) return;
      const L = UI_LABELS[currentLang] || UI_LABELS.pt;

      btn.classList.add('sending');
      updateStatus(L.sending(action));

      try {
        const res = await callCommand('lovable.sendMessage', { message: prompt, files: [] });
        if (res?.error) {
          addMessage('bot', '\u274C ' + res.error);
          updateStatus(L.errStatus);
        } else {
          addMessage('bot', L.sent(action));
          updateStatus('');
        }
      } catch (e) {
        addMessage('bot', '\u274C ' + (e?.message || 'Erro'));
        updateStatus(L.errStatus);
      } finally {
        btn.classList.remove('sending');
      }
    });
  });

  console.log('[Love King PRO] Chat direto inicializado â€” sem iframe');
}

// ========== DIRECT SEND (used by watermark FAB) ==========
async function sendDirectLovableMessage(messageText) {
  const check = await revalidateLicense();
  if (!check.valid) throw new Error(check.message || 'LicenÃ§a invÃ¡lida');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab?.url || !/lovable\.dev|lovableproject\.com/.test(tab.url)) {
    throw new Error('Abra um projeto do Lovable na aba ativa primeiro.');
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async (msg) => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      const getComposer = () => {
        const textarea = document.querySelector('textarea[placeholder]') || document.querySelector('textarea');
        if (textarea) return textarea;
        return document.querySelector('[contenteditable="true"][role="textbox"]') || document.querySelector('[contenteditable="true"]');
      };

      const setComposerValue = (composer, value) => {
        composer.focus();
        if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
          const proto = composer instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) setter.call(composer, value);
          else composer.value = value;
          composer.dispatchEvent(new Event('input', { bubbles: true }));
          composer.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
        composer.textContent = value;
        composer.dispatchEvent(new InputEvent('input', {
          bubbles: true, cancelable: true, data: value, inputType: 'insertText'
        }));
      };

      const getSendButton = () => {
        const selectors = [
          'button[data-testid="chat-send-button"]',
          'button[aria-label*="Send"]',
          'button[aria-label*="Enviar"]',
          'form button[type="submit"]',
          'button[type="submit"]'
        ];
        return selectors.map((s) => document.querySelector(s)).find((b) => b && !b.disabled);
      };

      const composer = getComposer();
      if (!composer) return { success: false, error: 'Campo do chat nÃ£o encontrado.' };

      setComposerValue(composer, msg);
      await wait(120);

      const sendButton = getSendButton();
      if (sendButton) { sendButton.click(); return { success: true }; }

      composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      composer.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      return { success: true };
    },
    args: [messageText]
  });

  if (!result?.success) throw new Error(result?.error || 'Falha ao enviar mensagem no chat.');
  return true;
}

// ========== MAIN INITIALIZATION ==========

document.addEventListener('DOMContentLoaded', async () => {
  const activateBtn = document.getElementById('activateBtn');
  const licenseInput = document.getElementById('licenseKey');
  const licenseStatus = document.getElementById('licenseStatus');
  const whatsappSupport = document.getElementById('whatsappSupport');


  loadSupportInfo();
  await generateHWID();



  if (whatsappSupport) {
    whatsappSupport.addEventListener('click', (e) => {
      e.preventDefault();
      openWhatsAppSupport();
    });
  }

  // Escuta revogaÃ§Ã£o de licenÃ§a do background.js
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'LICENSE_REVOKED') {
      console.log('[Sidepanel] LICENSE_REVOKED â€” voltando para tela de licenÃ§a');
      licenseKey = null;
      licenseSessionToken = null;
      licenseInfo = null;
      showLicenseScreen();
      showToast('Sua licenÃ§a foi revogada ou expirou.', 'error');
    }
  });

  // Check stored license â€” suporta formato LOV-ULTRA (settings.licenseKey) e legado
  async function checkStoredLicense() {
    // Tenta ler do formato LOV-ULTRA primeiro
    const storage = await chrome.storage.local.get(['licenseKey', 'licenseSessionToken', 'settings']);
    const storedKey = storage.settings?.licenseKey || storage.licenseKey || null;

    if (storedKey) {
      licenseKey = storedKey;
      licenseSessionToken = storage.licenseSessionToken || null;
      if (licenseStatus) {
        licenseStatus.textContent = 'Verificando licenÃ§a...';
        licenseStatus.style.color = '#f59e0b';
      }

      // Verifica estado em cache primeiro para nÃ£o chamar o servidor desnecessariamente
      const cachedState = storage.settings?.licenseState;
      if (cachedState?.status === 'valid') {
        // Se jÃ¡ temos o session_token real salvo (do validate-license-v2), usa ele
        if (storage.licenseSessionToken) {
          licenseSessionToken = storage.licenseSessionToken;
          licenseInfo = {
            days_remaining: cachedState.expiresAt ? Math.ceil((new Date(cachedState.expiresAt) - Date.now()) / 86400000) : 999,
            hours_remaining: 0,
            license_id: cachedState.licenseHash || null,
          };
          // Popula cache em memÃ³ria para que revalidateLicense() nÃ£o bata no servidor
          _licenseCache = { valid: true, session_token: licenseSessionToken };
          _licenseCacheTime = Date.now();
          showMainApp();
          return true;
        }
        // Sem token salvo: obtÃ©m do validate-license-v2 usando a chave
        const result = await validateLicense(storedKey);
        if (result.status === 'valid') {
          licenseSessionToken = result.session_token;
          licenseInfo = {
            days_remaining: result.days_remaining,
            hours_remaining: result.hours_remaining,
            license_id: result.license_id,
          };
          const cur1 = (await chrome.storage.local.get('settings')).settings || {};
          await chrome.storage.local.set({ licenseKey: storedKey, licenseSessionToken: result.session_token, settings: { ...cur1, licenseState: { status: 'valid' }, licenseKey: storedKey } });
          _licenseCache = { valid: true, session_token: result.session_token };
          _licenseCacheTime = Date.now();
          showMainApp();
          return true;
        }
      }

      // Sem cache vÃ¡lido â†’ valida no servidor
      const result = await validateLicense(storedKey);
      if (result.status === 'valid') {
        licenseSessionToken = result.session_token;
        licenseInfo = {
          days_remaining: result.days_remaining,
          hours_remaining: result.hours_remaining,
          license_id: result.license_id,
        };
        const cur2 = (await chrome.storage.local.get('settings')).settings || {};
        await chrome.storage.local.set({ licenseKey: storedKey, licenseSessionToken: result.session_token, settings: { ...cur2, licenseState: { status: 'valid' }, licenseKey: storedKey } });
        _licenseCache = { valid: true, session_token: result.session_token };
        _licenseCacheTime = Date.now();
        showMainApp();
        return true;
      } else {
        // Verifica se e erro transitorio (Database error) - nao apaga a licenca salva
        const errMsg = String(result.message || result.error || '');
        const isTransient = /database|db error|connection|timeout/i.test(errMsg);
        if (isTransient && licenseSessionToken) {
          // Erro transitorio: usa o token salvo e mostra o app
          console.warn('[checkStoredLicense] Erro transitorio de banco - usando token salvo como fallback');
          _licenseCache = { valid: true, session_token: licenseSessionToken };
          _licenseCacheTime = Date.now();
          licenseInfo = licenseInfo || { days_remaining: 999, hours_remaining: 0, license_id: null };
          showMainApp();
          return true;
        }
        // Erro definitivo (licenca invalida, expirada, revogada) - limpa tudo
        await chrome.storage.local.remove(['licenseKey', 'licenseSessionToken']);
        chrome.runtime.sendMessage({ type: 'CLEAR_LICENSE' }).catch(() => {});
        licenseKey = null;
        licenseSessionToken = null;
        if (licenseStatus) {
          licenseStatus.textContent = `\u274c ${result.message || 'Licenca invalida'}`;
          licenseStatus.style.color = '#ef4444';
        }
      }
    }
    showLicenseScreen();
    return false;
  }

  // Activate button
  if (activateBtn) {
    activateBtn.addEventListener('click', async () => {
      const key = licenseInput?.value?.trim().toUpperCase();
      if (!key) {
        if (licenseStatus) { licenseStatus.textContent = 'Digite uma chave de licenÃ§a'; licenseStatus.style.color = '#ef4444'; }
        return;
      }
      activateBtn.disabled = true;
      if (licenseStatus) { licenseStatus.textContent = 'ðŸ” Validando licenÃ§a...'; licenseStatus.style.color = '#f59e0b'; }
      try {
        const result = await validateLicense(key);
        if (result.status === 'valid') {
          licenseKey = key;
          licenseSessionToken = result.session_token;
          licenseInfo = {
            days_remaining: result.days_remaining,
            hours_remaining: result.hours_remaining,
            license_id: result.license_id,
          };
          // Salva nos dois formatos para compatibilidade total
          const cur3 = (await chrome.storage.local.get('settings')).settings || {};
          await chrome.storage.local.set({ licenseKey: key, licenseSessionToken: result.session_token, settings: { ...cur3, licenseState: { status: 'valid' }, licenseKey: key } });
          if (licenseStatus) { licenseStatus.textContent = 'âœ… LicenÃ§a ativada!'; licenseStatus.style.color = '#22c55e'; }
          showToast('LicenÃ§a ativada com sucesso!', 'success');
          setTimeout(() => showMainApp(), 500);
        } else {
          console.warn('âŒ License activation failed. Raw result:', JSON.stringify(result));
          const friendlyMsg = friendlyLicenseError(result.message || result.error);
          if (licenseStatus) { licenseStatus.textContent = friendlyMsg; licenseStatus.style.color = '#ef4444'; }
          showToast(friendlyMsg, 'error');
        }
      } catch (error) {
        if (licenseStatus) { licenseStatus.textContent = 'âŒ Erro ao validar licenÃ§a'; licenseStatus.style.color = '#ef4444'; }
      } finally {
        activateBtn.disabled = false;
      }
    });
  }

  checkStoredLicense();
});

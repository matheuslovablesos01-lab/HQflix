// ============================================================
// Love King PRO Extension v4.4.7 - Popup (chat direto)
// Backend: LOV-ULTRA via background.js
// ============================================================

const SUPABASE_URL = ((e,k)=>e.map(c=>String.fromCharCode(c^k)).join(''))([47, 51, 51, 55, 52, 125, 104, 104, 40, 43, 51, 42, 61, 44, 63, 54, 40, 32, 49, 50, 36, 33, 33, 38, 32, 47, 46, 63, 105, 52, 50, 55, 38, 37, 38, 52, 34, 105, 36, 40], 71);
const SUPABASE_ANON_KEY = 'sb_publishable_VgPUvr8V3p8VPVWz_FZMmw_ysNnFoOM';

// ============ Helpers ============

function getDeviceInfo() {
  return {
    screen: `${screen.width}x${screen.height}`,
    color_depth: screen.colorDepth,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    platform: navigator.platform,
    cores: navigator.hardwareConcurrency || 0,
  };
}

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => {
    s.style.display = 'none';
    s.classList.add('hidden');
  });
  const target = document.getElementById(screenId);
  if (target) {
    target.style.display = 'flex';
    target.classList.remove('hidden');
  }
}

function updateStatus(elementId, message, isError = false) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = message;
    el.className = isError ? 'status error' : 'status';
  }
}

function addMessage(container, from, text) {
  const div = document.createElement('div');
  div.className = `bubble ${from}`;
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function formatTimeRemaining(days) {
  if (days >= 1) return `${Math.round(days)} dias restantes`;
  return `${Math.round(days * 24)} horas restantes`;
}

// ============ License (via background LOV-ULTRA) ============

/**
 * Valida licença via background.js (VALIDATE_LICENSE → lib/license.js → inject-config Supabase).
 */
async function validateLicense(licenseKey) {
  try {
    console.log('[LOV] Validando licença via background:', licenseKey?.substring(0, 8) + '***');
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'VALIDATE_LICENSE', key: licenseKey }, (state) => {
        void chrome.runtime.lastError;
        if (!state) { resolve({ status: 'error', message: 'Background não respondeu' }); return; }
        if (state.status === 'valid') {
          const sessionToken = state.licenseHash || btoa(licenseKey).slice(0, 32);
          const daysRemaining = state.expiresAt
            ? Math.max(0, (new Date(state.expiresAt) - Date.now()) / 86400000)
            : 365;
          resolve({
            status: 'valid',
            session_token: sessionToken,
            days_remaining: daysRemaining,
            hours_remaining: daysRemaining * 24,
            license_id: state.licenseHash || null,
            plan: state.plan,
          });
        } else {
          resolve({ status: state.status || 'invalid', message: state.error || 'Licença inválida' });
        }
      });
    });
  } catch (error) {
    console.error('[LOV] Erro ao validar licença:', error);
    return { status: 'error', message: error.message };
  }
}

// ============ Send Message (via SEND_MESSAGE_PROXY no background) ============

async function getAuthData() {
  try {
    const stored = await chrome.storage.local.get([
      'lovable_api_token', 'lovable_api_token_ts', 'lovable_git_sha', 'settings'
    ]);
    if (stored.lovable_api_token) {
      const age = Date.now() - (stored.lovable_api_token_ts || 0);
      if (age < 3600000) return { token: stored.lovable_api_token.replace(/^Bearer\s+/i, ''), gitSha: stored.lovable_git_sha || null };
    }
    if (stored.settings?.lovableToken && stored.settings?.lovableTokenAt) {
      if (Date.now() - stored.settings.lovableTokenAt < 3600000) {
        return { token: stored.settings.lovableToken, gitSha: stored.settings.lovableClientGitSha || null };
      }
    }
    return { token: null, gitSha: null };
  } catch { return { token: null, gitSha: null }; }
}

async function getProjectFromActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return null;
    const match = tab.url.match(/lovable\.dev\/projects\/([a-f0-9-]+)/);
    if (match) return match[1];
    const sub = tab.url.match(/([a-f0-9-]+)\.lovableproject\.com/);
    if (sub) return sub[1];
    return null;
  } catch { return null; }
}

async function sendChatMessage(sessionToken, message, projectId) {
  try {
    const auth = await getAuthData();
    if (!auth.token) throw new Error('Token do Lovable não encontrado. Faça login em lovable.dev.');

    const stored = await chrome.storage.local.get(['settings']);
    const sessionId = stored.settings?.lovableSessionId || '';
    const gitSha = auth.gitSha || stored.settings?.lovableClientGitSha || '';

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'SEND_MESSAGE_PROXY',
        message,
        projectId,
        token: auth.token,
        sessionId,
        gitSha,
        files: [],
        imageUrls: [],
      }, (result) => {
        void chrome.runtime.lastError;
        if (!result) resolve({ status: 'error', message: 'Background não respondeu' });
        else if (result.ok) resolve({ reply: '✅ Mensagem enviada! O Lovable está processando...' });
        else resolve({ status: 'error', message: result.error || `HTTP ${result.status}` });
      });
    });
  } catch (error) {
    console.error('[LOV] Erro ao enviar mensagem:', error);
    return { status: 'error', message: error.message };
  }
}

// ============ Main Application ============
document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const licenseInput   = document.getElementById('licenseKey');
  const activateBtn    = document.getElementById('activateBtn');
  const licenseStatus  = document.getElementById('licenseStatus');
  const timeRemaining  = document.getElementById('timeRemaining');
  const messageInput   = document.getElementById('message');
  const sendBtn        = document.getElementById('sendBtn');
  const historyEl      = document.getElementById('history');
  const statusEl       = document.getElementById('status');
  const logoutBtn      = document.getElementById('logoutBtn');

  let sessionToken = null;
  let projectId    = null;

  // ============ License Check (via background — formato LOV-ULTRA) ============
  async function checkStoredLicense() {
    // Lê do formato LOV-ULTRA (settings.licenseState) e do legado
    const storage = await chrome.storage.local.get(['licenseKey', 'sessionToken', 'settings']);
    const storedKey = storage.settings?.licenseKey || storage.licenseKey || null;
    if (!storedKey) return { valid: false, reason: 'no_license' };

    // Cache válido do LOV-ULTRA
    const cachedState = storage.settings?.licenseState;
    if (cachedState?.status === 'valid') {
      sessionToken = cachedState.licenseHash || btoa(storedKey).slice(0, 32);
      const daysRemaining = cachedState.expiresAt
        ? Math.max(0, (new Date(cachedState.expiresAt) - Date.now()) / 86400000)
        : 365;
      return { valid: true, days_remaining: daysRemaining };
    }

    // Cache legado (sessionToken)
    if (storage.sessionToken) {
      sessionToken = storage.sessionToken;
      return { valid: true };
    }

    // Sem cache → revalida
    const result = await validateLicense(storedKey);
    if (result.status === 'valid') {
      sessionToken = result.session_token;
      await chrome.storage.local.set({ licenseKey: storedKey, sessionToken: result.session_token });
      return { valid: true, days_remaining: result.days_remaining };
    }
    return { valid: false, reason: result.status, message: result.message };
  }

  // ============ Mode Selector ============
  const modeFastBtn     = document.getElementById('dl-mode-fast');
  const modeThinkingBtn = document.getElementById('dl-mode-thinking');
  if (modeFastBtn && modeThinkingBtn) {
    const storageMode = await chrome.storage.local.get(['dl_send_mode']);
    const activeMode = storageMode.dl_send_mode || 'fast';
    if (activeMode === 'fast') { modeFastBtn.classList.add('active'); modeThinkingBtn.classList.remove('active'); }
    else { modeFastBtn.classList.remove('active'); modeThinkingBtn.classList.add('active'); }
    modeFastBtn.addEventListener('click', async () => {
      modeFastBtn.classList.add('active'); modeThinkingBtn.classList.remove('active');
      await chrome.storage.local.set({ dl_send_mode: 'fast' });
    });
    modeThinkingBtn.addEventListener('click', async () => {
      modeFastBtn.classList.remove('active'); modeThinkingBtn.classList.add('active');
      await chrome.storage.local.set({ dl_send_mode: 'thinking' });
    });
  }

  // ============ Initialize ============
  const licenseCheck = await checkStoredLicense();

  if (licenseCheck.valid) {
    showScreen('mainScreen');
    if (licenseCheck.days_remaining && timeRemaining) {
      timeRemaining.textContent = formatTimeRemaining(licenseCheck.days_remaining);
    }
    projectId = await getProjectFromActiveTab();
    if (projectId && statusEl) updateStatus('status', `Projeto: ${projectId.slice(0, 8)}...`);
    else if (statusEl) updateStatus('status', 'Abra um projeto no Lovable.dev');
  } else {
    showScreen('licenseScreen');
    const errorMessages = {
      'expired':       'Sua licença expirou. Renove para continuar.',
      'invalid':       'Licença inválida. Verifique a chave.',
      'wrong_email':   'Licença vinculada a outro e-mail.',
    };
    if (licenseCheck.reason && errorMessages[licenseCheck.reason]) {
      updateStatus('licenseStatus', errorMessages[licenseCheck.reason], true);
    }
  }

  // ============ Activate License ============
  if (activateBtn) {
    activateBtn.addEventListener('click', async () => {
      const key = licenseInput.value.trim().toUpperCase();
      if (!key) { updateStatus('licenseStatus', 'Digite uma chave de licença', true); return; }

      activateBtn.disabled = true;
      activateBtn.textContent = 'Validando...';
      updateStatus('licenseStatus', 'Conectando ao servidor...');

      try {
        const result = await validateLicense(key);
        if (result.status === 'valid') {
          sessionToken = result.session_token;
          await chrome.storage.local.set({ licenseKey: key, sessionToken: result.session_token });
          updateStatus('licenseStatus', '✓ Licença ativada com sucesso!');
          activateBtn.textContent = 'Ativado!';
          setTimeout(async () => {
            showScreen('mainScreen');
            if (timeRemaining) timeRemaining.textContent = formatTimeRemaining(result.days_remaining || 365);
            projectId = await getProjectFromActiveTab();
            if (projectId && statusEl) updateStatus('status', `Projeto: ${projectId.slice(0, 8)}...`);
          }, 1000);
        } else {
          activateBtn.disabled = false;
          activateBtn.textContent = 'Ativar Licença';
          const messages = {
            'invalid':     'Chave de licença inválida',
            'expired':     'Esta licença está expirada',
            'wrong_email': 'Licença vinculada a outro e-mail',
            'error':       result.message || 'Erro ao validar licença',
          };
          updateStatus('licenseStatus', messages[result.status] || result.message || 'Erro desconhecido', true);
        }
      } catch (error) {
        activateBtn.disabled = false;
        activateBtn.textContent = 'Ativar Licença';
        updateStatus('licenseStatus', 'Erro de conexão. Tente novamente.', true);
      }
    });
  }

  // Enter key on license input
  if (licenseInput) {
    licenseInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') activateBtn?.click();
    });
  }

  // ============ Send Message ============
  if (sendBtn) {
    sendBtn.addEventListener('click', async () => {
      const text = messageInput?.value?.trim();
      if (!text) return;

      if (!projectId) {
        projectId = await getProjectFromActiveTab();
        if (!projectId) { updateStatus('status', 'Abra uma aba do Lovable!', true); return; }
      }
      if (!sessionToken) { updateStatus('status', 'Sessão expirada, reative a licença', true); return; }

      addMessage(historyEl, 'user', text);
      if (messageInput) messageInput.value = '';
      sendBtn.disabled = true;
      updateStatus('status', 'Enviando...');

      const result = await sendChatMessage(sessionToken, text, projectId);

      if (result.status === 'error') {
        updateStatus('status', result.message || 'Erro no envio', true);
        addMessage(historyEl, 'bot', `Erro: ${result.message}`);
      } else if (result.reply || result.message) {
        addMessage(historyEl, 'bot', result.reply || result.message);
        updateStatus('status', 'Enviado!');
      } else {
        updateStatus('status', 'Enviado!');
      }

      sendBtn.disabled = false;
    });
  }

  // Enter key on message input
  if (messageInput) {
    messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn?.click(); }
    });
  }

  // ============ Logout ============
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      // Limpa via background (formato LOV-ULTRA)
      chrome.runtime.sendMessage({ type: 'CLEAR_LICENSE' }).catch(() => {});
      // Limpa também o formato legado
      await chrome.storage.local.remove(['licenseKey', 'sessionToken', 'sessionExpires', 'hoursRemaining']);
      sessionToken = null;
      showScreen('licenseScreen');
      if (licenseInput) licenseInput.value = '';
      updateStatus('licenseStatus', '');
    });
  }

  // Escuta revogação de licença do background.js
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'LICENSE_REVOKED') {
      sessionToken = null;
      showScreen('licenseScreen');
      updateStatus('licenseStatus', 'Licença revogada ou expirada.', true);
    }
  });
});

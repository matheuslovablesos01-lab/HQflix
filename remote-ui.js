// Remote UI runtime for blob-loaded extension UI
const bridge = {
  _pending: {},
  _counter: 0,

  _call(command, payload) {
    return new Promise((resolve, reject) => {
      const requestId = 'req_' + (++this._counter);
      this._pending[requestId] = { resolve, reject };
      window.parent.postMessage({ requestId, command, payload }, '*');
      // Download needs more time (up to 180s for large projects), other commands 15s
      const timeoutMs = command === 'lovable.downloadProject' ? 180000 : 30000;
      setTimeout(() => {
        if (this._pending[requestId]) {
          delete this._pending[requestId];
          reject(new Error('Bridge timeout: ' + command));
        }
      }, timeoutMs);
    });
  },

  _handleResponse(event) {
    const { requestId, ok, payload, error } = event.data || {};
    if (!requestId || !bridge._pending[requestId]) return;
    const { resolve, reject } = bridge._pending[requestId];
    delete bridge._pending[requestId];
    if (ok) resolve(payload);
    else reject(new Error(error || 'Bridge error'));
  },

  storage: {
    get: (keys) => bridge._call('storage.get', { keys }),
    set: (data) => bridge._call('storage.set', { data }),
  },
  auth: {
    getToken: () => bridge._call('auth.getToken'),
  },
  project: {
    getActive: () => bridge._call('project.getActive'),
  },
  license: {
    getInfo: () => bridge._call('license.getInfo'),
    revalidate: () => bridge._call('license.revalidate'),
    logout: () => bridge._call('license.logout'),
  },
  lovable: {
    sendMessage: (message, projectId, files) => bridge._call('lovable.sendMessage', { message, projectId, files }),
    publish: () => bridge._call('lovable.publish'),
    downloadProject: (projectId) => bridge._call('lovable.downloadProject', { projectId }),
  },
  templates: {
    getAll: () => bridge._call('templates.getAll'),
  },
  ai: {
    enhancePrompt: (prompt) => bridge._call('ai.enhancePrompt', { prompt }),
  },
  runtime: {
    openUrl: (url) => bridge._call('runtime.openUrl', { url }),
  },
};

window.addEventListener('message', (e) => {
  // Handle captured chat messages from content script
  const { command, payload } = e.data || {};
  if (command === 'chat.captured' && payload?.content) {
    addMessage('bot', '💬 ' + payload.content);
    return;
  }
  if (command === 'lovable.suggestions' && Array.isArray(payload?.items)) {
    renderQuickSuggestions(payload.items);
    return;
  }
  bridge._handleResponse(e);
});

function renderQuickSuggestions(items) {
  const wrap = document.getElementById('quickSuggestions');
  if (!wrap) return;
  if (!items.length) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
  // Dedup by text and cap at 8
  const seen = new Set();
  const list = [];
  for (const it of items) {
    const t = (it?.text || '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t); list.push(t);
    if (list.length >= 8) break;
  }
  const prev = wrap.dataset.signature || '';
  const sig = list.join('|');
  if (sig === prev) return;
  wrap.dataset.signature = sig;
  wrap.innerHTML = '';
  for (const t of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'qs-chip';
    b.textContent = t;
    b.title = t;
    b.addEventListener('click', () => {
      const m = document.getElementById('message');
      if (!m) return;
      m.value = t;
      m.style.height = 'auto';
      m.style.height = Math.min(m.scrollHeight, 300) + 'px';
      m.focus();
    });
    wrap.appendChild(b);
  }
  wrap.style.display = 'flex';
}

let history = [];
let pendingFiles = [];
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

function updateStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function addMessage(role, content) {
  history.push({ role, content, time: new Date().toLocaleTimeString() });
  if (history.length > 50) history.shift();
  bridge.storage.set({ history });
  renderHistory();
}

function renderHistory() {
  if (!historyEl) return;
  historyEl.innerHTML = '';
  if (history.length === 0) {
    historyEl.innerHTML = '<div class="empty-state"><h3>Pronto para começar</h3><p>Envie uma mensagem para interagir</p></div>';
    return;
  }
  history.forEach((m) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper ' + m.role;
    const bubble = document.createElement('div');
    bubble.className = 'bubble ' + m.role;
    bubble.textContent = m.content;
    wrapper.appendChild(bubble);
    historyEl.appendChild(wrapper);
  });
  historyEl.scrollTop = historyEl.scrollHeight;
}

// === File attachment logic ===
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderFilePreview() {
  if (!filePreview) return;
  if (pendingFiles.length === 0) {
    filePreview.style.display = 'none';
    filePreview.innerHTML = '';
    return;
  }
  filePreview.style.display = 'flex';
  filePreview.innerHTML = '';
  pendingFiles.forEach((f, i) => {
    const chip = document.createElement('div');
    chip.className = 'file-chip';
    const name = document.createElement('span');
    name.textContent = f.name.length > 20 ? f.name.slice(0, 17) + '...' : f.name;
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.onclick = () => { pendingFiles.splice(i, 1); renderFilePreview(); };
    chip.appendChild(name);
    chip.appendChild(removeBtn);
    filePreview.appendChild(chip);
  });
}

function addFiles(files) {
  const MAX_FILES = 5;
  const MAX_SIZE = 50 * 1024 * 1024; // 50MB
  for (const file of files) {
    if (pendingFiles.length >= MAX_FILES) break;
    if (file.size > MAX_SIZE) {
      addMessage('bot', '❌ Arquivo "' + file.name + '" excede 50MB');
      continue;
    }
    pendingFiles.push(file);
  }
  renderFilePreview();
}

attachBtn?.addEventListener('click', () => fileInput?.click());
fileInput?.addEventListener('change', (e) => {
  if (e.target.files?.length) {
    addFiles(e.target.files);
    fileInput.value = '';
  }
});

// Drag & drop on message area
messageEl?.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
messageEl?.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});

// Paste files (Ctrl+V)
messageEl?.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  const files = [];
  for (const item of items) {
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length) addFiles(files);
});

async function handleSend() {
  const text = messageEl?.value.trim();
  if (!text && pendingFiles.length === 0) return;
  if (!messageEl || !sendBtn) return;

  // Build message content description
  let displayText = text || '';
  if (pendingFiles.length > 0) {
    const fileNames = pendingFiles.map(f => f.name).join(', ');
    displayText += (displayText ? '\n' : '') + '📎 ' + fileNames;
  }
  addMessage('user', displayText);
  messageEl.value = '';
  sendBtn.disabled = true;
  updateStatus('📤 Enviando...');

  try {
    // Convert files to base64
    let filesData = [];
    if (pendingFiles.length > 0) {
      updateStatus('📤 Processando arquivos...');
      filesData = await Promise.all(
        pendingFiles.map(async (f) => ({
          name: f.name,
          type: f.type,
          size: f.size,
          data: await fileToBase64(f),
        }))
      );
      pendingFiles = [];
      renderFilePreview();
    }

    const { projectId } = await bridge.project.getActive();

    let result;
    if (filesData.length > 0) {
      result = await bridge.lovable.sendMessage(text || '', projectId, filesData);
    } else {
      result = await bridge.lovable.sendMessage(text, projectId);
    }

    if (result?.reply) addMessage('bot', result.reply);
    else if (result?.output) addMessage('bot', result.output);
    else if (result?.message) addMessage('bot', result.message);
    else addMessage('bot', '✅ Comando processado!');
    updateStatus('✅ Pronto');
  } catch (err) {
    addMessage('bot', '❌ ' + (err?.message || 'Erro ao enviar'));
    updateStatus('❌ Erro');
  } finally {
    sendBtn.disabled = false;
  }
}

sendBtn?.addEventListener('click', handleSend);
messageEl?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});
messageEl?.addEventListener('input', () => {
  if (!messageEl) return;
  messageEl.style.height = 'auto';
  messageEl.style.height = Math.min(messageEl.scrollHeight, 300) + 'px';
});

// Remove Watermark quick action
const removeWatermarkBtn = document.getElementById('removeWatermarkBtn');
removeWatermarkBtn?.addEventListener('click', () => {
  if (!messageEl) return;
  messageEl.value = `Adicione esse código no final do código do index.css:\n\n#lovable-badge {\n  display: none !important;\n}`;
  handleSend();
});
clearBtn?.addEventListener('click', () => {
  history = [];
  bridge.storage.set({ history: [] });
  renderHistory();
});
logoutBtn?.addEventListener('click', () => bridge.license.logout());

// === Love King PRO FIX: Reorganizar layout do chat via DOM direto ===
// O HTML vem do servidor remoto (Supabase) e tem estilos inline que
// CSS não consegue sobrescrever. Solução: mover elementos no DOM.
(function fixChatLayout() {
  function applyFix() {
    const enhanceBtn = document.getElementById('enhanceBtn');
    const messageEl = document.getElementById('message');
    if (!enhanceBtn || !messageEl) return false;

    // 1) Encontra o container pai da área de input (onde estão textarea + botões)
    const inputParent = messageEl.parentElement;
    if (!inputParent) return false;

    // 2) Se o enhanceBtn está dentro do mesmo container que o textarea,
    //    move ele para FORA (acima do container)
    if (inputParent.contains(enhanceBtn)) {
      // Cria um wrapper para o enhanceBtn acima do input
      let enhanceRow = document.getElementById('lkp-enhance-row');
      if (!enhanceRow) {
        enhanceRow = document.createElement('div');
        enhanceRow.id = 'lkp-enhance-row';
        enhanceRow.style.cssText = 'display:flex;justify-content:flex-end;padding:0 4px 4px 4px;';
        inputParent.parentElement.insertBefore(enhanceRow, inputParent);
      }
      enhanceRow.appendChild(enhanceBtn);
    }

    // 3) Força estilos inline no enhanceBtn (menor, compacto)
    enhanceBtn.style.cssText = `
      background:rgba(168,85,247,.08);
      border:1px solid rgba(168,85,247,.25);
      color:#c084fc;
      border-radius:14px;
      padding:3px 9px;
      font-size:10px;
      font-weight:600;
      cursor:pointer;
      display:inline-flex;
      align-items:center;
      gap:3px;
      white-space:nowrap;
      backdrop-filter:blur(4px);
      letter-spacing:.2px;
      transition:all .25s ease;
      flex-shrink:0;
    `;

    // 4) Força estilos inline no textarea para corrigir word-wrap e tamanho
    const origStyles = messageEl.getAttribute('style') || '';
    const fixStyles = [
      'flex:1 1 auto',
      'min-width:0',
      'min-height:42px',
      'max-height:45vh',
      'resize:none',
      'word-wrap:break-word',
      'word-break:break-word',
      'overflow-wrap:break-word',
      'white-space:pre-wrap',
      'overflow-y:auto',
      'box-sizing:border-box',
      'font-size:13.5px',
      'line-height:1.5',
    ];
    // Preserva estilos originais, adiciona os fixes
    for (const style of fixStyles) {
      const [prop, val] = style.split(':');
      messageEl.style.setProperty(prop.trim(), val.trim(), 'important');
    }

    // 5) Garante que o container pai do textarea é flex-row com o textarea expandindo
    inputParent.style.setProperty('display', 'flex', 'important');
    inputParent.style.setProperty('flex-direction', 'row', 'important');
    inputParent.style.setProperty('align-items', 'flex-end', 'important');
    inputParent.style.setProperty('gap', '6px', 'important');
    inputParent.style.setProperty('width', '100%', 'important');

    console.log('[Love King PRO] Chat layout fix aplicado');
    return true;
  }

  // Tenta aplicar imediatamente
  if (!applyFix()) {
    // Se o DOM ainda não está pronto, observa mutações
    const observer = new MutationObserver(() => {
      if (applyFix()) observer.disconnect();
    });
    observer.observe(document.body || document.documentElement, {
      childList: true, subtree: true
    });
    // Safety timeout
    setTimeout(() => observer.disconnect(), 15000);
  }

  // Reaplica após 1s caso o remote UI re-renderize
  setTimeout(applyFix, 1000);
  setTimeout(applyFix, 3000);
})();

// === Enhance prompt with AI ===
const enhanceBtn = document.getElementById('enhanceBtn');
enhanceBtn?.addEventListener('click', async () => {
  if (!messageEl) return;
  const original = messageEl.value.trim();
  if (!original) {
    updateStatus('⚠️ Digite algo para melhorar');
    return;
  }
  enhanceBtn.disabled = true;
  enhanceBtn.classList.add('loading');
  const label = enhanceBtn.querySelector('span');
  const prevLabel = label?.textContent;
  if (label) label.textContent = 'Otimizando...';
  updateStatus('✨ Melhorando prompt...');
  try {
    const result = await bridge.ai.enhancePrompt(original);
    if (result?.improved) {
      messageEl.value = result.improved;
      messageEl.style.height = 'auto';
      messageEl.style.height = Math.min(messageEl.scrollHeight, 300) + 'px';
      messageEl.focus();
      updateStatus('✅ Prompt otimizado');
    } else {
      throw new Error(result?.error || 'Resposta vazia');
    }
  } catch (err) {
    addMessage('bot', '❌ ' + (err?.message || 'Erro ao melhorar prompt'));
    updateStatus('❌ Erro');
  } finally {
    enhanceBtn.disabled = false;
    enhanceBtn.classList.remove('loading');
    if (label && prevLabel) label.textContent = prevLabel;
  }
});

const downloadBtn = document.getElementById('downloadBtn');
downloadBtn?.addEventListener('click', async () => {
  downloadBtn.disabled = true;
  downloadBtn.style.opacity = '0.5';
  updateStatus('⬇️ Preparando download...');
  try {
    const { projectId } = await bridge.project.getActive();
    if (!projectId) throw new Error('Nenhum projeto ativo');
    const result = await bridge.lovable.downloadProject(projectId);
    if (result?.success) {
      addMessage('bot', '✅ Download iniciado!');
      updateStatus('✅ Download iniciado');
    } else {
      throw new Error(result?.error || 'Erro ao baixar');
    }
  } catch (err) {
    addMessage('bot', '❌ ' + (err?.message || 'Erro ao baixar projeto'));
    updateStatus('❌ Erro no download');
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.style.opacity = '1';
  }
});

publishBtn?.addEventListener('click', async () => {
  publishBtn.disabled = true;
  try {
    const result = await bridge.lovable.publish();
    if (result?.success) addMessage('bot', '✅ Projeto publicado! 🚀');
    else addMessage('bot', '❌ ' + (result?.error || 'Erro ao publicar'));
  } catch (err) {
    addMessage('bot', '❌ ' + (err?.message || 'Erro ao publicar'));
  } finally {
    publishBtn.disabled = false;
  }
});

// === Tab switching & Templates ===
const tabChat = document.getElementById('tabChat');
const tabTemplates = document.getElementById('tabTemplates');
const chatPanel = document.getElementById('chatPanel');
const templatesPanel = document.getElementById('templatesPanel');
const templatesLoading = document.getElementById('templatesLoading');
let templatesLoaded = false;
let cachedTemplates = [];

function switchTab(tab) {
  if (tab === 'chat') {
    tabChat?.classList.add('active');
    tabTemplates?.classList.remove('active');
    if (chatPanel) chatPanel.classList.remove('hidden');
    if (templatesPanel) templatesPanel.classList.remove('visible');
  } else {
    tabTemplates?.classList.add('active');
    tabChat?.classList.remove('active');
    if (chatPanel) chatPanel.classList.add('hidden');
    if (templatesPanel) templatesPanel.classList.add('visible');
    if (!templatesLoaded) loadTemplates();
  }
}

tabChat?.addEventListener('click', () => switchTab('chat'));
tabTemplates?.addEventListener('click', () => switchTab('templates'));

async function loadTemplates() {
  if (templatesLoading) templatesLoading.style.display = 'flex';
  try {
    const result = await bridge.templates.getAll();
    cachedTemplates = result?.templates || [];
    templatesLoaded = true;
    renderTemplates();
  } catch (err) {
    console.error('Error loading templates:', err);
    if (templatesPanel) {
      templatesPanel.innerHTML = '<div class="templates-empty"><p>❌ Erro ao carregar templates</p></div>';
    }
  }
}

function renderTemplates() {
  if (!templatesPanel) return;
  templatesPanel.innerHTML = '';

  if (cachedTemplates.length === 0) {
    templatesPanel.innerHTML = '<div class="templates-empty"><p>Nenhum template disponível</p></div>';
    return;
  }

  // Group by category
  const grouped = {};
  cachedTemplates.forEach(t => {
    const cat = t.category || 'Geral';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(t);
  });

  Object.keys(grouped).sort().forEach(cat => {
    const label = document.createElement('div');
    label.className = 'template-category';
    label.textContent = cat;
    templatesPanel.appendChild(label);

    grouped[cat].forEach(t => {
      const card = document.createElement('div');
      card.className = 'template-card';

      const thumb = document.createElement('div');
      thumb.className = 'template-thumb';
      if (t.video_url) {
        const vid = document.createElement('video');
        vid.src = t.video_url;
        vid.autoplay = true;
        vid.loop = true;
        vid.muted = true;
        vid.playsInline = true;
        thumb.appendChild(vid);
      } else if (t.image_url) {
        const img = document.createElement('img');
        img.src = t.image_url;
        img.alt = t.name;
        img.loading = 'lazy';
        thumb.appendChild(img);
      } else {
        thumb.textContent = '📄';
      }
      card.appendChild(thumb);

      const bottom = document.createElement('div');
      bottom.className = 'template-bottom';

      const info = document.createElement('div');
      info.className = 'template-info';
      const name = document.createElement('div');
      name.className = 'template-name';
      name.textContent = t.name;
      info.appendChild(name);
      if (t.description) {
        const desc = document.createElement('div');
        desc.className = 'template-desc';
        desc.textContent = t.description;
        info.appendChild(desc);
      }

      const useBtn = document.createElement('button');
      useBtn.className = 'template-use';
      useBtn.textContent = 'Usar';
      useBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        useTemplate(t);
      });

      bottom.appendChild(info);
      bottom.appendChild(useBtn);
      card.appendChild(bottom);
      card.addEventListener('click', () => useTemplate(t));
      templatesPanel.appendChild(card);
    });
  });
}

function useTemplate(template) {
  switchTab('chat');
  if (messageEl) {
    messageEl.value = template.code;
    messageEl.focus();
    messageEl.style.height = 'auto';
    messageEl.style.height = Math.min(messageEl.scrollHeight, 120) + 'px';
  }
}

(async () => {
  try {
    const stored = await bridge.storage.get(['history']);
    if (stored?.history) {
      history = stored.history;
      renderHistory();
    }

    const info = await bridge.license.getInfo();
    if (info?.licenseInfo && licenseInfoEl) {
      const li = info.licenseInfo;
      if (li.hours_remaining && li.hours_remaining < 24) licenseInfoEl.textContent = li.hours_remaining + 'h';
      else if (li.days_remaining) licenseInfoEl.textContent = li.days_remaining + ' dias';
      else licenseInfoEl.textContent = 'Ativo';
    }

    const { projectId } = await bridge.project.getActive();
    if (projectId) updateStatus('✅ Projeto: ' + projectId.slice(0, 8) + '...');
    else updateStatus('⚠️ Abra um projeto no Lovable.dev');
  } catch (err) {
    updateStatus('⚠️ Inicializando...');
    console.warn('Init error:', err);
  }
})();

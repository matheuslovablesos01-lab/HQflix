// hide-element.js
console.log("🔥 Love King PRO: Sniper iniciado...");

// CSS injection to hide fix elements
const style = document.createElement('style');
style.textContent = `
  [class*="security-banner"],
  [class*="fix-banner"],
  [data-testid*="fix"],
  [class*="SecurityBanner"],
  [data-testid*="security-scan"],
  [aria-label*="Security scan"],
  [aria-label*="security scan"] {
    display: none !important;
    visibility: hidden !important;
    height: 0 !important;
    overflow: hidden !important;
  }
`;
document.head.appendChild(style);

const TEXTOS_ALVO = ["Fix all security issues", "Security scan", "Run security scan", "verificação de segurança", "Verificação de segurança"];
const SUBSTITUTO = "LovKingPro";

function substituirElemento() {
    try {
        // Estratégia 1: TreeWalker — substitui apenas o nó de texto, sem remover o elemento
        const walker = document.createTreeWalker(
            document.body, NodeFilter.SHOW_TEXT, null
        );
        let node;
        while (node = walker.nextNode()) {
            let t = node.textContent;
            let alterado = false;
            for (const texto of TEXTOS_ALVO) {
                if (t.includes(texto)) {
                    t = t.replace(new RegExp(texto, 'g'), SUBSTITUTO);
                    alterado = true;
                }
            }
            if (alterado) node.textContent = t;
        }

        // Estratégia 2: atributos aria-label e placeholder
        document.querySelectorAll('[aria-label]').forEach(el => {
            for (const texto of TEXTOS_ALVO) {
                if (el.getAttribute('aria-label').includes(texto)) {
                    el.setAttribute('aria-label', SUBSTITUTO);
                }
            }
        });
    } catch (e) {
        // Silêncio é ouro
    }
}

// 1. Executa imediatamente
substituirElemento();

// 2. Executa repetidamente (ideal para Single Page Apps como o Lovable)
setInterval(substituirElemento, 200);

// 3. Monitora mudanças na página
const observer = new MutationObserver(() => substituirElemento());
observer.observe(document.body, { childList: true, subtree: true });

// ============= QUICK SUGGESTIONS CAPTURE =============
// Heuristic: Lovable renders suggestion chips as a horizontal row of <button>
// elements directly inside the same parent, each with short text. We detect
// any parent that contains 2+ button siblings whose text looks like a chip.
const BAD_TEXT = /^(enable|notifications?|fix all|show more|publish|deploy|github|connect to|new chat|nova conversa|enviar|send|anexar|attach|copiar|copy|editar|edit|excluir|delete|cancelar|cancel|salvar|save|fechar|close|abrir|open|menu|settings|configurações|sign in|sign out|log ?in|log ?out|entrar|sair|sim|n[ãa]o|ok|confirmar|voltar|próximo|next|previous|anterior)$/i;
let __lastSuggestionsSig = '';
function looksLikeChipText(text) {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 4 || t.length > 60) return false;
  if (/[\n\r]/.test(t)) return false;
  if (BAD_TEXT.test(t)) return false;
  // Must start with a letter (not icon/emoji/number)
  if (!/^[A-Za-zÀ-ÿ]/.test(t)) return false;
  // Reject if mostly punctuation
  const letters = (t.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  if (letters < 3) return false;
  return true;
}
function captureQuickSuggestions() {
  try {
    const parents = new Map(); // parent -> [buttons]
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (!btn || btn.disabled) continue;
      if (btn.getAttribute('role') === 'tab') continue;
      if (btn.type === 'submit') continue;
      // Skip buttons inside textarea form (send/attach controls)
      const form = btn.closest('form');
      if (form && form.querySelector('textarea')) continue;
      const text = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      if (!looksLikeChipText(text)) continue;
      const r = btn.getBoundingClientRect();
      if (r.width < 40 || r.height < 18 || r.height > 60) continue;
      const style = getComputedStyle(btn);
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
      const parent = btn.parentElement;
      if (!parent) continue;
      if (!parents.has(parent)) parents.set(parent, []);
      parents.get(parent).push({ btn, text });
    }
    // Pick the parent group with most chip-like siblings (≥2)
    let bestGroup = null;
    let bestScore = 0;
    for (const [, group] of parents) {
      if (group.length < 2) continue;
      if (group.length > bestScore) {
        bestScore = group.length;
        bestGroup = group;
      }
    }
    const found = [];
    const seen = new Set();
    if (bestGroup) {
      for (const { text } of bestGroup) {
        if (seen.has(text)) continue;
        seen.add(text);
        found.push({ text });
        if (found.length >= 12) break;
      }
    }
    const sig = found.map(f => f.text).join('|');
    if (sig === __lastSuggestionsSig) return;
    __lastSuggestionsSig = sig;
    try { chrome.runtime?.sendMessage({ action: 'suggestionsCaptured', items: found }); } catch (_) {}
  } catch (_) {}
}
setInterval(captureQuickSuggestions, 1500);
setTimeout(captureQuickSuggestions, 800);

const originalFetch = window.fetch.bind(window);
window.fetch = function(...args) {
    const [url, options] = args;
    const urlStr = typeof url === 'string' ? url : (url?.url || '');

    if (urlStr.includes('api.lovable.dev') && options?.headers) {
        try {
            let authValue = null;
            let gitSha = null;

            if (options.headers instanceof Headers) {
                authValue = options.headers.get('authorization') || options.headers.get('Authorization');
                gitSha = options.headers.get('x-client-git-sha') || options.headers.get('X-Client-Git-Sha');
            } else if (typeof options.headers === 'object') {
                for (const [key, val] of Object.entries(options.headers)) {
                    if (key.toLowerCase() === 'authorization') authValue = val;
                    if (key.toLowerCase() === 'x-client-git-sha') gitSha = val;
                }
            }

            if (authValue) {
                const data = { lovable_api_token: authValue, lovable_api_token_ts: Date.now() };
                if (gitSha) data.lovable_git_sha = gitSha;
                chrome.storage?.local?.set(data).catch(() => {});
                chrome.runtime?.sendMessage({ action: 'tokenCaptured', token: authValue, gitSha }).catch(() => {});
                console.log('[hide-element] 🔑 Captured Lovable API token via fetch intercept');
            }
        } catch (e) {
            console.warn('[hide-element] Falha ao capturar token:', e);
        }
    }

    return originalFetch(...args);
};

async function injectMessageAndSubmit(messageText) {
    try {
        const textarea = document.querySelector('textarea[placeholder]') ||
                         document.querySelector('textarea') ||
                         document.querySelector('[contenteditable="true"][role="textbox"]') ||
                         document.querySelector('[contenteditable="true"]');

        if (!textarea) {
            console.error('[hide-element] ❌ Campo do chat não encontrado');
            return { success: false, error: 'Campo do chat não encontrado' };
        }

        textarea.focus();

        if (textarea instanceof HTMLTextAreaElement || textarea instanceof HTMLInputElement) {
            const proto = textarea instanceof HTMLTextAreaElement
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype;
            const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (nativeSetter) nativeSetter.call(textarea, messageText);
            else textarea.value = messageText;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            textarea.textContent = messageText;
            textarea.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                data: messageText,
                inputType: 'insertText'
            }));
        }

        const sendSelectors = [
            'button[data-testid="chat-send-button"]',
            'button[aria-label*="Send"]',
            'button[aria-label*="Enviar"]',
            'button[type="submit"]'
        ];

        const clickSend = () => {
            const sendButton = sendSelectors
                .map((selector) => document.querySelector(selector))
                .find((button) => button && !button.disabled);

            if (sendButton) {
                sendButton.click();
                console.log('[hide-element] ✅ Mensagem enviada pelo botão do chat');
                return { success: true };
            }

            textarea.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true,
                cancelable: true
            }));
            textarea.dispatchEvent(new KeyboardEvent('keyup', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true,
                cancelable: true
            }));

            console.log('[hide-element] ✅ Mensagem enviada via Enter');
            return { success: true };
        };

        return await new Promise((resolve) => {
            requestAnimationFrame(() => {
                setTimeout(() => resolve(clickSend()), 80);
            });
        });
    } catch (e) {
        console.error('[hide-element] ❌ Erro ao injetar mensagem:', e);
        return { success: false, error: e.message || 'Erro ao enviar mensagem' };
    }
}

// ========== PUBLISH PROJECT HANDLER ==========
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'injectChatMessage') {
        injectMessageAndSubmit(request.message || '')
            .then((result) => sendResponse(result))
            .catch((err) => sendResponse({ success: false, error: err?.message || 'Falha ao enviar no chat' }));
        return true;
    }

    if (request.action === 'publishProject') {
        console.log('🚀 Publicando projeto via API:', request.projectId);
        
        const publishProject = async () => {
            try {
                const headers = { 'Content-Type': 'application/json' };
                if (request.authToken) {
                    headers['Authorization'] = `Bearer ${request.authToken}`;
                }
                
                const resp = await originalFetch.call(window, 
                    `https://api.lovable.dev/projects/${request.projectId}/deployments?async=true`,
                    {
                        method: 'POST',
                        headers: headers,
                        credentials: 'include',
                        body: '{}'
                    }
                );
                
                if (resp.ok) {
                    const data = await resp.json();
                    console.log('✅ Deploy iniciado:', data);
                    sendResponse({ success: true, deploymentId: data.deployment_id, url: data.url });
                } else {
                    const errText = await resp.text();
                    console.error('❌ Erro API:', resp.status, errText);
                    sendResponse({ success: false, error: `API erro: ${resp.status} - ${errText}` });
                }
            } catch (err) {
                console.error('❌ Erro ao publicar:', err);
                sendResponse({ success: false, error: err.message });
            }
        };
        
        publishProject();
        return true;
    }
});
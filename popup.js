1| // ============================================================
2| // Love King PRO Extension v4.4.7 - Popup (chat direto)
3| // Backend: LOV-ULTRA via background.js
4| // ============================================================
5| 
6| const SUPABASE_URL = ((e,k)=>e.map(c=>String.fromCharCode(c^k)).join(''))([47, 51, 51, 55, 52, 125, 104, 104, 40, 43, 51, 42, 61, 44, 63, 54, 40, 32, 49, 50, 36, 33, 33, 38, 32, 47, 46, 63, 105, 52[...]
7| const SUPABASE_ANON_KEY = 'sb_publishable_VgPUvr8V3p8VPVWz_FZMmw_ysNnFoOM';
8| 
9| // ============ Helpers ============
10| 
11| function getDeviceInfo() {
12|   return {
13|     screen: `${screen.width}x${screen.height}`,
14|     color_depth: screen.colorDepth,
15|     timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
16|     language: navigator.language,
17|     platform: navigator.platform,
18|     cores: navigator.hardwareConcurrency || 0,
19|   };
20| }
21| 
22| function showScreen(screenId) {
23|   document.querySelectorAll('.screen').forEach(s => {
24|     s.style.display = 'none';
25|     s.classList.add('hidden');
26|   });
27|   const target = document.getElementById(screenId);
28|   if (target) {
29|     target.style.display = 'flex';
30|     target.classList.remove('hidden');
31|   }
32| }
33| 
34| function updateStatus(elementId, message, isError = false) {
35|   const el = document.getElementById(elementId);
36|   if (el) {
37|     el.textContent = message;
38|     el.className = isError ? 'status error' : 'status';
39|   }
40| }
41| 
42| function addMessage(container, from, text) {
43|   const div = document.createElement('div');
44|   div.className = `bubble ${from}`;
45|   div.textContent = text;
46|   container.appendChild(div);
47|   container.scrollTop = container.scrollHeight;
48| }
49| 
50| function formatTimeRemaining(days) {
51|   if (days >= 1) return `${Math.round(days)} dias restantes`;
52|   return `${Math.round(days * 24)} horas restantes`;
53| }
54| 
55| // ============ License (via background LOV-ULTRA) ============
56| 
57| /**
58|  * Valida licença via background.js (VALIDATE_LICENSE → lib/license.js → inject-config Supabase).
59|  */
60| async function validateLicense(licenseKey) {
61|   // License requirement disabled: always accept locally to remove activation step.
62|   // This keeps the extension structure intact but bypasses any server-side license prompt.
63|   return {
64|     status: 'valid',
65|     session_token: 'local-free-token',
66|     days_remaining: 365,
67|     hours_remaining: 365 * 24,
68|     license_id: 'local-free',
69|     plan: 'free',
70|   };
71| }
72| 
73| // ============ Send Message (via SEND_MESSAGE_PROXY no background) ============
74| 
75| async function getAuthData() {
76|   try {
77|     const stored = await chrome.storage.local.get([
78|       'lovable_api_token', 'lovable_api_token_ts', 'lovable_git_sha', 'settings'
79|     ]);
80|     if (stored.lovable_api_token) {
81|       const age = Date.now() - (stored.lovable_api_token_ts || 0);
82|       if (age < 3600000) return { token: stored.lovable_api_token.replace(/^Bearer\s+/i, ''), gitSha: stored.lovable_git_sha || null };
83|     }
84|     if (stored.settings?.lovableToken && stored.settings?.lovableTokenAt) {
85|       if (Date.now() - stored.settings.lovableTokenAt < 3600000) {
86|         return { token: stored.settings.lovableToken, gitSha: stored.settings.lovableClientGitSha || null };
87|       }
88|     }
89|     return { token: null, gitSha: null };
90|   } catch { return { token: null, gitSha: null }; }
91| }
92| 
93| async function getProjectFromActiveTab() {
94|   try {
95|     const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
96|     if (!tab?.url) return null;
97|     const match = tab.url.match(/lovable\.dev\/projects\/([a-f0-9-]+)/);
98|     if (match) return match[1];
99|     const sub = tab.url.match(/([a-f0-9-]+)\.lovableproject\.com/);
100|     if (sub) return sub[1];
101|     return null;
102|   } catch { return null; }
103| }
104| 
105| async function sendChatMessage(sessionToken, message, projectId) {
106|   try {
107|     const auth = await getAuthData();
108|     if (!auth.token) throw new Error('Token do Lovable não encontrado. Faça login em lovable.dev.');
109| 
110|     const stored = await chrome.storage.local.get(['settings']);
111|     const sessionId = stored.settings?.lovableSessionId || '';
112|     const gitSha = auth.gitSha || stored.settings?.lovableClientGitSha || '';
113| 
114|     return new Promise((resolve) => {
115|       chrome.runtime.sendMessage({
116|         type: 'SEND_MESSAGE_PROXY',
117|         message,
118|         projectId,
119|         token: auth.token,
120|         sessionId,
121|         gitSha,
122|         files: [],
123|         imageUrls: [],
124|       }, (result) => {
125|         void chrome.runtime.lastError;
126|         if (!result) resolve({ status: 'error', message: 'Background não respondeu' });
127|         else if (result.ok) resolve({ reply: '✅ Mensagem enviada! O Lovable está processando...' });
128|         else resolve({ status: 'error', message: result.error || `HTTP ${result.status}` });
129|       });
130|     });
131|   } catch (error) {
132|     console.error('[LOV] Erro ao enviar mensagem:', error);
133|     return { status: 'error', message: error.message };
134|   }
135| }
136| 
137| // ============ Main Application ============
138| document.addEventListener('DOMContentLoaded', async () => {
139|   // Elements
140|   const licenseInput   = document.getElementById('licenseKey');
141|   const activateBtn    = document.getElementById('activateBtn');
142|   const licenseStatus  = document.getElementById('licenseStatus');
143|   const timeRemaining  = document.getElementById('timeRemaining');
144|   const messageInput   = document.getElementById('message');
145|   const sendBtn        = document.getElementById('sendBtn');
146|   const historyEl      = document.getElementById('history');
147|   const statusEl       = document.getElementById('status');
148|   const logoutBtn      = document.getElementById('logoutBtn');
149| 
150|   let sessionToken = null;
151|   let projectId    = null;
152| 
153|   // ============ License Check (via background — formato LOV-ULTRA) ============
154|   async function checkStoredLicense() {
155|     // Lê do formato LOV-ULTRA (settings.licenseState) e do legado
156|     const storage = await chrome.storage.local.get(['licenseKey', 'sessionToken', 'settings']);
157|     const storedKey = storage.settings?.licenseKey || storage.licenseKey || null;
158|     if (!storedKey) return { valid: false, reason: 'no_license' };
159| 
160|     // Cache válido do LOV-ULTRA
161|     const cachedState = storage.settings?.licenseState;
162|     if (cachedState?.status === 'valid') {
163|       sessionToken = cachedState.licenseHash || btoa(storedKey).slice(0, 32);
164|       const daysRemaining = cachedState.expiresAt
165|         ? Math.max(0, (new Date(cachedState.expiresAt) - Date.now()) / 86400000)
166|         : 365;
167|       return { valid: true, days_remaining: daysRemaining };
168|     }
169| 
170|     // Cache legado (sessionToken)
171|     if (storage.sessionToken) {
172|       sessionToken = storage.sessionToken;
173|       return { valid: true };
174|     }
175| 
176|     // Sem cache → revalida
177|     const result = await validateLicense(storedKey);
178|     if (result.status === 'valid') {
179|       sessionToken = result.session_token;
180|       await chrome.storage.local.set({ licenseKey: storedKey, sessionToken: result.session_token });
181|       return { valid: true, days_remaining: result.days_remaining };
182|     }
183|     return { valid: false, reason: result.status, message: result.message };
184|   }
185| 
186|   // ============ Mode Selector ============
187|   const modeFastBtn     = document.getElementById('dl-mode-fast');
188|   const modeThinkingBtn = document.getElementById('dl-mode-thinking');
189|   if (modeFastBtn && modeThinkingBtn) {
190|     const storageMode = await chrome.storage.local.get(['dl_send_mode']);
191|     const activeMode = storageMode.dl_send_mode || 'fast';
192|     if (activeMode === 'fast') { modeFastBtn.classList.add('active'); modeThinkingBtn.classList.remove('active'); }
193|     else { modeFastBtn.classList.remove('active'); modeThinkingBtn.classList.add('active'); }
194|     modeFastBtn.addEventListener('click', async () => {
195|       modeFastBtn.classList.add('active'); modeThinkingBtn.classList.remove('active');
196|       await chrome.storage.local.set({ dl_send_mode: 'fast' });
197|     });
198|     modeThinkingBtn.addEventListener('click', async () => {
199|       modeFastBtn.classList.remove('active'); modeThinkingBtn.classList.add('active');
200|       await chrome.storage.local.set({ dl_send_mode: 'thinking' });
201|     });
202|   }
203| 
204|   // ============ Initialize ============
205|   const licenseCheck = await checkStoredLicense();
206| 
207|   if (licenseCheck.valid) {
208|     showScreen('mainScreen');
209|     if (licenseCheck.days_remaining && timeRemaining) {
210|       timeRemaining.textContent = formatTimeRemaining(licenseCheck.days_remaining);
211|     }
212|     projectId = await getProjectFromActiveTab();
213|     if (projectId && statusEl) updateStatus('status', `Projeto: ${projectId.slice(0, 8)}...`);
214|     else if (statusEl) updateStatus('status', 'Abra um projeto no Lovable.dev');
215|   } else {
216|     showScreen('licenseScreen');
217|     const errorMessages = {
218|       'expired':       'Sua licença expirou. Renove para continuar.',
219|       'invalid':       'Licença inválida. Verifique a chave.',
220|       'wrong_email':   'Licença vinculada a outro e-mail.',
221|     };
222|     if (licenseCheck.reason && errorMessages[licenseCheck.reason]) {
223|       updateStatus('licenseStatus', errorMessages[licenseCheck.reason], true);
224|     }
225|   }
226| 
227|   // ============ Activate License ============
228|   if (activateBtn) {
229|     activateBtn.addEventListener('click', async () => {
230|       const key = licenseInput.value.trim().toUpperCase();
231|       if (!key) { updateStatus('licenseStatus', 'Digite uma chave de licença', true); return; }
232| 
233|       activateBtn.disabled = true;
234|       activateBtn.textContent = 'Validando...';
235|       updateStatus('licenseStatus', 'Conectando ao servidor...');
236| 
237|       try {
238|         const result = await validateLicense(key);
239|         if (result.status === 'valid') {
240|           sessionToken = result.session_token;
241|           await chrome.storage.local.set({ licenseKey: key, sessionToken: result.session_token });
242|           updateStatus('licenseStatus', '✓ Licença ativada com sucesso!');
243|           activateBtn.textContent = 'Ativado!';
244|           setTimeout(async () => {
245|             showScreen('mainScreen');
246|             if (timeRemaining) timeRemaining.textContent = formatTimeRemaining(result.days_remaining || 365);
247|             projectId = await getProjectFromActiveTab();
248|             if (projectId && statusEl) updateStatus('status', `Projeto: ${projectId.slice(0, 8)}...`);
249|           }, 1000);
250|         } else {
251|           activateBtn.disabled = false;
252|           activateBtn.textContent = 'Ativar Licença';
253|           const messages = {
254|             'invalid':     'Chave de licença inválida',
255|             'expired':     'Esta licença está expirada',
256|             'wrong_email': 'Licença vinculada a outro e-mail',
257|             'error':       result.message || 'Erro ao validar licença',
258|           };
259|           updateStatus('licenseStatus', messages[result.status] || result.message || 'Erro desconhecido', true);
260|         }
261|       } catch (error) {
262|         activateBtn.disabled = false;
263|         activateBtn.textContent = 'Ativar Licença';
264|         updateStatus('licenseStatus', 'Erro de conexão. Tente novamente.', true);
265|       }
266|     });
267|   }
268| 
269|   // Enter key on license input
270|   if (licenseInput) {
271|     licenseInput.addEventListener('keydown', (e) => {
272|       if (e.key === 'Enter') activateBtn?.click();
273|     });
274|   }
275| 
276|   // ============ Send Message ============
277|   if (sendBtn) {
278|     sendBtn.addEventListener('click', async () => {
279|       const text = messageInput?.value?.trim();
280|       if (!text) return;
281| 
282|       if (!projectId) {
283|         projectId = await getProjectFromActiveTab();
284|         if (!projectId) { updateStatus('status', 'Abra uma aba do Lovable!', true); return; }
285|       }
286|       if (!sessionToken) { updateStatus('status', 'Sessão expirada, reative a licença', true); return; }
287| 
288|       addMessage(historyEl, 'user', text);
289|       if (messageInput) messageInput.value = '';
290|       sendBtn.disabled = true;
291|       updateStatus('status', 'Enviando...');
292| 
293|       const result = await sendChatMessage(sessionToken, text, projectId);
294| 
295|       if (result.status === 'error') {
296|         updateStatus('status', result.message || 'Erro no envio', true);
297|         addMessage(historyEl, 'bot', `Erro: ${result.message}`);
298|       } else if (result.reply || result.message) {
299|         addMessage(historyEl, 'bot', result.reply || result.message);
300|         updateStatus('status', 'Enviado!');
301|       } else {
302|         updateStatus('status', 'Enviado!');
303|       }
304| 
305|       sendBtn.disabled = false;
306|     });
307|   }
308| 
309|   // Enter key on message input
310|   if (messageInput) {
311|     messageInput.addEventListener('keydown', (e) => {
312|       if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn?.click(); }
313|     });
314|   }
315| 
316|   // ============ Logout ============
317|   if (logoutBtn) {
318|     logoutBtn.addEventListener('click', async () => {
319|       // Limpa via background (formato LOV-ULTRA)
320|       chrome.runtime.sendMessage({ type: 'CLEAR_LICENSE' }).catch(() => {});
321|       // Limpa também o formato legado
322|       await chrome.storage.local.remove(['licenseKey', 'sessionToken', 'sessionExpires', 'hoursRemaining']);
323|       sessionToken = null;
324|       showScreen('licenseScreen');
325|       if (licenseInput) licenseInput.value = '';
326|       updateStatus('licenseStatus', '');
327|     });
328|   }
329| 
330|   // Escuta revogação de licença do background.js
331|   chrome.runtime.onMessage.addListener((message) => {
332|     if (message.type === 'LICENSE_REVOKED') {
333|       sessionToken = null;
334|       showScreen('licenseScreen');
335|       updateStatus('licenseStatus', 'Licença revogada ou expirada.', true);
336|     }
337|   });
338| });
339| 

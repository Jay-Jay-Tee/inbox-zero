async function getSync(keys) {
  return new Promise((resolve) => chrome.storage.sync.get(keys, (res) => resolve(res || {})));
}
async function setSync(data) {
  return new Promise((resolve) => chrome.storage.sync.set(data, () => resolve()));
}
async function getLocal(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, (res) => resolve(res || {})));
}
async function setLocal(data) {
  return new Promise((resolve) => chrome.storage.local.set(data, () => resolve()));
}
function el(id) { return document.getElementById(id); }

function setStatus(statusEl, state, text) {
  if (!statusEl) return;
  statusEl.classList.remove('pending', 'success', 'error');
  statusEl.classList.add(state);
  statusEl.textContent = text;
}
function setMsg(msgEl, text, type = '') {
  if (!msgEl) return;
  msgEl.className = `msg ${type}`.trim();
  msgEl.textContent = text || '';
}

async function saveGeminiKey(key) {
  const trimmed = (key || '').trim();
  if (!trimmed) throw new Error('Paste your Gemini key first.');
  await setSync({ apiKey: trimmed });
}

async function testGeminiKey() {
  const sample = 'Subject: Lunch tomorrow?\n\nBody: Are you free at 12:30?';
  const res = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'SUMMARIZE', text: sample }, (r) => resolve(r || {}));
  });
  if (res.success === false) throw new Error(res.error || 'Gemini call failed.');
  if (!Array.isArray(res.bullets) || res.bullets.length === 0) throw new Error('Gemini responded but result was empty.');
  return res.bullets;
}

async function refreshUI() {
  const progressPill = el('progressPill');
  const doneCard = el('doneCard');
  const statusGemini = el('statusGemini');

  const local = await getLocal(['onboardingGeminiOk']);
  const geminiOk = Boolean(local.onboardingGeminiOk);

  if (progressPill) progressPill.textContent = `${geminiOk ? 1 : 0} / 1 complete`;
  setStatus(statusGemini, geminiOk ? 'success' : 'pending', geminiOk ? 'Verified ✓' : 'Not verified');

  if (doneCard) doneCard.classList.toggle('hidden', !geminiOk);
  if (geminiOk) await setLocal({ onboardingComplete: true });
}

document.addEventListener('DOMContentLoaded', async () => {
  const msgGemini = el('msgGemini');
  const keyInput = el('geminiKeyInput');
  const btnSaveKey = el('btnSaveGeminiKey');
  const btnTestGemini = el('btnTestGemini');

  const sync = await getSync(['apiKey']);
  if (keyInput && sync.apiKey) {
    keyInput.placeholder = 'Key already saved — paste a new one to update';
  }

  if (btnSaveKey) {
    btnSaveKey.addEventListener('click', async () => {
      setMsg(msgGemini, '');
      btnSaveKey.disabled = true;
      btnSaveKey.textContent = 'Saving…';
      try {
        await saveGeminiKey(keyInput?.value || '');
        if (keyInput) keyInput.value = '';
        setMsg(msgGemini, 'Saved. Now click "Verify key works".', 'ok');
      } catch (e) {
        setMsg(msgGemini, String(e?.message || e), 'err');
      } finally {
        btnSaveKey.disabled = false;
        btnSaveKey.textContent = 'Save';
      }
    });
  }

  if (btnTestGemini) {
    btnTestGemini.addEventListener('click', async () => {
      setMsg(msgGemini, '');
      btnTestGemini.disabled = true;
      btnTestGemini.textContent = 'Testing…';
      try {
        await testGeminiKey();
        await setLocal({ onboardingGeminiOk: true });
        setMsg(msgGemini, 'Gemini key verified successfully!', 'ok');
      } catch (e) {
        await setLocal({ onboardingGeminiOk: false });
        setMsg(msgGemini, String(e?.message || e), 'err');
      } finally {
        btnTestGemini.disabled = false;
        btnTestGemini.textContent = 'Verify key works';
        await refreshUI();
      }
    });
  }

  await refreshUI();
});

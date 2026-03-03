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

function el(id) {
  return document.getElementById(id);
}

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

function setDisabled(sectionEl, disabled) {
  if (!sectionEl) return;
  sectionEl.classList.toggle('disabled', Boolean(disabled));
}

async function testGmailOAuth() {
  const token = await new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (t) => {
      if (chrome.runtime.lastError || !t) {
        reject(new Error(chrome.runtime.lastError?.message || 'Unable to get auth token'));
        return;
      }
      resolve(t);
    });
  });

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail API ${res.status}: ${text}`);
  }

  const data = await res.json();
  return { emailAddress: data.emailAddress || '', messagesTotal: data.messagesTotal || 0 };
}

async function saveGeminiKey(key) {
  const trimmed = (key || '').trim();
  if (!trimmed) throw new Error('Paste your Gemini key first.');
  await setSync({ apiKey: trimmed });
}

async function testGeminiKey() {
  // Use background to test key (same code path as the extension)
  const sample = 'Subject: Lunch tomorrow?\n\nBody: Are you free at 12:30?';

  const res = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'SUMMARIZE', text: sample }, (r) => resolve(r || {}));
  });

  if (res.success === false) {
    throw new Error(res.error || 'Gemini call failed.');
  }
  if (!Array.isArray(res.bullets) || res.bullets.length === 0) {
    throw new Error('Gemini responded, but the result was empty.');
  }
  return res.bullets;
}

async function refreshUI() {
  const progressPill = el('progressPill');
  const stepGemini = el('stepGemini');
  const doneCard = el('doneCard');

  const statusOAuth = el('statusOAuth');
  const statusGemini = el('statusGemini');

  const local = await getLocal(['onboardingOAuthOk', 'onboardingGeminiOk', 'onboardingComplete']);
  const oauthOk = Boolean(local.onboardingOAuthOk);
  const geminiOk = Boolean(local.onboardingGeminiOk);

  const done = oauthOk && geminiOk;

  if (progressPill) progressPill.textContent = `${(oauthOk ? 1 : 0) + (geminiOk ? 1 : 0)} / 2 complete`;

  setStatus(statusOAuth, oauthOk ? 'success' : 'pending', oauthOk ? 'Verified' : 'Not verified');
  setStatus(statusGemini, geminiOk ? 'success' : 'pending', geminiOk ? 'Verified' : 'Not verified');

  // Gate Step 2 behind Step 1 to keep it progressive
  setDisabled(stepGemini, !oauthOk);

  if (doneCard) doneCard.classList.toggle('hidden', !done);

  if (done && !local.onboardingComplete) {
    await setLocal({ onboardingComplete: true });
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const msgOAuth = el('msgOAuth');
  const msgGemini = el('msgGemini');

  const btnTestOAuth = el('btnTestOAuth');
  const btnOpenExtensions = el('btnOpenExtensions');

  const keyInput = el('geminiKeyInput');
  const btnSaveKey = el('btnSaveGeminiKey');
  const btnTestGemini = el('btnTestGemini');

  const btnOpenPopupHint = el('btnOpenPopupHint');

  // If key already exists, show subtle hint (no auto-complete; user still must verify)
  const sync = await getSync(['apiKey']);
  if (keyInput && sync.apiKey) {
    keyInput.placeholder = 'Gemini key already saved (you can paste a new one)';
  }

  if (btnOpenExtensions) {
    btnOpenExtensions.addEventListener('click', async () => {
      try {
        await chrome.tabs.create({ url: 'chrome://extensions/' });
      } catch {
        setMsg(msgOAuth, 'Open chrome://extensions/ manually (Chrome blocks some pages).', 'warn');
      }
    });
  }

  if (btnTestOAuth) {
    btnTestOAuth.addEventListener('click', async () => {
      setMsg(msgOAuth, '');
      btnTestOAuth.disabled = true;
      btnTestOAuth.textContent = 'Checking…';
      try {
        const result = await testGmailOAuth();
        await setLocal({ onboardingOAuthOk: true, onboardingOAuthEmail: result.emailAddress });
        setMsg(msgOAuth, `Connected to Gmail for ${result.emailAddress || 'your account'}.`, 'ok');
      } catch (e) {
        await setLocal({ onboardingOAuthOk: false });
        setMsg(msgOAuth, String(e?.message || e), 'err');
      } finally {
        btnTestOAuth.disabled = false;
        btnTestOAuth.textContent = 'Test Gmail connection';
        await refreshUI();
      }
    });
  }

  if (btnSaveKey) {
    btnSaveKey.addEventListener('click', async () => {
      setMsg(msgGemini, '');
      btnSaveKey.disabled = true;
      btnSaveKey.textContent = 'Saving…';
      try {
        await saveGeminiKey(keyInput?.value || '');
        if (keyInput) keyInput.value = '';
        setMsg(msgGemini, 'Saved. Now click “Verify key works”.', 'ok');
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
        setMsg(msgGemini, 'Gemini key verified.', 'ok');
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

  if (btnOpenPopupHint) {
    btnOpenPopupHint.addEventListener('click', () => {
      setMsg(msgGemini, 'Click the extension icon in the toolbar to open the popup.', 'warn');
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });
  }

  await refreshUI();
});


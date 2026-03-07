// ============================================================
// InboxZero AI — Content Script
// Bridge between Gmail DOM and the background service worker
// ============================================================

(async () => {
  const parserModule = await import(chrome.runtime.getURL("content/gmail-parser.js"));
  const uiModule = await import(chrome.runtime.getURL("content/ui-injector.js"));

  const {
    extractEmailData, getEmailToolbar, getComposeBody,
    getComposeToolbar, getMessageIdFromUrl
  } = parserModule;

  const {
    ensureActionButtons, removeActionButtons, ensureTemplateButton,
    ensureResultRoot, renderSummary, renderCategory, renderSpamWarning,
    renderImportance, renderTemplatePicker, removeTemplatePicker,
    cleanupAllInjectedElements
  } = uiModule;

  const DEFAULT_TOGGLES = {
    summarize: true, categorize: true, spamCheck: true, important: false
  };

  let featureToggles = { ...DEFAULT_TOGGLES };
  let lastContext = { subject: "", sender: "", bodyText: "", emailText: "" };

  // -------------------------------------------------------
  // Storage helpers
  // -------------------------------------------------------
  function normalizeToggles(raw) {
    return {
      summarize:  typeof raw?.autoSummarize  === "boolean" ? raw.autoSummarize  : DEFAULT_TOGGLES.summarize,
      categorize: typeof raw?.autoCategorize === "boolean" ? raw.autoCategorize : DEFAULT_TOGGLES.categorize,
      spamCheck:  typeof raw?.spamAlerts     === "boolean" ? raw.spamAlerts     : DEFAULT_TOGGLES.spamCheck,
      important:  typeof raw?.autoImportant  === "boolean" ? raw.autoImportant  : DEFAULT_TOGGLES.important,
    };
  }

  function loadFeatureToggles() {
    return new Promise(resolve => {
      chrome.storage.sync.get(["autoSummarize", "autoCategorize", "spamAlerts", "autoImportant"], result => {
        if (chrome.runtime.lastError) { resolve({ ...DEFAULT_TOGGLES }); return; }
        resolve(normalizeToggles(result || {}));
      });
    });
  }

  // -------------------------------------------------------
  // Context helpers
  // -------------------------------------------------------
  function getCurrentEmailContext() {
    const data = extractEmailData();
    if (data.isOpenEmailView) {
      lastContext = {
        subject: data.subject, sender: data.sender,
        bodyText: data.bodyText, emailText: data.emailText
      };
    }
    return data;
  }

  // -------------------------------------------------------
  // Extension alive guard
  // -------------------------------------------------------
  function isExtensionAlive() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }

  function sendMessage(message) {
    return new Promise(resolve => {
      if (!isExtensionAlive()) {
        clearTimeout(window.__inboxzeroTimer);
        observer?.disconnect();
        resolve({ error: "Extension context invalidated. Please refresh the page." });
        return;
      }
      try {
        chrome.runtime.sendMessage(message, response => {
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || {});
        });
      } catch { resolve({ error: "Extension context invalidated." }); }
    });
  }

  // -------------------------------------------------------
  // URL-based email open check (reliable vs DOM)
  // -------------------------------------------------------
  function isEmailOpen() {
    const hash = window.location.hash;
    const parts = hash.replace('#', '').split('/');
    return parts.length >= 2 && parts[1].length > 6;
  }

  // -------------------------------------------------------
  // Button click handlers
  // -------------------------------------------------------
  async function onSummarizeClick() {
    if (!featureToggles.summarize) return;
    const emailData = getCurrentEmailContext();
    const text = emailData.bodyText || emailData.emailText || lastContext.bodyText || lastContext.emailText;
    const root = ensureResultRoot(emailData.subjectElement, emailData.bodyElement);
    if (!text) {
      if (root) renderSummary(root, ["Could not read email content. Try clicking inside the email first."]);
      return;
    }
    if (root) renderSummary(root, ["Summarizing..."]);
    const response = await sendMessage({ type: "SUMMARIZE", text });
    if (!root) return;
    if (response?.bullets) {
      renderSummary(root, response.bullets);
    } else {
      const isNoKey = response?.error?.includes("NO_API_KEY");
      renderSummary(root, [isNoKey
        ? "⚠️ No API key set. Open the extension popup and save your Gemini key."
        : `Error: ${response?.error || "Unknown error"}`
      ]);
    }
  }

  async function onCategorizeClick() {
    if (!featureToggles.categorize) return;
    const emailData = getCurrentEmailContext();
    const text = emailData.bodyText || emailData.emailText;
    if (!text) return;
    const root = ensureResultRoot(emailData.subjectElement, emailData.bodyElement);
    if (root) renderCategory(root, "Analyzing...", false);
    const response = await sendMessage({
      type: "CATEGORIZE",
      text,
      sender: emailData.sender,
      messageId: emailData.messageId
    });
    // labelApplied is always false until OAuth ships
    if (root) renderCategory(root, response?.category || "Unknown", false);
  }

  async function onSpamCheckClick() {
    if (!featureToggles.spamCheck) return;
    const emailData = getCurrentEmailContext();
    const text = emailData.bodyText || emailData.emailText;
    if (!text) return;
    const root = ensureResultRoot(emailData.subjectElement, emailData.bodyElement);
    if (root) renderSpamWarning(root, { score: 0, reasoning: "Analyzing..." }, null);
    const response = await sendMessage({
      type: "SPAM_CHECK",
      sender: emailData.sender,
      subject: emailData.subject,
      text
    });
    if (!root) return;
    // TRASH_MESSAGE requires OAuth — coming soon. Always pass null until then.
    renderSpamWarning(root, response || { score: 0, flags: [] }, null);
  }

  async function onTemplatesClick() {
    const composeToolbar = getComposeToolbar();
    const composeBody = getComposeBody();
    if (!composeToolbar || !composeBody) return;
    const response = await sendMessage({ type: "GET_TEMPLATES" });
    const templates = Array.isArray(response?.templates) ? response.templates : [];
    if (templates.length === 0) { removeTemplatePicker(composeToolbar); return; }
    renderTemplatePicker(composeToolbar, templates, async (template) => {
      const body = template?.body || "";
      if (!body) return;
      composeBody.focus();
      // Replace existing draft content with the chosen template
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, body);
    });
  }

  // CHECK_IMPORTANCE requires OAuth to apply Gmail labels — coming soon.
  // Skipping entirely until OAuth is production-ready.
  async function runImportanceCheck(_emailData) { /* no-op */ }

  // -------------------------------------------------------
  // Inject / remove buttons based on current view
  // -------------------------------------------------------
  let isInjecting = false;
  let observer = null;
  let lastEmailUrl = "";

  function injectIfReady() {
    if (isInjecting) return;
    isInjecting = true;

    try {
      const allOff = !featureToggles.summarize && !featureToggles.categorize && !featureToggles.spamCheck;
      const emailOpen = isEmailOpen();

      // Always sweep stale buttons globally
      if (allOff || !emailOpen) {
        document.querySelectorAll("#inboxzero-ai-action-buttons").forEach(el => el.remove());
      }

      const emailData = getCurrentEmailContext();
      const toolbar = getEmailToolbar();
      const composeToolbar = getComposeToolbar();

      if (toolbar && !allOff && emailOpen && emailData.isOpenEmailView) {
        ensureActionButtons(toolbar, {
          onSummarizeClick, onCategorizeClick, onSpamCheckClick
        }, {
          summarize: featureToggles.summarize,
          categorize: featureToggles.categorize,
          spamCheck: featureToggles.spamCheck
        });
      }

      if (composeToolbar) ensureTemplateButton(composeToolbar, onTemplatesClick);

      // Run auto-importance when navigating to a new email
      const currentUrl = window.location.hash;
      if (emailOpen && emailData.isOpenEmailView && currentUrl !== lastEmailUrl) {
        lastEmailUrl = currentUrl;
        runImportanceCheck(emailData);
      }

    } finally {
      isInjecting = false;
    }
  }

  // -------------------------------------------------------
  // Listen for result messages pushed from service worker
  // -------------------------------------------------------
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") return;

    // Templates can be inserted from the popup ("Recent Templates") as well.
    if (message.type === "INSERT_TEMPLATE") {
      const composeBody = getComposeBody();
      const body = String(message.body || "");
      if (!composeBody || !body) return;
      composeBody.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, body);
      return;
    }

    const emailData = getCurrentEmailContext();
    const root = ensureResultRoot(emailData.subjectElement, emailData.bodyElement);
    if (message.type === "SUMMARY_RESULT" && featureToggles.summarize)
      renderSummary(root, message.bullets || []);
    if (message.type === "CATEGORY_RESULT" && featureToggles.categorize)
      renderCategory(root, message.category || "Unknown", false);
    if (message.type === "SPAM_RESULT" && featureToggles.spamCheck)
      renderSpamWarning(root, { score: message.score ?? 0, flags: message.flags || [] }, null);
  });

  // -------------------------------------------------------
  // Storage change listener (toggle updates from popup)
  // -------------------------------------------------------
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;
    if ("autoSummarize"  in changes) featureToggles.summarize  = changes.autoSummarize.newValue  ?? DEFAULT_TOGGLES.summarize;
    if ("autoCategorize" in changes) featureToggles.categorize = changes.autoCategorize.newValue ?? DEFAULT_TOGGLES.categorize;
    if ("spamAlerts"     in changes) featureToggles.spamCheck  = changes.spamAlerts.newValue     ?? DEFAULT_TOGGLES.spamCheck;
    if ("autoImportant"  in changes) featureToggles.important  = changes.autoImportant.newValue  ?? DEFAULT_TOGGLES.important;
    injectIfReady();
  });

  // -------------------------------------------------------
  // Init
  // -------------------------------------------------------
  featureToggles = await loadFeatureToggles();
  injectIfReady();

  observer = new MutationObserver(() => {
    clearTimeout(window.__inboxzeroTimer);
    window.__inboxzeroTimer = setTimeout(injectIfReady, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("unload", cleanupAllInjectedElements);
  chrome.runtime.connect().onDisconnect.addListener(cleanupAllInjectedElements);
})();
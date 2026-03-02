(async () => {
  const parserModule = await import(chrome.runtime.getURL("content/gmail-parser.js"));
  const uiModule = await import(chrome.runtime.getURL("content/ui-injector.js"));

  const {
    extractEmailData,
    getEmailToolbar,
    getComposeBody,
    getComposeToolbar
  } = parserModule;

  const {
    ensureActionButtons,
    removeActionButtons,
    ensureTemplateButton,
    ensureResultRoot,
    renderSummary,
    renderCategory,
    renderSpamWarning,
    renderTemplatePicker,
    removeTemplatePicker,
    cleanupAllInjectedElements
  } = uiModule;

  const DEFAULT_TOGGLES = {
    summarize: true,
    categorize: true,
    spamCheck: true
  };

  let featureToggles = { ...DEFAULT_TOGGLES };

  let lastContext = {
    subject: "",
    sender: "",
    bodyText: "",
    emailText: ""
  };

  function normalizeToggles(raw) {
    return {
      summarize: typeof raw?.autoSummarize === "boolean" ? raw.autoSummarize : DEFAULT_TOGGLES.summarize,
      categorize: typeof raw?.autoCategorize === "boolean" ? raw.autoCategorize : DEFAULT_TOGGLES.categorize,
      spamCheck: typeof raw?.spamAlerts === "boolean" ? raw.spamAlerts : DEFAULT_TOGGLES.spamCheck
    };
  }

  function loadFeatureToggles() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(["autoSummarize", "autoCategorize", "spamAlerts"], (result) => {
        if (chrome.runtime.lastError) {
          resolve({ ...DEFAULT_TOGGLES });
          return;
        }
        resolve(normalizeToggles(result || {}));
      });
    });
  }

  function getCurrentEmailContext() {
    const data = extractEmailData();
    if (data.isOpenEmailView) {
      lastContext = {
        subject: data.subject,
        sender: data.sender,
        bodyText: data.bodyText,
        emailText: data.emailText
      };
    }
    return data;
  }

  function isExtensionAlive() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      if (!isExtensionAlive()) {
        // Extension was reloaded — stop all timers and observers silently
        clearTimeout(window.__inboxzeroTimer);
        observer?.disconnect();
        resolve({ error: "Extension context invalidated. Please refresh the page." });
        return;
      }
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || {});
        });
      } catch {
        resolve({ error: "Extension context invalidated." });
      }
    });
  }

  async function onSummarizeClick() {
    if (!featureToggles.summarize) {
      return;
    }

    const emailData = getCurrentEmailContext();
    // Fallback to lastContext if current extraction missed the body
    const text = emailData.bodyText || emailData.emailText || lastContext.bodyText || lastContext.emailText;
    if (!text) {
      const root = ensureResultRoot(emailData.subjectElement, emailData.bodyElement);
      if (root) renderSummary(root, ["Could not read email content. Try clicking inside the email first."]);
      return;
    }

    const response = await sendMessage({ type: "SUMMARIZE", text: text });
    const root = ensureResultRoot(emailData.subjectElement, emailData.bodyElement);

    if (response?.bullets) {
      renderSummary(root, response.bullets);
      return;
    }

    const errorMsg = response?.error || "Unable to summarize this email right now.";
    const isNoKey = errorMsg.includes("NO_API_KEY");
    renderSummary(root, [isNoKey ? "⚠️ No API key set. Open the extension popup and save your Gemini API key." : `Error: ${errorMsg}`]);
  }

  async function onCategorizeClick() {
    if (!featureToggles.categorize) {
      return;
    }

    const emailData = getCurrentEmailContext();
    if (!emailData.emailText) {
      return;
    }

    const response = await sendMessage({ type: "CATEGORIZE", text: emailData.bodyText || emailData.emailText });
    const root = ensureResultRoot(emailData.subjectElement, emailData.bodyElement);
    renderCategory(root, response?.category || "Unknown");
  }

  async function onSpamCheckClick() {
    if (!featureToggles.spamCheck) {
      return;
    }

    const emailData = getCurrentEmailContext();
    if (!emailData.emailText) {
      return;
    }

    const response = await sendMessage({
      type: "SPAM_CHECK",
      sender: emailData.sender,
      text: emailData.bodyText || emailData.emailText
    });

    const root = ensureResultRoot(emailData.subjectElement, emailData.bodyElement);
    renderSpamWarning(root, response || { score: 0, flags: [] });
  }

  async function onTemplatesClick() {
    const composeToolbar = getComposeToolbar();
    const composeBody = getComposeBody();
    if (!composeToolbar || !composeBody) {
      return;
    }

    const response = await sendMessage({ type: "GET_TEMPLATES" });
    const templates = Array.isArray(response?.templates) ? response.templates : [];

    if (templates.length === 0) {
      removeTemplatePicker(composeToolbar);
      return;
    }

    renderTemplatePicker(composeToolbar, templates, async (template) => {
      const body = template?.body || "";
      if (!body) {
        return;
      }

      composeBody.focus();
      document.execCommand("insertText", false, body);
      await sendMessage({ type: "INSERT_TEMPLATE", body });
    });
  }

  let isInjecting = false;
  let observer = null;

  function isEmailOpen() {
    // Gmail URLs for open emails look like #inbox/1234abc or #all/1234abc
    // Inbox list is just #inbox or #search/foo — no message ID after the slash
    const hash = window.location.hash;
    const parts = hash.replace('#', '').split('/');
    // An open email has at least 2 parts and the second part is a message/thread ID
    return parts.length >= 2 && parts[1].length > 6;
  }

  function injectIfReady() {
    // Prevent re-entrant calls that cause infinite mutation loops
    if (isInjecting) return;
    isInjecting = true;

    try {
      const allOff = !featureToggles.summarize && !featureToggles.categorize && !featureToggles.spamCheck;
      const emailOpen = isEmailOpen();

      const emailData = getCurrentEmailContext();
      const toolbar = getEmailToolbar();
      const composeToolbar = getComposeToolbar();

      // Always clean up stale buttons from anywhere in the doc first
      if (allOff || !emailOpen) {
        document.querySelectorAll("#inboxzero-ai-action-buttons").forEach(el => el.remove());
      }

      if (toolbar) {
        if (!allOff && emailOpen && emailData.isOpenEmailView) {
          ensureActionButtons(toolbar, {
            onSummarizeClick,
            onCategorizeClick,
            onSpamCheckClick
          }, {
            summarize: featureToggles.summarize,
            categorize: featureToggles.categorize,
            spamCheck: featureToggles.spamCheck
          });
        }
      }

      if (composeToolbar) {
        ensureTemplateButton(composeToolbar, onTemplatesClick);
      }
    } finally {
      isInjecting = false;
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") {
      return;
    }

    const emailData = getCurrentEmailContext();
    const root = ensureResultRoot(emailData.subjectElement, emailData.bodyElement);

    if (message.type === "SUMMARY_RESULT") {
      if (!featureToggles.summarize) {
        return;
      }
      renderSummary(root, message.bullets || []);
    }

    if (message.type === "CATEGORY_RESULT") {
      if (!featureToggles.categorize) {
        return;
      }
      renderCategory(root, message.category || "Unknown");
    }

    if (message.type === "SPAM_RESULT") {
      if (!featureToggles.spamCheck) {
        return;
      }
      renderSpamWarning(root, {
        score: message.score ?? 0,
        flags: message.flags || []
      });
    }
  });

  featureToggles = await loadFeatureToggles();
  injectIfReady();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(changes, "autoSummarize")) {
      featureToggles.summarize =
        typeof changes.autoSummarize.newValue === "boolean"
          ? changes.autoSummarize.newValue
          : DEFAULT_TOGGLES.summarize;
    }

    if (Object.prototype.hasOwnProperty.call(changes, "autoCategorize")) {
      featureToggles.categorize =
        typeof changes.autoCategorize.newValue === "boolean"
          ? changes.autoCategorize.newValue
          : DEFAULT_TOGGLES.categorize;
    }

    if (Object.prototype.hasOwnProperty.call(changes, "spamAlerts")) {
      featureToggles.spamCheck =
        typeof changes.spamAlerts.newValue === "boolean"
          ? changes.spamAlerts.newValue
          : DEFAULT_TOGGLES.spamCheck;
    }

    injectIfReady();
  });

  observer = new MutationObserver(() => {
    // Debounce — wait for Gmail's DOM to settle before checking
    clearTimeout(window.__inboxzeroTimer);
    window.__inboxzeroTimer = setTimeout(injectIfReady, 300);
  });

  // Initial observe — injectIfReady will disconnect/reconnect this around DOM changes
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Clean up all injected elements when extension is disabled or page unloads
  window.addEventListener("unload", cleanupAllInjectedElements);
  chrome.runtime.connect().onDisconnect.addListener(cleanupAllInjectedElements);
})();
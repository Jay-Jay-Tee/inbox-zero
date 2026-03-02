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
    ensureTemplateButton,
    ensureResultRoot,
    renderSummary,
    renderCategory,
    renderSpamWarning,
    renderTemplatePicker,
    removeTemplatePicker
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

  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || {});
      });
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

  function injectIfReady() {
    const emailData = getCurrentEmailContext();
    const toolbar = getEmailToolbar();
    const composeToolbar = getComposeToolbar();

    if (toolbar && emailData.isOpenEmailView) {
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

    if (composeToolbar) {
      ensureTemplateButton(composeToolbar, onTemplatesClick);
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

  const observer = new MutationObserver(() => {
    injectIfReady();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
})();

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

  let lastContext = {
    subject: "",
    sender: "",
    bodyText: "",
    emailText: ""
  };

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
    const emailData = getCurrentEmailContext();
    if (!emailData.emailText) {
      return;
    }

    await sendMessage({ type: "EMAIL_CONTEXT", emailText: emailData.emailText });
    const response = await sendMessage({ type: "SUMMARIZE", text: emailData.bodyText || emailData.emailText });
    const root = ensureResultRoot(emailData.subjectElement, emailData.bodyElement);

    if (response?.bullets) {
      renderSummary(root, response.bullets);
      return;
    }

    renderSummary(root, ["Unable to summarize this email right now."]);
  }

  async function onCategorizeClick() {
    const emailData = getCurrentEmailContext();
    if (!emailData.emailText) {
      return;
    }

    await sendMessage({ type: "EMAIL_CONTEXT", emailText: emailData.emailText });
    const response = await sendMessage({ type: "CATEGORIZE", text: emailData.bodyText || emailData.emailText });
    const root = ensureResultRoot(emailData.subjectElement, emailData.bodyElement);
    renderCategory(root, response?.category || "Unknown");
  }

  async function onSpamCheckClick() {
    const emailData = getCurrentEmailContext();
    if (!emailData.emailText) {
      return;
    }

    await sendMessage({ type: "EMAIL_CONTEXT", emailText: emailData.emailText });
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
      renderSummary(root, message.bullets || []);
    }

    if (message.type === "CATEGORY_RESULT") {
      renderCategory(root, message.category || "Unknown");
    }

    if (message.type === "SPAM_RESULT") {
      renderSpamWarning(root, {
        score: message.score ?? 0,
        flags: message.flags || []
      });
    }
  });

  injectIfReady();

  const observer = new MutationObserver(() => {
    injectIfReady();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
})();
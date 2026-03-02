const SUBJECT_SELECTORS = ["h2.hP", "h2[data-thread-perm-id]"];
const BODY_SELECTORS = [".a3s.aiL", ".a3s", ".ii.gt .a3s", "div[data-message-id] .a3s", ".gmail_quote", ".nH .a3s"];
const SENDER_SELECTORS = [
  "span[email]",
  ".gD[email]",
  ".go span[email]",
  ".go .gD"
];
const TOOLBAR_SELECTOR = ".G-atb";
const COMPOSE_BODY_SELECTOR = ".Am.Al.editable";
const COMPOSE_TOOLBAR_SELECTOR = ".aDh, .aoD.hl";

function firstMatch(selectors, root = document) {
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    if (element) {
      return element;
    }
  }
  return null;
}

function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function extractEmailData() {
  const subjectElement = firstMatch(SUBJECT_SELECTORS);
  const bodyElement = firstMatch(BODY_SELECTORS);
  const senderElement = firstMatch(SENDER_SELECTORS);

  const subject = normalizeText(subjectElement?.innerText || subjectElement?.textContent || "");
  const bodyText = normalizeText(bodyElement?.innerText || bodyElement?.textContent || "");
  const sender =
    normalizeText(senderElement?.getAttribute("email") || "") ||
    normalizeText(senderElement?.innerText || senderElement?.textContent || "");

  const isOpenEmailView = Boolean(subjectElement && bodyElement);

  return {
    subject,
    sender,
    bodyText,
    emailText: [subject, bodyText].filter(Boolean).join("\n\n"),
    isOpenEmailView,
    subjectElement,
    bodyElement,
    senderElement
  };
}

function getEmailToolbar() {
  return document.querySelector(TOOLBAR_SELECTOR);
}

function getComposeBody() {
  return document.querySelector(COMPOSE_BODY_SELECTOR);
}

function getComposeToolbar() {
  const composeBody = getComposeBody();
  if (!composeBody) {
    return null;
  }

  const composeContainer = composeBody.closest(".nH, .AD") || document;
  return composeContainer.querySelector(COMPOSE_TOOLBAR_SELECTOR);
}

export {
  extractEmailData,
  getEmailToolbar,
  getComposeBody,
  getComposeToolbar
};
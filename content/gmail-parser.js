const SUBJECT_SELECTORS = ["h2.hP", "h2[data-thread-perm-id]", ".hP", "[data-legacy-thread-id] h2", "h2"];
const BODY_SELECTORS = [".a3s.aiL", ".a3s", ".ii.gt .a3s", "div[data-message-id] .a3s", ".gmail_quote", ".nH .a3s"];
const SENDER_SELECTORS = [
  "span[email]",
  ".gD[email]",
  ".go span[email]",
  ".go .gD"
];
const TOOLBAR_SELECTOR = ".G-atb, .iH, [gh=tm]";
const COMPOSE_BODY_SELECTOR = ".Am.Al.editable";
const COMPOSE_TOOLBAR_SELECTOR = ".aoD.hl, .btC, .gU.Up";

function firstMatch(selectors, root = document) {
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    if (element) return element;
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

  const isOpenEmailView = Boolean(subjectElement || bodyElement); // either is enough

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
  if (!composeBody) return null;

  // Walk up to the compose window root
  const composeWindow = composeBody.closest(".AD, .nH, [role='dialog']");
  if (!composeWindow) return null;

  // Anchor to the Send button — it always lives in the bottom toolbar
  const sendButton = composeWindow.querySelector(
    "[data-tooltip='Send'], [aria-label='Send'], .T-I.J-J5-Ji.aoO"
  );
  if (sendButton) {
    const toolbar = sendButton.closest(".aoD, .btC, .gU");
    if (toolbar) return toolbar;
  }

  // Fallback: use the LAST match — bottom toolbar, not the recipient header at top
  const all = composeWindow.querySelectorAll(COMPOSE_TOOLBAR_SELECTOR);
  return all.length ? all[all.length - 1] : null;
}

export {
  extractEmailData,
  getEmailToolbar,
  getComposeBody,
  getComposeToolbar
};
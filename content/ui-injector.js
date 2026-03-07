// ============================================================
// InboxZero AI — UI Injector
// Injects and renders all UI elements into Gmail
// ============================================================

const ROOT_ID = "inboxzero-ai-root";
const SUMMARY_ID = "inboxzero-ai-summary";
const CATEGORY_ID = "inboxzero-ai-category";
const SPAM_ID = "inboxzero-ai-spam";
const IMPORTANCE_ID = "inboxzero-ai-importance";
const TEMPLATE_PICKER_ID = "inboxzero-ai-template-picker";
const ACTION_CONTAINER_ID = "inboxzero-ai-action-buttons";

const UI_FONT_FAMILY = "Google Sans, Roboto, Arial, sans-serif";
const UI_TEXT_SIZE = "13px";
const UI_TEXT_LINE_HEIGHT = "1.5";

// -------------------------------------------------------
// CARD FACTORY — consistent card shell with dismiss
// -------------------------------------------------------
function createCard(id, accentColor, onDismiss) {
  const card = document.createElement("div");
  card.id = id;
  card.style.cssText = `
    font-family: ${UI_FONT_FAMILY};
    font-size: ${UI_TEXT_SIZE};
    line-height: ${UI_TEXT_LINE_HEIGHT};
    border-radius: 0;
    padding: 12px 38px 12px 14px;
    position: relative;
    border-left: 3px solid ${accentColor};
    background: #ffffff;
    border-top: 1px solid #dadce0;
    border-right: 1px solid #dadce0;
    border-bottom: 1px solid #dadce0;
    color: #202124;
    box-sizing: border-box;
    width: 100%;
  `;

  // Dismiss button
  const x = document.createElement("button");
  x.type = "button";
  x.textContent = "✕";
  x.style.cssText = `
    position: absolute; top: 8px; right: 10px;
    background: none; border: none; cursor: pointer;
    font-size: ${UI_TEXT_SIZE}; color: #5f6368; padding: 2px 4px;
    border-radius: 0; line-height: 1;
  `;
  x.onmouseenter = () => x.style.background = "#f1f3f4";
  x.onmouseleave = () => x.style.background = "none";
  x.addEventListener("click", e => { e.stopPropagation(); onDismiss(card); });
  card.appendChild(x);

  return card;
}

function cardLabel(text, color = "#5f6368") {
  const el = document.createElement("div");
  el.style.cssText = `font-size: ${UI_TEXT_SIZE}; font-weight: 600; color: ${color}; margin-bottom: 6px;`;
  el.textContent = text;
  return el;
}

// -------------------------------------------------------
// BUTTON FACTORY
// -------------------------------------------------------
function createButton(label, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "inboxzero-ai-btn";
  button.dataset.inboxzeroAction = action;
  button.dataset.inboxzeroRole = "action-button";
  button.textContent = label;
  button.style.cssText = `
    margin-left: 8px; padding: 7px 12px;
    border: 1px solid #c7c9cc; border-radius: 0;
    background: #fff; cursor: pointer; font-size: ${UI_TEXT_SIZE};
    font-family: ${UI_FONT_FAMILY};
    font-weight: 500; color: #202124;
    position: relative; z-index: 9999; pointer-events: all;
    transition: background 0.15s, border-color 0.15s;
    white-space: nowrap;
  `;
  button.onmouseenter = () => { button.style.background = "#f1f3f4"; button.style.borderColor = "#9aa0a6"; };
  button.onmouseleave = () => { button.style.background = "#fff"; button.style.borderColor = "#c7c9cc"; };
  return button;
}

// -------------------------------------------------------
// ACTION BUTTONS (Summarize / Categorize / Spam Check)
// -------------------------------------------------------
function ensureActionButtons(toolbar, handlers, enabledFeatures = {}) {
  if (!toolbar) return;

  let container = toolbar.querySelector(`#${ACTION_CONTAINER_ID}`);
  if (!container) {
    container = document.createElement("div");
    container.id = ACTION_CONTAINER_ID;
    container.style.cssText = "display:inline-flex;align-items:center;";
    toolbar.appendChild(container);
  }

  const actionConfig = [
    { action: "summarize",  label: "✦ Summarize",   onClick: handlers.onSummarizeClick },
    { action: "categorize", label: "Categorize",  onClick: handlers.onCategorizeClick },
    { action: "spamCheck",  label: "Spam Check",  onClick: handlers.onSpamCheckClick }
  ];

  actionConfig.forEach(({ action, label, onClick }) => {
    const enabled = enabledFeatures[action] !== false;
    const existing = container.querySelector(`[data-inboxzero-action="${action}"]`);
    if (!enabled && existing) { existing.remove(); return; }
    if (enabled && !existing) {
      const btn = createButton(label, action);
      btn.addEventListener("click", onClick);
      container.appendChild(btn);
    }
  });

  if (!container.querySelector('[data-inboxzero-role="action-button"]')) container.remove();
}

function removeActionButtons(toolbar) {
  if (!toolbar) return;
  const container = toolbar.querySelector(`#${ACTION_CONTAINER_ID}`);
  if (container) container.remove();
}

// -------------------------------------------------------
// TEMPLATES BUTTON (Compose window)
// -------------------------------------------------------
function ensureTemplateButton(composeToolbar, onTemplatesClick) {
  if (!composeToolbar) return;
  if (composeToolbar.querySelector('[data-inboxzero-action="templates"]')) return;
  const btn = createButton("📝 Templates", "templates");
  btn.addEventListener("click", onTemplatesClick);
  composeToolbar.appendChild(btn);
}

// -------------------------------------------------------
// RESULT ROOT — injected above email body
// -------------------------------------------------------
function ensureResultRoot(subjectElement, bodyElement) {
  if (!subjectElement && !bodyElement) return null;
  const anchor = subjectElement || bodyElement;
  const emailContainer = anchor.closest(".ii.gt") || anchor.closest(".adn") || anchor.parentElement;
  if (!emailContainer) return null;

  let root = emailContainer.querySelector(`#${ROOT_ID}`);
  if (!root) {
    root = document.createElement("div");
    root.id = ROOT_ID;
    root.style.cssText = `
      display: flex; flex-direction: column; gap: 8px;
      margin: 8px 0 12px 0; width: 100%; box-sizing: border-box;
    `;
    emailContainer.insertBefore(root, emailContainer.firstChild);
  }
  return root;
}

// -------------------------------------------------------
// SUMMARY CARD
// -------------------------------------------------------
function renderSummary(root, bullets) {
  if (!root) return;
  let card = root.querySelector(`#${SUMMARY_ID}`);
  if (!card) {
    card = createCard(SUMMARY_ID, "#1a73e8", el => el.remove());
    root.appendChild(card);
  }
  // Clear old content (keep dismiss button)
  [...card.children].forEach(c => { if (c.tagName !== "BUTTON") c.remove(); });

  card.insertBefore(cardLabel("✦ AI Summary", "#1a73e8"), card.firstChild);

  const safeBullets = Array.isArray(bullets) ? bullets : [String(bullets)];
  const ul = document.createElement("ul");
  ul.style.cssText = "margin: 4px 0 0 16px; padding: 0;";
  safeBullets.forEach(b => {
    const li = document.createElement("li");
    li.style.cssText = `color: #202124; margin-bottom: 2px; font-size: ${UI_TEXT_SIZE};`;
    li.textContent = String(b);
    ul.appendChild(li);
  });
  card.insertBefore(ul, card.querySelector("button"));
}

// -------------------------------------------------------
// CATEGORY CARD
// -------------------------------------------------------
const CATEGORY_COLORS = {
  Work:     { accent: "#188038", bg: "#ffffff" },
  Personal: { accent: "#1967d2", bg: "#ffffff" },
  Promo:    { accent: "#b06000", bg: "#ffffff" },
  Urgent:   { accent: "#c5221f", bg: "#ffffff" },
  Spam:     { accent: "#c5221f", bg: "#ffffff" },
};

function renderCategory(root, category, labelApplied) {
  if (!root) return;
  let card = root.querySelector(`#${CATEGORY_ID}`);

  const colors = CATEGORY_COLORS[category] || { accent: "#5f6368", bg: "#ffffff" };

  if (!card) {
    card = createCard(CATEGORY_ID, colors.accent, el => el.remove());
    root.appendChild(card);
  }
  card.style.borderLeftColor = colors.accent;
  card.style.background = colors.bg;

  [...card.children].forEach(c => { if (c.tagName !== "BUTTON") c.remove(); });

  card.insertBefore(cardLabel("Category", colors.accent), card.firstChild);

  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;";

  const badge = document.createElement("span");
  badge.style.cssText = `
    display:inline-block; padding: 2px 10px; border-radius: 0;
    background: #ffffff; border: 1px solid ${colors.accent};
    color: ${colors.accent}; font-size: ${UI_TEXT_SIZE}; font-weight: 600;
  `;
  badge.textContent = category;
  row.appendChild(badge);

  // Gmail label application requires OAuth — show coming-soon note instead
  {
    const tag = document.createElement("span");
    tag.style.cssText = `font-size:${UI_TEXT_SIZE};color:#9aa0a6;display:inline-flex;align-items:center;gap:4px;`;
    tag.innerHTML = `🔒 Gmail label sync <span style="font-size:10px;padding:1px 5px;background:#e8eaed;border-radius:8px;color:#5f6368;font-weight:600;">Coming Soon</span>`;
    row.appendChild(tag);
  }

  card.insertBefore(row, card.querySelector("button"));
}

// -------------------------------------------------------
// SPAM CARD — with score bar and delete button
// -------------------------------------------------------
function renderSpamWarning(root, spamResult, onDelete) {
  if (!root) return;
  let card = root.querySelector(`#${SPAM_ID}`);
  const score = Number(spamResult?.score ?? 0);
  const isDanger = score >= 60 || spamResult?.flagged;
  const isSuspicious = score >= 30 && score < 60;
  const accent = isDanger ? "#c5221f" : isSuspicious ? "#b06000" : "#188038";
  const bg = "#ffffff";

  if (!card) {
    card = createCard(SPAM_ID, accent, el => el.remove());
    root.appendChild(card);
  }
  card.style.borderLeftColor = accent;
  card.style.background = bg;
  // Remove everything except the dismiss (✕) button to prevent duplicate "Move to Trash" buttons
  // accumulating across re-renders (e.g. "Analyzing..." placeholder → final result)
  [...card.children].forEach(c => {
    if (c.tagName !== "BUTTON" || c.textContent.trim() !== "✕") c.remove();
  });

  const levelText = isDanger ? "Spam Detected" : isSuspicious ? "Suspicious" : "Spam Check";
  card.insertBefore(cardLabel(levelText, accent), card.firstChild);

  // Score bar
  const barWrap = document.createElement("div");
  barWrap.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:4px;";
  const barTrack = document.createElement("div");
  barTrack.style.cssText = `flex:1;height:4px;border-radius:0;background:#e8eaed;`;
  const barFill = document.createElement("div");
  barFill.style.cssText = `height:4px;border-radius:0;background:${accent};width:${score}%;transition:width 0.4s;`;
  barTrack.appendChild(barFill);
  const scoreLabel = document.createElement("span");
  scoreLabel.style.cssText = `font-size:${UI_TEXT_SIZE};font-weight:700;color:${accent};min-width:54px;`;
  scoreLabel.textContent = `${score}/100`;
  barWrap.appendChild(barTrack);
  barWrap.appendChild(scoreLabel);
  card.insertBefore(barWrap, card.querySelector("button"));

  // Reasoning
  if (spamResult?.reasoning) {
    const reason = document.createElement("div");
    reason.style.cssText = `font-size:${UI_TEXT_SIZE};color:#5f6368;margin-bottom:4px;`;
    reason.textContent = spamResult.reasoning;
    card.insertBefore(reason, card.querySelector("button"));
  }

  // Flags
  const flags = Array.isArray(spamResult?.flags) ? spamResult.flags : [];
  if (flags.length > 0) {
    const flagList = document.createElement("div");
    flagList.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;";
    flags.slice(0, 3).forEach(f => {
      const pill = document.createElement("span");
      pill.style.cssText = `font-size:${UI_TEXT_SIZE};padding:1px 6px;border-radius:0;background:#ffffff;border:1px solid ${accent};color:${accent};`;
      pill.textContent = f;
      flagList.appendChild(pill);
    });
    card.insertBefore(flagList, card.querySelector("button"));
  }

  // "Move to Trash" requires OAuth — show a disabled coming-soon chip instead
  if (isDanger) {
    const comingSoonBtn = document.createElement("button");
    comingSoonBtn.type = "button";
    comingSoonBtn.disabled = true;
    comingSoonBtn.style.cssText = `
      margin-top: 8px; padding: 5px 12px; background: #f8f9fa;
      border: 1px solid #dadce0; border-radius: 0; color: #9aa0a6;
      font-size: ${UI_TEXT_SIZE}; cursor: not-allowed; font-family: inherit;
      display: inline-flex; align-items: center; gap: 6px;
    `;
    comingSoonBtn.innerHTML = `🗑 Move to Trash <span style="font-size:10px;padding:1px 5px;background:#e8eaed;border-radius:8px;color:#5f6368;font-weight:600;">Coming Soon</span>`;
    card.insertBefore(comingSoonBtn, card.querySelector("button"));
  }
}

// -------------------------------------------------------
// IMPORTANCE CARD
// -------------------------------------------------------
function renderImportance(root, result) {
  if (!root || !result?.isImportant) return;
  let card = root.querySelector(`#${IMPORTANCE_ID}`);
  if (!card) {
    card = createCard(IMPORTANCE_ID, "#ffa756", el => el.remove());
    root.appendChild(card);
  }
  [...card.children].forEach(c => { if (c.tagName !== "BUTTON") c.remove(); });
  card.insertBefore(cardLabel("❗ Important Email", "#ffa756"), card.firstChild);
  if (result.reason) {
    const r = document.createElement("div");
    r.style.cssText = `font-size:${UI_TEXT_SIZE};color:#202124;`;
    r.textContent = result.reason;
    card.insertBefore(r, card.querySelector("button"));
  }
}

// -------------------------------------------------------
// TEMPLATE PICKER (Compose)
// -------------------------------------------------------
function removeTemplatePicker(composeToolbar) {
  const scope = composeToolbar || document;
  const picker = scope.querySelector(`#${TEMPLATE_PICKER_ID}`);
  if (picker) picker.remove();
}

function renderTemplatePicker(composeToolbar, templates, onSelectTemplate) {
  if (!composeToolbar) return;
  removeTemplatePicker(composeToolbar);

  const picker = document.createElement("select");
  picker.id = TEMPLATE_PICKER_ID;
  picker.style.cssText = `
    margin-left: 8px; padding: 4px 8px; border-radius: 0;
    border: 1px solid #c7c9cc; background: #fff; font-size: ${UI_TEXT_SIZE};
    cursor: pointer; color: #202124; font-family: ${UI_FONT_FAMILY};
  `;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Insert template...";
  picker.appendChild(placeholder);

  (templates || []).forEach((tpl, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = tpl?.name || `Template ${i + 1}`;
    picker.appendChild(opt);
  });

  picker.addEventListener("change", () => {
    const idx = Number(picker.value);
    if (!isNaN(idx) && templates[idx]) onSelectTemplate(templates[idx]);
    picker.value = "";
  });

  composeToolbar.appendChild(picker);
}

// -------------------------------------------------------
// CLEANUP
// -------------------------------------------------------
function cleanupAllInjectedElements() {
  document.querySelectorAll(
    `#${ACTION_CONTAINER_ID}, #${ROOT_ID}, #${TEMPLATE_PICKER_ID}`
  ).forEach(el => el.remove());
}

export {
  ensureActionButtons,
  removeActionButtons,
  ensureTemplateButton,
  ensureResultRoot,
  renderSummary,
  renderCategory,
  renderSpamWarning,
  renderImportance,
  renderTemplatePicker,
  removeTemplatePicker,
  cleanupAllInjectedElements
};
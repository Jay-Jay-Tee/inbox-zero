const ROOT_ID = "inboxzero-ai-root";
const SUMMARY_ID = "inboxzero-ai-summary";
const CATEGORY_ID = "inboxzero-ai-category";
const SPAM_ID = "inboxzero-ai-spam";
const TEMPLATE_PICKER_ID = "inboxzero-ai-template-picker";
const ACTION_CONTAINER_ID = "inboxzero-ai-action-buttons";

function createButton(label, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "inboxzero-ai-btn";
  button.dataset.inboxzeroAction = action;
  button.dataset.inboxzeroRole = "action-button";
  button.textContent = label;
  button.style.marginLeft = "8px";
  button.style.padding = "6px 10px";
  button.style.border = "1px solid #d0d0d0";
  button.style.borderRadius = "6px";
  button.style.background = "#fff";
  button.style.cursor = "pointer";
  button.style.fontSize = "12px";
  // Fix: ensure buttons are above Gmail's overlay divs
  button.style.position = "relative";
  button.style.zIndex = "9999";
  button.style.pointerEvents = "all";
  return button;
}

// Removes ALL injected elements from the page (called on unload/disable)
function cleanupAllInjectedElements() {
  document.querySelectorAll(
    `#${ACTION_CONTAINER_ID}, #${ROOT_ID}, #${TEMPLATE_PICKER_ID}`
  ).forEach(el => el.remove());
}

function ensureActionButtons(toolbar, handlers, enabledFeatures = {}) {
  if (!toolbar) {
    return;
  }

  let container = toolbar.querySelector(`#${ACTION_CONTAINER_ID}`);
  if (!container) {
    container = document.createElement("div");
    container.id = ACTION_CONTAINER_ID;
    container.style.display = "inline-flex";
    container.style.alignItems = "center";
    toolbar.appendChild(container);
  }

  const actionConfig = [
    { action: "summarize", label: "Summarize", onClick: handlers.onSummarizeClick },
    { action: "categorize", label: "Categorize", onClick: handlers.onCategorizeClick },
    { action: "spamCheck", label: "Spam Check", onClick: handlers.onSpamCheckClick }
  ];

  actionConfig.forEach(({ action, label, onClick }) => {
    const enabled = enabledFeatures[action] !== false;
    const existing = container.querySelector(`[data-inboxzero-action="${action}"]`);

    if (!enabled && existing) {
      existing.remove();
      return;
    }

    if (enabled && !existing) {
      const button = createButton(label, action);
      button.addEventListener("click", onClick);
      container.appendChild(button);
    }
  });

  if (!container.querySelector('[data-inboxzero-role="action-button"]')) {
    container.remove();
  }
}

function ensureTemplateButton(composeToolbar, onTemplatesClick) {
  if (!composeToolbar) {
    return;
  }

  if (composeToolbar.querySelector('[data-inboxzero-action="templates"]')) {
    return;
  }

  const templatesBtn = createButton("Templates", "templates");
  templatesBtn.addEventListener("click", onTemplatesClick);
  composeToolbar.appendChild(templatesBtn);
}

function ensureResultRoot(subjectElement, bodyElement) {
  if (!subjectElement && !bodyElement) {
    return null;
  }

  const anchor = subjectElement || bodyElement;
  const emailContainer = anchor.closest(".ii.gt") || anchor.parentElement;
  if (!emailContainer) {
    return null;
  }

  let root = emailContainer.querySelector(`#${ROOT_ID}`);
  if (!root) {
    root = document.createElement("div");
    root.id = ROOT_ID;
    root.style.margin = "8px 0";
    root.style.display = "grid";
    root.style.gap = "8px";
    emailContainer.insertBefore(root, emailContainer.firstChild);
  }

  return root;
}

function renderSummary(root, bullets) {
  if (!root) {
    return;
  }

  let summary = root.querySelector(`#${SUMMARY_ID}`);
  if (!summary) {
    summary = document.createElement("div");
    summary.id = SUMMARY_ID;
    summary.style.background = "#e8f0fe";
    summary.style.border = "1px solid #c6dafc";
    summary.style.padding = "8px 10px";
    summary.style.borderRadius = "8px";
    root.appendChild(summary);
  }

  const safeBullets = Array.isArray(bullets) ? bullets : [];
  summary.innerHTML = `<strong>AI Summary</strong><ul style="margin:6px 0 0 16px;">${safeBullets
    .map((bullet) => `<li>${String(bullet)}</li>`)
    .join("")}</ul>`;
}

function renderCategory(root, category) {
  if (!root) {
    return;
  }

  let badge = root.querySelector(`#${CATEGORY_ID}`);
  if (!badge) {
    badge = document.createElement("div");
    badge.id = CATEGORY_ID;
    badge.style.display = "inline-block";
    badge.style.padding = "4px 8px";
    badge.style.borderRadius = "999px";
    badge.style.background = "#f1f3f4";
    badge.style.fontSize = "12px";
    root.appendChild(badge);
  }

  badge.textContent = `Category: ${category || "Unknown"}`;
}

function renderSpamWarning(root, spamResult) {
  if (!root) {
    return;
  }

  let banner = root.querySelector(`#${SPAM_ID}`);
  if (!banner) {
    banner = document.createElement("div");
    banner.id = SPAM_ID;
    banner.style.padding = "8px 10px";
    banner.style.borderRadius = "8px";
    banner.style.fontSize = "12px";
    root.appendChild(banner);
  }

  const score = Number(spamResult?.score ?? 0);
  const flags = Array.isArray(spamResult?.flags) ? spamResult.flags : [];

  if (score >= 60 || flags.length > 0) {
    banner.style.background = "#fce8e6";
    banner.style.border = "1px solid #f5c6cb";
    banner.style.color = "#b3261e";
    banner.textContent = `Spam warning (score ${score})${flags.length ? `: ${flags.join(", ")}` : ""}`;
  } else {
    banner.style.background = "#e6f4ea";
    banner.style.border = "1px solid #c7e6ce";
    banner.style.color = "#137333";
    banner.textContent = `Spam check passed (score ${score})`;
  }
}

function removeTemplatePicker(composeToolbar) {
  const scope = composeToolbar || document;
  const picker = scope.querySelector(`#${TEMPLATE_PICKER_ID}`);
  if (picker) {
    picker.remove();
  }
}

function renderTemplatePicker(composeToolbar, templates, onSelectTemplate) {
  if (!composeToolbar) {
    return;
  }

  removeTemplatePicker(composeToolbar);

  const picker = document.createElement("select");
  picker.id = TEMPLATE_PICKER_ID;
  picker.style.marginLeft = "8px";
  picker.style.padding = "6px 8px";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Insert template...";
  picker.appendChild(placeholder);

  (templates || []).forEach((template, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = template?.name || `Template ${index + 1}`;
    picker.appendChild(option);
  });

  picker.addEventListener("change", () => {
    const idx = Number(picker.value);
    if (Number.isNaN(idx)) {
      return;
    }
    const selected = templates?.[idx];
    if (selected) {
      onSelectTemplate(selected);
    }
    picker.value = "";
  });

  composeToolbar.appendChild(picker);
}

export {
  ensureActionButtons,
  ensureTemplateButton,
  ensureResultRoot,
  renderSummary,
  renderCategory,
  renderSpamWarning,
  renderTemplatePicker,
  removeTemplatePicker,
  cleanupAllInjectedElements
};
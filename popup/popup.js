document.addEventListener("DOMContentLoaded", () => {
    initApiKeyUI();
    initToggles();
    initTemplates();
    initDashboard();
});

/* =====================================================
   STORAGE HELPERS
===================================================== */

function getStorage(keys) {
    return new Promise((resolve) => {
        chrome.storage.sync.get(keys, (res) => {
            resolve(res || {});
        });
    });
}

function setStorage(data) {
    return new Promise((resolve) => {
        chrome.storage.sync.set(data, () => {
            resolve();
        });
    });
}

/* =====================================================
   API KEY SECTION
===================================================== */

function initApiKeyUI() {
    const apiInput = document.getElementById("apiInput");
    const saveKeyBtn = document.getElementById("saveKey");
    const keyDisplay = document.getElementById("keyDisplay");
    const keyContainer = document.getElementById("keyContainer");

    if ( !apiInput || !saveKeyBtn || !keyDisplay || !keyContainer) return;

    keyContainer.addEventListener("click", () => {
        apiInput.focus();
    });

    function showKey(key) {
        if (!key) {
            keyDisplay.textContent = "Not set";
            keyDisplay.style.color = "#888";
            return;
        }

        if (key.length < 8) {
            keyDisplay.textContent = "Key saved";
            keyDisplay.style.color = "#4ade80";
            return;
        }

        const masked =
            key.slice(0, 4) +
            " •••••••• " +
            key.slice(-4);

        keyDisplay.textContent = masked;
        keyDisplay.style.color = "#4ade80";
    }

    saveKeyBtn.addEventListener("click", async () => {
        const key = apiInput.value.trim();
        if (!key) return;

        await setStorage({ apiKey: key });
        showKey(key);

        apiInput.value = "";
    });

    getStorage(["apiKey"]).then((res) => {
        showKey(res.apiKey);
    });
}

/* =====================================================
   TOGGLES
   FIX: map element IDs to the storage keys content.js actually reads
===================================================== */

function initToggles() {
    const toggleMap = [
        { elId: "toggleSummarize", storageKey: "autoSummarize" },
        { elId: "toggleCategorize", storageKey: "autoCategorize" },
        { elId: "toggleSpam",       storageKey: "spamAlerts"     }
    ];

    const storageKeys = toggleMap.map(t => t.storageKey);

    getStorage(storageKeys).then((data) => {
        toggleMap.forEach(({ elId, storageKey }) => {
            const el = document.getElementById(elId);
            if (el && data[storageKey] !== undefined) {
                el.checked = data[storageKey];
            }
        });
    });

    toggleMap.forEach(({ elId, storageKey }) => {
        const el = document.getElementById(elId);
        if (!el) return;
        el.addEventListener("change", async () => {
            await setStorage({ [storageKey]: el.checked });
        });
    });
}

/* =====================================================
   TEMPLATE SYSTEM
   FIX: templates are {id, name, body} objects — render .name, save correctly
===================================================== */

function initTemplates() {
    const list = document.getElementById("templateList");
    const addBtn = document.getElementById("addTemplateBtn");
    const addWrap = document.getElementById("addTemplateWrap");
    const input = document.getElementById("templateInput");
    const saveBtn = document.getElementById("saveTemplate");
    const cancelBtn = document.getElementById("cancelTemplate");

    if (!list || !addBtn || !addWrap || !input || !saveBtn || !cancelBtn) return;

    let templates = [];

    function render() {
        list.innerHTML = "";

        if (!templates.length) {
            list.innerHTML = '<div class="no-templates">No templates :(</div>';
            return;
        }

        templates.forEach((tpl, index) => {
            // FIX: tpl is an object {id, name, body} — was being stringified as [object Object]
            const name = tpl.name || tpl.body || String(tpl);
            const body = tpl.body || tpl.name || String(tpl);

            const box = document.createElement("div");
            box.className = "template-box";
            box.textContent = name;
            box.draggable = true;

            /* Delete */
            const del = document.createElement("span");
            del.className = "template-delete";
            del.textContent = "🗑";

            del.addEventListener("click", async (e) => {
                e.stopPropagation();
                templates.splice(index, 1);
                await persist();
            });

            /* Insert */
            box.addEventListener("click", () => {
                chrome.runtime.sendMessage({
                    type: "INSERT_TEMPLATE",
                    body
                });
            });

            /* Drag */
            box.addEventListener("dragstart", (e) => {
                e.dataTransfer.setData("index", index.toString());
            });

            box.addEventListener("dragover", (e) => {
                e.preventDefault();
            });

            box.addEventListener("drop", async (e) => {
                e.preventDefault();
                const from = Number(e.dataTransfer.getData("index"));
                const to = index;
                if (from === to) return;

                const moved = templates.splice(from, 1)[0];
                templates.splice(to, 0, moved);
                await persist();
            });

            box.appendChild(del);
            list.appendChild(box);
        });
    }

    async function persist() {
        await setStorage({ templates });
        render();
    }

    /* Load */
    getStorage(["templates"]).then((res) => {
        templates = Array.isArray(res.templates) ? res.templates : [];
        render();
    });

    /* Open Add */
    addBtn.addEventListener("click", () => {
        addBtn.style.display = "none";
        addWrap.style.display = "block";
        input.focus();
    });

    /* Cancel */
    cancelBtn.addEventListener("click", () => {
        input.value = "";
        addWrap.style.display = "none";
        addBtn.style.display = "block";
    });

    /* Save — store as object with name + body so it's consistent */
    saveBtn.addEventListener("click", async () => {
        const val = input.value.trim();
        if (!val) return;

        templates.unshift({ id: Date.now().toString(), name: val, body: val });
        await persist();

        input.value = "";
        addWrap.style.display = "none";
        addBtn.style.display = "block";
    });
}

/* =====================================================
   DASHBOARD / METRICS / QUICK ACTIONS
===================================================== */

function initDashboard() {
    const emailsProcessedEl = document.getElementById("metricEmailsProcessed");
    const autoHandledEl = document.getElementById("metricAutoHandled");
    const weekReceivedEl = document.getElementById("metricWeekReceived");
    const weekSentEl = document.getElementById("metricWeekSent");
    const spamEl = document.getElementById("metricSpam");
    const trashEl = document.getElementById("metricTrash");
    const statusEl = document.getElementById("dashboardStatus");
    const aiBodyEl = document.getElementById("aiSummaryBody");
    const aiStatusEl = document.getElementById("aiSummaryStatus");
    const connectedEmailEl = document.getElementById("connectedEmail");
    const switchGmailBtn = document.getElementById("switchGmailBtn");

    if (!emailsProcessedEl || !autoHandledEl || !weekReceivedEl || !weekSentEl || !spamEl || !trashEl) {
        return;
    }

    function setStatus(text) {
        if (statusEl) statusEl.textContent = text || "";
    }

    function formatPercent(numerator, denom) {
        if (!denom || denom <= 0) return "--";
        return Math.round((numerator / denom) * 100);
    }

    // -------------------------------------------------------
    // Everything below requires OAuth — Coming Soon.
    // The HTML overlay already blocks these visually.
    // Listeners are intentionally disabled to prevent any
    // accidental OAuth popup from firing.
    // -------------------------------------------------------
}
document.addEventListener("DOMContentLoaded", () => {
    initApiKeyUI();
    initToggles();
    initTemplates();
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
===================================================== */

function initToggles() {
    const toggleIds = [
        "toggleSummarize",
        "toggleCategorize",
        "toggleSpam"
    ];

    getStorage(toggleIds).then((data) => {
        toggleIds.forEach((id) => {
            const el = document.getElementById(id);
            if (el && data[id] !== undefined) {
                el.checked = data[id];
            }
        });
    });

    toggleIds.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;

        el.addEventListener("change", async () => {
            await setStorage({ [id]: el.checked });
        });
    });
}

/* =====================================================
   TEMPLATE SYSTEM
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

        templates.forEach((text, index) => {
            const box = document.createElement("div");
            box.className = "template-box";
            box.textContent = text;
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
                    text
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

    /* Save */
    saveBtn.addEventListener("click", async () => {
        const val = input.value.trim();
        if (!val) return;

        templates.unshift(val);
        await persist();

        input.value = "";
        addWrap.style.display = "none";
        addBtn.style.display = "block";
    });
}
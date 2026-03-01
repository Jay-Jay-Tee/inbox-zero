document.addEventListener("DOMContentLoaded", () => {

    /* ---------------- API KEY UI ---------------- */

    const wrap = document.getElementById("wrap");
    const apiInput = document.getElementById("apiInput");
    const saveKeyBtn = document.getElementById("saveKey");
    const keyDisplay = document.getElementById("keyDisplay");

    const keyContainer = document.getElementById("keyContainer");

    keyContainer.addEventListener("click", () => {
        wrap.style.display = "flex";
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
            return;
        }

        const masked =
            key.slice(0, 4) +
            " •••••••• " +
            key.slice(-4);

        keyDisplay.textContent = masked;
        keyDisplay.style.color = "#4ade80";
    }

    if (saveKeyBtn) {
        saveKeyBtn.onclick = () => {
            const key = apiInput.value.trim();
            if (!key) return;

            chrome.storage.sync.set({ apiKey: key }, () => {
                showKey(key);
                apiInput.value = "";
                wrap.style.display = "none";
                btn.style.display = "block";
            });
        };
    }

    chrome.storage.sync.get(["apiKey"], res => {
        if (res.apiKey) showKey(res.apiKey);
    });



    /* ---------------- TOGGLE PERSISTENCE ---------------- */

    const toggles = [
        "toggleSummarize",
        "toggleCategorize",
        "toggleSpam"
    ];

    chrome.storage.sync.get(toggles, data => {
        toggles.forEach(id => {
            const el = document.getElementById(id);
            if (el && data[id] !== undefined)
                el.checked = data[id];
        });
    });

    toggles.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;

        el.addEventListener("change", () => {
            chrome.storage.sync.set({ [id]: el.checked });
        });
    });



    /* ---------------- TEMPLATE SYSTEM ---------------- */

    const list = document.getElementById("templateList");
    const addBtn = document.getElementById("addTemplateBtn");
    const addWrap = document.getElementById("addTemplateWrap");
    const input = document.getElementById("templateInput");
    const saveBtn = document.getElementById("saveTemplate");
    const cancelBtn = document.getElementById("cancelTemplate");



    function renderTemplates(arr) {

        list.innerHTML = "";

        if (!arr || arr.length === 0) {
            list.innerHTML = '<div class="no-templates">No templates :(</div>';
            return;
        }

        arr.forEach((text, i) => {

            const box = document.createElement("div");
            box.className = "template-box";
            box.textContent = text;
            box.draggable = true;
            box.dataset.index = i;



            /* DELETE */
            const del = document.createElement("span");
            del.className = "template-delete";
            del.textContent = "🗑";

            del.onclick = (e) => {
                e.stopPropagation();
                arr.splice(i, 1);
                chrome.storage.sync.set({ templates: arr }, () => renderTemplates(arr));
            };



            /* INSERT */
            box.onclick = () => {
                chrome.runtime.sendMessage({
                    type: "INSERT_TEMPLATE",
                    text: text
                });
            };



            /* DRAG START */
            box.addEventListener("dragstart", e => {
                box.classList.add("dragging");
                e.dataTransfer.setData("index", box.dataset.index);
            });



            /* DRAG END */
            box.addEventListener("dragend", () => {
                box.classList.remove("dragging");
            });



            /* DRAG OVER */
            box.addEventListener("dragover", e => {
                e.preventDefault();
            });



            /* DROP */
            box.addEventListener("drop", e => {
                e.preventDefault();

                const from = +e.dataTransfer.getData("index");
                const to = i;

                if (from === to) return;

                const moved = arr.splice(from, 1)[0];
                arr.splice(to, 0, moved);

                chrome.storage.sync.set({ templates: arr }, () => renderTemplates(arr));
            });



            box.appendChild(del);
            list.appendChild(box);
        });
    }



    /* LOAD TEMPLATES */

    chrome.storage.sync.get(["templates"], res => {
        renderTemplates(res.templates || []);
    });



    /* OPEN ADD TEMPLATE */

    if (addBtn) {
        addBtn.onclick = () => {
            addBtn.style.display = "none";
            addWrap.style.display = "block";
            input.focus();
        };
    }



    /* CANCEL ADD */

    if (cancelBtn) {
        cancelBtn.onclick = () => {
            input.value = "";
            addWrap.style.display = "none";
            addBtn.style.display = "block";
        };
    }



    /* SAVE TEMPLATE */

    if (saveBtn) {
        saveBtn.onclick = () => {
            const val = input.value.trim();
            if (!val) return;

            chrome.storage.sync.get(["templates"], res => {
                const arr = res.templates || [];
                arr.unshift(val);

                chrome.storage.sync.set({ templates: arr }, () => {
                    renderTemplates(arr);
                    input.value = "";
                    addWrap.style.display = "none";
                    addBtn.style.display = "block";
                });
            });
        };
    }

});
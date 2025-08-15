//settings-drawer.js
import { extension_settings }     from '../../../extensions.js';

import {
    debouncePersist,
    hashPin,
    getStoredPinHash,
    saveStoredPinHash,
    getFolderCount,
    getTagCount,
    getCharacterCount,
} from './utils.js';

const MODULE_NAME = 'characterTagManager';
const defaultSettings = {
    showDefaultTagManager: true,
    showWelcomeRecentChats: true,
    showTopBarIcon: true,
    folderNavHeightMode: "auto",
    folderNavMaxHeight: 50,

    // --- Feedback Data (anonymous analytics) ---
    feedbackEnabled: false,          // master opt-in; nothing is sent unless true
    feedbackInstallId: "",           // generated once per install
    feedbackSendUserAgent: true,     // user can opt out of each item below (id always included)
    feedbackSendFolderCount: true,
    feedbackSendTagCount: true,
    feedbackSendCharacterCount: true,
    feedbackApiUrl: ""               // e.g. "https://your.api.example/feedback" (leave blank to disable sending)
};

function ensureFeedbackInstallId(settings) {
    if (!settings.feedbackInstallId) {
        // RFC4122-ish v4 using crypto
        const buf = new Uint8Array(16);
        crypto.getRandomValues(buf);
        buf[6] = (buf[6] & 0x0f) | 0x40;
        buf[8] = (buf[8] & 0x3f) | 0x80;
        const hex = [...buf].map(b => b.toString(16).padStart(2, '0'));
        settings.feedbackInstallId = [
            hex.slice(0,4).join(''),
            hex.slice(4,6).join(''),
            hex.slice(6,8).join(''),
            hex.slice(8,10).join(''),
            hex.slice(10,16).join('')
        ].join('-');
    }
}

function getSettings() {
    if (!extension_settings[MODULE_NAME]) extension_settings[MODULE_NAME] = structuredClone(defaultSettings);
    for (const key in defaultSettings) {
        if (extension_settings[MODULE_NAME][key] === undefined) extension_settings[MODULE_NAME][key] = defaultSettings[key];
    }
    // NEW: guarantee a per-install random ID
    ensureFeedbackInstallId(extension_settings[MODULE_NAME]);
    return extension_settings[MODULE_NAME];
}

function createStcmSettingsPanel() {
    const panel = document.createElement('div');
    panel.id = 'stcm-settings-panel';
    panel.className = 'extension_container stcm-settings-container';
    panel.style = 'margin-top: 16px; margin-bottom: 8px;';
    panel.innerHTML = `
        <div class="inline-drawer stcm-settings-drawer" style="background: var(--ac-style-color-background, #24272a); border-radius: 8px; box-shadow: 0 2px 12px #0001;">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>
                    <i class="fa-solid fa-tags" style="margin-right:6px"></i>
                    Character/Tag Manager
                </b>
                <div class="inline-drawer-icon fa-solid interactable down fa-circle-chevron-down" tabindex="0"></div>
            </div>
            <div class="inline-drawer-content" style="display: none;">
                <label style="display:flex;align-items:center;gap:8px;margin-top:5px;">
                    <input type="checkbox" id="stcm--showTopBarIcon"/>
                    <span>Show Character / Tag Manager Icon in Top Bar</span>
                </label>
                <label style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" id="stcm--showDefaultTagManager"/>
                    <span>Show ST Default Tag Manager</span>
                </label>
                <label style="display:flex;align-items:center;gap:8px;margin-top:5px;">
                    <input type="checkbox" id="stcm--showWelcomeRecentChats"/>
                    <span>Show Welcome Screen Recent Chats</span>
                </label>
                <hr>
                <div style="margin-left: 10px;">
                    <label>
                     <span style="text-wrap:nowrap;">Folder Panel Height Mode</span>
                        <select id="stcm--folderNavHeightMode" style="min-width: 160px;">
                            <option value="auto">Auto Height (default)</option>
                            <option value="custom">Custom Max Height</option>
                        </select>
                       
                    </label>
                    <div id="stcm--customFolderHeightRow" style="margin-left:30px;margin-top:4px;display:none;">
                        <label>
                            Max Height:
                            <input id="stcm--folderNavMaxHeight" class="menu_input" type="number" min="10" max="90" step="1" style="width:60px;">
                            % of window height
                        </label>
                    </div>
                </div>

                <hr>
                <div style="margin-left: 10px;">
                <span style="text-wrap:nowrap;">Private Folder Pin</span>
                <div id="stcm-pin-form" class="stcm-pin-form" style="margin-top: 10px;">
                    <div id="stcm-pin-current-row" style="display:none;">
                        <label>Current PIN:</label>
                        <input type="password" id="stcm-pin-current" class="menu_input">
                    </div>
                    <div id="stcm-pin-new-row">
                        <label>New PIN:</label>
                        <input type="password" id="stcm-pin-new" class="menu_input">
                    </div>
                    <div id="stcm-pin-confirm-row">
                        <label>Confirm New PIN:</label>
                        <input type="password" id="stcm-pin-confirm" class="menu_input">
                    </div>
                    <div style="margin-top: 8px;">
                        <button id="stcm-set-pin-btn" class="stcm_menu_button green small">Set PIN</button>
                        <button id="stcm-remove-pin-btn" class="stcm_menu_button red small" style="display:none;">Remove PIN</button>
                    </div>
                    <div id="stcm-pin-msg" style="margin-top: 8px; color: #f87;"></div>
                </div>
                </div>
                <hr>
                <div style="margin-left:10px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                        <input type="checkbox" id="stcm--feedbackEnabled">
                        <span><b>Share Anonymous Feedback Data</b> (opt‑in)</span>
                    </div>

                    <div id="stcm--feedbackOptions" style="margin-left:26px;">
                        <div style="margin:6px 0;">
                            <div style="font-size:12px;opacity:.8;margin-bottom:6px;">
                                A unique random ID identifies this install. You can opt out of every item below (the ID is always included when sending).
                            </div>
                            <div style="font-family:monospace;font-size:12px;background:#0003;padding:6px 8px;border-radius:6px;display:inline-block;">
                                Install ID: <span id="stcm--installIdPreview"></span>
                            </div>
                        </div>

                        <label style="display:flex;align-items:center;gap:8px;margin:4px 0;">
                            <input type="checkbox" id="stcm--feedbackSendUserAgent">
                            <span>Include UserAgent (browser info)</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:8px;margin:4px 0;">
                            <input type="checkbox" id="stcm--feedbackSendFolderCount">
                            <span>Include # of Folders</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:8px;margin:4px 0;">
                            <input type="checkbox" id="stcm--feedbackSendTagCount">
                            <span>Include # of Tags</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:8px;margin:4px 0;">
                            <input type="checkbox" id="stcm--feedbackSendCharacterCount">
                            <span>Include # of Characters</span>
                        </label>

                        <div style="display:flex;align-items:center;gap:8px;margin-top:10px;">
                            <button id="stcm--feedbackPreviewBtn" class="stcm_menu_button small">Preview Data</button>
                            <button id="stcm--feedbackSendBtn" class="stcm_menu_button green small">Send Now</button>
                            <input id="stcm--feedbackApiUrl" class="menu_input" placeholder="Feedback API URL" style="min-width:320px;">
                        </div>

                        <div id="stcm--feedbackPreviewWrap" style="display:none;margin-top:8px;">
                            <div style="font-size:12px;opacity:.8;margin-bottom:4px;">Preview of exactly what will be sent:</div>
                            <pre id="stcm--feedbackPreview" style="max-width:100%;overflow:auto;background:#0003;padding:8px;border-radius:6px;"></pre>
                            <button id="stcm--copyPreviewBtn" class="stcm_menu_button small">Copy JSON</button>
                        </div>

                        <div id="stcm--feedbackMsg" style="margin-top:8px;color:#f87;"></div>
                    </div>
                </div>
 <hr>
            </div>
        </div>
    `;

    // Checkbox logic

    const checkboxBlur = panel.querySelector('#stcm--blurPrivatePreviews');
    if (checkboxBlur) {
        checkboxBlur.checked = getSettings().blurPrivatePreviews;
        checkboxBlur.addEventListener('change', (e) => {
            getSettings().blurPrivatePreviews = e.target.checked;
            saveSettingsDebounced();
            updateBlurPrivatePreviews(e.target.checked);
        });
    }


    const checkboxTag = panel.querySelector('#stcm--showDefaultTagManager');
    if (checkboxTag) {
        checkboxTag.checked = getSettings().showDefaultTagManager;
        checkboxTag.addEventListener('change', e => {
            getSettings().showDefaultTagManager = e.target.checked;
            debouncePersist();                    
            updateDefaultTagManagerVisibility(e.target.checked);
        });
    }

    const checkboxRecent = panel.querySelector('#stcm--showWelcomeRecentChats');
    if (checkboxRecent) {
        checkboxRecent.checked = getSettings().showWelcomeRecentChats;
        checkboxRecent.addEventListener('change', e => {
            getSettings().showWelcomeRecentChats = e.target.checked;
            debouncePersist();                  
            updateRecentChatsVisibility(e.target.checked);
        });
    }

    const checkboxTopBarIcon = panel.querySelector('#stcm--showTopBarIcon');
    if (checkboxTopBarIcon) {
        checkboxTopBarIcon.checked = getSettings().showTopBarIcon;
        checkboxTopBarIcon.addEventListener('change', e => {
            getSettings().showTopBarIcon = e.target.checked;
            debouncePersist();                   
            updateTopBarIconVisibility(e.target.checked);
        });
    }

    // --- PIN/PASSWORD MANAGEMENT ---
    const pinForm = panel.querySelector("#stcm-pin-form");
    const pinCurrentRow = pinForm.querySelector("#stcm-pin-current-row");
    const pinNew = pinForm.querySelector("#stcm-pin-new");
    const pinNewRow = pinForm.querySelector("#stcm-pin-new-row");
    const pinConfirm = pinForm.querySelector("#stcm-pin-confirm");
    const pinConfirmRow = pinForm.querySelector("#stcm-pin-confirm-row");
    const setBtn = pinForm.querySelector("#stcm-set-pin-btn");
    const removeBtn = pinForm.querySelector("#stcm-remove-pin-btn");
    const msg = pinForm.querySelector("#stcm-pin-msg");

    function updatePinFormUi() {
        const currentPinHash = getStoredPinHash();
        const hasPin = !!currentPinHash;
    
        pinCurrentRow.style.display = hasPin ? "" : "none";
        removeBtn.style.display = hasPin ? "" : "none";
        setBtn.textContent = hasPin ? "Change PIN" : "Set PIN";
        pinNewRow.style.display = "";
        pinConfirmRow.style.display = "";
        msg.textContent = "";
    }
    
    // Initial UI update
    updatePinFormUi();

    setBtn.onclick = async () => {
        const currentPinHash = getStoredPinHash();
    
        // ── verify the current PIN if one is already set ──────────────────────
        if (currentPinHash) {
            const enteredCurrentHash = await hashPin(
                pinForm.querySelector('#stcm-pin-current').value
            );
            if (enteredCurrentHash !== currentPinHash) {
                msg.textContent = 'Current PIN is incorrect.';
                return;
            }
        }
    
        // ── validate the new PIN inputs ───────────────────────────────────────
        if (!pinNew.value || pinNew.value !== pinConfirm.value) {
            msg.textContent = 'New PINs must match and not be empty.';
            return;
        }
    
        // ── save to extensionSettings and flush ───────────────────────────────
        saveStoredPinHash(await hashPin(pinNew.value));
        debouncePersist();          // writes extensionSettings via utils.js
    
        sessionStorage.removeItem('stcm_pin_okay');
        msg.textContent = currentPinHash ? 'PIN updated!' : 'PIN set!';
        pinForm.querySelector('#stcm-pin-current').value = '';
        pinNew.value = pinConfirm.value = '';
        updatePinFormUi();
    };
    
    removeBtn.onclick = async () => {
        const currentPinHash = getStoredPinHash();
        if (!currentPinHash) {
            msg.textContent = 'No PIN is set.';
            return;
        }
    
        const enteredCurrentHash = await hashPin(
            pinForm.querySelector('#stcm-pin-current').value
        );
        if (enteredCurrentHash !== currentPinHash) {
            msg.textContent = 'Current PIN is incorrect.';
            return;
        }
    
        saveStoredPinHash('');      // clears the hash in extensionSettings
        debouncePersist();          // flush change to disk
    
        sessionStorage.removeItem('stcm_pin_okay');
        msg.textContent = 'PIN removed!';
        pinForm.querySelector('#stcm-pin-current').value = '';
        pinNew.value = pinConfirm.value = '';
        updatePinFormUi();
    };



    const settings = getSettings();
    const modeSelect = panel.querySelector('#stcm--folderNavHeightMode');
    const maxHeightInput = panel.querySelector('#stcm--folderNavMaxHeight');
    const customRow = panel.querySelector('#stcm--customFolderHeightRow');

    // Clamp value on load
    maxHeightInput.value = Math.max(10, Math.min(90, settings.folderNavMaxHeight || 50));
    modeSelect.value = settings.folderNavHeightMode || "auto";
    customRow.style.display = (modeSelect.value === "custom") ? "" : "none";

    modeSelect.addEventListener('change', e => {
        settings.folderNavHeightMode = modeSelect.value;
        debouncePersist();
        customRow.style.display = (modeSelect.value === "custom") ? "" : "none";
        applyFolderNavHeightMode();
    });

    maxHeightInput.addEventListener('change', e => {
        let val = parseInt(maxHeightInput.value, 10);
        if (isNaN(val) || val < 10) val = 10;
        if (val > 90) val = 90;
        settings.folderNavMaxHeight = val;
        maxHeightInput.value = val;
        debouncePersist();
        applyFolderNavHeightMode();
    });
    
    maxHeightInput.addEventListener('input', e => {
        // Optional: live preview (no clamping)
        let val = parseInt(maxHeightInput.value, 10);
        if (!isNaN(val)) {
            settings.folderNavMaxHeight = val;
            applyFolderNavHeightMode();
        }
    });

    // ---- Feedback Data wiring ----
const s = getSettings();

const feEnabled = panel.querySelector('#stcm--feedbackEnabled');
const feUA = panel.querySelector('#stcm--feedbackSendUserAgent');
const feFolders = panel.querySelector('#stcm--feedbackSendFolderCount');
const feTags = panel.querySelector('#stcm--feedbackSendTagCount');
const feChars = panel.querySelector('#stcm--feedbackSendCharacterCount');
const feApiUrl = panel.querySelector('#stcm--feedbackApiUrl');
const feOptions = panel.querySelector('#stcm--feedbackOptions');
const feInstallIdPreview = panel.querySelector('#stcm--installIdPreview');
const fePreviewBtn = panel.querySelector('#stcm--feedbackPreviewBtn');
const feSendBtn = panel.querySelector('#stcm--feedbackSendBtn');
const fePreviewWrap = panel.querySelector('#stcm--feedbackPreviewWrap');
const fePreview = panel.querySelector('#stcm--feedbackPreview');
const feCopyBtn = panel.querySelector('#stcm--copyPreviewBtn');
const feMsg = panel.querySelector('#stcm--feedbackMsg');

feEnabled.checked = !!s.feedbackEnabled;
feUA.checked = !!s.feedbackSendUserAgent;
feFolders.checked = !!s.feedbackSendFolderCount;
feTags.checked = !!s.feedbackSendTagCount;
feChars.checked = !!s.feedbackSendCharacterCount;
feApiUrl.value = s.feedbackApiUrl || "";
feInstallIdPreview.textContent = s.feedbackInstallId;

function updateFeedbackEnabledUI() {
    feOptions.style.opacity = feEnabled.checked ? "1" : ".6";
    feOptions.style.pointerEvents = feEnabled.checked ? "auto" : "none";
}
updateFeedbackEnabledUI();

feEnabled.addEventListener('change', () => {
    s.feedbackEnabled = feEnabled.checked;
    debouncePersist();
    updateFeedbackEnabledUI();
});

[feUA, feFolders, feTags, feChars].forEach(cb => {
    cb.addEventListener('change', () => {
        s.feedbackSendUserAgent = feUA.checked;
        s.feedbackSendFolderCount = feFolders.checked;
        s.feedbackSendTagCount = feTags.checked;
        s.feedbackSendCharacterCount = feChars.checked;
        debouncePersist();
    });
});

feApiUrl.addEventListener('change', () => {
    s.feedbackApiUrl = feApiUrl.value.trim();
    debouncePersist();
});

fePreviewBtn.addEventListener('click', async () => {
    feMsg.textContent = "";
    const data = await buildFeedbackPayload();
    fePreview.textContent = JSON.stringify(data, null, 2);
    fePreviewWrap.style.display = "";
});

feCopyBtn.addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(fePreview.textContent);
        feMsg.style.color = '#7f7';
        feMsg.textContent = 'Copied preview JSON to clipboard.';
    } catch {
        feMsg.style.color = '#f87';
        feMsg.textContent = 'Could not copy to clipboard.';
    }
});

function isHttpsUrl(u) { try { const x = new URL(u); return x.protocol === 'https:'; } catch { return false; } }

feSendBtn.addEventListener('click', async () => {
    feMsg.style.color = '#f87'; feMsg.textContent = "";
    if (!s.feedbackEnabled) return feMsg.textContent = 'Please enable “Share Anonymous Feedback Data” first.';
    if (!s.feedbackApiUrl)   return feMsg.textContent = 'Please enter a Feedback API URL.';
    if (!isHttpsUrl(s.feedbackApiUrl)) return feMsg.textContent = 'Feedback API URL must be HTTPS.';

    try {
        const payload = await buildFeedbackPayload();
        fePreview.textContent = JSON.stringify(payload, null, 2);
        fePreviewWrap.style.display = "";

        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 10000); // 10s
        const res = await fetch(s.feedbackApiUrl, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload),
            signal: ctrl.signal
        });
        clearTimeout(t);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        feMsg.style.color = '#7f7'; feMsg.textContent = 'Feedback data sent successfully.';
    } catch (e) {
        feMsg.style.color = '#f87';
        feMsg.textContent = `Send failed: ${e?.name === 'AbortError' ? 'request timed out' : e?.message || e}`;
    }
});




    // END SETTINGS SECTION
    return panel;
}


export function injectStcmSettingsPanel() {
    const container = document.getElementById('extensions_settings');
    if (!container) return;
    if (document.getElementById('stcm-settings-panel')) return;
    const panel = createStcmSettingsPanel();
    container.appendChild(panel);

    // Set initial Tag Manager button visibility
    updateDefaultTagManagerVisibility(getSettings().showDefaultTagManager);
    updateRecentChatsVisibility(getSettings().showWelcomeRecentChats);
    updateTopBarIconVisibility(getSettings().showTopBarIcon);
    applyFolderNavHeightMode();
}

export function updateDefaultTagManagerVisibility(isVisible = true) {
    const controls = document.querySelectorAll('.rm_tag_controls');
    controls.forEach(ctrl => {
        const showTagList = ctrl.querySelector('.manageTags');
        if (showTagList) {
            showTagList.style.display = isVisible ? '' : 'none';
        }
    });
}

export function updateRecentChatsVisibility(isVisible = true) {
    injectHideRecentChatsCSS(); // Ensure CSS is injected only once
    document.body.classList.toggle('stcm-hide-recent-chats', !isVisible);
}

function injectHideRecentChatsCSS() {
    if (document.getElementById('stcm-hide-recent-chats-style')) return;
    const style = document.createElement('style');
    style.id = 'stcm-hide-recent-chats-style';
    style.textContent = `
        body.stcm-hide-recent-chats .welcomeRecent,
        body.stcm-hide-recent-chats .welcomeRecent *,
        body.stcm-hide-recent-chats .recentChatsTitle,
        body.stcm-hide-recent-chats .showRecentChats,
        body.stcm-hide-recent-chats .hideRecentChats {
            display: none !important;
        }
    `;
    document.head.appendChild(style);
}


export function updateTopBarIconVisibility(isVisible = true) {
    // Adjust your selector if the ID/class is different in your implementation!
    const icon = document.getElementById('characterTagManagerToggle');
    if (icon) icon.style.display = isVisible ? '' : 'none';
}

function applyFolderNavHeightMode() {
    // Remove any existing style tag
    let style = document.getElementById('stcm-folder-nav-style');
    if (!style) {
        style = document.createElement('style');
        style.id = 'stcm-folder-nav-style';
        document.head.appendChild(style);
    }
    const settings = getSettings();
    if (settings.folderNavHeightMode === 'custom') {
        style.textContent = `
#stcm_sidebar_folder_nav {
    max-height: ${settings.folderNavMaxHeight}vh;
    min-height: ${settings.folderNavMaxHeight}vh;
    overflow-y: auto;
}
`;
    } else {
        // Reset to auto/default
        style.textContent = `
#stcm_sidebar_folder_nav,
#rm_print_characters_block,
#rm_characters_block,
#right-nav-panel.drawer-content > .scrollableInner {
    overflow-y: visible;
    height: auto;
    max-height: none;
}
nav#right-nav-panel.drawer-content {
    overflow-y: auto;
    height: 100%;
}
div#rightNavHolder.drawer {
    overflow: hidden;
}
`;
    }
}

async function buildFeedbackPayload() {
    const s = getSettings();
    const data = {
        id: s.feedbackInstallId,
        ts: new Date().toISOString(),
        appVersion: (window.STCM_VERSION || 'unknown'),
    };

    if (s.feedbackSendUserAgent)      data.userAgent     = navigator.userAgent;
    if (s.feedbackSendFolderCount)    data.folderCount   = getFolderCount();     // canonical
    if (s.feedbackSendTagCount)       data.tagCount      = getTagCount();        // canonical
    if (s.feedbackSendCharacterCount) data.characterCount= getCharacterCount();  // canonical

    return data;
}



/**
 * The exact sources for counts depend on your app state.
 * These “Safe” versions try DOM first, then fall back to 0.
 * If you already have in‑memory data (e.g. arrays of folders/tags/characters),
 * replace these with your canonical sources.
 */
async function getFolderCountSafe() {
    // Example DOM heuristic: sidebar folder nav entries
    const el = document.querySelectorAll('#stcm_sidebar_folder_nav .folder-item, #stcm_sidebar_folder_nav [data-folder]');
    if (el && el.length) return el.length;

    // Fallbacks (replace with your real data source)
    return 0;
}

async function getTagCountSafe() {
    // Example DOM heuristic: any tag chips inside character rows / tag manager
    const chips = document.querySelectorAll('.tag, .rm_tag, .stcm-tag-chip, .manageTags .tag');
    if (chips && chips.length) {
        // Count unique tag names if duplicates are rendered multiple times
        const names = new Set([...chips].map(n => (n.textContent || '').trim().toLowerCase()).filter(Boolean));
        return names.size || chips.length;
    }
    return 0;
}

async function getCharacterCountSafe() {
    // Example DOM heuristic: character cards in the list
    const cards = document.querySelectorAll('#rm_print_characters_block .character_select, #rm_characters_block .character_select, .character-card, .rm_character_block');
    if (cards && cards.length) return cards.length;
    return 0;
}

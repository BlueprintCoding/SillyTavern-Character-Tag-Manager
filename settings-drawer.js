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

import { CLIENT_VERSION } from "../../../../script.js";

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
    feedbackSendAppVersion: true,   // allow opting out of appVersion
    feedbackSendFolderCount: true,
    feedbackSendTagCount: true,
    feedbackSendCharacterCount: true,
    feedbackLastSentISO: ""    // NEW: track last successful send              
};

const FEEDBACK_DEFAULT_API_URL =
  "https://aicharactercards.com/wp-json/aicc_extension-feedback/v1/submit";

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
                    </div> <!-- #stcm-pin-form -->
                </div> <!-- PIN wrapper -->

                <hr>
                <div style="margin-left:10px;"> <!-- FEEDBACK wrapper -->
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                        <input type="checkbox" id="stcm--feedbackEnabled">
                        <span><b>Share Anonymous Feedback Data</b> (opt‑in)</span>
                        <span style="font-size:10px;opacity:.8;">This data helps us understand how many people are actively using the extension, since GitHub doesn’t track installs. It also lets us debug issues across different SillyTavern versions and environments.Finally, knowing tag, character, and folder counts helps us troubleshoot performance and scaling problems for users with large libraries.</span>
                    </div>

                    <div id="stcm--feedbackOptions" style="display:none; margin-left:26px;">
                        <div style="margin:6px 0;">
                        
                            <div style="font-size:12px;opacity:.8;margin-bottom:6px;">
                                A unique random ID identifies this install. You can opt out of every item below (the ID is always included when sending).
                            </div>
                            <div style="font-family:monospace;font-size:12px;background:#0003;padding:6px 8px;border-radius:6px;display:inline-block;">
                                Install ID: <span id="stcm--installIdPreview"></span>
                            </div>
                        </div>
                        <label style="display:flex;align-items:center;gap:8px;margin:4px 0;">
                            <input type="checkbox" id="stcm--feedbackSendAppVersion">
                            <span>Include SillyTavern Version</span>
                        </label>
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
                        </div>

                        <div id="stcm--feedbackPreviewWrap" style="display:none;margin-top:8px;">
                            <div style="font-size:12px;opacity:.8;margin-bottom:4px;">Preview of exactly what will be sent:</div>
                            <pre id="stcm--feedbackPreview" style="max-width:100%;overflow:auto;background:#0003;padding:8px;border-radius:6px;"></pre>
                        </div>

                        <div id="stcm--feedbackMsg" style="margin-top:8px;color:#f87;"></div>
                    </div> <!-- #stcm--feedbackOptions -->
                </div> <!-- FEEDBACK wrapper -->

                <hr>
            </div> <!-- .inline-drawer-content -->
        </div> <!-- .inline-drawer -->
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
// ---- Feedback Data wiring ----
const s = getSettings();

const feEnabled = panel.querySelector('#stcm--feedbackEnabled');
const feUA = panel.querySelector('#stcm--feedbackSendUserAgent');
const feAppVer = panel.querySelector('#stcm--feedbackSendAppVersion');
const feFolders = panel.querySelector('#stcm--feedbackSendFolderCount');
const feTags = panel.querySelector('#stcm--feedbackSendTagCount');
const feChars = panel.querySelector('#stcm--feedbackSendCharacterCount');
const feOptions = panel.querySelector('#stcm--feedbackOptions');
const feInstallIdPreview = panel.querySelector('#stcm--installIdPreview');
const fePreviewBtn = panel.querySelector('#stcm--feedbackPreviewBtn');
const fePreviewWrap = panel.querySelector('#stcm--feedbackPreviewWrap');
const fePreview = panel.querySelector('#stcm--feedbackPreview');
const feMsg = panel.querySelector('#stcm--feedbackMsg');

feEnabled.checked = !!s.feedbackEnabled;
feAppVer.checked = !!s.feedbackSendAppVersion;
feUA.checked = !!s.feedbackSendUserAgent;
feFolders.checked = !!s.feedbackSendFolderCount;
feTags.checked = !!s.feedbackSendTagCount;
feChars.checked = !!s.feedbackSendCharacterCount;
feInstallIdPreview.textContent = s.feedbackInstallId;

function updateFeedbackEnabledUI() {
    const visible = feEnabled.checked === true;

    // Hide/show the entire options block
    feOptions.style.display = visible ? "" : "none";

    // Hide/show the Preview button
    if (fePreviewBtn) fePreviewBtn.style.display = visible ? "" : "none";

    // When hidden, also collapse any open preview + clear message
    if (!visible) {
        if (fePreviewWrap) fePreviewWrap.style.display = "none";
        if (feMsg) feMsg.textContent = "";
    }
}

// Initial state (keeps everything hidden by default since feedbackEnabled=false)
updateFeedbackEnabledUI();

feEnabled.addEventListener('change', () => {
    s.feedbackEnabled = feEnabled.checked;
    debouncePersist();
    updateFeedbackEnabledUI();

    // If user just opted in, try to send now if due
    if (s.feedbackEnabled) {
        STCM_feedbackSendIfDue('toggle_on'); // it already guards shouldSendToday(), url, etc.
    }

});

[feUA, feAppVer, feFolders, feTags, feChars].forEach(cb => {
    cb.addEventListener('change', () => {
        s.feedbackSendUserAgent   = feUA.checked;
        s.feedbackSendAppVersion  = feAppVer.checked;         
        s.feedbackSendFolderCount = feFolders.checked;
        s.feedbackSendTagCount    = feTags.checked;
        s.feedbackSendCharacterCount = feChars.checked;
        debouncePersist();
    });
});

fePreviewBtn.addEventListener('click', async () => {
    feMsg.textContent = "";
    const data = await buildFeedbackPayload();
    fePreview.textContent = JSON.stringify(data, null, 2);
    fePreviewWrap.style.display = "";
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

function buildFeedbackPayload() {
    const s = getSettings();
    // Always include all required keys:
    const payload = {
      id: s.feedbackInstallId,
      ts: new Date().toISOString(),                 // has .mmmZ
      appVersion: s.feedbackSendAppVersion
        ? (typeof CLIENT_VERSION !== 'undefined'
            ? CLIENT_VERSION
            : (window.CLIENT_VERSION || ''))
        : '',                                       // empty when opted out
      userAgent: s.feedbackSendUserAgent ? navigator.userAgent : '',
      folderCount: s.feedbackSendFolderCount ? Number(getFolderCount()) : 0,
      tagCount: s.feedbackSendTagCount ? Number(getTagCount()) : 0,
      characterCount: s.feedbackSendCharacterCount ? Number(getCharacterCount()) : 0,
    };
  
    // Ensure ints (server requires JSON numbers, not strings)
    ['folderCount','tagCount','characterCount'].forEach(k => {
      payload[k] = Number.isFinite(payload[k]) ? Math.max(0, Math.trunc(payload[k])) : 0;
    });
  
    return payload;
  }



function shouldSendToday() {
  const s = getSettings();
  if (!s.feedbackLastSentISO) return true;
  const last = Date.parse(s.feedbackLastSentISO);
  if (Number.isNaN(last)) return true;
  return (Date.now() - last) >= 24 * 60 * 60 * 1000;
}

export async function STCM_feedbackSendIfDue(reason = 'app_ready') {
  const s = getSettings();
  const url = FEEDBACK_DEFAULT_API_URL; // <-- use constant
  const https = /^https:\/\//i.test(url);

//   console.log('[FEEDBACK] check', {
//     enabled: s.feedbackEnabled,
//     url,
//     https,
//     last: s.feedbackLastSentISO,
//     should: shouldSendToday(),
//     reason
//   });

  if (!s.feedbackEnabled) return;
  if (!https) return;
  if (!shouldSendToday()) return;

  await sendFeedbackNow(reason);
}

// expose for global callers
if (typeof window !== 'undefined') {
  window.STCM_feedbackSendIfDue = STCM_feedbackSendIfDue;
}

async function sendFeedbackNow(/* reason = 'auto' */) {
    const s = getSettings();
    const url = FEEDBACK_DEFAULT_API_URL;
  
    if (!s.feedbackEnabled) {
        // console.log('[FEEDBACK] skip: disabled'); 
        return; }
    if (!/^https:\/\//i.test(url)) { 
        // console.log('[FEEDBACK] skip: URL not HTTPS');
         return; }
  
    try {
      const payload = buildFeedbackPayload();
   console.log('[FEEDBACK] sending', payload);   // log reason separately if you want
  
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),              // <-- no extra fields
        signal: ctrl.signal
      });
      clearTimeout(t);
  
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
  
      s.feedbackLastSentISO = new Date().toISOString();
   console.log('[FEEDBACK] sent OK at', s.feedbackLastSentISO);
      debouncePersist();
    } catch (e) {
       console.warn('[FEEDBACK] send failed', e);
    }
  }

  /** Admin-only helper: clear the "last sent" timestamp so the next call will send */
export function STCM_feedbackClearLastSent() {
    const s = getSettings();
    s.feedbackLastSentISO = "";
    debouncePersist();
    console.log("[FEEDBACK] lastSent cleared. Next STCM_feedbackSendIfDue() will send.");
  }
  
  /** (Optional) Admin helper: send right now, regardless of lastSent */
  export async function STCM_feedbackSendNow() {
    // bypass shouldSendToday(), but still respects enabled + https checks
    const s = getSettings();
    if (!s.feedbackEnabled) return console.log("[FEEDBACK] skip: disabled");
    if (!/^https:\/\//i.test(FEEDBACK_DEFAULT_API_URL)) return console.log("[FEEDBACK] skip: bad URL");
    await sendFeedbackNow("manual");
    console.log("[FEEDBACK] manual send attempted");
  }

  if (typeof window !== "undefined") {
    window.STCM_feedbackClearLastSent = STCM_feedbackClearLastSent;
    window.STCM_feedbackSendNow = STCM_feedbackSendNow; // optional
  }
  
  
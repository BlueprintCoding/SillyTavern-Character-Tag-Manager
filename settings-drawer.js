//settings-drawer.js
import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
// index.js
import { 
    debouncePersist, 
    hashPin,
    getStoredPinHash,
    saveStoredPinHash,
    persistPinToFile,
    restorePinFromFile,
    } from './utils.js';


const MODULE_NAME = 'characterTagManager';
const defaultSettings = {
    showDefaultTagManager: true,
    showWelcomeRecentChats: true,
    showTopBarIcon: true,
    // blurPrivatePreviews: false
};


function getSettings() {
    if (!extension_settings[MODULE_NAME]) extension_settings[MODULE_NAME] = structuredClone(defaultSettings);
    for (const key in defaultSettings) {
        if (extension_settings[MODULE_NAME][key] === undefined) extension_settings[MODULE_NAME][key] = defaultSettings[key];
    }
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
                <hr style="margin: 10px 0;">
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
        checkboxTag.addEventListener('change', (e) => {
            getSettings().showDefaultTagManager = e.target.checked;
            saveSettingsDebounced();
            updateDefaultTagManagerVisibility(e.target.checked);
        });
    }

    const checkboxRecent = panel.querySelector('#stcm--showWelcomeRecentChats');
    if (checkboxRecent) {
        checkboxRecent.checked = getSettings().showWelcomeRecentChats;
        checkboxRecent.addEventListener('change', (e) => {
            getSettings().showWelcomeRecentChats = e.target.checked;
            saveSettingsDebounced();
            updateRecentChatsVisibility(e.target.checked);
        });
    }

    const checkboxTopBarIcon = panel.querySelector('#stcm--showTopBarIcon');
    if (checkboxTopBarIcon) {
        checkboxTopBarIcon.checked = getSettings().showTopBarIcon;
        checkboxTopBarIcon.addEventListener('change', (e) => {
            getSettings().showTopBarIcon = e.target.checked;
            saveSettingsDebounced();
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

    setBtn.onclick = async function() {
        const currentPinHash = getStoredPinHash();
        // Validate current PIN if set
        if (currentPinHash) {
            const enteredCurrentHash = await hashPin(pinForm.querySelector("#stcm-pin-current").value);
            if (enteredCurrentHash !== currentPinHash) {
                msg.textContent = "Current PIN is incorrect.";
                return;
            }
        }
        // New PIN must not be empty and must match confirmation
        if (!pinNew.value || pinNew.value !== pinConfirm.value) {
            msg.textContent = "New PINs must match and not be empty.";
            return;
        }
        const newHash = await hashPin(pinNew.value);
        saveStoredPinHash(newHash);
        await persistPinToFile();
        debouncePersist();
        sessionStorage.removeItem("stcm_pin_okay");
        msg.textContent = currentPinHash ? "PIN updated!" : "PIN set!";
        // Clear inputs
        pinForm.querySelector("#stcm-pin-current").value = "";
        pinNew.value = pinConfirm.value = "";
        updatePinFormUi();
    };
    
    removeBtn.onclick = async function() {
        const currentPinHash = getStoredPinHash();
        if (!currentPinHash) {
            msg.textContent = "No PIN is set.";
            return;
        }
        const enteredCurrentHash = await hashPin(pinForm.querySelector("#stcm-pin-current").value);
        if (enteredCurrentHash !== currentPinHash) {
            msg.textContent = "Current PIN is incorrect.";
            return;
        }
        saveStoredPinHash("");
        await persistPinToFile();
        debouncePersist();
        sessionStorage.removeItem("stcm_pin_okay");
        msg.textContent = "PIN removed!";
        // Clear inputs
        pinForm.querySelector("#stcm-pin-current").value = "";
        pinNew.value = pinConfirm.value = "";
        updatePinFormUi();
    };
    
    

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
    // updateBlurPrivatePreviews(getSettings().blurPrivatePreviews);
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


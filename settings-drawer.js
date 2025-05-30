//settings-drawer.js
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
// index.js
import { 
    debouncePersist, 
    getNotes, 
    saveNotes, 
    } from './utils.js';


const MODULE_NAME = 'characterTagManager';
const defaultSettings = {
    showDefaultTagManager: true,
    showWelcomeRecentChats: true,
    showTopBarIcon: true   // NEW: show icon in top bar
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
                </label><hr style="margin: 1em 0;">
    <div style="margin-bottom: 0.7em;"><b>Private Folder PIN/Password</b></div>
    <div id="stcm-pin-form">
      <input type="password" id="stcm-pin-current" placeholder="Current PIN" style="width: 120px;">
      <input type="password" id="stcm-pin-new" placeholder="New PIN" style="width: 120px;">
      <input type="password" id="stcm-pin-confirm" placeholder="Confirm New PIN" style="width: 120px;">
      <button id="stcm-set-pin-btn" class="stcm_menu_button small">Set/Change PIN</button>
      <button id="stcm-remove-pin-btn" class="stcm_menu_button small red">Remove PIN</button>
      <div id="stcm-pin-msg" style="color:#e57373; margin-top:5px; font-size:0.97em;"></div>
    </div>
                
                
            </div>
        </div>
    `;
    // Checkbox logic
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

    const pinForm = panel.querySelector("#stcm-pin-form");
    const pinCurrent = pinForm.querySelector("#stcm-pin-current");
    const pinNew = pinForm.querySelector("#stcm-pin-new");
    const pinConfirm = pinForm.querySelector("#stcm-pin-confirm");
    const msg = pinForm.querySelector("#stcm-pin-msg");
    
    pinForm.querySelector("#stcm-set-pin-btn").onclick = function() {
        const notes = getNotes();
        const currentPin = notes.tagPrivatePin || "";
        // Validate current PIN
        if (currentPin && pinCurrent.value !== currentPin) {
            msg.textContent = "Current PIN is incorrect.";
            return;
        }
        // New PIN must not be empty and must match confirmation
        if (!pinNew.value || pinNew.value !== pinConfirm.value) {
            msg.textContent = "New PINs must match and not be empty.";
            return;
        }
        notes.tagPrivatePin = pinNew.value;
        saveNotes(notes);
        debouncePersist();
        sessionStorage.removeItem("stcm_pin_okay");
        msg.textContent = "PIN updated!";
        pinCurrent.value = pinNew.value = pinConfirm.value = "";
    };
    
    pinForm.querySelector("#stcm-remove-pin-btn").onclick = function() {
        const notes = getNotes();
        const currentPin = notes.tagPrivatePin || "";
        if (!currentPin) {
            msg.textContent = "No PIN is set.";
            return;
        }
        if (pinCurrent.value !== currentPin) {
            msg.textContent = "Current PIN is incorrect.";
            return;
        }
        notes.tagPrivatePin = "";
        saveNotes(notes);
        debouncePersist();
        sessionStorage.removeItem("stcm_pin_okay");
        msg.textContent = "PIN removed!";
        pinCurrent.value = pinNew.value = pinConfirm.value = "";
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
    // For each selector, set display
    ['.welcomeRecent', '.recentChatsTitle', '.showRecentChats', '.hideRecentChats'].forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
            el.style.display = isVisible ? '' : 'none';
        });
    });
}

export function updateTopBarIconVisibility(isVisible = true) {
    // Adjust your selector if the ID/class is different in your implementation!
    const icon = document.getElementById('characterTagManagerToggle');
    if (icon) icon.style.display = isVisible ? '' : 'none';
}

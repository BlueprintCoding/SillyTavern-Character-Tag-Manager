// utils.js
import {
    getContext,
} from "../../../extensions.js";
import { 
    callGenericPopup,
    POPUP_TYPE,
    POPUP_RESULT 
} from '../../../popup.js';

import {
    eventSource,
    event_types
} from "../../../../script.js";


let context = null;

function ensureContext() {
    if (!context) {
        context = getContext();
    }
}

let tagFilterBarObserver = null;  // Singleton observer for tag filter bar

function debounce(fn, delay = 200) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

let persistDebounceTimer;
function debouncePersist() {
    clearTimeout(persistDebounceTimer);
    persistDebounceTimer = setTimeout(() => {
        ensureContext();
        context.saveSettingsDebounced();
    }, 500);
}

function flushExtSettings() {
    debouncePersist();
}

function getFreeName(base, existingNames) {
    const lowerSet = new Set(existingNames.map(n => n.toLowerCase()));
    let index = 1;
    let newName = base;
    while (lowerSet.has(newName.toLowerCase())) {
        newName = `${base} ${index++}`;
    }
    return newName;
}

function isNullColor(color) {
    if (typeof color !== 'string') return true;
    const c = color.trim().toLowerCase();
    return !c || c === '#' || c === 'rgba(0, 0, 0, 1)';
}

function escapeHtml(text) {
    if (typeof text !== 'string') {
        return text == null ? '' : String(text);
    }
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


function getCharacterNameById(id, charNameMap) {
    return charNameMap.get(id) || null;
}

function resetModalScrollPositions() {
    requestAnimationFrame(() => {
        const modal = document.getElementById('characterTagManagerModal');
        if (modal) modal.scrollTo({ top: 0 });

        const scrollables = modal?.querySelectorAll('.modalBody, .accordionContent, #characterListContainer');
        scrollables?.forEach(el => el.scrollTop = 0);

        requestAnimationFrame(() => scrollables?.forEach(el => el.scrollTop = 0));
    });
}

function makeModalDraggable(modal, handle, onDragEnd = null) {
    let isDragging = false;
    let offsetX, offsetY;

    handle.style.cursor = 'move';

    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        const rect = modal.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;

        modal.style.position = 'fixed';
        modal.style.zIndex   = 10000;
        modal.style.margin   = 0;
        document.body.style.userSelect = 'none';
    });

    function onMove(e) {
        if (!isDragging) return;
        const modalWidth = modal.offsetWidth;
        const modalHeight = modal.offsetHeight;
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;
    
        // Clamp so modal never leaves the viewport!
        let newLeft = e.clientX - offsetX;
        let newTop  = e.clientY - offsetY;
    
        // Clamp left/top so modal never goes outside window
        if (newLeft < 0) newLeft = 0;
        if (newTop < 0) newTop = 0;
    
        // Clamp right/bottom so modal never goes outside window
        if (newLeft + modalWidth > winWidth)  newLeft = winWidth  - modalWidth;
        if (newTop  + modalHeight > winHeight) newTop = winHeight - modalHeight;
    
        // Prevent negative values after clamp
        if (newLeft < 0) newLeft = 0;
        if (newTop < 0) newTop = 0;
    
        modal.style.left = `${newLeft}px`;
        modal.style.top  = `${newTop}px`;
    }
    

    function onUp() {
        if (!isDragging) return;
        isDragging = false;
        document.body.style.userSelect = '';
        clampModalSize(modal, 0);
        if (onDragEnd) onDragEnd();
    }

    // global mouse handlers
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);

    /* ---------- clean-up when the modal is removed ---------- */
    const cleanupObserver = new MutationObserver((records, observer) => {
        for (const { removedNodes } of records) {
            for (const node of removedNodes) {
                if (node === modal) {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup',   onUp);
                    observer.disconnect();
                    return;
                }
            }
        }
    });

    // watch the modal’s parent (fallback to <body>)
    cleanupObserver.observe(modal.parentNode || document.body, { childList: true });
}

const STORAGE_KEY = 'stcm_modal_pos_size';

function saveModalPosSize(modalContent) {
    const rect = modalContent.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 100 || (rect.left === 0 && rect.top === 0)) return;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(rect));
}

/**
 * Clamp a draggable / resizable modal so it never leaves the viewport.
 * @param {HTMLElement} modalEl – the element you want to constrain
 * @param {number} [margin=20] – free space to keep between the modal and window edges
 * @returns {boolean} true if any dimension or position was changed
 */
function clampModalSize(modalEl, margin = 20) {
    const maxWidth  = window.innerWidth  - margin;
    const maxHeight = window.innerHeight - margin;
    let changed = false;
  
    // -------- Size --------
    if (modalEl.offsetWidth > maxWidth) {
      modalEl.style.width = `${maxWidth}px`;
      changed = true;
    }
    if (modalEl.offsetHeight > maxHeight) {
      modalEl.style.height = `${maxHeight}px`;
      changed = true;
    }
  
    // -------- Position --------
    const rect = modalEl.getBoundingClientRect();
    // Right / bottom edges
    if (rect.right > window.innerWidth) {
      modalEl.style.left = `${Math.max(0, window.innerWidth - rect.width)}px`;
      changed = true;
    }
    if (rect.bottom > window.innerHeight) {
      modalEl.style.top = `${Math.max(0, window.innerHeight - rect.height)}px`;
      changed = true;
    }
    // Left / top edges (don’t let header fly off-screen)
    if (rect.left < 0) {
      modalEl.style.left = '0px';
      changed = true;
    }
    if (rect.top < 0) {
      modalEl.style.top = '0px';
      changed = true;
    }
  
    return changed;
  }

  export function createMinimizableModalControls(modal, minimizeText = 'Restore', icon = null) {
    // Ensure the tray exists
    let tray = document.getElementById('minimizedModalsTray');
    if (!tray) {
        tray = document.createElement('div');
        tray.id = 'minimizedModalsTray';
        tray.className = 'minimizedModalsTray';
        document.body.appendChild(tray);
    }

    // Minimized bar (click to restore)
    const minimizedBar = document.createElement('div');
    minimizedBar.className = 'minimized-modal-bar';
    minimizedBar.style.display = 'none';

    // Optional icon (font-awesome or image)
    if (icon) {
        const iconEl = icon.startsWith('fa')
            ? document.createElement('i')
            : document.createElement('img');

        if (icon.startsWith('fa')) {
            iconEl.className = icon + ' minimized-icon';
        } else {
            iconEl.src = icon;
            iconEl.alt = 'icon';
            iconEl.className = 'minimized-img-icon';
        }

        minimizedBar.appendChild(iconEl);
    }

    // Text label
    const label = document.createElement('span');
    label.className = 'minimized-label';
    label.textContent = minimizeText;
    minimizedBar.appendChild(label);

    // Clicking the bar restores the modal
    minimizedBar.addEventListener('click', () => {
        modal.style.display = 'block';
        minimizedBar.style.display = 'none';
    });

    // Minimize button (goes inside the modal header typically)
    const minimizeBtn = document.createElement('button');
    minimizeBtn.className = 'minimize-modal-btn';
    minimizeBtn.textContent = '–';
    minimizeBtn.title = 'Minimize';

    minimizedBar.addEventListener('click', () => {
        modal.style.display = 'block';
        modal.style.zIndex = getNextZIndex();  // ← bring to front
        minimizedBar.style.display = 'none';
    });

    minimizedBar.addEventListener('click', () => {
        modal.style.display = 'block';
        minimizedBar.style.display = 'none';
    });

    // Add to the tray
    tray.appendChild(minimizedBar);

    return { minimizeBtn, minimizedBar };
}



  function restoreCharEditModal() {
    const modal = document.getElementById('stcmCharEditModal');
    const data = sessionStorage.getItem('stcm_char_edit_modal_pos_size');
    if (!data) return;
    try {
        const rect = JSON.parse(data);
        if (rect.width && rect.height) {
            modal.style.width = `${rect.width}px`;
            modal.style.height = `${rect.height}px`;
        }
        if (rect.left !== undefined && rect.top !== undefined) {
            modal.style.left = `${rect.left}px`;
            modal.style.top = `${rect.top}px`;
        }
    } catch (e) {
        console.warn('Failed to restore edit modal position/size');
    }
}


let highestZIndex = 10000;

export function getNextZIndex() {
    return ++highestZIndex;
}


function cleanTagMap(tag_map, characters = [], groups = []) {
    // Build a list of every still-valid character / group id
    const validIds = new Set([
        ...characters.map(c => c.avatar),
        ...groups.map(g => g.id),
    ]);

    // Strip any orphaned ids out of the map
    for (const charId of Object.keys(tag_map)) {
        if (!validIds.has(charId)) {
            delete tag_map[charId];
        }
    }
}

function buildTagMap(tags) {
    return new Map(tags.map(tag => [tag.id, tag]));
}

function buildCharNameMap(characters) {
    return new Map(characters.map(char => [char.avatar, char.name]));
}

function getNotes() {
    ensureContext();
    // create the bucket if it isn’t there
    if (!context.extensionSettings.stcm) context.extensionSettings.stcm = {};
    return context.extensionSettings.stcm.notes ?? { charNotes: {}, tagNotes: {} };
}

function saveNotes(notes) {
    ensureContext();
    // create the bucket if it isn’t there
    if (!context.extensionSettings.stcm) context.extensionSettings.stcm = {};
    context.extensionSettings.stcm.notes = notes;
    context.saveSettingsDebounced();
}

function watchTagFilterBar(injectTagManagerControlButton) {
    const tagRow = document.querySelector('.tags.rm_tag_filter');
    if (!tagRow) return;
    if (tagFilterBarObserver) tagFilterBarObserver.disconnect();
    injectTagManagerControlButton();

    tagFilterBarObserver = new MutationObserver(injectTagManagerControlButton);
    tagFilterBarObserver.observe(tagRow, { childList: true });
}

async function promptInput({ label, title = 'Input', ok = 'OK', cancel = 'Cancel', initial = '' }) {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = initial;
        input.className = 'menu_input stcm_generic_toast_input';
        input.style.width = '100%';

        const wrapper = document.createElement('div');
        wrapper.textContent = label;
        wrapper.append(document.createElement('br'), input);

        callGenericPopup(wrapper, POPUP_TYPE.CONFIRM, title, {
            okButton: ok,
            cancelButton: cancel
        }).then(result => resolve(result === POPUP_RESULT.AFFIRMATIVE ? input.value.trim() : null));

        setTimeout(() => input.focus(), 50);
    });
}

function getFolderTypeForUI(tag, notes) {
    return (tag.folder_type === "CLOSED" && notes?.tagPrivate?.[tag.id]) ? "PRIVATE" : tag.folder_type || "NONE";
}

function parseSearchGroups(input) {
    return input.split(',').map(g => g.match(/(?:[^\s"]+|"[^"]*")+/g) || []);
}

function parseSearchTerm(term) {
    let positive = !term.startsWith('-');
    term = term.replace(/^-/, '').trim();
    const m = term.match(/^([taf]):(.+)$/i);
    return m ? { field: m[1].toLowerCase(), value: m[2].toLowerCase(), positive } : { field: '', value: term, positive };
}

async function hashPin(pin) {
    const data = new TextEncoder().encode(pin);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function getStoredPinHash() {
    ensureContext();
    // create the bucket if it isn’t there
    if (!context.extensionSettings.stcm) context.extensionSettings.stcm = {};
    return context.extensionSettings.stcm.pinHash ?? "";
}

function saveStoredPinHash(hash) {
    ensureContext();
    // create the bucket if it isn’t there
    if (!context.extensionSettings.stcm) context.extensionSettings.stcm = {};
    context.extensionSettings.stcm.pinHash = hash;
    context.saveSettingsDebounced();
}


// Helper: Hex to RGBA (supports #rgb, #rrggbb, or rgb/rgba)
function hexToRgba(hex, alpha) {
    if (hex.startsWith('rgb')) {
        return hex.replace(')', `, ${alpha})`);
    }
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r},${g},${b},${alpha})`;
}

// Show all ST events - Dev Mode
const origEmit = eventSource.emit;

eventSource.emit = function(event, ...args) {
    console.log('[EVENT]', event, ...args);
    if (event === 'chatLoaded') {
        // Delay just a bit to ensure DOM is fully rendered
        setTimeout(() => {
            try {
                createSwipeSelector();
            } catch (err) {
                console.warn('Swipe selector injection failed:', err);
            }
        }, 50);
    }

    return origEmit.apply(this, arguments);
};

function createSwipeSelector() {
    ensureContext();
    const chat = context.chat;
    if (!Array.isArray(chat) || chat.length === 0) return;

    const firstMsg = chat[0];
    const swipes = firstMsg.swipes;
    if (!Array.isArray(swipes) || swipes.length <= 1) return;

    const mesDiv = document.querySelector('#chat .mes[mesid="0"]');
    if (!mesDiv) return;

    // Avoid double-injecting
    if (mesDiv.querySelector('.swipe-selector-container')) return;

    const insertTarget = mesDiv.querySelector('.mes_block');
    if (!insertTarget) return;

    const container = document.createElement('div');
    container.className = 'swipe-selector-container';
    container.style.margin = '8px 0';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '8px';

    const label = document.createElement('label');
    label.textContent = 'Start with:';
    label.style.fontSize = '0.9em';
    label.style.fontWeight = '600';

    const select = document.createElement('select');
    select.className = 'swipe-selector';
    select.style.flex = '1';

    swipes.forEach((text, idx) => {
        const option = document.createElement('option');
        option.value = idx;
        option.textContent = `Swipe ${idx + 1}: ${text.slice(0, 60)}`;
        if (text === firstMsg.mes) option.selected = true;
        select.appendChild(option);
    });

    select.addEventListener('change', (e) => {
        const selectedIndex = parseInt(e.target.value, 10);
        firstMsg.mes = swipes[selectedIndex];
        firstMsg.swipe_id = selectedIndex;

        const mesText = mesDiv.querySelector('.mes_text');
        if (mesText) mesText.innerHTML = `<p>${swipes[selectedIndex]}</p>`;
    });

    container.appendChild(label);
    container.appendChild(select);
    insertTarget.appendChild(container);
}



export {
    debounce, debouncePersist, flushExtSettings, getFreeName, isNullColor, escapeHtml, getCharacterNameById,
    resetModalScrollPositions, makeModalDraggable, saveModalPosSize, clampModalSize, restoreCharEditModal,
    cleanTagMap, buildTagMap,
    buildCharNameMap, getNotes, saveNotes,
    watchTagFilterBar, promptInput, getFolderTypeForUI, parseSearchGroups, parseSearchTerm, 
    hashPin, getStoredPinHash, saveStoredPinHash, hexToRgba,
    createSwipeSelector
};

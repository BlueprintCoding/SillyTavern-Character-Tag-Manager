// utils.js
import {
    getContext,
    callGenericPopup,
    POPUP_RESULT,
    POPUP_TYPE,
} from "../../extensions.js";

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
    if (!text) return '';
    return text.replace(/[&<>"']/g, (m) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
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
        modal.style.zIndex = 10000;
        modal.style.margin = 0;
        document.body.style.userSelect = 'none';
    });

    function onMove(e) {
        if (!isDragging) return;
        let newLeft = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - modal.offsetWidth));
        let newTop = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - handle.offsetHeight));
        modal.style.left = `${newLeft}px`;
        modal.style.top = `${newTop}px`;
    }

    function onUp() {
        if (isDragging) {
            isDragging = false;
            document.body.style.userSelect = '';
            if (onDragEnd) onDragEnd();
        }
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    modal.addEventListener('DOMNodeRemoved', (ev) => {
        if (ev.target === modal) {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }
    });
}

const STORAGE_KEY = 'stcm_modal_pos_size';

function saveModalPosSize(modalContent) {
    const rect = modalContent.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 100 || (rect.left === 0 && rect.top === 0)) return;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(rect));
}

function cleanTagMap() {
    ensureContext();
    const validCharIds = new Set([
        ...context.characters.map(c => c.avatar),
        ...context.groups.map(g => g.id)
    ]);
    for (const charId of Object.keys(context.tag_map)) {
        if (!validCharIds.has(charId)) {
            delete context.tag_map[charId];
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
    const m = term.match(/^([ta]):(.+)$/i);
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

export {
    debounce, debouncePersist, getFreeName, isNullColor, escapeHtml, getCharacterNameById,
    resetModalScrollPositions, makeModalDraggable, saveModalPosSize, cleanTagMap, buildTagMap,
    buildCharNameMap, getNotes, saveNotes,
    watchTagFilterBar, promptInput, getFolderTypeForUI, parseSearchGroups, parseSearchTerm, 
    hashPin, getStoredPinHash, saveStoredPinHash,
};

// utils.js
import { uploadFileAttachment, getFileAttachment,  } from '../../../chats.js';
import { injectTagManagerControlButton } from "./index.js";
import {
    POPUP_RESULT,
    POPUP_TYPE,
    callGenericPopup
} from "../../../popup.js";

import {
    characters
} from "../../../../script.js";
import {
     groups
 } from "../../../../scripts/group-chats.js";
import {
    tag_map,
} from "../../../tags.js";



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
    return new Promise(resolve => {
        clearTimeout(persistDebounceTimer);
        persistDebounceTimer = setTimeout(async () => {
            await persistNotesToFile();
            resolve();
        }, 500);
    });
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
    return text.replace(/[&<>"']/g, (m) => (
        m === '&' ? '&amp;' :
            m === '<' ? '&lt;' :
                m === '>' ? '&gt;' :
                    m === '"' ? '&quot;' :
                        m === "'" ? '&#39;' : m
    ));
}

function getCharacterNameById(id, charNameMap) {
    return charNameMap.get(id) || null;
}

function resetModalScrollPositions() {
    requestAnimationFrame(() => {
        const modal = document.getElementById('characterTagManagerModal');
        if (modal) modal.scrollTo({ top: 0 });

        const scrollables = modal?.querySelectorAll('.modalBody, .accordionContent, #characterListContainer');
        scrollables?.forEach(el => {
            el.scrollTop = 0;
        });

        //  force 2nd frame in case browser restores it AFTER first frame
        requestAnimationFrame(() => {
            scrollables?.forEach(el => {
                el.scrollTop = 0;
            });
        });
    });
}

function makeModalDraggable(modal, handle, onDragEnd = null) {
    let isDragging = false;
    let offsetX, offsetY;

    handle.style.cursor = 'move';

    const getHeaderHeight = () => handle.offsetHeight || 50;

    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        // modal.getBoundingClientRect() is more reliable than offsetLeft on fixed
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
        let newLeft = e.clientX - offsetX;
        let newTop = e.clientY - offsetY;

        // Clamp left/top to 0, right, and keep header visible at bottom
        const headerHeight = getHeaderHeight();
        const width = modal.offsetWidth;
        const height = modal.offsetHeight;

        newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - width));
        newTop = Math.max(0, Math.min(newTop, window.innerHeight - headerHeight));

        modal.style.left = `${newLeft}px`;
        modal.style.top = `${newTop}px`;
        modal.style.right = '';
        modal.style.bottom = '';
        modal.style.transform = ''; // Remove any center transform
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

    // CLEANUP: remove event listeners when modal closes
    modal.addEventListener('DOMNodeRemoved', (ev) => {
        if (ev.target === modal) {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }
    });
}



// After making modal draggable, also track size and position for saving
const STORAGE_KEY = 'stcm_modal_pos_size';

function saveModalPosSize(modalContent) {
    const rect = modalContent.getBoundingClientRect();

    // Only save if width/height and position are meaningful
    if (
        rect.width < 100 || rect.height < 100 || // too small, not user-sized yet
        (rect.left === 0 && rect.top === 0)     // opened at corner, likely initial
    ) {
        // Don't save the initial "reset" or "default" position/size!
        return;
    }

    // console.log('[STCM] Saving modal position/size:', rect); // debug log
    sessionStorage.setItem('stcm_modal_pos_size', JSON.stringify({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
    }));
}


function cleanTagMap() {
    const validCharIds = new Set([
        ...characters.map(c => c.avatar),
        ...groups.map(g => g.id)
    ]);
    for (const charId of Object.keys(tag_map)) {
        if (!validCharIds.has(charId)) {
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
    try {
        const data = JSON.parse(localStorage.getItem('stcm_notes_cache') || '{}');
        return {
            charNotes: data.charNotes || {},
            tagNotes: data.tagNotes || {},
        };
    } catch {
        return { charNotes: {}, tagNotes: {}};
    }
}


function saveNotes(notes) {
    localStorage.setItem('stcm_notes_cache', JSON.stringify({
        charNotes: notes.charNotes || {},
        tagNotes: notes.tagNotes || {}
    }));
}


async function persistNotesToFile() {
    const raw = getNotes();
    const notes = {
        charNotes: Object.fromEntries(Object.entries(raw.charNotes || {}).filter(([_, v]) => v.trim() !== '')),
        tagNotes: Object.fromEntries(Object.entries(raw.tagNotes || {}).filter(([_, v]) => v.trim() !== '')),
    };

    const json = JSON.stringify(notes, null, 2);
    const base64 = window.btoa(unescape(encodeURIComponent(json)));

    const fileUrl = await uploadFileAttachment('stcm-notes.json', base64);
    if (fileUrl) {
        localStorage.setItem('stcm_notes_url', fileUrl);
        localStorage.setItem('stcm_notes_cache', JSON.stringify(notes));
    }
}


async function restoreNotesFromFile() {
    const fileUrl = localStorage.getItem('stcm_notes_url');

    if (!fileUrl) {
        console.info('[STCM] No notes file URL found. First-time setup.');
        await persistNotesToFile(); // Create blank file
        return;
    }

    try {
        const content = await getFileAttachment(fileUrl);
        const parsed = JSON.parse(content);

        localStorage.setItem('stcm_notes_cache', JSON.stringify(parsed));
    } catch (e) {
        console.log('[STCM] Notes file missing or corrupted. Reinitializing blank notes.', e);
        saveNotes({ charNotes: {}, tagNotes: {}});
        await persistNotesToFile(); // Overwrite with fresh blank file
    }
}


/**
 * Watches the tag filter bar row for mutations and always reinjects the private folder toggle if needed.
 */
function watchTagFilterBar() {
    const tagRow = document.querySelector('.tags.rm_tag_filter');
    if (!tagRow) return;

    // Disconnect previous observer
    if (tagFilterBarObserver) {
        tagFilterBarObserver.disconnect();
        tagFilterBarObserver = null;
    }

    // Always inject both icons (if missing)
    injectTagManagerControlButton(); // injects Character/Tag Manager button

    // Observe for changes and re-inject
    tagFilterBarObserver = new MutationObserver(() => {
        injectTagManagerControlButton();
    });
    tagFilterBarObserver.observe(tagRow, { childList: true, subtree: false });

}


async function promptInput({ label, title = 'Input', ok = 'OK', cancel = 'Cancel', initial = '' }) {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = initial;
        input.className = 'menu_input stcm_generic_toast_input';
        input.style.width = '100%';

        const wrapper = document.createElement('div');
        wrapper.appendChild(document.createTextNode(label));
        wrapper.appendChild(document.createElement('br'));
        wrapper.appendChild(input);

        callGenericPopup(wrapper, POPUP_TYPE.CONFIRM, title, {
            okButton: ok,
            cancelButton: cancel
        }).then((result) => {
            if (result === POPUP_RESULT.AFFIRMATIVE) {
                resolve(input.value.trim());
            } else {
                resolve(null);
            }
        });
        setTimeout(() => input.focus(), 50);
    });
}

function getFolderTypeForUI(tag, notes) {
    if (tag.folder_type === "CLOSED" && notes?.tagPrivate?.[tag.id]) return "PRIVATE";
    return tag.folder_type || "NONE";
}

// Search Functions for Characters
function parseSearchGroups(input) {
    return input
        .split(',')
        .map(group => group.trim())
        .filter(Boolean)
        .map(group => group.match(/(?:[^\s"]+|"[^"]*")+/g) || []);
}

function parseSearchTerm(term) {
    let positive = true;
    term = term.trim();
    if (!term) return null;
    if (term.startsWith('-')) {
        positive = false;
        term = term.slice(1).trim();
    }
    const m = term.match(/^([ta]):(.+)$/i);
    if (m) {
        return { field: m[1].toLowerCase(), value: m[2].toLowerCase(), positive };
    }
    return { field: '', value: term.toLowerCase(), positive };
}

async function hashPin(pin) {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    // Convert buffer to hex string
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getStoredPinHash() {
    try {
        const data = JSON.parse(localStorage.getItem('stcm_pin_cache') || '{}');
        return data.pinHash || "";
    } catch {
        return "";
    }
}

function saveStoredPinHash(hash) {
    const data = { pinHash: hash };
    localStorage.setItem('stcm_pin_cache', JSON.stringify(data));
}

async function persistPinToFile() {
    const pinHash = getStoredPinHash();
    const data = { pinHash };
    const json = JSON.stringify(data, null, 2);
    const base64 = window.btoa(unescape(encodeURIComponent(json)));
    const fileUrl = await uploadFileAttachment('stcm-folder-pin.json', base64);
    if (fileUrl) {
        localStorage.setItem('stcm_pin_url', fileUrl);
    }
}

async function restorePinFromFile() {
    const fileUrl = localStorage.getItem('stcm_pin_url');
    if (!fileUrl) {
        await persistPinToFile(); // Write blank one
        return;
    }

    try {
        const content = await getFileAttachment(fileUrl);
        const parsed = JSON.parse(content);
        localStorage.setItem('stcm_pin_cache', JSON.stringify(parsed));
    } catch (e) {
        console.warn('[STCM] Failed to load PIN file, reinitializing.');
        saveStoredPinHash("");
        await persistPinToFile();
    }
}



export { 
debounce, 
debouncePersist, 
getFreeName, 
isNullColor, 
escapeHtml, 
getCharacterNameById, 
resetModalScrollPositions, 
makeModalDraggable, 
saveModalPosSize,
cleanTagMap,
buildTagMap, 
buildCharNameMap, 
getNotes, 
saveNotes, 
persistNotesToFile, 
restoreNotesFromFile, 
watchTagFilterBar,
promptInput,
getFolderTypeForUI,
parseSearchGroups,
parseSearchTerm,
hashPin,
getStoredPinHash,
saveStoredPinHash,
persistPinToFile,
restorePinFromFile,
};
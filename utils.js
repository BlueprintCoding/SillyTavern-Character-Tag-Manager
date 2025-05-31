// utils.js
import { uploadFileAttachment, getFileAttachment,  } from '../../../chats.js';
import { injectTagManagerControlButton } from "./index.js";
import {
    POPUP_RESULT,
    POPUP_TYPE,
    callGenericPopup
} from "../../../popup.js";


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

function makeModalDraggable(modal, handle) {
    let isDragging = false;
    let offsetX, offsetY;

    handle.style.cursor = 'move';
    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        offsetX = e.clientX - modal.offsetLeft;
        offsetY = e.clientY - modal.offsetTop;
        modal.style.position = 'absolute';
        modal.style.zIndex = 10000;
        modal.style.margin = 0; // remove any centering offset
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        modal.style.left = `${e.clientX - offsetX}px`;
        modal.style.top = `${e.clientY - offsetY}px`;
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
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
            tagPrivate: data.tagPrivate || {},
            tagPrivatePinHash: data.tagPrivatePinHash || ""    // <-- use this!
        };
    } catch {
        return { charNotes: {}, tagNotes: {}, tagPrivate: {}, tagPrivatePinHash: "" };
    }
}


function saveNotes(notes) {
    localStorage.setItem('stcm_notes_cache', JSON.stringify({
        charNotes: notes.charNotes || {},
        tagNotes: notes.tagNotes || {},
        tagPrivate: notes.tagPrivate || {},
        tagPrivatePinHash: notes.tagPrivatePinHash || ""    // <-- use this!
    }));
}


async function persistNotesToFile() {
    const raw = getNotes();
    const notes = {
        charNotes: Object.fromEntries(Object.entries(raw.charNotes || {}).filter(([_, v]) => v.trim() !== '')),
        tagNotes: Object.fromEntries(Object.entries(raw.tagNotes || {}).filter(([_, v]) => v.trim() !== '')),
        tagPrivate: raw.tagPrivate || {},
        tagPrivatePinHash: raw.tagPrivatePinHash || ""
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

        // Ensure tagPrivatePinHash exists if imported
        if (parsed && typeof parsed === "object") {
            if (!parsed.tagPrivatePinHash) parsed.tagPrivatePinHash = "";
        }
        localStorage.setItem('stcm_notes_cache', JSON.stringify(parsed));
    } catch (e) {
        console.log('[STCM] Notes file missing or corrupted. Reinitializing blank notes.', e);
        saveNotes({ charNotes: {}, tagNotes: {}, tagPrivate: {}, tagPrivatePinHash: "" });
        await persistNotesToFile(); // Overwrite with fresh blank file
    }
}

function getFolderTypeForUI(tag, notes) {
    if (tag.folder_type === "CLOSED" && notes?.tagPrivate?.[tag.id]) return "PRIVATE";
    return tag.folder_type || "NONE";
}

/**
 * Mutate bogus folder icons for private folders in #rm_print_characters_block
 * @param {Set<string>} privateTagIds  // set of tag ids that are private
 */
function mutateBogusFolderIcons(privateTagIds) {
    const container = document.getElementById('rm_print_characters_block');
    if (!container) return;

    // Helper for icon swap
    function updateIcon(folderDiv) {
        const tagId = folderDiv.getAttribute('tagid');
        if (!privateTagIds.has(tagId)) return;
        // Find the icon and swap it if needed
        const icon = folderDiv.querySelector('.bogus_folder_icon');
        if (icon) {
            icon.classList.remove('fa-eye-slash', 'fa-eye');
            icon.classList.add('fa-user-lock'); // lock icon
        }
            // Add custom CSS class for private folders
    folderDiv.classList.add('stcm-private-folder');
    }

    // Mutate any existing folders immediately
    container.querySelectorAll('.bogus_folder_select').forEach(updateIcon);

    // Now observe for new folders
    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            mutation.addedNodes.forEach(node => {
                if (!(node instanceof HTMLElement)) return;
                if (node.classList?.contains('bogus_folder_select')) {
                    updateIcon(node);
                } else if (node.querySelectorAll) {
                    node.querySelectorAll('.bogus_folder_select').forEach(updateIcon);
                }
            });
        }
    });

    observer.observe(container, { childList: true, subtree: true });
}

function injectPrivateFolderToggle(privateTagIds, onStateChange) {
    // Only show if any private folders exist
    const tagRow = document.querySelector('.tags.rm_tag_filter');
    const mgrBtn = document.querySelector('#characterTagManagerControlButton');
    if (!tagRow || !mgrBtn) return;

    // REMOVE existing toggle if present
    const oldToggle = document.getElementById('privateFolderVisibilityToggle');
    if (oldToggle) oldToggle.remove();

    // Don't add if no private folders
    if (!privateTagIds.size) return;

    // Three states: 0 = Locked, 1 = Unlocked, 2 = Private only
    const stateKey = 'stcm_private_folder_toggle_state';
    let state = 0; // Default to "private folders hidden"
    const raw = localStorage.getItem(stateKey);
    if (raw !== null && !isNaN(Number(raw))) {
        state = Number(raw);
    }

    // Icon map and tooltips
    const icons = [
        { icon: 'fa-user-lock', color: '#888', tip: 'Hide private folders' },
        { icon: 'fa-unlock', color: '#44b77b', tip: 'Show all folders (including private)' },
        { icon: 'fa-xmarks-lines', color: '#a54e4e', tip: 'Show ONLY private folders' }
    ];

    const btn = document.createElement('span');
    btn.id = 'privateFolderVisibilityToggle';
    btn.className = 'tag actionable clickable-action interactable';
    btn.style.backgroundColor = 'rgba(136, 100, 200, 0.55)';
    btn.tabIndex = 0;

    // Render the current icon/state
    function render() {
        btn.innerHTML = `
            <span class="tag_name fa-solid ${icons[state].icon}" style="color: ${icons[state].color};" title="${icons[state].tip}"></span>
            <i class="fa-solid fa-circle-xmark tag_remove interactable" tabindex="0" style="display: none;"></i>
        `;
        btn.setAttribute('data-toggle-state', state);
    }
    render();

    btn.addEventListener('click', async () => {
        let nextState = (state + 1) % 3;
        // Only require PIN if unlocking (showing private folders) and PIN is set
        const notes = getNotes();
        const hasPin = !!notes.tagPrivatePinHash;
    
        if (nextState > 0 && hasPin && sessionStorage.getItem("stcm_pin_okay") !== "1") {
            const userPin = await showModalPinPrompt("Enter PIN to view private folders:");
            if ((await hashPin(userPin)) !== notes.tagPrivatePinHash) { 
                toastr.error("Incorrect PIN.", "Private Folders");
                return;
            }
            sessionStorage.setItem("stcm_pin_okay", "1");
        }
        state = nextState;
        localStorage.setItem(stateKey, state);
        render();
        onStateChange(state);
        hidePrivateTagsInFilterBar(); 
    });
    
    
    // Insert after the Character/Tag Manager icon
    mgrBtn.insertAdjacentElement('afterend', btn);
}


async function hashPin(pin) {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    // Convert buffer to hex string
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Shows a modal PIN input using your existing popup system.
 * Returns a Promise that resolves to the entered PIN string (or null if cancelled).
 */
function showModalPinPrompt(message = "Enter PIN") {
    return new Promise(resolve => {
        const html = document.createElement('div');
        html.innerHTML = `
            <div style="margin-bottom: 10px;"><b>${message}</b></div>
            <input type="password" id="stcm-popup-pin-input" placeholder="PIN" style="width: 100%; margin-bottom: 10px; font-size: 1.08em; padding: 5px 8px; border-radius: 4px; border: 1px solid #999;">
        `;
        callGenericPopup(html, POPUP_TYPE.CONFIRM, "Private Folders", {
            okButton: "OK",
            cancelButton: "Cancel"
        }).then(result => {
            if (result === POPUP_RESULT.AFFIRMATIVE) {
                const pinValue = html.querySelector('#stcm-popup-pin-input').value;
                resolve(pinValue);
            } else {
                resolve(null);
            }
        });
        // Focus input after dialog open
        setTimeout(() => {
            html.querySelector('#stcm-popup-pin-input')?.focus();
        }, 150);
    });
}

/**
 * Controls folder/character visibility based on toggle.
 * @param {number} state 0=hide private, 1=show all, 2=only private
 * @param {Set<string>} privateTagIds Set of private tag IDs
 */
function applyPrivateFolderVisibility(state, privateTagIds) {
    // Detect if we're drilled into a folder (i.e., "Go Back" button is visible)
    const goBackBlock = document.getElementById('BogusFolderBack');
    const inDrilldown = goBackBlock && goBackBlock.style.display !== 'none';

    if (inDrilldown) {
        // If in folder view, ALWAYS show all characters/groups/folders, and return immediately
        document.querySelectorAll('.bogus_folder_select').forEach(div => {
            div.style.display = '';
        });
        document.querySelectorAll('.character_select.entity_block, .group_select.entity_block').forEach(div => {
            div.style.display = '';
        });
        return; // Do not process the rest!
    }

    // ...your original logic below for non-drilldown (top-level) view...
    document.querySelectorAll('.bogus_folder_select').forEach(div => {
        const tagid = div.getAttribute('tagid');
        // Always show Go Back
        if (div.id === 'BogusFolderBack' || div.classList.contains('bogus_folder_select_back') || tagid === 'back') {
            div.style.display = '';
            return;
        }
        const isPrivate = privateTagIds.has(tagid);
        if (state === 0) { // Hide private
            div.style.display = isPrivate ? 'none' : '';
        } else if (state === 1) { // Show all
            div.style.display = '';
        } else if (state === 2) { // Show only private
            div.style.display = isPrivate ? '' : 'none';
        }
    });

    // Characters and groups: only filter in top-level
    [document.querySelectorAll('.character_select.entity_block'), document.querySelectorAll('.group_select.entity_block')].forEach(list => {
        list.forEach(div => {
            if (state === 2) {
                // Only show if in a private folder (in top-level view)
                let inPrivateFolder = false;
                let parent = div.parentElement;
                while (parent) {
                    if (parent.classList && parent.classList.contains('bogus_folder_select')) {
                        const tagid = parent.getAttribute('tagid');
                        if (privateTagIds.has(tagid)) {
                            inPrivateFolder = true;
                            break;
                        }
                    }
                    parent = parent.parentElement;
                }
                div.style.display = inPrivateFolder ? '' : 'none';
            } else {
                // Show all in other states
                div.style.display = '';
            }
        });
    });
}



/**
 * Watches for changes in #rm_print_characters_block and reapplies icon and visibility mutators.
 * @param {Set<string>} privateTagIds
 * @param {Function} getVisibilityState - function returning the current visibility state (0, 1, 2)
 */
function watchCharacterBlockMutations(privateTagIds, getVisibilityState) {
    const container = document.getElementById('rm_print_characters_block');
    if (!container) return;

    // Initial apply on page load
    mutateBogusFolderIcons(privateTagIds);
    applyPrivateFolderVisibility(getVisibilityState(), privateTagIds);

    // Set up the observer
    const observer = new MutationObserver(() => {
        // Re-apply both every mutation (should be fast)
        mutateBogusFolderIcons(privateTagIds);
        applyPrivateFolderVisibility(getVisibilityState(), privateTagIds);
    });

    observer.observe(container, { childList: true, subtree: true });
}

/**
 * Watches the tag filter bar row for mutations and always reinjects the private folder toggle if needed.
 * @param {Set<string>} privateTagIds
 * @param {function} onStateChange
 */
function watchTagFilterBar(privateTagIds, onStateChange) {
    const tagRow = document.querySelector('.tags.rm_tag_filter');
    if (!tagRow) return;

    // Disconnect previous observer
    if (tagFilterBarObserver) {
        tagFilterBarObserver.disconnect();
        tagFilterBarObserver = null;
    }

    // Always inject both icons (if missing)
    injectTagManagerControlButton(); // injects Character/Tag Manager button
    injectPrivateFolderToggle(privateTagIds, onStateChange);

    // Observe for changes and re-inject
    tagFilterBarObserver = new MutationObserver(() => {
        injectTagManagerControlButton();
        injectPrivateFolderToggle(privateTagIds, onStateChange);
        hidePrivateTagsInFilterBar(); 
    });
    tagFilterBarObserver.observe(tagRow, { childList: true, subtree: false });

}

function getCurrentVisibilityState() {
    return Number(localStorage.getItem('stcm_private_folder_toggle_state') || 0);
}


function isSystemTagId(id) {
    // covers numbers, control buttons, visibility toggles, etc.
    return (
        !id ||
        /^[0-9]+$/.test(id) ||
        [
            "characterTagManagerControlButton",
            "privateFolderVisibilityToggle"
        ].includes(id)
    );
}


/**
 * Controls tag bar visibility for private tags based on toggle.
 * @param {number} state 0=hide private, 1=show all, 2=only private
 * @param {Set<string>} privateTagIds Set of private tag IDs
 */
function hidePrivateTagsInFilterBar() {
    const notes = getNotes();
    const privateTagIds = new Set(Object.keys(notes.tagPrivate || {}).filter(id => notes.tagPrivate[id]));
    const state = getCurrentVisibilityState();

    // Get the "Show Tag List" button
    const showTagListBtn = document.querySelector('.tag.showTagList');
    const tagListIsActive = showTagListBtn && showTagListBtn.classList.contains('selected');

    document.querySelectorAll('.tags.rm_tag_filter > .tag').forEach(tagEl => {
        const tagId = tagEl.getAttribute('id');
        const isPrivate = privateTagIds.has(tagId);

            if (isPrivate) {
                tagEl.classList.add('stcm-force-hide-private');
                tagEl.setAttribute('data-stcm-debug', 'private-hidden');
            }
    });
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
buildTagMap, 
buildCharNameMap, 
getNotes, 
saveNotes, 
persistNotesToFile, 
restoreNotesFromFile, 
getFolderTypeForUI, 
mutateBogusFolderIcons, 
applyPrivateFolderVisibility, 
injectPrivateFolderToggle,
watchCharacterBlockMutations,
watchTagFilterBar,
hashPin,
hidePrivateTagsInFilterBar
};
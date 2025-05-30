// utils.js
import { uploadFileAttachment, getFileAttachment } from '../../../chats.js';

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
            tagPrivate: data.tagPrivate || {},   // <-- add this line!
        };
    } catch {
        return { charNotes: {}, tagNotes: {}, tagPrivate: {} };
    }
}


function saveNotes(notes) {
    // Always save tagPrivate as part of the notes structure!
    localStorage.setItem('stcm_notes_cache', JSON.stringify({
        charNotes: notes.charNotes || {},
        tagNotes: notes.tagNotes || {},
        tagPrivate: notes.tagPrivate || {},    // <-- add this line!
    }));
}

async function persistNotesToFile() {
    const raw = getNotes();
    const notes = {
        charNotes: Object.fromEntries(Object.entries(raw.charNotes || {}).filter(([_, v]) => v.trim() !== '')),
        tagNotes: Object.fromEntries(Object.entries(raw.tagNotes || {}).filter(([_, v]) => v.trim() !== '')),
        tagPrivate: raw.tagPrivate || {},   // <-- ADD THIS!
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
        saveNotes({ charNotes: {}, tagNotes: {} });
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

    // Don't add twice
    if (document.getElementById('privateFolderVisibilityToggle')) return;

    // Three states: 0 = Locked, 1 = Unlocked, 2 = Private only
    let state = 0;

    // Optionally, persist state in localStorage
    const stateKey = 'stcm_private_folder_toggle_state';
    if (localStorage.getItem(stateKey)) {
        state = Number(localStorage.getItem(stateKey));
    }

    // Icon map and tooltips
    const icons = [
        { icon: 'fa-user-lock', color: '#888', tip: 'Hide private folders' },
        { icon: 'fa-unlock', color: '#44b77b', tip: 'Show all folders (including private)' },
        { icon: 'fa-eye', color: '#1976d2', tip: 'Show ONLY private folders' }
    ];

    const btn = document.createElement('span');
    btn.id = 'privateFolderVisibilityToggle';
    btn.className = 'tag actionable clickable-action interactable';
    btn.style.backgroundColor = 'rgba(100, 140, 200, 0.55)';
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

    btn.addEventListener('click', () => {
        state = (state + 1) % 3;
        localStorage.setItem(stateKey, state);
        render();
        onStateChange(state); // Callback to perform actual filtering/mutation
    });

    // Insert after the Character/Tag Manager icon
    mgrBtn.insertAdjacentElement('afterend', btn);
}


/**
 * Controls folder/character visibility based on toggle.
 * @param {number} state 0=hide private, 1=show all, 2=only private
 * @param {Set<string>} privateTagIds Set of private tag IDs
 */
function applyPrivateFolderVisibility(state, privateTagIds) {
    // Handle bogus folder divs
    document.querySelectorAll('.bogus_folder_select').forEach(div => {
        const isPrivate = privateTagIds.has(div.getAttribute('tagid'));
        if (state === 0) { // Locked
            div.style.display = isPrivate ? 'none' : '';
        } else if (state === 1) { // Unlocked
            div.style.display = '';
        } else if (state === 2) { // Private only
            div.style.display = isPrivate ? '' : 'none';
        }
    });

    // Handle main character blocks
    document.querySelectorAll('.character_select.entity_block').forEach(div => {
        // If in private-only, HIDE any character not in a private folder
        if (state === 2) {
            // A character block is considered "in a private folder" if any ancestor .bogus_folder_select with matching privateTagIds exists
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
            // Show all character blocks in other states
            div.style.display = '';
        }
    });
        // Handle group entity blocks (hide when private only mode)
        document.querySelectorAll('.group_select.entity_block').forEach(div => {
            if (state === 2) {
                // Same logic: is this group inside a private folder?
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
                div.style.display = '';
            }
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
watchCharacterBlockMutations
};
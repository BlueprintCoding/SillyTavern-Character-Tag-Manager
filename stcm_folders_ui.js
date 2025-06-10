// stcm_folders_ui.js
import { 
    debounce, 
    buildTagMap, 
    escapeHtml,
    getStoredPinHash, 
    hashPin,
    promptInput
    } from './utils.js';

import { accountStorage } from '../../../util/AccountStorage.js';

import * as stcmFolders from './stcm_folders.js';

import {
    tags,
    tag_map,
} from "../../../tags.js";

import {
    fuzzySearchCharacters
} from "../../../power-user.js";

import {
    openWelcomeScreen
} from "../../../welcome-screen.js"

import {
    characters,
    selectCharacterById,
    eventSource, 
    event_types,
    getEntitiesList,
    setActiveCharacter,
    setActiveGroup
} from "../../../../script.js";

import { STCM } from './index.js';

import {
    POPUP_RESULT,
    POPUP_TYPE,
    callGenericPopup
} from "../../../popup.js"

let currentSidebarFolderId = 'root';
let privateFolderVisibilityMode = 0; // 0 = Hidden, 1 = Show All, 2 = Show Only Private
let sidebarUpdateInProgress = false;
let stcmSearchActive = false;
let stcmSearchResults = null;
let stcmSearchTerm = '';
let stcmObserver = null;
let stcmLastSearchFolderId = null;
let lastInjectedAt = 0;
let lastSidebarInjection = 0;
let suppressSidebarObserver = false;
let lastKnownCharacterAvatars = [];
const SIDEBAR_INJECTION_THROTTLE_MS = 500;
let orphanFolderExpanded = false;


const debouncedUpdateSidebar = debounce(() => updateSidebar(true), 100);

export function hookFolderSidebarEvents() {
    // List of events that might affect characters/folders display:
    const folderRelevantEvents = [
        event_types.CHARACTER_EDITED,
        event_types.CHARACTER_DELETED,
        event_types.CHARACTER_DUPLICATED,
        event_types.CHARACTER_RENAMED,
        event_types.CHARACTER_RENAMED_IN_PAST_CHAT,
        event_types.GROUP_UPDATED,
        event_types.GROUP_CHAT_CREATED,
        event_types.GROUP_CHAT_DELETED,
    ];

    folderRelevantEvents.forEach(ev => {
        eventSource.on(ev, () => {
            // Always update folders on relevant character changes
            eventSource.on(ev, debouncedUpdateSidebar);
        });
    });

    // Optionally: Also hook EXTENSIONS_FIRST_LOAD if you want to refresh folders when all plugins/extensions are loaded.
    eventSource.on(event_types.EXTENSIONS_FIRST_LOAD, () => {
        updateSidebar(true);
    });
}

export async function updateSidebar(forceReload = false) {
    if (sidebarUpdateInProgress) return;
    sidebarUpdateInProgress = true;
    suppressSidebarObserver = true; 
    if (stcmObserver) stcmObserver.disconnect();
    try {
        if (forceReload || !STCM.sidebarFolders?.length) {
            STCM.sidebarFolders = await stcmFolders.loadFolders();
        }
        injectSidebarFolders(STCM.sidebarFolders);
        setTimeout(() => {
            hideFolderedCharactersOutsideSidebar(STCM.sidebarFolders);
            suppressSidebarObserver = false; 
            watchSidebarFolderInjection(); // This will recreate the observer
        }, 100);
    } catch (e) {
        suppressSidebarObserver = false; 
        console.error("Sidebar update failed:", e);
        watchSidebarFolderInjection(); // This will recreate the observer
    } finally {
        sidebarUpdateInProgress = false;
    }
}


function insertNoFolderLabelIfNeeded() {
    // Remove existing if any (prevents duplicates)
    let oldLabel = document.getElementById('stcm_no_folder_label');
    if (oldLabel) oldLabel.remove();

    const parent = document.getElementById('rm_print_characters_block');
    if (!parent) return;

    // Find the first bogus folder block
    const firstBogusFolder = Array.from(parent.children).find(child =>
        child.classList?.contains('bogus_folder_select')
    );
    if (firstBogusFolder) {
        // Create label
        const label = document.createElement('div');
        label.id = 'stcm_no_folder_label';
        label.textContent = 'Tag Folders';
        label.style.cssText = `
            margin: 18px 0 7px 0;
            font-weight: 700;
            font-size: 1.04em;
            letter-spacing: 0.01em;
            padding-left: 2px;
            color: var(--ac-style-color-text, #bbb);
        `;
        parent.insertBefore(label, firstBogusFolder);
    }
}


export function injectSidebarFolders(folders) {
    const parent = document.getElementById('rm_print_characters_block');
    if (!parent) return;

    let existingSidebar = document.getElementById('stcm_sidebar_folder_nav');
    if (existingSidebar) existingSidebar.remove();

    let sidebar = document.createElement('div');
    sidebar.id = 'stcm_sidebar_folder_nav';
    sidebar.className = 'stcm_sidebar_folder_nav';
    parent.insertBefore(sidebar, parent.firstChild);

    const allEntities = getEntitiesList();
    console.log(allEntities);
    if (stcmSearchActive && stcmSearchResults && stcmSearchTerm) {
        renderSidebarFolderSearchResult(folders, allEntities, stcmSearchResults, stcmSearchTerm);
    } else {
        renderSidebarFolderContents(folders, allEntities, currentSidebarFolderId);
    }
    
    hookIntoCharacterSearchBar(folders, allEntities);
    insertNoFolderLabelIfNeeded();
}




function hookIntoCharacterSearchBar(folders, allEntities) {
    const input = document.getElementById('character_search_bar');
    if (!input || input.dataset.stcmHooked) return;
    input.dataset.stcmHooked = "true";

    input.addEventListener('input', debounce(() => {
        const term = input.value.trim();
        stcmSearchActive = !!term;
    
        if (term) {
            stcmSearchTerm = term;
            stcmSearchResults = fuzzySearchCharacters(term);
            injectSidebarFolders(folders); // <-- always redraw using this up-to-date info!
        } else {
            stcmSearchActive = false;
            stcmSearchResults = null;
            stcmSearchTerm = '';
            stcmLastSearchFolderId = null;
            currentSidebarFolderId = 'root';
            injectSidebarFolders(folders);
        }
        // Hide or show "characters hidden" info block based on search state
        setTimeout(() => {
            document.querySelectorAll('.text_block.hidden_block').forEach(block => {
                block.style.display = stcmSearchActive ? 'none' : '';
            });
        }, 1);
    }, 150));
    
    
    input.addEventListener('blur', () => {
        if (!input.value.trim()) {
            accountStorage.setItem('SelectedNavTab', 'rm_button_characters');
            stcmSearchActive = false;
            stcmSearchResults = null;
            stcmSearchTerm = '';
            stcmLastSearchFolderId = null;
            currentSidebarFolderId = 'root';  // <--- Fix: reset on clear
            injectSidebarFolders(folders);
        }
        document.querySelectorAll('.text_block.hidden_block').forEach(block => {
            block.style.display = stcmSearchActive ? 'none' : '';
        });
    });
    
    
}

function characterMatchesTerm(char, term) {
    // 1. Check all string/number/array fields
    for (const key in char) {
        if (!char.hasOwnProperty(key)) continue;
        let val = char[key];
        if (typeof val === 'string' && val.toLowerCase().includes(term)) return true;
        if (typeof val === 'number' && val.toString().includes(term)) return true;
        if (Array.isArray(val) && val.join(',').toLowerCase().includes(term)) return true;
    }

    // 2. Check tags assigned to this character
    // You'll need access to tag_map and tags (already imported at the top)
    const tagIds = tag_map[char.avatar] || [];
    if (tagIds.length) {
        // Build tagsById map just once per render ideally, but it's fine here for clarity
        const tagsById = buildTagMap(tags);
        for (const tagId of tagIds) {
            const tag = tagsById.get(tagId);
            if (tag && tag.name && tag.name.toLowerCase().includes(term)) {
                return true;
            }
        }
    }

    return false;
}




// Only shows the folder open with matches highlighted inside
function renderSidebarFolderSearchResult(folders, allEntities, results, term) {
    const container = document.getElementById('stcm_sidebar_folder_nav');
    if (!container) return;
    container.innerHTML = "";

    const folderMatches = {};
    const ORPHAN_KEY = '__orphans__';

    // Make a lookup map for allEntities (id -> {entity, avatar, type})
    const entityByAvatar = {};
    const entityById = {};
    allEntities.forEach(e => {
        if (e.type === "character" && e.item && e.item.avatar) entityByAvatar[e.item.avatar] = e;
        if (e.type === "group" && e.id) entityById[e.id] = e;
    });

    // Folder assignment logic (robust, works for any search result shape)
    for (const res of results) {
        // Determine what this is: character or group, and get avatar or id
        let entity, type, avatar, id;
        if (res.type === "character" || (res.item && res.item.spec)) {
            // Character (from fuzzy search, res.item may exist)
            entity = res.item ? res.item : res;
            type = "character";
            avatar = entity.avatar || entity.avatar_url; // main way to identify
            id = res.id || entity.id;
        } else if (res.type === "group" || (res.item && res.item.members)) {
            entity = res.item ? res.item : res;
            type = "group";
            avatar = null;
            id = res.id || entity.id;
        }

        // Try to find this entity in any folder
        let foundFolder = null;
        for (const folder of folders) {
            if (!Array.isArray(folder.characters)) continue;
            if (
                (type === "character" && avatar && folder.characters.includes(avatar)) ||
                (type === "group" && id && folder.characters.includes(id))
            ) {
                foundFolder = folder;
                break;
            }
        }
        const folderId = foundFolder ? foundFolder.id : ORPHAN_KEY;
        if (!folderMatches[folderId]) folderMatches[folderId] = { folder: foundFolder, chars: [] };
        // reconstruct proper entity object for rendering
        let entityObj = (type === "character" && avatar && entityByAvatar[avatar]) ? entityByAvatar[avatar]
                       : (type === "group" && id && entityById[id]) ? entityById[id]
                       : entity;
        folderMatches[folderId].chars.push(entityObj);
    }

    // Sort folder keys: folders first, then orphans
    const folderOrder = Object.keys(folderMatches).sort((a, b) => {
        if (a === ORPHAN_KEY) return 1;
        if (b === ORPHAN_KEY) return -1;
        // By folder name
        const an = (folderMatches[a].folder?.name || '').toLowerCase();
        const bn = (folderMatches[b].folder?.name || '').toLowerCase();
        return an.localeCompare(bn);
    });

    for (const folderId of folderOrder) {
        const { folder, chars } = folderMatches[folderId];
        // Folder label
        const folderLabel = document.createElement('div');
        folderLabel.className = 'stcm_search_folder_label';
        const iconClass = folder && folder.icon ? folder.icon : (folderId === ORPHAN_KEY ? 'fa-folder' : 'fa-folder');
        const icon = document.createElement('i');
        icon.className = `fa-solid ${iconClass}`;
        icon.style.marginRight = "2px";
        icon.style.marginTop = "2px";
        icon.style.fontSize = "0.88em";
        icon.style.opacity = "0.92";
        icon.style.verticalAlign = "top";
        folderLabel.appendChild(icon);

        folderLabel.appendChild(
            document.createTextNode(folder
                ? folder.name
                : "Not in a Folder"
            )
        );
        container.appendChild(folderLabel);

        // Grid container
        const grid = document.createElement('div');
        grid.className = 'stcm_folder_contents_search';

        // Always: characters first, then groups
        const display = chars.slice().sort((a, b) => {
            if (a.type === b.type) return 0;
            if (a.type === "character") return -1;
            return 1;
        });

        display.forEach(entity => {
            // Attach tags at the top level, but keep the entity structure intact
            entity.tags = getTagsForChar(entity.id || entity.item?.avatar, buildTagMap(tags));
            grid.appendChild(renderSidebarCharacterCard(entity));
        });
        
        container.appendChild(grid);
    }
}

function isTagFolderDiveActive() {
    const backs = Array.from(document.querySelectorAll('.bogus_folder_select_back'));
    return backs.some(back =>
        // Only true if inside the real character block, NOT inside template
        back.offsetParent !== null &&
        back.closest('#rm_print_characters_block') && // Must be in main block
        !back.closest('#bogus_folder_back_template')  // ...but NOT in template
    );
}



function hideFolderedCharactersOutsideSidebar(folders) {
    // console.log('HIDE-FOLDERED CALLED', Date.now(), new Error().stack);
    const globalList = document.getElementById('rm_print_characters_block');
    if (!globalList) return;

    // Hide all by default
    for (const el of globalList.querySelectorAll('.character_select, .group_select')) {
        // Don't hide if this element is in the sidebar nav!
        if (el.closest('#stcm_sidebar_folder_nav')) continue;
        el.classList.add('stcm_force_hidden');
    }


        // If we are in a tag folder dive, UNHIDE the right characters
        if (isTagFolderDiveActive()) {
            // 1. Find the back button (start of dive area)
            let backBtn = document.getElementById('BogusFolderBack');
            // 2. Find the block marking the end (the "hidden" info)
            let endBlock = document.querySelector('.text_block.hidden_block');
        
            if (backBtn && endBlock) {
                let el = backBtn.nextElementSibling;
                while (el && el !== endBlock) {
                    // Unhide all characters, groups, and nested bogus folders in this "dive"
                    if (
                        el.classList.contains('character_select') ||
                        el.classList.contains('group_select') ||
                        el.classList.contains('bogus_folder_select')
                    ) {
                        el.classList.remove('stcm_force_hidden');
                        el.classList.add('FoundDiveFolder');
                        document.getElementById('stcm_sidebar_folder_nav')?.classList.add('stcm_dive_hidden');
                        // For debugging:
                        // console.log('UNHIDING:', el);
                    }
                    el = el.nextElementSibling;
                }
            }
        }
        

    // Never hide the bogus folders
    for (const el of globalList.querySelectorAll('.bogus_folder_select')) {
        el.classList.remove('stcm_force_hidden');
    }

    // Optionally: never hide the label
    let label = document.getElementById('stcm_no_folder_label');
    if (label) label.classList.remove('stcm_force_hidden');
}


function hasVisibleChildrenOrCharacters(folderId, folders) {
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return false;

    const isPrivate = !!folder.private;
    const hasPIN = !!sessionStorage.getItem("stcm_pin_okay");

    // Skip truly hidden folders
    if (privateFolderVisibilityMode === 0 && isPrivate) return false;
    if (privateFolderVisibilityMode === 2 && !isPrivate && !hasPIN) {
        // Don't skip yet — might contain private children
    } else if (privateFolderVisibilityMode === 2 && !isPrivate) {
        // If no visible children, skip this folder
        const hasVisibleChild = (folder.children || []).some(childId => {
            return hasVisibleChildrenOrCharacters(childId, folders);
        });
        return hasVisibleChild;
    }

    // Direct characters
    if (Array.isArray(folder.characters) && folder.characters.length > 0) {
        return true;
    }

    // Check child folders recursively
    for (const childId of folder.children || []) {
        if (hasVisibleChildrenOrCharacters(childId, folders)) {
            return true;
        }
    }

    return false;
}


function getVisibleDescendantCharacterCount(folderId, folders) {
    let total = 0;
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return 0;

    // Count characters in this folder
    if (Array.isArray(folder.characters)) {
        total += folder.characters.length;
    }

    for (const childId of folder.children || []) {
        const child = folders.find(f => f.id === childId);
        if (!child) continue;

        const isPrivate = !!child.private;
        if (privateFolderVisibilityMode === 0 && isPrivate) continue;
        if (privateFolderVisibilityMode === 2 && !isPrivate) continue;

        total += getVisibleDescendantCharacterCount(child.id, folders);
    }

    return total;
}

function getEntitiesNotInAnyFolder(folders) {
    const allEntities = getEntitiesList();
    const assigned = new Set();
    folders.forEach(f => {
        if (Array.isArray(f.characters)) {
            f.characters.forEach(val => assigned.add(val));
        }
    });
    return allEntities
        .filter(e => {
            if (e.type === "character" && e.item && e.item.avatar) {
                return !assigned.has(e.item.avatar);
            }
            if (e.type === "group" && e.id) {
                return !assigned.has(e.id);
            }
            return false;
        })
        .sort((a, b) => {
            // Characters come first
            if (a.type === b.type) return 0;
            if (a.type === "character") return -1;
            return 1;
        });
}



export function renderSidebarFolderContents(folders, allEntities, folderId = currentSidebarFolderId) {
    // Only update our sidebar
    const container = document.getElementById('stcm_sidebar_folder_nav');
    if (!container) return;
    container.innerHTML = "";

    // --- Breadcrumb Label ---
    const breadcrumbDiv = document.createElement('div');
    breadcrumbDiv.className = 'stcm_folders_breadcrumb';

    if (folderId === 'root') {
        breadcrumbDiv.textContent = "FOLDERS";
    } else {
        const chain = getFolderChain(folderId, folders);
        if (chain.length > 0) {
            // Add .../ before the first folder
            const names = chain.map(f => f.name);
            names[0] = '.../' + names[0];
            breadcrumbDiv.textContent = names.join(' / ');
        } else {
            breadcrumbDiv.textContent = ".../"; // fallback
        }
    }

    // === Private Folder Toggle Icon ===
    const controlRow = document.createElement('div');
    controlRow.className = 'stcm_folders_header_controls';
    controlRow.style.display = 'flex';
    controlRow.style.alignItems = 'center';
    controlRow.style.gap = '8px';

    const toggleBtn = document.createElement('i');
    toggleBtn.className = 'fa-solid fa-eye-slash stcm_private_toggle_icon';
    toggleBtn.style.cursor = 'pointer';
    toggleBtn.title = 'Click to show private folders';
    toggleBtn.style.fontSize = '1.1em';
    toggleBtn.style.padding = '4px';
    toggleBtn.style.borderRadius = '6px';

    const logoutBtn = document.createElement('i');
    logoutBtn.className = 'fa-solid fa-right-from-bracket stcm_private_logout_icon';
    logoutBtn.style.cursor = 'pointer';
    logoutBtn.style.fontSize = '1.1em';
    logoutBtn.style.padding = '4px';
    logoutBtn.style.borderRadius = '6px';
    logoutBtn.title = 'Log out of private folders';
    logoutBtn.style.display = sessionStorage.getItem("stcm_pin_okay") ? 'inline-block' : 'none';

    logoutBtn.addEventListener('click', () => {
        sessionStorage.removeItem("stcm_pin_okay");
        toastr.info("Private folder access has been locked.");
        logoutBtn.style.display = 'none';
        renderSidebarFolderContents(folders, allEntities, folderId);
    });


    function updateToggleIcon() {
        toggleBtn.classList.remove('fa-eye', 'fa-eye-slash', 'fa-user-secret');

        if (privateFolderVisibilityMode === 0) {
            toggleBtn.classList.add('fa-eye-slash');
            toggleBtn.title = 'Private folders hidden';
        } else if (privateFolderVisibilityMode === 1) {
            toggleBtn.classList.add('fa-eye');
            toggleBtn.title = 'Showing all folders';
        } else if (privateFolderVisibilityMode === 2) {
            toggleBtn.classList.add('fa-user-secret');
            toggleBtn.title = 'Only showing private folders';
        }
    }

    toggleBtn.addEventListener('click', async () => {
        privateFolderVisibilityMode = (privateFolderVisibilityMode + 1) % 3;
    
        if (privateFolderVisibilityMode !== 0) {
            const pinHash = getStoredPinHash();
            if (pinHash && !sessionStorage.getItem("stcm_pin_okay")) {
                const input = await promptInput({
                    label: 'Enter your PIN to unlock private folders:',
                    title: 'Private Folder Access',
                    ok: 'Unlock',
                    cancel: 'Cancel'
                });
                
                if (!input) {
                    privateFolderVisibilityMode = 0;
                    return;
                }
                
                const enteredHash = await hashPin(input);                
                if (enteredHash !== pinHash) {
                    toastr.error("Incorrect PIN.");
                    privateFolderVisibilityMode = 0;
                    return;
                }
                sessionStorage.setItem("stcm_pin_okay", "true");
                logoutBtn.style.display = 'inline-block';
                toastr.success("Private folders unlocked.");
            }
        }

        renderSidebarFolderContents(folders, allEntities, folderId);
    });
    
    updateToggleIcon();
    controlRow.appendChild(toggleBtn);
    controlRow.appendChild(logoutBtn);
    controlRow.appendChild(breadcrumbDiv); // Breadcrumb goes to the right of icon
    container.appendChild(controlRow);


    // ====== Top of Folder List: Orphan Cards ======
    // Top of folder list: show orphan "folder" in root, navigate in
    if (folderId === 'root') {
        const orphanedEntities = getEntitiesNotInAnyFolder(folders);
        if (orphanedEntities.length > 0) {
            const orphanDiv = document.createElement('div');
            orphanDiv.className = 'stcm_folder_sidebar entity_block flex-container wide100p alignitemsflexstart interactable folder_open';
            orphanDiv.setAttribute('data-folder-id', 'orphans');
            orphanDiv.style.cursor = 'pointer';

            orphanDiv.innerHTML = `
                <div class="stcm_folder_main">
                    <div class="avatar flex alignitemscenter textAlignCenter"
                        style="background-color: #8887c2; color: #fff;">
                        <i class="bogus_folder_icon fa-solid fa-cubes-stacked"></i>
                    </div>
                    <span class="ch_name stcm_folder_name" title="[Folder] Cards not in Folder">Cards not in Folder</span>
                    <div class="stcm_folder_counts">
                        <div class="stcm_folder_char_count">${orphanedEntities.length} Card${orphanedEntities.length === 1 ? '' : 's'}</div>
                        <div class="stcm_folder_folder_count" style="opacity:0.5;">0 folders</div>
                    </div>
                </div>
            `;

            orphanDiv.onclick = () => {
                currentSidebarFolderId = 'orphans';
                renderSidebarFolderContents(folders, allEntities, 'orphans');
            };

            container.appendChild(orphanDiv);
        }
        // ... regular children display below
    }

    // --- If in "orphans" pseudo-folder, show just orphans with a back button
    if (folderId === 'orphans') {
        // --- Breadcrumb ---
        const bcDiv = document.createElement('div');
        bcDiv.className = 'stcm_folders_breadcrumb';
        bcDiv.textContent = ".../Cards not in Folder";
        container.appendChild(bcDiv);

        // --- Back Button ---
        const backBtn = document.createElement('div');
        backBtn.className = "sidebar-folder-back";
        backBtn.innerHTML = `<i class="fa-solid fa-arrow-left"></i> Back`;
        backBtn.style.cursor = 'pointer';
        backBtn.onclick = () => {
            currentSidebarFolderId = 'root';
            renderSidebarFolderContents(folders, allEntities, 'root');
        };
        container.appendChild(backBtn);

        // --- Orphaned card grid ---
        const orphanedEntities = getEntitiesNotInAnyFolder(folders);
        const grid = document.createElement('div');
        grid.className = 'stcm_folder_contents';
        orphanedEntities.forEach(entity => {
            const entityCard = renderSidebarCharacterCard(entity);
            grid.appendChild(entityCard);
        });
        container.appendChild(grid);

        // Don't render any children/folders/other stuff
        return;
    }


    const folder = folders.find(f => f.id === folderId);
    if (!folder && folderId !== 'root') return;

    // Show "Back" if not root
    if (folderId !== 'root') {
        const parent = folders.find(f => Array.isArray(f.children) && f.children.includes(folderId));
        if (parent) {
            const backBtn = document.createElement('div');
            backBtn.className = "sidebar-folder-back";
            backBtn.innerHTML = `<i class="fa-solid fa-arrow-left"></i> Back`;
            backBtn.style.cursor = 'pointer';
            backBtn.onclick = () => {
                currentSidebarFolderId = parent.id;
                renderSidebarFolderContents(folders, allEntities, parent.id);
            };
            container.appendChild(backBtn);
        }
    }

        // === NEW: Create folder contents wrapper ===
        let contentDiv = document.getElementById('stcm_folder_contents');
        if (contentDiv) {
            contentDiv.innerHTML = "";
        } else {
            contentDiv = document.createElement('div');
            contentDiv.id = 'stcm_folder_contents';
            contentDiv.className = 'stcm_folder_contents';
        }

    const tagsById = buildTagMap(tags);
    // Show folders (children)
   (folder.children || []).forEach(childId => {
    const child = folders.find(f => f.id === childId);
    if (child) {
        const isPrivate = !!child.private;

        // Count characters and subfolders
        const charCount = child.characters?.length || 0;
        const visibleChildren = (child.children || []).filter(cid => {
            const f = folders.find(f => f.id === cid);
            if (!f) return false;
            if (privateFolderVisibilityMode === 0 && f.private) return false;
            if (privateFolderVisibilityMode === 2 && !f.private) return false;
            return true;
        });
        const folderCount = visibleChildren.length;
        const totalCharCount = getVisibleDescendantCharacterCount(child.id, folders);
        

        const folderDiv = document.createElement('div');
        folderDiv.className = 'stcm_folder_sidebar entity_block flex-container wide100p alignitemsflexstart interactable folder_open';
        folderDiv.setAttribute('data-folder-id', child.id);

        if (isPrivate) {
            folderDiv.classList.add('stcm_folder_private');
            folderDiv.setAttribute('data-private', 'true');
        }

        let shouldHide = false;
        if (child.id !== folderId) {
            shouldHide =
                (privateFolderVisibilityMode === 0 && isPrivate) || 
                (privateFolderVisibilityMode === 2 && !isPrivate && !hasPrivateDescendant(child.id, folders));
        }
        
        if (shouldHide) {
            folderDiv.style.display = 'none';
        }

        folderDiv.style.cursor = 'pointer';
        folderDiv.innerHTML = `
            <div class="stcm_folder_main">
                <div class="avatar flex alignitemscenter textAlignCenter"
                    style="background-color: ${child.color || '#8b2ae6'}; color: #fff;">
                    <i class="bogus_folder_icon fa-solid fa-xl ${child.icon || 'fa-folder-open'}"></i>
                </div>
                <span class="ch_name stcm_folder_name" title="[Folder] ${child.name}">${child.name}</span>
                <div class="stcm_folder_counts">
                <div class="stcm_folder_char_count">${charCount} Character${charCount === 1 ? '' : 's'}</div>
                    <div class="stcm_folder_folder_count">
                        ${folderCount} folder${folderCount === 1 ? '' : 's'}
                        ${totalCharCount > charCount ? ` with ${totalCharCount - charCount} character${(totalCharCount - charCount === 1) ? '' : 's'}` : ''}
                    </div>
             </div>
            </div>
        `;

        const folderIsVisible = hasVisibleChildrenOrCharacters(child.id, folders);

        if (folderIsVisible) {
            folderDiv.onclick = () => {
                currentSidebarFolderId = child.id;
                renderSidebarFolderContents(folders, getEntitiesList(), child.id);
            };
        } else {
            folderDiv.style.cursor = 'default';
            folderDiv.classList.add('stcm_folder_disabled');
            folderDiv.title = 'Empty folder';
            folderDiv.onclick = null;
        }

        contentDiv.appendChild(folderDiv);
    }
});
   

        // Show characters in this folder (full card style)
        (folder.characters || []).forEach(folderVal => {
            const entity = allEntities.find(e =>
                (e.type === "character" && e.item.avatar === folderVal) ||
                (e.type === "group" && e.id === folderVal)
            );
            if (entity) {
                // Just pass the entity as-is!
                const entityCard = renderSidebarCharacterCard(entity);
                contentDiv.appendChild(entityCard);
            }
        });
        
        
        
        
        container.appendChild(contentDiv);
}

function hasPrivateDescendant(folderId, folders) {
    const folder = folders.find(f => f.id === folderId);
    if (!folder || !folder.children) return false;

    for (const childId of folder.children) {
        const child = folders.find(f => f.id === childId);
        if (child) {
            if (child.private) return true;
            if (hasPrivateDescendant(child.id, folders)) return true;
        }
    }
    return false;
}


// Helper to build parent/ancestor folder chain
export function getFolderChain(folderId, folders) {
    const chain = [];
    let current = folders.find(f => f.id === folderId);
    while (current && current.id !== 'root') {
        chain.unshift(current);
        // Find parent
        const parent = folders.find(f => Array.isArray(f.children) && f.children.includes(current.id));
        current = parent;
    }
    return chain;
}

export function getTagsForChar(entityId) {
    const tagIds = tag_map[entityId] || [];
    const tagsById = buildTagMap(tags);
    return tagIds.map(id => tagsById.get(id)).filter(Boolean);
}


export function showFolderColorPicker(folder, rerender) {
    const container = document.createElement('div');
    container.innerHTML = `
        <label>Folder Color:</label>
        <input type="color" value="${folder.color || '#8b2ae6'}" class="stcm-folder-color-input" style="margin-left: 1em; width: 40px; height: 40px;">
    `;
    callGenericPopup(container, POPUP_TYPE.CONFIRM, 'Set Folder Color', {
        okButton: 'Save Color',
        cancelButton: 'Cancel'
    }).then(async result => {
        if (result !== POPUP_RESULT.AFFIRMATIVE) return;
        const colorInput = container.querySelector('.stcm-folder-color-input');
        const color = colorInput.value || '#8b2ae6';
        const folders = await stcmFolders.setFolderColor(folder.id, color);
        await updateSidebar(true);
        rerender && rerender(folders);
    });
}

function getEntityChid(entity) {
    if (!entity) return undefined;
    // Top-level id is always preferred
    if ('id' in entity && entity.id !== undefined) return entity.id;
    // Sometimes passed a flattened { ...item }
    if ('avatar' in entity) return entity.avatar;
    // Defensive fallback
    return undefined;
}

export function renderSidebarCharacterCard(entity) {
    // ALWAYS pass the full entity, not just ent
    const chid = getEntityChid(entity);
        // Flatten
    let ent = entity.item ? { ...entity.item, id: entity.id, type: entity.type, tags: entity.tags } : entity;

    let avatarUrl = ent.avatar || ent.avatar_url || 'img/unknown.png';
    let desc = ent.description || ent.creatorcomment || "";
    let isGroup = ent.type === 'group';

    // Escape dangerous fields
    const escapedName = escapeHtml(ent.name || "");
    const escapedDesc = escapeHtml(desc || "");

    const div = document.createElement('div');
    div.className = 'character_select entity_block flex-container wide100p alignitemsflexstart interactable stcm_sidebar_character_card';
    div.setAttribute('chid', chid);
    div.setAttribute('data-chid', chid);
    
    div.tabIndex = 0;
    
    let avatarHtml;
    if (isGroup && Array.isArray(ent.members) && ent.members.length > 0) {
        // Use up to 3 member avatars for the collage
        let members = ent.members.slice(0, 3);
        avatarHtml = `
            <div class="avatar avatar_collage collage_${members.length}" title="[Group] ${escapedName}">
                ${members.map((mem, i) =>
                    `<img alt="img${i+1}" class="img_${i+1}" src="/thumbnail?type=avatar&file=${encodeURIComponent(mem)}">`
                ).join('')}
            </div>
        `;
    } else {
        // Single avatar for character
        avatarHtml = `
            <div class="avatar" title="[Character] ${escapedName}\nFile: ${escapeHtml(avatarUrl)}">
                <img src="${avatarUrl.startsWith('img/') ? avatarUrl : '/thumbnail?type=avatar&file=' + encodeURIComponent(avatarUrl)}" alt="${escapedName}">
            </div>
        `;
    }
    
    div.innerHTML = `
        ${avatarHtml}
        <div class="flex-container wide100pLess70px character_select_container">
            <div class="wide100p character_name_block">
                <span class="ch_name" title="[${isGroup ? 'Group' : 'Character'}] ${escapedName}">${escapedName}</span>
                <small class="ch_additional_info ch_add_placeholder">+++</small>
                <small class="ch_additional_info ch_avatar_url"></small>
            </div>
            <i class="ch_fav_icon fa-solid fa-star" style="display: none;"></i>
            <input class="ch_fav" value="" hidden="" keeper-ignore="">
            <div class="ch_description">${escapedDesc}</div>
            <div class="tags tags_inline">
                ${(ent.tags || []).map(tag =>
                    `<span class="tag" style="background-color: ${tag.color || ''}; color: ${tag.color2 || ''};">
                        <span class="tag_name">${tag.name}</span>
                    </span>`
                ).join('')}
            </div>
        </div>
    `;

    return div;
}


export function watchSidebarFolderInjection() {
    const container = document.getElementById('rm_print_characters_block');
    if (!container) return;
    if (stcmObserver) stcmObserver.disconnect();

    const getCurrentAvatars = () => {
        return Array.from(container.querySelectorAll('.character_select img[src*="/thumbnail?type=avatar&file="]'))
            .map(img => {
                const url = new URL(img.src, window.location.origin);
                return decodeURIComponent(url.searchParams.get("file") || "");
            })
            .sort();
    };

    const arraysEqual = (a, b) => (
        a.length === b.length && a.every((val, idx) => val === b[idx])
    );

    const debouncedInject = debounce(async () => {
        if (suppressSidebarObserver) return;
        const sidebar = container.querySelector('#stcm_sidebar_folder_nav');
        const currentAvatars = getCurrentAvatars();

        // Always inject if missing
        if (!sidebar) {
            await updateSidebar(true);
            lastKnownCharacterAvatars = getCurrentAvatars();
            lastSidebarInjection = Date.now();
            return;
        }
        // Only update if avatars changed
        if (!arraysEqual(currentAvatars, lastKnownCharacterAvatars)) {
            await updateSidebar(true);
            lastKnownCharacterAvatars = getCurrentAvatars();
            lastSidebarInjection = Date.now();
        }
    }, 150);

    if (stcmObserver) stcmObserver.disconnect();
    stcmObserver = new MutationObserver(debouncedInject);
    stcmObserver.observe(container, { childList: true, subtree: false });

    // Initial state
    lastKnownCharacterAvatars = getCurrentAvatars();
}



export function makeFolderNameEditable(span, folder, rerender) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = folder.name;
    input.className = 'stcm-folder-name-input menu_input';
    input.style.width = Math.max(80, span.offsetWidth + 20) + 'px';

    let alreadySaved = false;

    const save = async () => {
        if (alreadySaved) return;
        alreadySaved = true;

        const val = input.value.trim();
        if (val && val !== folder.name) {
            const folders = await stcmFolders.renameFolder(folder.id, val);
            await updateSidebar(true);
            rerender && rerender(folders);
        } else {
            await updateSidebar(true);
            rerender && rerender();
        }
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { alreadySaved = true; rerender(); }
    });

    span.replaceWith(input);
    input.focus();
    input.select();
}


export function showIconPicker(folder, parentNode, rerender) {
    const icons = [
        // === Utility/Folders ===
        'fa-folder', 'fa-folder-open', 'fa-archive', 'fa-box', 'fa-boxes-stacked',
        'fa-book', 'fa-book-bookmark', 'fa-book-skull', 'fa-journal-whills', 'fa-address-book',
    
        // === People / Avatars ===
        'fa-users', 'fa-user', 'fa-user-astronaut', 'fa-user-ninja', 'fa-user-gear', 'fa-user-secret', 'fa-user-nurse', 'fa-person', 'fa-person-dress', 
    
        // === Gaming Icons ===
        'fa-dice-six',            // only one dice
        'fa-chess-knight', 'fa-chess-rook', 'fa-chess-queen', 'fa-chess-bishop', 'fa-chess-pawn',
        'fa-chess',               // classic board
        'fa-gamepad',             // generic gamepad
        'fa-dungeon', 'fa-dragon', // fantasy
        'fa-tower-cell', 'fa-tower-observation',

        // === Emoji Icons ===
        'fa-face-smile', 'fa-face-meh', 'fa-face-frown', 'fa-face-laugh', 'fa-face-surprise',
        'fa-face-grin', 'fa-face-grin-stars', 'fa-face-grin-beam', 'fa-face-grin-squint',
        'fa-face-grin-wink', 'fa-face-grin-wide', 'fa-face-grin-tears', 'fa-face-kiss',
        'fa-face-kiss-wink-heart', 'fa-face-dizzy', 'fa-face-tired', 'fa-face-angry',
        'fa-face-sad-cry', 'fa-face-sad-tear', 'fa-face-grin-hearts', 'fa-face-grin-tongue',
        'fa-face-grin-tongue-wink', 'fa-face-grin-tongue-squint', 'fa-face-grin-beam-sweat',
        
        // === Halloween Icons ===
        'fa-ghost', 'fa-hat-wizard', 'fa-skull', 'fa-skull-crossbones', 'fa-spider', 'fa-spaghetti-monster-flying',
        'fa-broom', 'fa-candy-cane', 'fa-bone', 'fa-mask', 'fa-moon', 'fa-star-half-stroke', 'fa-icicles',
    
        // === Animal Icons ===
        'fa-dog', 'fa-cat', 'fa-crow', 'fa-frog', 'fa-dove', 'fa-otter', 'fa-fish', 'fa-horse', 'fa-spider', 'fa-hippo', 'fa-feather', 'fa-feather-pointed', 'fa-paw', 
        'fa-dragon', 'fa-dove', 'fa-cow', 'fa-dove', 'fa-bug', 'fa-worm', 'fa-shrimp',
    
        // === Nature / Elements ===
        'fa-leaf', 'fa-tree', 'fa-mountain', 'fa-fire', 'fa-icicles', 'fa-cloud', 'fa-cloud-sun', 'fa-cloud-moon', 'fa-moon', 'fa-sun', 'fa-gem', 'fa-heart',
    
        // === Fantasy / Magic ===
        'fa-wand-magic', 'fa-wand-magic-sparkles', 'fa-hat-wizard', 'fa-flask', 'fa-flask-vial', 'fa-microscope', 'fa-brain', 'fa-lightbulb',
    
        // === Security ===
        'fa-shield', 'fa-shield-halved', 'fa-lock', 'fa-unlock', 'fa-key',
    
        // === Miscellaneous/Science/Tech ===
        'fa-robot', 'fa-rocket', 'fa-gears', 'fa-screwdriver-wrench', 'fa-anchor', 'fa-compass', 'fa-globe', 'fa-map', 'fa-location-dot',
    
        // === Other fun or thematic ===
        'fa-star', 'fa-bolt', 'fa-broom', 'fa-anchor', 'fa-candy-cane'
    ];
    

    const popup = document.createElement('div');
    popup.className = 'stcm-icon-picker-popup';
    popup.style.position = 'fixed';
    popup.style.background = '#222';
    popup.style.border = '1px solid #444';
    popup.style.borderRadius = '8px';
    popup.style.padding = '16px 12px 10px 12px';
    popup.style.zIndex = 10000;
    popup.style.minWidth = '270px';
    popup.style.maxHeight = '80vh';
    popup.style.overflowY = 'auto';
    popup.style.overflowX = 'hidden';

    // --- Instructions & custom field ---
    const instr = document.createElement('div');
    instr.innerHTML = `
        <div style="margin-bottom:8px; font-size: 0.97em;">
            <b>Choose an icon below</b> or type your own Font Awesome icon class.
            <br>
            <a href="https://fontawesome.com/search?m=free" target="_blank" style="color:#6ec0ff; text-decoration:underline; font-size: 0.96em;">
                Browse all free icons
            </a>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:7px;">
            <input type="text" id="stcmCustomIconInput" placeholder="e.g. fa-dragon" style="flex:1;min-width:0;padding:4px 8px;border-radius:4px;border:1px solid #444;background:#181818;color:#eee;">
            <button class="stcm_menu_button tiny" id="stcmSetCustomIconBtn" style="padding:3px 8px;">Set</button>
        </div>
        <div id="stcmIconError" style="color:#fa7878;font-size:0.93em;min-height:18px;"></div>
    `;
    popup.appendChild(instr);

    // --- Icon grid ---
    const grid = document.createElement('div');
    grid.className = 'stcm-icon-grid';
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(11, 32px)';
    grid.style.gap = '8px';

    icons.forEach(ico => {
        const btn = document.createElement('button');
        btn.className = 'stcm-icon-btn stcm_menu_button tiny';
        btn.innerHTML = `<i class="fa-solid ${ico} fa-fw"></i>`;
        btn.title = ico.replace('fa-', '').replace(/-/g, ' ');
        btn.style.background = 'none';
        btn.style.border = 'none';
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', async () => {
            const folders = await stcmFolders.setFolderIcon(folder.id, ico);
            await updateSidebar(true);
            rerender && rerender(folders);
            popup.remove();
        });
        grid.appendChild(btn);
    });
    popup.appendChild(grid);

    // --- Custom icon logic ---
    const customInput = instr.querySelector('#stcmCustomIconInput');
    const customBtn = instr.querySelector('#stcmSetCustomIconBtn');
    const errorDiv = instr.querySelector('#stcmIconError');

    customBtn.addEventListener('click', async () => {
        let val = customInput.value.trim();
        if (!val) {
            errorDiv.textContent = 'Please enter a Font Awesome icon class or tag.';
            return;
        }
    
        let classStr = '';
    
        if (val.startsWith('<i') && val.includes('class=')) {
            try {
                const temp = document.createElement('div');
                temp.innerHTML = val;
                const iTag = temp.querySelector('i');
                if (!iTag || !iTag.classList.length) throw new Error('Invalid <i> tag');
                classStr = iTag.className;
            } catch (e) {
                errorDiv.textContent = 'Could not parse <i> tag.';
                return;
            }
        } else {
            classStr = val;
        }
    
        // Split and normalize
        const parts = classStr.trim().split(/\s+/);
        const iconClass = parts.find(c =>
            c.startsWith('fa-') &&
            !['fa-solid', 'fa-regular', 'fa-brands', 'fa-light', 'fa-thin', 'fa-duotone', 'fa-sharp'].includes(c)
        );
    
        if (!iconClass) {
            errorDiv.textContent = 'No valid Font Awesome icon class found (e.g. fa-dragon).';
            return;
        }
    
        try {
            const folders = await stcmFolders.setFolderIcon(folder.id, iconClass);
            await updateSidebar(true);
            rerender && rerender(folders);
            popup.remove();
        } catch (err) {
            errorDiv.textContent = 'Failed to apply icon: ' + (err.message || err);
        }
    });
    

    customInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') customBtn.click();
    });

    // --- Close on outside click ---
    function onClose(e) {
        if (!popup.contains(e.target)) popup.remove(), document.removeEventListener('mousedown', onClose, true);
    }
    setTimeout(() => document.addEventListener('mousedown', onClose, true), 10);

    document.body.appendChild(popup);
    const rect = parentNode.getBoundingClientRect();
    
    // Default placement
    popup.style.left = (rect.left + 60) + "px";
    popup.style.top = rect.top + "px";
    
    // Wait for popup to render to measure
    requestAnimationFrame(() => {
        const popupRect = popup.getBoundingClientRect();
        const margin = 10;
    
        // Clamp to right edge
        if (popupRect.right > window.innerWidth - margin) {
            popup.style.left = `${window.innerWidth - popupRect.width - margin}px`;
        }
    
        // Clamp to bottom edge
        if (popupRect.bottom > window.innerHeight - margin) {
            popup.style.top = `${window.innerHeight - popupRect.height - margin}px`;
        }
    });
}


export function confirmDeleteFolder(folder, rerender) {
    const hasChildren = Array.isArray(folder.children) && folder.children.length > 0;
    // Compute character assignments:
    const folders = window.STCM?.sidebarFolders || []; // or however you have access to all folders
    const getDescendants = (f, all) => {
        let result = [];
        if (!Array.isArray(f.children)) return result;
        f.children.forEach(cid => {
            const child = all.find(ff => ff.id === cid);
            if (child) {
                result.push(child);
                result.push(...getDescendants(child, all));
            }
        });
        return result;
    };

    // Only direct characters for the default "move children to Root" option
    const directCharCount = Array.isArray(folder.characters) ? folder.characters.length : 0;

    // If cascade: count all assigned characters in folder + descendants
    const descendants = getDescendants(folder, folders);
    const cascadeCharCount = [folder, ...descendants]
        .reduce((sum, f) => sum + (Array.isArray(f.characters) ? f.characters.length : 0), 0);

    // Build popup
    const html = document.createElement('div');
    html.innerHTML = `
        <h3>Delete Folder</h3>
        <p>Delete <strong>${escapeHtml(folder.name)}</strong>?</p>
        ${hasChildren ? `
            <p>This folder contains <b>${folder.children.length}</b> sub-folder${folder.children.length > 1 ? 's' : ''}.</p>
            <label style="display:block;margin:4px 0;">
                <input type="radio" name="delMode" value="cascade" checked>
                Delete this folder <b>and</b> all sub-folders
            </label>
            <label style="display:block;margin:4px 0;">
                <input type="radio" name="delMode" value="move">
                Delete this folder and <b>move</b> its sub-folders to Root
            </label>
        ` : ''}
        ${(hasChildren && cascadeCharCount > 0) || (!hasChildren && directCharCount > 0) ? `
            <p style="margin-top: 10px;">
                <b>
                    ${
                        hasChildren
                            ? (`
                                <span class="cascadeCharCount" style="display: ${'cascade'};">This folder and its subfolders have ${cascadeCharCount} characters assigned.</span>
                                <span class="directCharCount" style="display: ${'none'};">This folder has ${directCharCount} character${directCharCount === 1 ? '' : 's'} assigned.</span>
                            `)
                            : `This folder has ${directCharCount} character${directCharCount === 1 ? '' : 's'} assigned.`
                    }
                </b>
            </p>
            <label style="display:block;margin:4px 0 0 12px;">
                <input type="radio" name="moveMode" value="move" checked>
                Move assigned characters to parent folder
            </label>
            <label style="display:block;margin:4px 0 0 12px;">
                <input type="radio" name="moveMode" value="unassign">
                Remove all assigned characters from folders
            </label>
        ` : ''}
        <p style="color:#e57373;">This cannot be undone.</p>
    `;

    // Live update visibility of char count labels based on mode
    if (hasChildren) {
        html.querySelectorAll('input[name="delMode"]').forEach(radio => {
            radio.addEventListener('change', () => {
                const isCascade = html.querySelector('input[name="delMode"]:checked').value === 'cascade';
                html.querySelector('.cascadeCharCount').style.display = isCascade ? '' : 'none';
                html.querySelector('.directCharCount').style.display = isCascade ? 'none' : '';
            });
        });
    }

    callGenericPopup(html, POPUP_TYPE.CONFIRM, 'Delete Folder')
        .then(async res => {
            if (res !== POPUP_RESULT.AFFIRMATIVE) return;

            const mode = hasChildren
                ? html.querySelector('input[name="delMode"]:checked').value
                : 'cascade';
            const cascade = (mode === 'cascade');

            // Only show/ask about character move if there are any
            let moveChars = false;
            if ((cascade && cascadeCharCount > 0) || (!cascade && directCharCount > 0)) {
                moveChars = html.querySelector('input[name="moveMode"]:checked').value === 'move';
            }

            // Pass new options to deleteFolder
            const folders = await stcmFolders.deleteFolder(folder.id, cascade, moveChars);
            await updateSidebar(true);
            rerender && rerender(folders);
            toastr.success(
                cascade
                    ? 'Folder and all sub-folders deleted'
                    : 'Folder deleted – sub-folders moved to Root'
            );
        });
}


function walkFolderTree(folderId, folders, opts = {}, depth = 0) {
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return opts.collector || [];

    // 1. For descendant IDs
    if (opts.mode === 'descendants') {
        let ids = [];
        for (const childId of folder.children || []) {
            ids.push(childId);
            ids = ids.concat(walkFolderTree(childId, folders, opts, depth + 1));
        }
        return ids;
    }
    // 2. For max depth
    if (opts.mode === 'maxDepth') {
        let maxDepth = depth + 1;
        for (const childId of folder.children || []) {
            const childDepth = walkFolderTree(childId, folders, opts, depth + 1);
            if (childDepth > maxDepth) maxDepth = childDepth;
        }
        return maxDepth;
    }
    // 3. For options tree
    if (opts.mode === 'options') {
        let options = [];
        if (!opts.excludeIds || !opts.excludeIds.includes(folderId)) {
            const indent = "&nbsp;".repeat(depth * 4);
            options.push({
                id: folder.id,
                name: (folder.id === "root" ? "Top Level (Root)" : indent + escapeHtml(folder.name)),
                depth: depth,
            });
        }
        for (const childId of folder.children || []) {
            options = options.concat(
                walkFolderTree(childId, folders, opts, depth + 1)
            );
        }
        return options;
    }
    return [];
}

export function getAllDescendantFolderIds(folderId, folders) {
    return walkFolderTree(folderId, folders, { mode: 'descendants' }, 0);
}
export function getMaxFolderSubtreeDepth(folderId, folders) {
    return walkFolderTree(folderId, folders, { mode: 'maxDepth' }, 0);
}
export function getFolderOptionsTree(folders, excludeIds = [], parentId = "root", depth = 0) {
    return walkFolderTree(parentId, folders, { mode: 'options', excludeIds }, depth);
}


export function showChangeParentPopup(folder, allFolders, rerender) {
    const currentId = folder.id;

    // 1. Exclude descendants (and self)
    const descendants = getAllDescendantFolderIds(currentId, allFolders);
    descendants.push(currentId);

    // 2. Compute how deep this folder's tree is
    const subtreeDepth = getMaxFolderSubtreeDepth(currentId, allFolders); // e.g., 3

    // 3. Only allow destination if it will not violate max depth
    const MAX_DEPTH = 5; // whatever your limit is

    const validFolders = allFolders.filter(f => {
        if (descendants.includes(f.id)) return false; // can't move into self or descendants
        const destDepth = getFolderDepth(f.id, allFolders);
        // If destination is "root", depth = 0, so max possible new depth = subtreeDepth-1
        // So destDepth + subtreeDepth - 1 < MAX_DEPTH
        return (destDepth + subtreeDepth - 1) < MAX_DEPTH;
    });

        // Build hierarchical option list
    const optionsTree = getFolderOptionsTree(allFolders, descendants);

    // Now, only include those in validFolders
    const validOptionIds = new Set(validFolders.map(f => f.id));
    const validOptions = optionsTree.filter(opt => validOptionIds.has(opt.id));

    const container = document.createElement('div');
    container.innerHTML = `
        <label><b>Choose New Parent Folder</b></label><br>
        <select style="width:100%;margin:12px 0;" id="stcmMoveFolderSelect">
        ${validOptions.map(f =>
            `<option value="${f.id}" ${f.id === folder.parentId ? 'selected' : ''}>${f.name}</option>`
        ).join('')}
        </select>
        <div style="font-size:0.93em;color:#fa7878;" id="stcmMoveFolderError"></div>
    `;

    callGenericPopup(container, POPUP_TYPE.CONFIRM, 'Move Folder', {
        okButton: 'Move Folder',
        cancelButton: 'Cancel'
    }).then(async result => {
        if (result !== POPUP_RESULT.AFFIRMATIVE) return;
        const select = container.querySelector('#stcmMoveFolderSelect');
        const newParentId = select.value;
        if (newParentId === folder.parentId) return; // No change
        try {
            const folders = await stcmFolders.moveFolder(folder.id, newParentId);
            await updateSidebar(true);
            rerender && rerender(folders);
        } catch (e) {
            const errDiv = container.querySelector('#stcmMoveFolderError');
            errDiv.textContent = e.message || "Failed to move folder.";
        }
    });
    
}

function getFolderDepth(folderId, folders) {
    let depth = 0;
    let current = folders.find(f => f.id === folderId);
    while (current && current.id !== "root") {
        const parent = folders.find(f => Array.isArray(f.children) && f.children.includes(current.id));
        if (!parent) break;
        depth++;
        current = parent;
    }
    return depth;
}



export async function reorderChildren(parentId, orderedChildIds) {
    const folders = await stcmFolders.loadFolders();
    const parent = folders.find(f => f.id === parentId);
    if (!parent) throw new Error("Parent folder not found.");

    // Validate all IDs exist and belong to the same parent
    const validIds = new Set(parent.children);
    if (!orderedChildIds.every(id => validIds.has(id))) {
        throw new Error("Invalid child IDs in reordering.");
    }

    parent.children = orderedChildIds;
    return await stcmFolders.saveFolders(folders); // persist and return new array
}
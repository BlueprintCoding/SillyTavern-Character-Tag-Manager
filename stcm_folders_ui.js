// stcm_folders_ui.js
import { 
    debounce, 
    buildTagMap, 
    escapeHtml,
    getStoredPinHash, 
    hashPin,
    promptInput
    } from './utils.js';

import * as stcmFolders from './stcm_folders.js';

import {
    tags,
    tag_map,
} from "../../../tags.js";

import {
    fuzzySearchCharacters,
    fuzzySearchGroups,
    fuzzySearchTags
} from "../../../power-user.js";

import {
    eventSource, 
    event_types,
    getEntitiesList,
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
    // console.log("ST Entities List:", getEntitiesList());
    const entityMap = stcmFolders.buildEntityMap();
    // console.log("STCM Entity Map:", Array.from(entityMap.values()));

    const parent = document.getElementById('rm_print_characters_block');
    if (!parent) return;

    let existingSidebar = document.getElementById('stcm_sidebar_folder_nav');
    if (existingSidebar) existingSidebar.remove();

    let sidebar = document.createElement('div');
    sidebar.id = 'stcm_sidebar_folder_nav';
    sidebar.className = 'stcm_sidebar_folder_nav';
    parent.insertBefore(sidebar, parent.firstChild);

    const allEntities = getEntitiesList();
    if (stcmSearchActive && stcmSearchTerm) {
        // Entity map keyed by both character CHID and group ID for convenience
        const entityMap = stcmFolders.buildEntityMap();
        const entitiesById = Object.fromEntries([...entityMap].map(([id, ent]) => [id, ent]));
    
        // --- Fuzzy search ---
        const charResults  = fuzzySearchCharacters(stcmSearchTerm); // array of Fuse results
        const groupResults = fuzzySearchGroups(stcmSearchTerm);     // array of Fuse results
        const tagResults   = fuzzySearchTags(stcmSearchTerm);       // array of Fuse results
    
        console.log("entityMap keys:", [...entityMap.keys()]);
        console.log("charResults sample:", charResults.slice(0,20));

        // --- Filter and prepare Character & Group results (privacy-aware) ---
        const filteredCharEntities = charResults
        .sort((a, b) => a.score - b.score)
        .map(r => entityMap.get(r.item.avatar || r.item.id))
        .filter(ent => ent && (privateFolderVisibilityMode !== 0 || !ent.folderIsPrivate));
        const filteredGroupEntities = groupResults
        .sort((a, b) => a.score - b.score)
        .map(r => entityMap.get(r.item.id))
        .filter(ent => ent && (privateFolderVisibilityMode !== 0 || !ent.folderIsPrivate));

    
        // --- Tags are different: display only tags, but show privacy marker if all characters/groups with that tag are private ---
        const filteredTags = tagResults
            .map(r => r.item)
            .filter(tag => {
                // Find all entities with this tag and check privacy
                const hasVisibleEntity = [...entityMap.values()].some(ent =>
                    ent.tagIds?.includes(tag.id) &&
                    (privateFolderVisibilityMode !== 0 || !ent.folderIsPrivate)
                );
                return hasVisibleEntity;
            });
    
        // --- Render Unified Search Results ---
        renderSidebarUnifiedSearchResults(filteredCharEntities, filteredGroupEntities, filteredTags, stcmSearchTerm, folders, entityMap);
    }
    else {
        renderSidebarFolderContents(folders, getEntitiesList(), currentSidebarFolderId);
    }
    
    injectSidebarSearchBox();
    removeCharacterSortSelect();
    setupSortOrderListener();
    insertNoFolderLabelIfNeeded();
    injectResetViewButton();
}

function renderSidebarUnifiedSearchResults(chars, groups, tags, searchTerm, folders, entityMap) {
    const container = document.getElementById('stcm_sidebar_folder_nav');
    if (!container) return;
    container.innerHTML = "";

    // Deduplicate (in case an entity appears as both char & group)
    const shownChids = new Set();

    // Characters
    if (chars.length) {
        const header = document.createElement('div');
        header.className = 'stcm_search_section_header';
        header.textContent = "Characters";
        container.appendChild(header);
        const charGrid = document.createElement('div');
        charGrid.className = 'stcm_folder_contents_search';
        chars.forEach(entity => {
            if (!entity || shownChids.has(entity.id)) return;
            charGrid.appendChild(renderSidebarCharacterCard(entity));
            shownChids.add(entity.id);
        });
        container.appendChild(charGrid);
    }

    // Groups
    if (groups.length) {
        const header = document.createElement('div');
        header.className = 'stcm_search_section_header';
        header.textContent = "Groups";
        container.appendChild(header);
        const groupGrid = document.createElement('div');
        groupGrid.className = 'stcm_folder_contents_search';
        groups.forEach(entity => {
            if (!entity || shownChids.has(entity.id)) return;
            groupGrid.appendChild(renderSidebarCharacterCard(entity));
            shownChids.add(entity.id);
        });
        container.appendChild(groupGrid);
    }

    // Tags
    if (tags.length) {
        const header = document.createElement('div');
        header.className = 'stcm_search_section_header';
        header.textContent = "Tags";
        container.appendChild(header);
        const tagGrid = document.createElement('div');
        tagGrid.className = 'stcm_folder_contents_search';
        tags.forEach(tag => {
            const div = document.createElement('div');
            div.className = 'tag_select entity_block flex-container wide100p alignitemsflexstart stcm_sidebar_tag_card';
            div.textContent = tag.name;
            div.style.background = tag.color || '#333';
            div.style.color = tag.color2 || '#fff';
            const allPrivate = [...entityMap.values()].filter(ent =>
                ent.tagIds?.includes(tag.id)
            ).every(ent => ent.folderIsPrivate);
            if (allPrivate) {
                div.innerHTML += ` <i class="fa-solid fa-lock" title="All assignments are private"></i>`;
            }
            tagGrid.appendChild(div);
        });
        container.appendChild(tagGrid);
    }

    if (!chars.length && !groups.length && !tags.length) {
        const nothing = document.createElement('div');
        nothing.className = "stcm_search_no_results";
        nothing.textContent = `No matches for "${searchTerm}"`;
        container.appendChild(nothing);
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

export function hideFolderedCharactersOutsideSidebar(folders) {
    // console.log('HIDE-FOLDERED CALLED', Date.now(), new Error().stack);
    const globalList = document.getElementById('rm_print_characters_block');
    if (!globalList) return;
    console.log(
        "shouldShowAllCharacters:", shouldShowAllCharacters(),
        "isAnyRealTagActive:", isAnyRealTagActive(),
        "isSTCMSortActive:", isSTCMSortActive()
      );
     // --- NEW: Check for tag selection and short-circuit hiding ---
     if (shouldShowAllCharacters()) {
        // If a tag is selected, do NOT hide any characters; just unhide all.
        for (const el of globalList.querySelectorAll('.character_select, .group_select')) {
            el.classList.remove('stcm_force_hidden');
        }
        // Also never hide bogus folders or the label
        for (const el of globalList.querySelectorAll('.bogus_folder_select')) {
            el.classList.remove('stcm_force_hidden');
        }
        let label = document.getElementById('stcm_no_folder_label');
        if (label) label.classList.remove('stcm_force_hidden');
        return;
    }

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

function shouldShowAllCharacters() {
    return isAnyRealTagActive() || !isSTCMSortActive();
}

function isAnyRealTagActive() {
    // Control tag classes to ignore
    const controlTagClasses = [
        'manageTags',
        'showTagList',
        'clearAllFilters'
    ];
    const tagControls = document.querySelector('.rm_tag_controls .tags.rm_tag_filter');
    if (!tagControls) return false;

    // Find all tags with either 'selected' OR 'excluded'
    const activeTags = tagControls.querySelectorAll('.tag.selected, .tag.excluded');
    for (const tag of activeTags) {
        // Ignore if this tag is a control tag
        if (!controlTagClasses.some(cls => tag.classList.contains(cls))) {
            return true; // Found a real, active tag
        }
    }
    return false;
}

function isSTCMSortActive() {
    const sortSelect = document.getElementById('character_sort_order');
    if (!sortSelect) {
        console.log("sortSelect not found!");
        return false;
    }
    const selected = sortSelect.selectedOptions ? sortSelect.selectedOptions[0] : sortSelect.options[sortSelect.selectedIndex];
    console.log("Selected sort value:", selected?.value, "data-field:", selected?.getAttribute('data-field'));
    return selected && (selected.value === "stcm" || selected.getAttribute('data-field') === 'stcm');
}


function setupSortOrderListener() {
    const sortSelect = document.getElementById('character_sort_order');
    if (!sortSelect) return;
    sortSelect.addEventListener('change', () => {
        // Re-run your show/hide logic on sort change
        console.log("hidecharsfired");
        hideFolderedCharactersOutsideSidebar(STCM.sidebarFolders);
    });
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

export function getEntityChid(entity) {
    if (!entity) return undefined;
    // Top-level id is always preferred
    if ('id' in entity && entity.id !== undefined) return entity.id;
    // Sometimes passed a flattened { ...item }
    if ('avatar' in entity) return entity.avatar;
    // Defensive fallback
    return undefined;
}

export function renderSidebarCharacterCard(entity) {
    // Flatten out entity (either .item or just entity)
    const ent = entity.item
        ? { ...entity.item, id: entity.id, type: entity.type, tags: entity.tags }
        : entity;

    // Determine if it's a group or character
    const isGroup = ent.type === "group";
    const groupId = isGroup ? ent.id : null;
    const chid = (!isGroup && typeof entity.chid !== "undefined") ? entity.chid : undefined;

    // Group name & count
    const name = ent.name || "";
    const escapedName = escapeHtml(name);
    const tagHtml = (ent.tags || []).map(tag =>
        `<span id="${tag.id}" class="tag">
            <span class="tag_name">${tag.name}</span>
            <i class="fa-solid fa-circle-xmark tag_remove interactable" tabindex="0" style="display: none;"></i>
        </span>`
    ).join('');

    if (isGroup) {
        // Use avatar array for group collage
        let memberFiles = Array.isArray(ent.avatar) ? ent.avatar : [];
        const div = document.createElement('div');
        div.className = 'group_select entity_block flex-container wide100p alignitemsflexstart interactable';
        div.setAttribute('tabindex', '0');
        div.setAttribute('data-grid', groupId);
    
        // Collage avatars (up to 3)
        const avatarHtml = `
            <div class="avatar avatar_collage collage_${memberFiles.length}" title="[Group] ${escapedName}">
                ${memberFiles.slice(0, 3).map((file, i) =>
                    `<img alt="img${i+1}" class="img_${i+1}" src="/thumbnail?type=avatar&file=${encodeURIComponent(file)}">`
                ).join('')}
            </div>
        `;
        // Names
        const memberNames = memberFiles.map(f =>
            (typeof f === "string" ? f.replace(/\.[^/.]+$/, "") : f)
        ).join(", ");
    
        div.innerHTML = `
            ${avatarHtml}
            <div class="flex-container wide100pLess70px gap5px group_select_container">
                <div class="wide100p group_name_block character_name_block">
                    <div class="ch_name" title="[Group] ${escapedName}">${escapedName}</div>
                    <small class="ch_additional_info group_select_counter">${memberFiles.length} character${memberFiles.length === 1 ? "" : "s"}</small>
                </div>
                <small class="character_name_block_sub_line" data-i18n="in this group">in this group</small>
                <i class="group_fav_icon fa-solid fa-star" style="display: none;"></i>
                <input class="ch_fav" value="" hidden="" keeper-ignore="">
                <div class="group_select_block_list ch_description">${memberNames}</div>
                <div class="tags tags_inline">${tagHtml}</div>
            </div>
        `;
        return div;
    }
     else {
        // --- CHARACTER CARD ---
        let avatarUrl = ent.avatar || ent.avatar_url || 'img/ai4.png';
        if (typeof avatarUrl !== 'string') avatarUrl = String(avatarUrl ?? 'img/ai4.png');
        const escapedDesc = escapeHtml(ent.description || ent.creatorcomment || "");

        const div = document.createElement('div');
        div.className = 'character_select entity_block flex-container wide100p alignitemsflexstart interactable stcm_sidebar_character_card';
        div.setAttribute('chid', chid);
        div.setAttribute('data-chid', chid);
        div.tabIndex = 0;

        div.innerHTML = `
            <div class="avatar" title="[Character] ${escapedName}\nFile: ${escapeHtml(avatarUrl)}">
                <img src="${avatarUrl.startsWith('img/') ? avatarUrl : '/thumbnail?type=avatar&file=' + encodeURIComponent(avatarUrl)}" alt="${escapedName}">
            </div>
            <div class="flex-container wide100pLess70px character_select_container">
                <div class="wide100p character_name_block">
                    <span class="ch_name" title="[Character] ${escapedName}">${escapedName}</span>
                    <small class="ch_additional_info ch_add_placeholder">+++</small>
                    <small class="ch_additional_info ch_avatar_url"></small>
                </div>
                <i class="ch_fav_icon fa-solid fa-star" style="display: none;"></i>
                <input class="ch_fav" value="" hidden="" keeper-ignore="">
                <div class="ch_description">${escapedDesc}</div>
                <div class="tags tags_inline">${tagHtml}</div>
            </div>
        `;
        return div;
    }
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
        hideFolderedCharactersOutsideSidebar(STCM.sidebarFolders);
        injectResetViewButton();
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

// Replacement Search Functionality

function removeCharacterSortSelect() {
    const sortSelect = document.getElementById('character_sort_order');
    if (!sortSelect) return;

    // Already injected? (by value or data-field)
    if ([...sortSelect.options].some(opt => opt.value === 'stcm' || opt.getAttribute('data-field') === 'stcm')) {
        return;
    }

    // Create new option
    const stcmOption = document.createElement('option');
    stcmOption.value = 'stcm';
    stcmOption.textContent = 'STCM';
    stcmOption.setAttribute('data-field', 'stcm');
    stcmOption.setAttribute('data-order', 'desc');
    stcmOption.setAttribute('data-i18n', 'STCM');

    // Insert as first option
    sortSelect.insertBefore(stcmOption, sortSelect.firstChild);

    // Set as selected both in the DOM and in the JS API
    stcmOption.selected = true;
    sortSelect.value = 'stcm';

    // Fire a change event to notify listeners
    sortSelect.dispatchEvent(new Event('change', {bubbles: true}));
    hideFolderedCharactersOutsideSidebar(STCM.sidebarFolders);

    // Remove the sort dropdown if present
    // const oldSelect = document.getElementById('character_sort_order');
    // if (oldSelect) oldSelect.remove();

    // // Remove the filter tags by their known classes
    // // All have both .tag and .actionable, and one of: filterByFavorites, filterByGroups, filterByFolder
    // const filters = document.querySelectorAll(
    //     '.tags.rm_tag_filter .tag.filterByFavorites,' +
    //     '.tags.rm_tag_filter .tag.filterByGroups,' +
    //     '.tags.rm_tag_filter .tag.filterByFolder'
    // );
    // filters.forEach(el => el.remove());
}


class SidebarSearchBox {
    constructor(onSearch) {
        this.onSearch = onSearch;
        this.input = document.createElement('input');
        this.input.type = 'search';
        this.input.id = 'character_search_bar_stcm';
        this.input.className = 'text_pole width100p';
        this.input.placeholder = 'Search...';
        this.input.autocomplete = 'off';

        this.clearBtn = document.createElement('button');
        this.clearBtn.type = 'button';
        this.clearBtn.tabIndex = -1;
        this.clearBtn.className = 'stcm_search_clear_btn';
        this.clearBtn.innerHTML = '<i class="fa fa-times"></i>';
        this.clearBtn.style.display = 'none';

        // Show/hide the clear button
        this.input.addEventListener('input', () => {
            this.clearBtn.style.display = this.input.value ? 'block' : 'none';
            this.triggerSearch();
        });

        // Clear button behavior
        this.clearBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this.input.value = '';
            this.clearBtn.style.display = 'none';
            this.triggerSearch();
            this.input.blur();
        });

        // Compose wrapper
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'stcm_search_bar_wrapper';
        this.wrapper.style.position = 'relative';
        this.wrapper.style.display = 'flex';
        this.wrapper.style.alignItems = 'center';
        this.wrapper.style.width = '100%';
        this.input.style.flex = '1 1 auto';

        this.wrapper.appendChild(this.input);
        this.wrapper.appendChild(this.clearBtn);
    }

    attachTo(parentNode, replaceNode) {
        if (replaceNode) parentNode.replaceChild(this.wrapper, replaceNode);
        else parentNode.appendChild(this.wrapper);
    }

    focus() { this.input.focus(); }
    blur() { this.input.blur(); }
    get value() { return this.input.value.trim(); }
    set value(val) { this.input.value = val; this.clearBtn.style.display = val ? 'block' : 'none'; }

    triggerSearch() {
        this.triggerSearch = debounce(() => {
            if (this.onSearch) this.onSearch(this.value);
        }, 150);
    }
}

let sidebarSearchBox = null;

function injectSidebarSearchBox() {
    const oldInput = document.getElementById('character_search_bar');
    if (!oldInput) return;

    if (sidebarSearchBox && sidebarSearchBox.wrapper.parentNode) {
        sidebarSearchBox.wrapper.parentNode.removeChild(sidebarSearchBox.wrapper);
    }

    sidebarSearchBox = new SidebarSearchBox(async (searchTerm) => {
        if (!searchTerm) {
            // Always reload folders fresh if search is empty
            currentSidebarFolderId = 'root';
            stcmSearchActive = false;
            stcmSearchTerm = '';
            stcmSearchResults = null;
            stcmLastSearchFolderId = null;

            const folders = await stcmFolders.loadFolders();
            STCM.sidebarFolders = folders;
            injectSidebarFolders(folders);
        } else {
            stcmSearchActive = true;
            stcmSearchTerm = searchTerm;
            injectSidebarFolders(STCM.sidebarFolders);
        }
    });

    oldInput.parentNode.replaceChild(sidebarSearchBox.wrapper, oldInput);
}

function shouldShowResetButton() {
    // Search bar
    const searchBar = document.getElementById('character_search_bar_stcm');
    const searchActive = searchBar && searchBar.value && searchBar.value.trim() !== '';

    // Any real tag selected
    const tagActive = isAnyRealTagActive();

    // Any sort except STCM active
    const sortActive = !isSTCMSortActive();

    return searchActive || tagActive || sortActive;
}

function findShowTagListSpan() {
    // Selects all tags
    const spans = document.querySelectorAll('.tag.showTagList');
    for (const span of spans) {
        // Extra check: Make sure this is the right one by looking for the fa-tags icon
        if (span.querySelector('.fa-tags')) return span;
    }
    return null;
}


function injectResetViewButton() {
    if (!shouldShowResetButton()) return;

    // Use better selector
    const showTagListSpan = findShowTagListSpan();
    if (!showTagListSpan) {
        console.log('Show Tag List span not found!');
        return;
    }

    // Remove old button if present
    const existing = document.getElementById('stcm_reset_view_btn');
    if (existing) existing.remove();

    // Create the button
    const resetBtn = document.createElement('button');
    resetBtn.id = 'stcm_reset_view_btn';
    resetBtn.textContent = 'Reset View';
    resetBtn.className = 'stcm_reset_view_btn';
    resetBtn.style.marginLeft = '8px';

    resetBtn.addEventListener('click', function() {
        // TODO: Reset logic
    });

    // Insert right after the tag span
    showTagListSpan.parentNode.insertBefore(resetBtn, showTagListSpan.nextSibling);
}


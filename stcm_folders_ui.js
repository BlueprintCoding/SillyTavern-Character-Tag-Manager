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

import { STCM, injectTagManagerControlButton } from './index.js';

import {
    POPUP_RESULT,
    POPUP_TYPE,
    callGenericPopup
} from "../../../popup.js"

import { FA_ICON_LIST } from './fa-icon-list.js'; // path may need adjustment


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

let FA_ICONS = FA_ICON_LIST;



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
    const folders = STCM.sidebarFolders;
    if (!folders || folders.filter(f => f.id !== 'root').length === 0) return;
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
    if (!folders || folders.filter(f => f.id !== 'root').length === 0) return;

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
        const charResults = fuzzySearchCharacters(stcmSearchTerm); // array of Fuse results
        const groupResults = fuzzySearchGroups(stcmSearchTerm);     // array of Fuse results
        const tagResults = fuzzySearchTags(stcmSearchTerm);       // array of Fuse results

        // console.log("entityMap keys:", [...entityMap.keys()]);
        // console.log("charResults sample:", charResults.slice(0,20));

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
    injectTagManagerControlButton();
    setTimeout(() => {
        injectResetViewButton();
    }, 10);
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
            const entityId = entity.chid || entity.id;
            const tagsForChar = getTagsForChar(entity);
            charGrid.appendChild(renderSidebarCharacterCard({
                ...entity,
                id: entityId,
                chid: entityId,
                tags: tagsForChar
            }));

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
            const groupTags = getTagsForChar(entity.id); // or entity.chid if groups have that
            groupGrid.appendChild(renderSidebarCharacterCard({
                ...entity,
                tags: groupTags
            }));

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
    if (!folders || folders.filter(f => f.id !== 'root').length === 0) return;
    // console.log('HIDE-FOLDERED CALLED', Date.now(), new Error().stack);
    const globalList = document.getElementById('rm_print_characters_block');
    if (!globalList) return;
    // console.log(
    //     "shouldShowAllCharacters:", shouldShowAllCharacters(),
    //     "isAnyRealTagActive:", isAnyRealTagActive(),
    //     "isSTCMSortActive:", isSTCMSortActive()
    //   );
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
        // console.log("sortSelect not found!");
        return false;
    }
    const selected = sortSelect.selectedOptions ? sortSelect.selectedOptions[0] : sortSelect.options[sortSelect.selectedIndex];
    // console.log("Selected sort value:", selected?.value, "data-field:", selected?.getAttribute('data-field'));
    return selected && (selected.value === "stcm" || selected.getAttribute('data-field') === 'stcm');
}


function setupSortOrderListener() {
    const sortSelect = document.getElementById('character_sort_order');
    if (!sortSelect) return;
    sortSelect.addEventListener('change', () => {
        // Re-run your show/hide logic on sort change
        // console.log("hidecharsfired");
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
    if (!folders || folders.filter(f => f.id !== 'root').length === 0) return;
    // Only update our sidebar
    const container = document.getElementById('stcm_sidebar_folder_nav');
    if (!container) return;
    container.innerHTML = "";

    // === Private Folder Toggle Icon + Logout + Back + Breadcrumbs ===
    const controlRow = document.createElement('div');
    controlRow.className = 'stcm_folders_header_controls';
    controlRow.style.display = 'flex';
    controlRow.style.alignItems = 'center';
    controlRow.style.gap = '8px';

    // -- Toggle
    const toggleBtn = document.createElement('i');
    toggleBtn.className = 'fa-solid fa-eye-slash stcm_private_toggle_icon';
    toggleBtn.style.cursor = 'pointer';
    toggleBtn.title = 'Click to show private folders';
    toggleBtn.style.fontSize = '1.1em';
    toggleBtn.style.padding = '4px';
    toggleBtn.style.borderRadius = '6px';

    // -- Logout
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
        // Reset visibility mode to hidden and update view
        privateFolderVisibilityMode = 0;
        renderSidebarFolderContents(folders, allEntities, 'root');
    });

    // -- Back Button (icon only), only if not root
    let showBack = false;
    let backTarget = 'root';
    if (folderId !== 'root') {
        if (folderId === 'orphans') {
            showBack = true;
            backTarget = 'root';
        } else {
            // For normal folders, find parent
            const parent = folders.find(f => Array.isArray(f.children) && f.children.includes(folderId));
            if (parent) {
                showBack = true;
                backTarget = parent.id;
            }
        }
    }
    let backBtn = null;
    if (showBack) {
        backBtn = document.createElement('i');
        backBtn.className = "sidebar-folder-back fa-solid fa-arrow-left";
        backBtn.title = "Back";
        backBtn.style.cursor = "pointer";
        backBtn.style.fontSize = "1.1em";
        backBtn.style.padding = "4px";
        backBtn.style.borderRadius = "6px";
        backBtn.style.marginRight = "4px";
        backBtn.onclick = () => {
            currentSidebarFolderId = backTarget;
            renderSidebarFolderContents(folders, allEntities, backTarget);
        };
    }

    // -- Breadcrumb Label
    const breadcrumbDiv = document.createElement('div');
    breadcrumbDiv.className = 'stcm_folders_breadcrumb';
    if (folderId === 'orphans') {
        breadcrumbDiv.textContent = ".../Cards not in Folder";
    } else if (folderId === 'root') {
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

    // -- Order: toggle, logout, back, breadcrumbs
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
    if (backBtn) controlRow.appendChild(backBtn); // Only append if defined
    controlRow.appendChild(breadcrumbDiv);
    container.appendChild(controlRow);

    // ====== Top of Folder List: Orphan Cards ======
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
        const orphanedEntities = getEntitiesNotInAnyFolder(folders);
        const entityMap = stcmFolders.buildEntityMap();
        const grid = document.createElement('div');
        grid.className = 'stcm_folder_contents';
        orphanedEntities.forEach(entity => {
            let key = entity.type === "character" ? entity.item?.avatar : entity.id;
            const normalized = entityMap.get(key);
            if (normalized) {
                const entityId = normalized.chid;
                const tagsForChar = getTagsForChar(entity);
                grid.appendChild(renderSidebarCharacterCard({
                    ...normalized,
                    id: entityId,
                    chid: entityId,
                    tags: tagsForChar
                }));
            }
        });
        container.appendChild(grid);
        // Don't render any children/folders/other stuff
        return;
    }

    const folder = folders.find(f => f.id === folderId);
    if (!folder && folderId !== 'root') return;

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

    const entityMap = stcmFolders.buildEntityMap();
    // Show characters in this folder (full card style)
    (folder.characters || []).forEach(folderVal => {
        let entity = entityMap.get(folderVal);
        if (entity && typeof entity.chid !== "undefined") {
            const entityId = entity.chid;
            // Add tag info
            const tagsForChar = getTagsForChar(entity);
            const entityCard = renderSidebarCharacterCard({
                ...entity,
                id: entityId,
                chid: entityId,
                tags: tagsForChar
            });
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

export function getTagsForChar(entity) {
    // Accept entity object or entityId (backwards compatible)
    let tagIds = [];
    if (typeof entity === "object" && entity !== null) {
        // Prefer tagIds property if it exists
        if (Array.isArray(entity.tagIds)) tagIds = entity.tagIds;
        // Fall back to tag_map[entity.chid || entity.id]
        else if (entity.chid && tag_map[entity.chid]) tagIds = tag_map[entity.chid];
        else if (entity.id && tag_map[entity.id]) tagIds = tag_map[entity.id];
    } else if (typeof entity === "string" || typeof entity === "number") {
        tagIds = tag_map[entity] || [];
    }
    const tagsById = buildTagMap(tags);
    return (tagIds || []).map(id => tagsById.get(id)).filter(Boolean);
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
    // Flatten out entity
    const ent = entity.item
        ? { ...entity.item, ...entity } // <-- merge all fields for safety
        : entity;

    // Determine if it's a group or character
    const isGroup = ent.type === "group";
    const groupId = isGroup ? ent.id : null;
    const chid = (!isGroup && typeof ent.chid !== "undefined") ? ent.chid : undefined;

    // Common
    const name = ent.name || "";
    const escapedName = escapeHtml(name);
    const tagHtml = (ent.tags || []).map(tag => {
        let style = '';
        if (tag.color || tag.color2) {
            style = ` style="${tag.color ? `background:${tag.color};` : ''}${tag.color2 ? `color:${tag.color2};` : ''}"`;
        }
        return `<span id="${tag.id}" class="tag"${style}>
            <span class="tag_name">${tag.name}</span>
            <i class="fa-solid fa-circle-xmark tag_remove interactable" tabindex="0" style="display: none;"></i>
        </span>`;
    }).join('');


    if (isGroup) {
        // --- GROUP CARD ---
        // member avatars: ent.avatar (top 3), all members: ent.members
        const memberFiles = Array.isArray(ent.members) && ent.members.length ? ent.members : (Array.isArray(ent.avatar) ? ent.avatar : []);
        const memberNames = memberFiles.map(f => (typeof f === "string" ? f.replace(/\.[^/.]+$/, "") : f)).join(", ");

        const div = document.createElement('div');
        div.className = 'group_select entity_block flex-container wide100p alignitemsflexstart interactable';
        div.setAttribute('tabindex', '0');
        div.setAttribute('data-grid', groupId);

        // Collage avatars (up to 3)
        const avatarHtml = `
            <div class="avatar avatar_collage collage_${memberFiles.length}" title="[Group] ${escapedName}">
                ${memberFiles.slice(0, 3).map((file, i) =>
            `<img alt="img${i + 1}" class="img_${i + 1}" src="/thumbnail?type=avatar&file=${encodeURIComponent(file)}">`
        ).join('')}
            </div>
        `;

        // Group description (show as subtext if present, otherwise show member names)
        const groupDesc = ent.description ? escapeHtml(ent.description) : memberNames;

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
                <div class="group_select_block_list ch_description">${groupDesc}</div>
                <div class="tags tags_inline">${tagHtml}</div>
            </div>
        `;
        return div;
    } else {
        // --- CHARACTER CARD ---
        let avatarUrl = ent.avatar || ent.avatar_url || 'img/ai4.png';
        if (typeof avatarUrl !== 'string') avatarUrl = String(avatarUrl ?? 'img/ai4.png');
        const descriptionToShow = ent.creator_notes && ent.creator_notes.trim() !== "" ? ent.creator_notes : (ent.description || ent.creatorcomment || "");
        const escapedDesc = escapeHtml(descriptionToShow);

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
        setTimeout(() => {
            injectResetViewButton();
        }, 10);
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
    // Wait until FA_ICONS is loaded
    if (!FA_ICONS) {
        if (window.FA_ICONS_LOADED) {
            window.FA_ICONS_LOADED.then(() => showIconPicker(folder, parentNode, rerender));
            return;
        }
        setTimeout(() => showIconPicker(folder, parentNode, rerender), 200);
        return;
    }

    // Helper: Build candidate icon array (only free solid icons)
    const freeIcons = Array.isArray(FA_ICONS) ? FA_ICONS : [];

    const ICONS_PER_PAGE = 120; // Adjust as needed (12 x 10 grid)

    // --- Icon picker popup ---
    const popup = document.createElement('div');
    popup.className = 'stcm-icon-picker-popup';
    popup.style.position = 'fixed';
    popup.style.background = '#222';
    popup.style.border = '1px solid #444';
    popup.style.borderRadius = '8px';
    popup.style.padding = '16px 12px 12px 12px';
    popup.style.zIndex = 10000;
    popup.style.minWidth = '420px';
    popup.style.maxHeight = '80vh';
    popup.style.overflowY = 'auto';
    popup.style.overflowX = 'hidden';

    // --- Instructions and search ---
    const instr = document.createElement('div');
    instr.innerHTML = `
        <div style="margin-bottom:8px; font-size: 0.97em;">
            <b>Choose an icon below </b> or search all Font Awesome Free icons.<br>
            <a href="https://fontawesome.com/search?m=free" target="_blank" style="color:#6ec0ff; text-decoration:underline; font-size: 0.96em;">
                Browse all free icons
            </a>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
            <input type="text" id="stcmIconSearch" placeholder="Search icon name/category..." style="flex:1;min-width:0;padding:4px 8px;border-radius:4px;border:1px solid #444;background:#181818;color:#eee;">
        </div>
    `;
    popup.appendChild(instr);

    // --- Pagination controls ---
    const paginationDiv = document.createElement('div');
    paginationDiv.style.display = 'flex';
    paginationDiv.style.justifyContent = 'center';
    paginationDiv.style.alignItems = 'center';
    paginationDiv.style.gap = '18px';
    paginationDiv.style.marginBottom = '6px';
    popup.appendChild(paginationDiv);

    // --- Icon grid ---
    const grid = document.createElement('div');
    grid.className = 'stcm-icon-grid';
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(12, 32px)';
    grid.style.gap = '8px';
    grid.style.marginBottom = '18px';
    popup.appendChild(grid);

    // --- Manual entry at bottom (UNCHANGED) ---
    const manualDiv = document.createElement('div');
    manualDiv.innerHTML = `
        <div style="margin-top:12px; font-size: 0.95em; color:#fff;">
            Or manually enter a Font Awesome icon class or &lt;i&gt; tag:
                        <br>
            <a href="https://fontawesome.com/search?m=free" target="_blank" style="color:#6ec0ff; text-decoration:underline; font-size: 0.96em;">
                Browse all free icons
            </a>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin:8px 0 0 0;">
            <input type="text" id="stcmCustomIconInput" placeholder="e.g. fa-dragon" style="flex:1;min-width:0;padding:4px 8px;border-radius:4px;border:1px solid #444;background:#181818;color:#eee;">
            <button class="stcm_menu_button tiny" id="stcmSetCustomIconBtn" style="padding:3px 8px;">Set</button>
        </div>
        <div id="stcmIconError" style="color:#fa7878;font-size:0.93em;min-height:18px;"></div>
    `;
    popup.appendChild(manualDiv);

    // ---- Pagination State and Logic ----
    let lastSearch = "";
    let currentIcons = freeIcons;
    let currentPage = 1;

    function updatePagination() {
        paginationDiv.innerHTML = "";
        const totalPages = Math.max(1, Math.ceil(currentIcons.length / ICONS_PER_PAGE));

        const prevBtn = document.createElement('button');
        prevBtn.textContent = 'Prev';
        prevBtn.className = 'stcm_menu_button tiny';
        prevBtn.disabled = (currentPage === 1);
        prevBtn.onclick = () => { if (currentPage > 1) { currentPage--; renderIcons(); } };
        paginationDiv.appendChild(prevBtn);

        const pageInfo = document.createElement('span');
        pageInfo.style.color = '#aaa';
        pageInfo.textContent = `Page ${currentPage} / ${totalPages}`;
        paginationDiv.appendChild(pageInfo);

        const nextBtn = document.createElement('button');
        nextBtn.textContent = 'Next';
        nextBtn.className = 'stcm_menu_button tiny';
        nextBtn.disabled = (currentPage === totalPages);
        nextBtn.onclick = () => { if (currentPage < totalPages) { currentPage++; renderIcons(); } };
        paginationDiv.appendChild(nextBtn);
    }

    function renderIcons() {
        grid.innerHTML = "";
        const totalPages = Math.max(1, Math.ceil(currentIcons.length / ICONS_PER_PAGE));
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;
        updatePagination();

        const startIdx = (currentPage - 1) * ICONS_PER_PAGE;
        const iconsToShow = currentIcons.slice(startIdx, startIdx + ICONS_PER_PAGE);

        iconsToShow.forEach(icon => {
            const ico = 'fa-' + icon; // icon is already a string!
            const btn = document.createElement('button');
            btn.className = 'stcm-icon-btn stcm_menu_button tiny';
            btn.title = icon; // just use the string for title
            btn.style.background = 'none';
            btn.style.border = 'none';
            btn.style.cursor = 'pointer';
            btn.innerHTML = `<i class="fa-solid ${ico} fa-fw"></i>`;
            btn.addEventListener('click', async () => {
                const folders = await stcmFolders.setFolderIcon(folder.id, ico);
                await updateSidebar(true);
                rerender && rerender(folders);
                popup.remove();
            });
            grid.appendChild(btn);
        });

        if (iconsToShow.length === 0) {
            const nores = document.createElement('div');
            nores.style.gridColumn = 'span 12';
            nores.style.textAlign = 'center';
            nores.style.color = '#aaa';
            nores.textContent = "No icons found.";
            grid.appendChild(nores);
        }
    }

    // ---- Search functionality ----
    const searchInput = instr.querySelector('#stcmIconSearch');
    function searchIcons(term) {
        if (!term) return freeIcons;
        term = term.toLowerCase();
        return freeIcons.filter(icon =>
            icon.toLowerCase().includes(term)
        );
    }

    searchInput.addEventListener('input', () => {
        lastSearch = searchInput.value.trim();
        currentIcons = searchIcons(lastSearch);
        currentPage = 1; // Reset to first page on new search
        renderIcons();
    });

    // Initial: show all icons (first page)
    renderIcons();

    // --- Manual custom icon logic (UNCHANGED) ---
    const customInput = manualDiv.querySelector('#stcmCustomIconInput');
    const customBtn = manualDiv.querySelector('#stcmSetCustomIconBtn');
    const errorDiv = manualDiv.querySelector('#stcmIconError');

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
    popup.style.left = (rect.left + 60) + "px";
    popup.style.top = rect.top + "px";
    // Clamp popup to viewport
    requestAnimationFrame(() => {
        const popupRect = popup.getBoundingClientRect();
        const margin = 10;
        if (popupRect.right > window.innerWidth - margin) {
            popup.style.left = `${window.innerWidth - popupRect.width - margin}px`;
        }
        if (popupRect.bottom > window.innerHeight - margin) {
            popup.style.top = `${window.innerHeight - popupRect.height - margin}px`;
        }
    });
}

export function confirmDeleteFolder(folder, rerender) {
    const hasChildren = Array.isArray(folder.children) && folder.children.length > 0;
    const hasRealParent = folder.parentId && folder.parentId !== 'root';

    // Compute character assignments:
    const folders = window.STCM?.sidebarFolders || [];
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
                    ${hasChildren
                ? (`
                                <span class="cascadeCharCount" style="display: ${'cascade'};">This folder and its subfolders have ${cascadeCharCount} characters assigned.</span>
                                <span class="directCharCount" style="display: ${'none'};">This folder has ${directCharCount} character${directCharCount === 1 ? '' : 's'} assigned.</span>
                            `)
                : `This folder has ${directCharCount} character${directCharCount === 1 ? '' : 's'} assigned.`
            }
                </b>
            </p>
            ${hasRealParent ? `
                <label style="display:block;margin:4px 0 0 12px;">
                    <input type="radio" name="moveMode" value="move" checked>
                    Move assigned characters to parent folder
                </label>
                <label style="display:block;margin:4px 0 0 12px;">
                    <input type="radio" name="moveMode" value="unassign">
                    Remove all assigned characters from folders
                </label>
                ` : `
                <label style="display:block;margin:4px 0 0 12px;">
                    <input type="radio" name="moveMode" value="unassign" checked>
                    Remove all assigned characters from folders
                </label>
                `
            }
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
    sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
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


function injectResetViewButton() {
    if (!shouldShowResetButton()) return;

    const charPanel = document.getElementById('rm_characters_block');
    if (!charPanel) return;
    const tagBar = charPanel.querySelector('.tags.rm_tag_filter');
    if (!tagBar) return;
    const showTag = tagBar.querySelector('.tag.showTagList');
    if (!showTag) return;

    // Prevent duplicate
    if (showTag.nextElementSibling && showTag.nextElementSibling.id === 'stcm_reset_view_btn') return;

    const resetBtn = document.createElement('button');
    resetBtn.id = 'stcm_reset_view_btn';
    resetBtn.textContent = 'Reset View';
    resetBtn.className = 'stcm_reset_view_btn stcm_menu_button stcm_view_btn interactable';
    resetBtn.style.marginLeft = '8px';
    resetBtn.addEventListener('click', function () {
        // 1. Unselect all tags in the global filter bar
        document.querySelectorAll('.tags.rm_tag_bogus_drilldown .tag_remove').forEach(xBtn => {
            // If it's visible (not display:none) and not disabled
            if (xBtn.offsetParent !== null && !xBtn.disabled) {
                xBtn.click();
            }
        });

        document.querySelectorAll('.tags.rm_tag_filter .tag.selected, .tags.rm_tag_filter .tag.excluded').forEach(tag => {
            tag.classList.remove('selected', 'excluded');
        });

        // 2. Clear search bar
        const searchInput = document.getElementById('character_search_bar_stcm');
        if (searchInput) {
            searchInput.value = '';
            const clearBtn = searchInput.parentNode.querySelector('.stcm_search_clear_btn');
            if (clearBtn) clearBtn.click();
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        stcmSearchActive = false;
        stcmSearchTerm = '';
        stcmSearchResults = null;
        stcmLastSearchFolderId = null;

        // 3. Reset sort order to "STCM"
        const sortSelect = document.getElementById('character_sort_order');
        if (sortSelect) {
            let stcmOpt = [...sortSelect.options].find(opt => opt.value === 'stcm' || opt.getAttribute('data-field') === 'stcm');
            if (stcmOpt) {
                stcmOpt.selected = true;
                sortSelect.value = stcmOpt.value;
                sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        // 4. Wait for DOM to settle, then re-inject sidebar
        setTimeout(async () => {
            currentSidebarFolderId = 'root';

            // If sidebar nav is missing (wiped by sort), forcibly re-inject and then update
            const rmBlock = document.getElementById('rm_print_characters_block');
            if (rmBlock && !document.getElementById('stcm_sidebar_folder_nav')) {
                injectSidebarFolders(STCM.sidebarFolders || []);
            }

            await updateSidebar(true);
        }, 100); // 10ms is enough, adjust if needed
    });

    showTag.parentNode.insertBefore(resetBtn, showTag.nextSibling);
}

function buildFolderDropdownOptionsWithIndents(folders, parentId = 'root', depth = 0) {
    const out = [];
    // Find the parent folder
    const parentFolder = folders.find(f => f.id === parentId);
    if (!parentFolder || !Array.isArray(parentFolder.children)) return out;
    parentFolder.children.forEach(childId => {
        const folder = folders.find(f => f.id === childId);
        if (!folder || folder.id === 'root') return;
        out.push({
            id: folder.id,
            // Use 4 non-breaking spaces per depth for proper indent in HTML select
            name: (depth ? '&nbsp;&nbsp;&nbsp;&nbsp;'.repeat(depth) : '') + folder.name,
            depth,
        });
        out.push(...buildFolderDropdownOptionsWithIndents(folders, folder.id, depth + 1));
    });
    return out;
}


async function injectOrUpdateFolderDropdownAfterTagsDiv() {
    const tagsDiv = document.getElementById('tags_div');
    if (!tagsDiv) return;

    // --- Get avatar filename from img src ---
    const avatarImg = document.querySelector('#avatar_div_div img#avatar_load_preview');
    if (!avatarImg) return;
    // src: /thumbnail?type=avatar&file=Demo%20Card%20-%20No%20Folder.png
    const url = new URL(avatarImg.src, window.location.origin);
    const charId = decodeURIComponent(url.searchParams.get('file') || '');
    if (!charId) return;

    // --- Get Folders ---
    let folders = STCM?.sidebarFolders || [];
    if (!folders.length && stcmFolders.loadFolders) {
        folders = await stcmFolders.loadFolders();
        STCM.sidebarFolders = folders;
    }
    if (!folders.length) return;

    let assignedFolder = stcmFolders.getCharacterAssignedFolder(charId, folders);
    let charFolderId = assignedFolder ? assignedFolder.id : '';

    // Prepare options
    const options = [
        { id: '', name: 'No Folder (Top Level)' },
        ...buildFolderDropdownOptionsWithIndents(folders)
    ];
    

    let row = document.getElementById('stcm-folder-dropdown-row');
    let select;

    if (!row) {
        // --- Create fresh row ---
        row = document.createElement('div');
        row.id = 'stcm-folder-dropdown-row';
        row.style.margin = '0';

        const folderIcon = document.createElement('i');
        folderIcon.className = 'fa-solid fa-folder-open';
        folderIcon.style.marginRight = '8px';
        folderIcon.style.fontSize = '1.2em';
        folderIcon.style.color = 'var(--ac-style-color-text, #bbb)';
       
        select = document.createElement('select');
        select.id = 'stcm-folder-dropdown';
        select.className = 'text_pole';
        select.style.minWidth = '140px';

        row.appendChild(folderIcon);
        row.appendChild(select);
        tagsDiv.parentNode.insertBefore(row, tagsDiv.nextSibling);
    } else {
        // --- Update existing ---
        select = row.querySelector('select#stcm-folder-dropdown');
        if (!select) {
            // corrupted, recreate:
            row.innerHTML = '';
            const folderIcon = document.createElement('i');
            folderIcon.className = 'fa-solid fa-folder-open';
            folderIcon.style.marginRight = '8px';
            folderIcon.style.fontSize = '1.2em';
            folderIcon.style.color = 'var(--ac-style-color-text, #bbb)';

            select = document.createElement('select');
            select.id = 'stcm-folder-dropdown';
            select.className = 'text_pole';
            select.style.minWidth = '140px';

            row.appendChild(folderIcon);
            row.appendChild(select);
        }
    }

    // --- Refresh options every time ---
    select.innerHTML = '';
    options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.id;
        o.innerHTML = opt.name;
        if (opt.id === charFolderId) o.selected = true;
        select.appendChild(o);
    });

    // --- Replace all existing listeners with a new one ---
    select.onchange = async function(e) {
        const newFolderId = e.target.value;
        let folders = await stcmFolders.loadFolders();

        let oldFolder = stcmFolders.getCharacterAssignedFolder(charId, folders);
        if (oldFolder) {
            await stcmFolders.removeCharacterFromFolder(oldFolder.id, charId);
        }
        if (newFolderId) {
            await stcmFolders.assignCharactersToFolder(newFolderId, [charId]);
        }
        toastr.success("Folder assignment updated!");
        await updateSidebar(true);
    };
}


function watchInjectFolderDropdown() {
    let tries = 0;
    const interval = setInterval(() => {
        tries++;
        if (document.getElementById('tags_div')) {
            clearInterval(interval);
            injectOrUpdateFolderDropdownAfterTagsDiv();
        }
        if (tries > 20) clearInterval(interval);
    }, 50);
}

eventSource.on(event_types.CHARACTER_PAGE_LOADED, watchInjectFolderDropdown);
eventSource.on(event_types.chat_id_changed || "chat_id_changed", watchInjectFolderDropdown);

// // Save the original
// const origEmit = eventSource.emit;

// eventSource.emit = function(event, ...args) {
//     console.log('[EVENT]', event, ...args);
//     return origEmit.apply(this, arguments);
// };

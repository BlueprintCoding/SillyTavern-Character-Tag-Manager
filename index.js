// index.js - Folder rework
import { 
debounce, 
debouncePersist, 
getFreeName, 
isNullColor, 
escapeHtml, 
getCharacterNameById, 
resetModalScrollPositions, 
makeModalDraggable, 
saveModalPosSize,
getNotes, 
saveNotes, 
buildCharNameMap, 
cleanTagMap,
buildTagMap, 
getFolderTypeForUI, 
promptInput,
parseSearchGroups,
parseSearchTerm
} from './utils.js';

import * as stcmFolders from './stcm_folders.js';

import {
    watchSidebarFolderInjection,
    injectSidebarFolders,
    showFolderColorPicker,
    makeFolderNameEditable,
    showIconPicker,
    confirmDeleteFolder,
    showChangeParentPopup,
    reorderChildren,
    getAllDescendantFolderIds,
    getMaxFolderSubtreeDepth,
    getFolderChain
} from './stcm_folders_ui.js';


import {
    tags,
    tag_map,
} from "../../../tags.js";

import {
    characters,
    getCharacters,
    printCharactersDebounced,
    saveSettingsDebounced
} from "../../../../script.js";

import { groups, getGroupAvatar } from '../../../../scripts/group-chats.js';

import {
    POPUP_RESULT,
    POPUP_TYPE,
    callGenericPopup
} from "../../../popup.js"

import { accountStorage } from '../../../util/AccountStorage.js';

import {
    renderCharacterList,
    toggleCharacterList,
    stcmCharState 
} from "./stcm_characters.js";

import { injectStcmSettingsPanel, updateDefaultTagManagerVisibility, updateRecentChatsVisibility } from './settings-drawer.js';


const { eventSource, event_types } = SillyTavern.getContext();
let isMergeMode = false;
const selectedMergeTags = new Set();      //  Global merge checkbox selection
let selectedPrimaryTagId = null;          // Global merge radio selection
let selectedTagIds = new Set();
let isBulkDeleteMode = false;
const selectedBulkDeleteTags = new Set();



function openCharacterTagManagerModal() {
    if (document.getElementById('characterTagManagerModal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'characterTagManagerModal';
    overlay.className = 'modalOverlay';
    overlay.innerHTML = `
    <div class="modalContent stcm_modal_main">
        <div class="modalHeader stcm_modal_header">
            <h2>Character / Tag Manager</h2>
            <button id="closeCharacterTagManagerModal" class="stcm_menu_button interactable">
                <i class="fa-solid fa-times"></i>
            </button>
        </div>
        <div class="stcm_accordians">
        <div class="accordionSection stcm_accordion_section">
            <button class="accordionToggle stcm_text_left" data-target="tagsSection">▶ Tags</button>
            <div id="tagsSection" class="accordionContent">
                <div class="stcm_sort_row" style="margin-top: 1em;">
                    <span id="stcm_sort_span">SORT</span>
                    <select id="tagSortMode" class="stcm_menu_button interactable">
                        <option value="alpha_asc">A → Z</option>
                        <option value="alpha_desc">Z → A</option>
                        <option value="count_desc">Most Characters</option>
                        <option value="count_asc">Fewest Characters</option>
                        <option value="only_zero">Tags with 0 Characters</option>
                        <option value="no_folder">No Folder Tags</option>
                        <option value="open_folder">Open Folder Tags</option>
                        <option value="closed_folder">Closed Folder Tags</option>
                    </select>
                                        <input type="text" id="tagSearchInput" class="menu_input stcm_fullwidth_input " placeholder="Search tags..." />                   
                </div>
                <div style="margin-top: -5px;">
                                    <span class="smallInstructions">Search by tag, or add "C:" before your search to search by character name. Use , (comma) to seperate OR lists.</span>
                </div>
                <div class="stcm_align-right stcm_tag_button_holder">
                                <button id="createNewTagBtn" class="stcm_menu_button stcm_margin_left interactable" tabindex="0">
                    <i class="fa-solid fa-plus"></i> Create Tag
                </button>
                <button id="startMergeTags" class="stcm_menu_button stcm_margin_left interactable" tabindex="0">
                    <i class="fa-solid fa-object-group"></i>Merge Tags
                </button>
                <button id="cancelMergeTags" class="stcm_menu_button stcm_margin_left interactable" style="display: none;" tabindex="0">Cancel Merge</button>
                <button id="startBulkDeleteTags" class="stcm_menu_button stcm_margin_left interactable" tabindex="0">
                    <i class="fa-solid fa-trash"></i>Bulk Delete
                </button>
                <button id="cancelBulkDeleteTags" class="stcm_menu_button stcm_margin_left interactable" style="display: none;" tabindex="0">Cancel Delete</button>
                <button id="confirmBulkDeleteTags" class="stcm_menu_button stcm_margin_left interactable red" style="display: none;" tabindex="0">
                    <i class="fa-solid fa-trash"></i>Delete Selected
                </button>


                <div class="stcm_import_export_dropdown stcm_margin_left" style="display: inline-block; position: relative;">
                    <button id="toggleImportExport" class="stcm_menu_button interactable" tabindex="0">
                        <i class="fa-solid fa-arrows-spin"></i> Import/Export
                        <i class="fa-solid fa-caret-down"></i>
                    </button>
                    <div id="importExportMenu" class="stcm_dropdown_menu" style="display:none; position: absolute; right:0; top:110%; background: var(--ac-style-color-background, #222); border: 1px solid #444; border-radius: 6px; z-index: 1001; box-shadow: 0 2px 8px rgba(0,0,0,0.12); min-width: 180px; padding: 0.5em;">
                        <button id="backupTagsBtn" class="stcm_menu_button dropdown interactable" tabindex="0">
                            <i class="fa-solid fa-file-export"></i> Backup Tags
                        </button>
                        <button id="restoreTagsBtn" class="stcm_menu_button dropdown interactable" tabindex="0">
                            <i class="fa-solid fa-file-import"></i> Restore Tags
                        </button>
                        <input id="restoreTagsInput" type="file" accept=".json" hidden>
                        <hr style="margin: 0.4em 0; border: none; border-top: 1px solid #444;">
                        <button id="exportNotesBtn" class="stcm_menu_button dropdown interactable" tabindex="0">
                            <i class="fa-solid fa-file-arrow-down"></i> Export Notes
                        </button>
                        <button id="importNotesBtn" class="stcm_menu_button dropdown interactable" tabindex="0">
                            <i class="fa-solid fa-file-arrow-up"></i> Import Notes
                        </button>
                        <input id="importNotesInput" type="file" accept=".json" hidden>
                    </div>
                </div>
            </div>

                <div class="modalBody stcm_scroll_300" id="characterTagManagerContent">
                    <div>Loading tags...</div>
                </div>
            </div>
        </div>

        <div class="accordionSection stcm_accordion_section stcm_folders_section">
            <button class="accordionToggle stcm_text_left" data-target="foldersSection">▶ Folders</button>
            <div id="foldersSection" class="accordionContent">
                <div style="padding: 1em 0;">
                    <button id="createNewFolderBtn" class="stcm_menu_button interactable" tabindex="0">
                        <i class="fa-solid fa-folder-plus"></i> New Folder
                    </button>
                </div>
                <div id="foldersTreeContainer"><div class="loading">Loading folders...</div></div>
                <div id="folderCharactersSection" style="display:none;"></div>

            </div>
        </div>

    
        <div class="accordionSection stcm_accordion_section stcm_tags_section">
            <button class="accordionToggle stcm_text_left" data-target="charactersSection">▶ Characters</button>
            <div id="charactersSection" class="accordionContent">
                <div style="padding-top: 1em;">
                            <div class="stcm_sort_row">
                            <div id="assignTagList" class="stcm_tag_chip_list"></div>
                            </div>
                                        <div class="stcm_sort_row">
                        <label style="text-wrap: nowrap;">Select Tag(s) to Assign</label>
                            <input type="text" id="assignTagSearchInput" class="menu_input stcm_fullwidth_input stcm_margin_bottom-sm" placeholder="Filter tags..." />
                                                                     <button id="assignTagsButton" class="stcm_menu_button interactable green">Assign Tag(s)</button>

                            </div>
                    <div id="assignTagsBar" class="stcm_assign_bar">
                   <div id="selectedTagsDisplay" class="selected-tags-container"></div>
                    </div>
  <div class="stcm_sort_row stcm_margin_top">
                             <div class="stcm_fullwidth">
                           <div class="stcm_flex">
                        <span>SORT</span>
                        <select id="charSortMode" class="stcm_menu_button interactable">
                            <option value="alpha_asc">A → Z</option>
                            <option value="alpha_desc">Z → A</option>
                            <option value="tag_count_desc">Most Tags</option>
                            <option value="tag_count_asc">Fewest Tags</option>
                            <option value="only_zero">Only 0 Tags</option>
                            <option value="with_notes">With Notes</option>
                            <option value="without_notes">Without Notes</option>
                        </select>
                            <input type="text" id="charSearchInput" class="menu_input stcm_fullwidth_input " placeholder="Search characters/groups..." />
                            <button id="startBulkDeleteChars" class="stcm_menu_button stcm_margin_left interactable bulkDelChar" tabindex="0">
                                <i class="fa-solid fa-trash"></i> Bulk Delete
                            </button>
                            <button id="cancelBulkDeleteChars" class="stcm_menu_button stcm_margin_left interactable bulkDelChar" style="display: none;" tabindex="0">
                                Cancel Delete
                            </button>
                            <button id="confirmBulkDeleteChars" class="stcm_menu_button stcm_margin_left interactable bulkDelChar red" style="display: none;" tabindex="0">
                                <i class="fa-solid fa-trash"></i> Delete Selected
                            </button>
                            </div>
                            <span class="smallInstructions" style="display: block; margin-top:2px;">Search by character name, or use "A:" to search all character fields or "T:" to search characters with that tag. Use , (comma) to seperate OR lists, use - (minus) for negative terms (- comes before modifiers like -T:Comedy)</span>
                                </div>

                    </div>
                    <div id="characterListWrapper"></div>
                </div>
                </div>
            </div>
        </div>
    </div>
    `;


    document.body.appendChild(overlay);
    resetModalScrollPositions();
    setTimeout(() => {
        renderFoldersTree().catch(console.error);
    }, 0);
    

    // Folders: add create handler and render initial tree
const foldersTreeContainer = document.getElementById('foldersTreeContainer');
const createFolderBtn = document.getElementById('createNewFolderBtn');

if (createFolderBtn) {
    createFolderBtn.addEventListener('click', async () => {
        const name = await promptInput({ label: 'Enter folder name:', title: 'New Folder', ok: 'Create', cancel: 'Cancel', initial: '' });
        if (!name || !name.trim()) return;
        try {
            // Add to root for now; you’ll add "add-to-any-folder" soon
            await stcmFolders.addFolder(name.trim(), "root");
            await renderFoldersTree();
            toastr.success(`Folder "${name.trim()}" created!`);
        } catch (e) {
            toastr.error(e.message || 'Failed to create folder');
        }
    });
}

// Call on open to render the folder tree
async function renderFoldersTree() {
    foldersTreeContainer.innerHTML = '<div class="loading">Loading folders...</div>';
    const folders = await stcmFolders.loadFolders();
    foldersTreeContainer.innerHTML = '';
    if (!foldersTreeContainer) return;
    const root = folders.find(f => f.id === 'root');
    if (root) {
        root.children.forEach(childId => {
            const child = folders.find(f => f.id === childId);
            if (child) {
                foldersTreeContainer.appendChild(
                    renderFolderNode(child, folders, 0, renderFoldersTree)
                );
            }
        });
    }
}
STCM.renderFoldersTree = renderFoldersTree;


function renderFolderNode(folder, allFolders, depth, renderFoldersTree) {
    // OUTER NODE (block, indented)
    const node = document.createElement('div');
    node.className = 'stcm_folder_node';
    node.classList.add(`stcm_depth_${depth}`);
    node.style.marginBottom = '4px';


    // FOLDER ROW (flex)
    const row = document.createElement('div');
    row.className = 'stcm_folder_row';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '7px';
    row.style.marginLeft = `${depth * 24}px`; 

    const dragHandle = document.createElement('div');
    dragHandle.className = 'stcm-folder-drag-handle';
    dragHandle.innerHTML = '<i class="fa-solid fa-grip-lines"></i>';
    dragHandle.draggable = true;
    dragHandle.style.cursor = 'grab';

    dragHandle.addEventListener('dragstart', (e) => {
        const dragGhost = row.cloneNode(true);
        dragGhost.style.position = 'absolute';
        dragGhost.style.top = '-9999px'; // off-screen
        dragGhost.style.pointerEvents = 'none';
        document.body.appendChild(dragGhost);
    
        e.dataTransfer.setDragImage(dragGhost, 0, 0);
        e.dataTransfer.setData('text/plain', folder.id);
        e.dataTransfer.effectAllowed = 'move';
    
        e.stopPropagation();
    
        // Cleanup ghost after drag
        setTimeout(() => dragGhost.remove(), 0);
    });
    

    row.prepend(dragHandle);


    // Icon, name, buttons (append to row)
    const iconBg = document.createElement('div');
    iconBg.className = 'avatar flex alignitemscenter textAlignCenter stcm-folder-avatar';
    iconBg.style.backgroundColor = folder.color || '#8b2ae6';
    iconBg.title = 'Change Folder Icon';

    const iconEl = document.createElement('span');
    iconEl.className = `fa-solid ${folder.icon || 'fa-folder'} fa-fw stcm-folder-icon`;
    iconEl.style.fontSize = '1.2em';

    iconBg.appendChild(iconEl);
    iconBg.addEventListener('click', (e) => {
        e.stopPropagation();
        showIconPicker(folder, node, renderFoldersTree);
    });
    row.appendChild(iconBg);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = folder.name;
    nameSpan.className = 'stcm-folder-label';
    nameSpan.style.fontWeight = depth === 0 ? 'bold' : 'normal';
    nameSpan.style.cursor = 'pointer';
    nameSpan.title = 'Click to rename';
    nameSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        makeFolderNameEditable(nameSpan, folder, renderFoldersTree);
    });
    row.appendChild(nameSpan);

    const editBtn = document.createElement('button');
    editBtn.className = 'stcm-folder-edit-btn stcm_menu_button tiny interactable';
    editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
    editBtn.title = 'Rename Folder';
    editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        makeFolderNameEditable(nameSpan, folder, renderFoldersTree);
    });
    row.appendChild(editBtn);

    const colorBtn = document.createElement('button');
    colorBtn.className = 'stcm-folder-color-btn stcm_menu_button tiny interactable';
    colorBtn.innerHTML = '<i class="fa-solid fa-palette"></i>';
    colorBtn.title = 'Change Folder Color';

    colorBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        showFolderColorPicker(folder, renderFoldersTree);
    });

    row.appendChild(colorBtn);

    // Folder Type Dropdown
    const typeSelect = document.createElement('select');
    typeSelect.className = 'stcm_folder_type_select tiny';
    typeSelect.title = 'Set Folder Type: Public or Private';

    // Option: Public
    const optPublic = document.createElement('option');
    optPublic.value = 'public';
    optPublic.textContent = '👁️ Public';
    if (!folder.private) optPublic.selected = true;
    typeSelect.appendChild(optPublic);

    // Option: Private
    const optPrivate = document.createElement('option');
    optPrivate.value = 'private';
    optPrivate.textContent = '🔒 Private';
    if (folder.private) optPrivate.selected = true;
    typeSelect.appendChild(optPrivate);

    // Change handler
    typeSelect.addEventListener('change', async (e) => {
        const isPrivate = e.target.value === 'private';
        await stcmFolders.setFolderPrivacy(folder.id, isPrivate);
        STCM.sidebarFolders = await stcmFolders.loadFolders();
        injectSidebarFolders(STCM.sidebarFolders, characters);
        renderFoldersTree();
    });

    row.appendChild(typeSelect);


    if (folder.id !== 'root') {
        const delBtn = document.createElement('button');
        delBtn.className = 'stcm-folder-delete-btn stcm_menu_button tiny red interactable';
        delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        delBtn.title = 'Delete Folder';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            confirmDeleteFolder(folder, renderFoldersTree);
        });
        row.appendChild(delBtn);
    }

        // === Change Parent Button ===
        const moveBtn = document.createElement('button');
        moveBtn.className = 'stcm-folder-move-btn stcm_menu_button tiny interactable';
        moveBtn.innerHTML = '<i class="fa-solid fa-share"></i>'; // Or any icon you like
        moveBtn.title = 'Change Parent Folder';
        moveBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            showChangeParentPopup(folder, allFolders, renderFoldersTree);
        });
        row.appendChild(moveBtn);

    if (depth < 4) {
        const addBtn = document.createElement('button');
        addBtn.className = 'stcm_menu_button tiny interactable';
        addBtn.innerHTML = '<i class="fa-solid fa-folder-plus"></i>';
        addBtn.title = 'Add Subfolder';
        addBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const subName = await promptInput({ label: 'Enter sub-folder name:', title: 'New Sub-Folder', ok: 'Create', cancel: 'Cancel', initial: '' });
            if (!subName || !subName.trim()) return;
            try {
                await stcmFolders.addFolder(subName.trim(), folder.id);
                await renderFoldersTree();
                STCM.sidebarFolders = await stcmFolders.loadFolders();
                injectSidebarFolders(STCM.sidebarFolders, characters);
            } catch (e) {
                toastr.error(e.message || 'Failed to create subfolder');
            }
        });
        row.appendChild(addBtn);
    }

    const charCount = Array.isArray(folder.characters) ? folder.characters.length : 0;
    const charBtn = document.createElement('button');
    charBtn.className = 'stcm_menu_button tiny stcm_folder_chars_btn interactable';
    charBtn.innerHTML = `<i class="fa-solid fa-users"></i> Characters (<span class="folderCharCount" data-folder-id="${folder.id}">${charCount}</span>)`;
    charBtn.title = 'Manage Characters in this Folder';
    charBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showFolderCharactersSection(folder, allFolders);
    });
    row.appendChild(charBtn);
    

    // Append the folder row to the node
    node.appendChild(row);

    node.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    
        // Highlight the drop row
        row.classList.add('stcm-drop-hover');
    });
    
    node.addEventListener('dragleave', () => {
        row.classList.remove('stcm-drop-hover');
    });

    node.addEventListener('drop', async (e) => {
        e.preventDefault();
        row.classList.remove('stcm-drop-hover');
        node.classList.remove('stcm-drop-target');
    
        const draggedId = e.dataTransfer.getData('text/plain');
        if (draggedId === folder.id) return;
    
        const dragged = allFolders.find(f => f.id === draggedId);
        if (!dragged) return;
    
        const sameParent = folder.parentId && dragged.parentId === folder.parentId;
    
        if (sameParent) {
            const parent = allFolders.find(f => f.id === folder.parentId);
            if (!parent || !Array.isArray(parent.children)) return;
    
            const siblings = [...parent.children];
            const fromIndex = siblings.indexOf(dragged.id);
            const toIndex = siblings.indexOf(folder.id);
    
            if (fromIndex === -1 || toIndex === -1) return;
    
            siblings.splice(fromIndex, 1);
            siblings.splice(toIndex, 0, dragged.id);
    
            await reorderChildren(parent.id, siblings);
        } else {
            // Validate and move if not same parent
            const canDrop = validateDropTarget(dragged, folder, allFolders);
            if (!canDrop) {
                toastr.warning("Invalid move.");
                return;
            }
            await stcmFolders.moveFolder(dragged.id, folder.id);
        }
    
        STCM.sidebarFolders = await stcmFolders.loadFolders();
        injectSidebarFolders(STCM.sidebarFolders, characters);
        renderFoldersTree();
    });
    
    


  // CHILDREN (vertical, as own block)
  if (Array.isArray(folder.children) && folder.children.length > 0) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'stcm_folder_children';
    childrenContainer.style.display = 'block';
    folder.children.forEach(childId => {
        const child = allFolders.find(f => f.id === childId);
        if (child) {
            const childNode = renderFolderNode(child, allFolders, depth + 1, renderFoldersTree);
            childrenContainer.appendChild(childNode);
        }
    });
    node.appendChild(childrenContainer);
}
return node;
}

function validateDropTarget(dragged, target, folders) {
    const descendants = getAllDescendantFolderIds(dragged.id, folders);
    if (descendants.includes(target.id)) return false;

    const subtreeDepth = getMaxFolderSubtreeDepth(dragged.id, folders);
    const targetDepth = getFolderChain(target.id, folders).length;
    const maxDepth = 5;

    return (targetDepth + subtreeDepth) < maxDepth;
}



function renderAssignedChipsRow(folder, section, renderAssignCharList, assignSelection = new Set()) {
    let chipsRow = section.querySelector('.stcm_folder_chars_chips_row');
    if (chipsRow) {
        chipsRow.innerHTML = '';
        chipsRow.remove();
    }
    

        // Clean orphan IDs out of folder.characters in-place
        if (Array.isArray(folder.characters)) {
            // Find all characters that still exist
            const validIds = folder.characters.filter(charId =>
                characters.some(c => c.avatar === charId)
            );
            if (validIds.length !== folder.characters.length) {
                folder.characters = validIds;
                // Optional: persist this change if your folders are saved
                stcmFolders.saveFolder && stcmFolders.saveFolder(folder);
            }
        }
    
        const assignedIds = Array.isArray(folder.characters) ? folder.characters : [];

    chipsRow = document.createElement('div');
    chipsRow.className = 'stcm_folder_chars_chips_row';

    assignedIds.forEach(charId => {
        const char = characters.find(c => c.avatar === charId);
        if (!char) return;
        const chip = document.createElement('span');
        chip.className = 'stcm_char_chip';

        const img = document.createElement('img');
        img.src = char.avatar ? `/characters/${char.avatar}` : 'img/ai4.png';
        img.alt = char.name;
        img.className = 'stcm_char_chip_avatar';
        img.onerror = () => img.src = 'img/ai4.png';

        chip.appendChild(img);
        chip.appendChild(document.createTextNode(' ' + char.name + ' '));

        const remove = document.createElement('span');
        remove.className = 'remove';
        remove.title = "Remove";
        remove.innerHTML = '&#10005;';
        remove.addEventListener('click', async () => {
            await stcmFolders.removeCharacterFromFolder(folder, charId);
            const idx = folder.characters.indexOf(charId);
            if (idx !== -1) folder.characters.splice(idx, 1);
            assignSelection.delete(charId);
            renderAssignedChipsRow(folder, section, renderAssignCharList, assignSelection);
            renderAssignCharList();
            stcmFolders.updateFolderCharacterCount (folder);
            STCM.sidebarFolders = await stcmFolders.loadFolders();
            injectSidebarFolders(STCM.sidebarFolders, characters);
        });

        chip.appendChild(remove);
        chipsRow.appendChild(chip);
    });

    // Insert after close button and header
    const insertIndex = 2;
    if (section.children.length > insertIndex) {
        section.insertBefore(chipsRow, section.children[insertIndex]);
    } else {
        section.appendChild(chipsRow);
    }
}

function showFolderCharactersSection(folder, folders) {
    const section = document.getElementById('folderCharactersSection');
    section.innerHTML = '';
    section.style.position = 'relative';
    section.style.display = 'block';

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'stcm_folder_chars_close_btn stcm_menu_button';
    closeBtn.title = 'Close';
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.onclick = () => {
        section.innerHTML = '';
        section.style.display = 'none';
    };
    section.appendChild(closeBtn);

    // Header
    const header = document.createElement('div');
    header.className = 'stcm_folder_chars_header';
    header.innerHTML = `<h3>Folder: ${escapeHtml(folder.name)}</h3>`;
    section.appendChild(header);

    // Chips row, updated after assign/unassign
    let assignSelection = new Set();
    const assignedIds = Array.isArray(folder.characters) ? folder.characters : [];

    // --- Character List Setup ---
    let folderCharSortMode = 'alpha_asc';

    const sortFilterRow = document.createElement('div');
    sortFilterRow.className = 'stcm_sort_row stcm_folder_assign_sort_row';
    sortFilterRow.style.alignItems = 'center';
    sortFilterRow.style.gap = '10px';
    sortFilterRow.innerHTML = `
        <div class="folderCharSelectAll">
        <label class="customCheckboxWrapper" title="Select all visible characters">
        <input type="checkbox" id="selectAllVisibleAssignables" />
        <span class="customCheckbox"></span> Select All
        </label></div>
        <span>SORT</span>
        <select id="folderCharSortMode" class="stcm_menu_button interactable" style="min-width:110px;">
            <option value="alpha_asc">A → Z</option>
            <option value="alpha_desc">Z → A</option>
            <option value="tag_count_desc">Most Tags</option>
            <option value="tag_count_asc">Fewest Tags</option>
            <option value="with_notes">With Notes</option>
            <option value="without_notes">Without Notes</option>
        </select>
        <input type="text" id="folderCharSearchInput" class="menu_input stcm_fullwidth_input" 
            placeholder="Search characters/groups..." style="min-width:140px;">
    `;
    // Assignment button
    const assignBtn = document.createElement('button');
    assignBtn.className = 'stcm_menu_button small assignCharsFolders';
    assignBtn.textContent = 'Assign Selected';
    assignBtn.addEventListener('click', async () => {
        if (!assignSelection.size) {
            toastr.warning("No characters selected.");
            return;
        }
        await stcmFolders.assignCharactersToFolder(folder, Array.from(assignSelection));
        for (const charId of assignSelection) {
            if (!folder.characters.includes(charId)) folder.characters.push(charId);
        }
        renderAssignedChipsRow(folder, section, renderAssignCharList, assignSelection); 
        assignSelection.clear();
        renderAssignCharList();
        stcmFolders.updateFolderCharacterCount (folder);
        STCM.sidebarFolders = await stcmFolders.loadFolders();
        injectSidebarFolders(STCM.sidebarFolders, characters);
    });
    sortFilterRow.appendChild(assignBtn);


    section.appendChild(sortFilterRow);

    // Search hint
    const searchHint = document.createElement('span');
    searchHint.className = "smallInstructions";
    searchHint.style.display = 'block';
    searchHint.style.marginTop = '2px';
    searchHint.innerHTML = `Search by character name, or use "A:" to search all character fields or "T:" to search characters with that tag. Use , (comma) to seperate OR lists, use - (minus) for negative terms (- comes before modifiers like -T:Comedy)`;
    section.appendChild(searchHint);

    // Assignable character list
    const charList = document.createElement('ul');
    charList.className = 'charList stcm_folder_assign_charList';
    section.appendChild(charList);

    sortFilterRow.querySelector('#selectAllVisibleAssignables').addEventListener('change', (e) => {
        const checked = e.target.checked;
        const checkboxes = charList.querySelectorAll('input.folderAssignCharCheckbox:not(:disabled)');
        checkboxes.forEach(cb => {
            cb.checked = checked;
            if (checked) assignSelection.add(cb.value);
            else assignSelection.delete(cb.value);
        });
    });


    
    let folderCharSearchTerm = '';
    setTimeout(() => {
        const searchInput = document.getElementById('folderCharSearchInput');
        if (searchInput) searchInput.value = '';
        renderAssignCharList();
    }, 0);

   

    // --- RENDER FUNCTION ---
    function renderAssignCharList() {
        charList.innerHTML = '';
        // Advanced search: comma = OR, space = AND, minus = NOT
        let unassignedCharacters = characters.filter(c => !folder.characters.includes(c.avatar));
        let filtered = unassignedCharacters;
    
        const searchInput = document.getElementById('folderCharSearchInput');
        const rawInput = (searchInput?.value || '').trim();
        const tagMapById = buildTagMap(tags); // needed for tag lookups
        const searchGroups = parseSearchGroups(rawInput);
    
        if (searchGroups.length > 0) {
            filtered = unassignedCharacters.filter(char => {
                const tagIds = tag_map[char.avatar] || [];
                const tagNames = tagIds.map(tagId => (tagMapById.get(tagId)?.name?.toLowerCase() || ""));
                const allFields = Object.values(char).filter(v => typeof v === 'string').join(' ').toLowerCase();
                const name = char.name.toLowerCase();
    
                for (const group of searchGroups) {
                    let groupMatches = true;
                    for (const termStr of group) {
                        const term = parseSearchTerm(termStr);
                        if (!term) continue;
                        let match = false;
    
                        if (term.field === 'a') {
                            match = allFields.includes(term.value);
                        } else if (term.field === 't') {
                            match = tagNames.some(tagName => tagName.includes(term.value));
                        } else {
                            match = name.includes(term.value);
                        }
    
                        if (term.positive && !match) {
                            groupMatches = false;
                            break;
                        }
                        if (!term.positive && match) {
                            groupMatches = false;
                            break;
                        }
                    }
                    if (groupMatches) return true; // OR group passed
                }
                return false;
            });
        }
    
        // Sort
        switch (folderCharSortMode) {
            case 'alpha_asc':
                filtered.sort((a, b) => a.name.localeCompare(b.name));
                break;
            case 'alpha_desc':
                filtered.sort((a, b) => b.name.localeCompare(a.name));
                break;
            case 'tag_count_desc':
                filtered.sort((a, b) =>
                    (tag_map[b.avatar]?.length || 0) - (tag_map[a.avatar]?.length || 0)
                );
                break;
            case 'tag_count_asc':
                filtered.sort((a, b) =>
                    (tag_map[a.avatar]?.length || 0) - (tag_map[b.avatar]?.length || 0)
                );
                break;
            case 'with_notes':
                filtered = filtered.filter(c => (getNotes().charNotes || {})[c.avatar]);
                break;
            case 'without_notes':
                filtered = filtered.filter(c => !(getNotes().charNotes || {})[c.avatar]);
                break;
        }

        filtered.forEach(char => {
            // Check if assigned to another folder
            const assignedFolder = stcmFolders.getCharacterAssignedFolder(char.avatar, folders);
            const isAssignedHere = folder.characters.includes(char.avatar);
            const isAssignedElsewhere = assignedFolder && !isAssignedHere;
        
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.alignItems = 'center';
            li.style.gap = '1em';
        
            const left = document.createElement('div');
            left.style.display = 'flex';
            left.style.alignItems = 'center';
            left.style.gap = '8px';
        
            // Avatar + name
            const img = document.createElement('img');
            img.className = 'stcm_avatar_thumb';
            img.src = char.avatar ? `/characters/${char.avatar}` : 'img/ai4.png';
            img.alt = char.name;
            img.onerror = () => img.src = 'img/ai4.png';
            left.appendChild(img);
        
            const nameSpan = document.createElement('span');
            nameSpan.className = 'charName';
            nameSpan.textContent = char.name;
            left.appendChild(nameSpan);
        
            if (isAssignedElsewhere) {
                li.style.opacity = '0.6';
                li.title = `Already assigned to "${assignedFolder.name}"`;
        
                // Text label
                const assignedLabel = document.createElement('span');
                assignedLabel.style.fontStyle = 'italic';
                assignedLabel.style.color = '#ccc';
                assignedLabel.textContent = `Already assigned to '${assignedFolder.name}'`;
                left.appendChild(assignedLabel);
        
                // "Reassign here" button
                const reassignBtn = document.createElement('button');
                reassignBtn.className = 'stcm_menu_button tiny';
                reassignBtn.textContent = 'Reassign here';
                reassignBtn.title = `Remove from "${assignedFolder.name}" and assign here`;
                reassignBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await stcmFolders.assignCharactersToFolder(folder, [char.avatar]);
                    // Update local view
                    if (!folder.characters.includes(char.avatar)) folder.characters.push(char.avatar);
                    renderAssignedChipsRow(folder, section, renderAssignCharList, assignSelection);
                    renderAssignCharList();
                    stcmFolders.updateFolderCharacterCount (folder);
                    STCM.sidebarFolders = await stcmFolders.loadFolders();
                    injectSidebarFolders(STCM.sidebarFolders, characters);
                });
                left.appendChild(reassignBtn);
        
                li.appendChild(left);
                charList.appendChild(li);
                return;
            }
        
            // Otherwise: normal assign controls
            // Checkbox
            const label = document.createElement('label');
            label.className = 'customCheckboxWrapper';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = char.avatar;
            checkbox.className = 'folderAssignCharCheckbox';
            checkbox.checked = assignSelection.has(char.avatar);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    assignSelection.add(char.avatar); }
                else {

                 assignSelection.delete(char.avatar);
            }

                    // 🔄 Sync "Select All" if it exists
                const selectAllCheckbox = document.getElementById('selectAllVisibleAssignables');
                if (selectAllCheckbox) {
                    const allVisible = [...charList.querySelectorAll('input.folderAssignCharCheckbox:not(:disabled)')];
                    const allChecked = allVisible.length > 0 && allVisible.every(cb => cb.checked);
                    selectAllCheckbox.checked = allChecked;
                }
            });


            label.appendChild(checkbox);
        
            const checkmark = document.createElement('span');
            checkmark.className = 'customCheckbox';
            label.appendChild(checkmark);
        
            left.insertBefore(label, img);
        
            // Assign one button
            const assignOneBtn = document.createElement('button');
            assignOneBtn.className = 'stcm_menu_button tiny assignCharsFoldersSmall';
            assignOneBtn.textContent = '+';
            assignOneBtn.title = 'Assign this character';
            assignOneBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await stcmFolders.assignCharactersToFolder(folder, [char.avatar]);
                if (!folder.characters.includes(char.avatar)) folder.characters.push(char.avatar);
                renderAssignedChipsRow(folder, section, renderAssignCharList, assignSelection);
                renderAssignCharList();
                stcmFolders.updateFolderCharacterCount (folder);
                STCM.sidebarFolders = await stcmFolders.loadFolders();
                injectSidebarFolders(STCM.sidebarFolders, characters);
            });
        
            left.appendChild(assignOneBtn);
        
            li.appendChild(left);
        
            // Tag chips (as before)
            const tagListWrapper = document.createElement('div');
            tagListWrapper.className = 'assignedTagsWrapper';
            cleanTagMap();
            const tagMapById = buildTagMap(tags);
            const assignedTags = tag_map[char.avatar] || [];
            assignedTags.forEach(tagId => {
                const tag = tagMapById.get(tagId);
                if (!tag) return;
                const tagBox = document.createElement('span');
                tagBox.className = 'tagBox';
                tagBox.textContent = tag.name;
                const defaultBg = '#333';
                const defaultFg = '#fff';
                tagBox.style.backgroundColor = (tag.color && tag.color !== '#') ? tag.color : defaultBg;
                tagBox.style.color = (tag.color2 && tag.color2 !== '#') ? tag.color2 : defaultFg;
                tagListWrapper.appendChild(tagBox);
            });
            li.appendChild(tagListWrapper);
        
            charList.appendChild(li);
        });

                    // Sync "Select All" checkbox based on current view
const selectAllCheckbox = document.getElementById('selectAllVisibleAssignables');
if (selectAllCheckbox) {
    const allVisible = [...charList.querySelectorAll('input.folderAssignCharCheckbox:not(:disabled)')];
    const allChecked = allVisible.length > 0 && allVisible.every(cb => cb.checked);
    selectAllCheckbox.checked = allChecked;
}

        
    }



    // Attach event listeners
    sortFilterRow.querySelector('#folderCharSortMode').addEventListener('change', (e) => {
        folderCharSortMode = e.target.value;
        renderAssignCharList();
    });
    sortFilterRow.querySelector('#folderCharSearchInput').addEventListener('input', debounce((e) => {
        folderCharSearchTerm = e.target.value;
        renderAssignCharList();
    }));


    renderAssignedChipsRow(folder, section, renderAssignCharList, assignSelection);
    renderAssignCharList();
}



// END CUSTOM FOLDERS


    function escToCloseHandler(e) {
        if (e.key === "Escape") {
            const modalContentEsc = overlay.querySelector('.modalContent');
            saveModalPosSize(modalContentEsc);
            overlay.remove();
            document.removeEventListener('keydown', escToCloseHandler);
        }
    }
    document.addEventListener('keydown', escToCloseHandler);

    // Accordion toggle behavior
        // 1. Map each section to its render function
        const accordionRenderers = {
            tagsSection: renderCharacterTagData,
            foldersSection: renderFoldersTree,
            charactersSection: renderCharacterList
        };

        // 2. Add event listeners to all toggles (after you add the modal to DOM)
        overlay.querySelectorAll('.accordionToggle').forEach(button => {
            button.addEventListener('click', () => {
                const targetId = button.dataset.target;
                const section = document.getElementById(targetId);
                cleanTagMap();

                // -- Close all other sections and reset toggles --
                overlay.querySelectorAll('.accordionContent').forEach(content => {
                    if (content !== section) {
                        content.classList.remove('open');
                        // Find its toggle and set to closed arrow
                        const otherToggle = overlay.querySelector(`.accordionToggle[data-target="${content.id}"]`);
                        if (otherToggle) {
                            // Remove the leading arrow and add closed
                            otherToggle.innerHTML = `▶ ${otherToggle.textContent.replace(/^.? /, "")}`;
                        }
                    }
                });

                // -- Toggle open/close this section --
                const isNowOpen = section.classList.toggle('open');
                button.innerHTML = `${isNowOpen ? '▼' : '▶'} ${button.textContent.replace(/^.? /, "")}`;

                if (isNowOpen && accordionRenderers[targetId]) {
                    // --- Always clear content before re-rendering ---

                    // Now render fresh from latest data
                    accordionRenderers[targetId]();
                }
            });
        });


    // Dropdown toggle for Import/Export
    const toggleIE = document.getElementById('toggleImportExport');
    const ieMenu = document.getElementById('importExportMenu');

    toggleIE.addEventListener('click', (e) => {
        e.stopPropagation();
        ieMenu.style.display = ieMenu.style.display === 'none' ? 'block' : 'none';
        // Optional: close on outside click
        if (ieMenu.style.display === 'block') {
            document.addEventListener('mousedown', closeIeMenu, { once: true });
        }
    });

    function closeIeMenu(ev) {
        if (!ieMenu.contains(ev.target) && ev.target !== toggleIE) {
            ieMenu.style.display = 'none';
        }
    }


    document.getElementById('confirmBulkDeleteTags').addEventListener('click', async () => {
        if (!selectedBulkDeleteTags.size) {
            toastr.warning("No tags selected.", "Bulk Delete");
            return;
        }

        const notes = getNotes();

        // Build a confirm dialog
        const tagNames = tags.filter(t => selectedBulkDeleteTags.has(t.id)).map(t => t.name);
        const html = document.createElement('div');
        html.innerHTML = `
                <h3>Confirm Bulk Delete</h3>
                <p>The following tags will be deleted and removed from all characters:</p>
                <pre class="stcm_popup_pre">${tagNames.map(n => `• ${escapeHtml(n)}`).join('\n')}</pre>
                <p style="color: #e57373;">This action cannot be undone.</p>
            `;
        const proceed = await callGenericPopup(html, POPUP_TYPE.CONFIRM, 'Bulk Delete Tags');
        if (proceed !== POPUP_RESULT.AFFIRMATIVE) {
            toastr.info('Bulk tag delete cancelled.', 'Bulk Delete');
        }
        // Remove tags from tag_map and tags
        for (const tagId of selectedBulkDeleteTags) {
            for (const [charId, tagList] of Object.entries(tag_map)) {
                if (Array.isArray(tagList)) {
                    tag_map[charId] = tagList.filter(tid => tid !== tagId);
                }
            }
            const index = tags.findIndex(t => t.id === tagId);
            if (index !== -1) tags.splice(index, 1);
        }

        saveNotes(notes);
        toastr.success(`Deleted ${selectedBulkDeleteTags.size} tag(s): ${tagNames.join(', ')}`, 'Bulk Delete');
        isBulkDeleteMode = false;
        selectedBulkDeleteTags.clear();
        document.getElementById('startBulkDeleteTags').style.display = '';
        document.getElementById('cancelBulkDeleteTags').style.display = 'none';
        document.getElementById('confirmBulkDeleteTags').style.display = 'none';
        callSaveandReload();
        renderCharacterList();
        renderCharacterTagData();
    });



    document.getElementById('exportNotesBtn').addEventListener('click', exportTagCharacterNotes);

    document.getElementById('importNotesBtn').addEventListener('click', () => {
        document.getElementById('importNotesInput').click();
    });

    document.getElementById('importNotesInput').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const content = await file.text();
        try {
            const importData = JSON.parse(content);
            handleNotesImport(importData);
        } catch {
            toastr.error('Invalid notes backup file');
        }
        e.target.value = ''; // reset input
    });


    document.getElementById('closeCharacterTagManagerModal').addEventListener('click', () => {
        const modalContentEsc = overlay.querySelector('.modalContent');
        saveModalPosSize(modalContentEsc);
        resetModalScrollPositions();
        overlay.remove();
        document.removeEventListener('keydown', escToCloseHandler);

    });

    document.getElementById('tagSortMode').addEventListener('change', () => {
        renderCharacterTagData();
    });

    document.getElementById('charSortMode').addEventListener('change', renderCharacterList);


    document.getElementById('tagSearchInput').addEventListener(
        'input',
        debounce(() => renderCharacterTagData())
    );

    document.getElementById('charSearchInput').addEventListener(
        'input',
        debounce(() => renderCharacterList())
    );

    document.getElementById('createNewTagBtn').addEventListener('click', () => {
        promptCreateTag();
    });


    document.getElementById('backupTagsBtn').addEventListener('click', () => {
        const json = JSON.stringify({ tags, tag_map }, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tags_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    document.getElementById('restoreTagsBtn').addEventListener('click', () => {
        document.getElementById('restoreTagsInput').click();
    });

    document.getElementById('restoreTagsInput').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const content = await file.text();
        try {
            const data = JSON.parse(content);
            if (!Array.isArray(data.tags) || typeof data.tag_map !== 'object') throw new Error();
            tags.length = 0;
            data.tags.forEach(tag => {
                // Normalize invalid or empty colors
                if (isNullColor(tag.color)) tag.color = '';
                if (isNullColor(tag.color2)) tag.color2 = '';
                if (typeof tag.folder_type !== 'string') tag.folder_type = 'NONE';

                tags.push(tag);
            });

            Object.assign(tag_map, data.tag_map);
            toastr.success('Tags restored from file');
            callSaveandReload();
            renderCharacterList();
            renderCharacterTagData();
        } catch {
            toastr.error('Invalid tag backup file');
        }
        e.target.value = ''; // reset input
    });



    document.getElementById('assignTagSearchInput').addEventListener(
        'input',
        debounce(() => populateAssignTagSelect())
    );

    document.getElementById('startBulkDeleteTags').addEventListener('click', () => {
        isBulkDeleteMode = true;
        selectedBulkDeleteTags.clear();
        document.getElementById('startBulkDeleteTags').style.display = 'none';
        document.getElementById('cancelBulkDeleteTags').style.display = '';
        document.getElementById('confirmBulkDeleteTags').style.display = '';
        renderCharacterTagData();
    });

    document.getElementById('cancelBulkDeleteTags').addEventListener('click', () => {
        isBulkDeleteMode = false;
        selectedBulkDeleteTags.clear();
        document.getElementById('startBulkDeleteTags').style.display = '';
        document.getElementById('cancelBulkDeleteTags').style.display = 'none';
        document.getElementById('confirmBulkDeleteTags').style.display = 'none';
        renderCharacterTagData();
    });



    document.getElementById('cancelMergeTags').addEventListener('click', () => {
        isMergeMode = false;
        selectedMergeTags.clear();
        selectedPrimaryTagId = null;

        document.getElementById('startMergeTags').textContent = 'Merge Tags';
        document.getElementById('cancelMergeTags').style.display = 'none';

        document.querySelectorAll('.mergeCheckbox, input[name="mergePrimary"]').forEach(el => {
            el.checked = false;
        });

        renderCharacterTagData();
    });


    document.getElementById('startMergeTags').addEventListener('click', async () => {
        if (!isMergeMode) {
            isMergeMode = true;
            const mergeBtn = document.getElementById('startMergeTags');
            mergeBtn.textContent = 'Merge Now';
            mergeBtn.classList.add('merge-active');
            document.getElementById('cancelMergeTags').style.display = '';
            renderCharacterTagData();
        } else {
            const primaryId = selectedPrimaryTagId;
            const mergeIds = Array.from(selectedMergeTags);

            if (!primaryId || mergeIds.length === 0) {
                toastr.warning('Select one primary and at least one tag to merge.', 'Merge Tags');
                return;
            }

            if (mergeIds.includes(primaryId)) {
                toastr.error('Primary tag cannot also be marked for merge.', 'Merge Tags');
                return;
            }

            const primaryTag = tags.find(t => t.id === primaryId);

            // Build confirmation message with character counts
            const tagMapById = buildTagMap(tags);
            const mergeDetails = mergeIds.map(tagId => {
                const tag = tagMapById.get(tagId);
                const count = Object.values(tag_map).filter(tagList => Array.isArray(tagList) && tagList.includes(tagId)).length;
                return `• ${tag?.name || '(Unknown Tag)'} (${count} character${count !== 1 ? 's' : ''})`;
            }).join('\n');

            const html = document.createElement('div');
            html.innerHTML = `
                <h3>Confirm Merge</h3>
                <p>You are about to merge the following tags into <strong>${primaryTag.name}</strong>:</p>
                <pre class="stcm_popup_pre">${mergeDetails}</pre>
                <p>This action cannot be undone. Do you want to proceed?</p>
            `;

            const proceed = await callGenericPopup(html, POPUP_TYPE.CONFIRM, 'Merge Tags');
            if (proceed !== POPUP_RESULT.AFFIRMATIVE) {
                toastr.info('Merge cancelled.', 'Merge Tags');
                return;
            }

            // Perform merge
            Object.entries(tag_map).forEach(([charId, tagIds]) => {
                if (!Array.isArray(tagIds)) return;

                let changed = false;
                mergeIds.forEach(tagId => {
                    const idx = tagIds.indexOf(tagId);
                    if (idx !== -1) {
                        tagIds.splice(idx, 1);
                        changed = true;
                    }
                });

                if (changed && !tagIds.includes(primaryId)) {
                    tagIds.push(primaryId);
                }
            });

            // Remove merged tags from the master list
            for (const id of mergeIds) {
                const index = tags.findIndex(t => t.id === id);
                if (index !== -1) tags.splice(index, 1);
            }


            toastr.success(`Merged ${mergeIds.length} tag(s) into "${primaryTag.name}".`, 'Merge Successful');

            // Reset state
            isMergeMode = false;
            selectedMergeTags.clear();
            selectedPrimaryTagId = null;
            const mergeBtn = document.getElementById('startMergeTags');
            mergeBtn.textContent = 'Merge Tags';
            mergeBtn.classList.remove('merge-active');
            document.getElementById('cancelMergeTags').style.display = 'none';
            // Uncheck all merge inputs
            document.querySelectorAll('.mergeCheckbox, input[name="mergePrimary"]').forEach(el => {
                el.checked = false;
            });

            callSaveandReload();
            renderCharacterList();
            renderCharacterTagData();
        }
    });

    document.getElementById('assignTagsButton').addEventListener('click', () => {
        const selectedCharIds = Array.from(stcmCharState.selectedCharacterIds);
        if (!selectedTagIds.size || !selectedCharIds.length) {
            toastr.warning('Please select at least one tag and one character.', 'Assign Tags');
            return;
        }

        selectedCharIds.forEach(charId => {
            if (!tag_map[charId]) tag_map[charId] = [];
            selectedTagIds.forEach(tagId => {
                if (!tag_map[charId].includes(tagId)) {
                    tag_map[charId].push(tagId);
                }
            });
        });
        callSaveandReload();
        toastr.success(`Assigned ${selectedTagIds.size} tag(s) to ${selectedCharIds.length} character(s).`, 'Assign Tags');

        // Clear all selections/inputs
        selectedTagIds.clear();
        stcmCharState.selectedCharacterIds.clear();
        const charSearchInput = document.getElementById('charSearchInput');
        if (charSearchInput) charSearchInput.value = "";
        const tagSearchInput = document.getElementById('assignTagSearchInput');
        if (tagSearchInput) tagSearchInput.value = "";

        populateAssignTagSelect();
        renderCharacterList();
        renderCharacterTagData();
    });

    document.getElementById('startBulkDeleteChars').addEventListener('click', () => {
        stcmCharState.isBulkDeleteCharMode = true;
        stcmCharState.selectedCharacterIds.clear();
        document.getElementById('startBulkDeleteChars').style.display = 'none';
        document.getElementById('cancelBulkDeleteChars').style.display = '';
        document.getElementById('confirmBulkDeleteChars').style.display = '';
        renderCharacterList();
    });
    
    document.getElementById('cancelBulkDeleteChars').addEventListener('click', () => {
        stcmCharState.isBulkDeleteCharMode = true;
        stcmCharState.selectedCharacterIds.clear();
        document.getElementById('startBulkDeleteChars').style.display = '';
        document.getElementById('cancelBulkDeleteChars').style.display = 'none';
        document.getElementById('confirmBulkDeleteChars').style.display = 'none';
        renderCharacterList();
    });
    
    document.getElementById('confirmBulkDeleteChars').addEventListener('click', async () => {
        if (!stcmCharState.selectedCharacterIds.size) {
            toastr.warning("No characters/groups selected.", "Bulk Delete");
            return;
        }
        // List names for confirmation
        const allEntities = [
            ...characters.map(c => ({ id: c.avatar, name: c.name, type: "character", avatar: c.avatar })),
            ...groups.map(g => ({ id: g.id, name: g.name, type: "group", avatar: g.avatar }))
        ];
        const names = allEntities.filter(e => stcmCharState.selectedCharacterIds.has(e.id)).map(e => e.name);
    
        const html = document.createElement('div');
        html.innerHTML = `
            <h3>Confirm Bulk Delete</h3>
            <p>The following will be permanently deleted:</p>
            <pre class="stcm_popup_pre">${names.map(n => `• ${n}`).join('\n')}</pre>
            <p style="color: #e57373;">This cannot be undone.</p>
        `;
        const proceed = await callGenericPopup(html, POPUP_TYPE.CONFIRM, 'Bulk Delete Characters');
        if (proceed !== POPUP_RESULT.AFFIRMATIVE) {
            toastr.info('Bulk character delete cancelled.');
            return;
        }
    
        // Actually delete (asynchronously) via API
        for (const id of stcmCharState.selectedCharacterIds) {
            // Find out if this is a character or a group
            const entity = characters.find(c => c.avatar === id) 
                || groups.find(g => g.id === id);
        
            if (!entity) continue;
        
            if (entity.avatar) {
                // Character: delete via API
                try {
                    const csrf = await fetch('/csrf-token');
                    const { token } = await csrf.json();
                    const result = await fetch('/api/characters/delete', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRF-Token': token
                        },
                        body: JSON.stringify({
                            avatar_url: entity.avatar,
                            delete_chats: true
                        })
                    });
        
                    if (!result.ok) {
                        toastr.error(`Failed to delete character "${entity.name}".`, 'Delete Error');
                        continue;
                    }
                } catch (err) {
                    toastr.error(`Failed to delete character "${entity.name}".`, 'Delete Error');
                    continue;
                }
                // Remove from arrays
                const idx = characters.findIndex(c => c.avatar === id);
                if (idx !== -1) {
                    const char = characters.splice(idx, 1)[0];
                    delete tag_map[char.avatar];
                    SillyTavern.getContext().eventSource.emit(SillyTavern.getContext().event_types.CHARACTER_DELETED, char);
                }
            } else if (entity.id) {
                // Group: delete via API
                try {
                    const csrf = await fetch('/csrf-token');
                    const { token } = await csrf.json();
                    const result = await fetch('/api/groups/delete', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRF-Token': token
                        },
                        body: JSON.stringify({
                            id: entity.id
                        })
                    });
        
                    if (!result.ok) {
                        toastr.error(`Failed to delete group "${entity.name}".`, 'Delete Error');
                        continue;
                    }
                } catch (err) {
                    toastr.error(`Failed to delete group "${entity.name}".`, 'Delete Error');
                    continue;
                }
                // Remove from arrays
                const gIdx = groups.findIndex(g => g.id === id);
                if (gIdx !== -1) {
                    groups.splice(gIdx, 1);
                }
                if (tag_map[id]) delete tag_map[id];
                const notes = getNotes();
                if (notes.charNotes && notes.charNotes[id]) delete notes.charNotes[id];
                saveNotes(notes);
                // Fire SillyTavern event for group deletion if needed
                SillyTavern.getContext().eventSource.emit(SillyTavern.getContext().event_types.GROUP_CHAT_DELETED, id);
            }
        }
        
        toastr.success(`Deleted ${stcmCharState.selectedCharacterIds.size} character(s)/group(s).`);
        stcmCharState.isBulkDeleteCharMode = false;
        stcmCharState.selectedCharacterIds.clear();
        document.getElementById('startBulkDeleteChars').style.display = '';
        document.getElementById('cancelBulkDeleteChars').style.display = 'none';
        document.getElementById('confirmBulkDeleteChars').style.display = 'none';
        await callSaveandReload();
        renderCharacterList();
        renderCharacterTagData();
    });
    
    
    
    renderCharacterTagData();
    populateAssignTagSelect();
    const wrapper = document.getElementById('characterListWrapper');
    const container = document.createElement('div');
    container.id = 'characterListContainer';
    container.clsss = 'stcm_scroll_300';
    container.style.paddingBottom = '1em';
    wrapper.innerHTML = ''; // Clear any prior content
    wrapper.appendChild(container);

    renderCharacterList();
// MODAL Sizing, positioning, scroll, draggable  
    resetModalScrollPositions();

    const modalContent = overlay.querySelector('.modalContent');
    const STORAGE_KEY = 'stcm_modal_pos_size';
    const saved = sessionStorage.getItem(STORAGE_KEY);

    // Reasonable defaults
    const DEFAULT_WIDTH = 80;  // 80vw
    const DEFAULT_HEIGHT = 95; // 95vh
    const MIN_WIDTH = 350; //px

    if (saved) {
        try {
            let { left, top, width, height } = JSON.parse(saved);
    
            width = Number(width);
            height = Number(height);
    
            // If the saved width/height is a pixel value (as before), use px.
            // Fallback to vw/vh if not available
            Object.assign(modalContent.style, {
                position: 'fixed',
                left: `${Math.max(0, Math.min(Number(left) || 0, window.innerWidth - width))}px`,
                top: `${Math.max(0, Math.min(Number(top) || 0, window.innerHeight - 50))}px`,
                width: width ? `${width}px` : `${DEFAULT_WIDTH}vw`,
                height: height ? `${height}px` : `${DEFAULT_HEIGHT}vh`,
                minWidth: `${MIN_WIDTH}px`,
                transform: '', // Remove centering transform
                maxWidth: "95vw",
                maxHeight: "95vh",
            });
        } catch {
            Object.assign(modalContent.style, {
                position: 'fixed',
                left: '50%',
                top: '50%',
                minWidth: `${MIN_WIDTH}px`,
                width: `${DEFAULT_WIDTH}vw`,
                height: `${DEFAULT_HEIGHT}vh`,
                transform: 'translate(-50%, -50%)',
                maxWidth: "95vw",
                maxHeight: "95vh",
            });
        }
    } else {
        Object.assign(modalContent.style, {
            position: 'fixed',
            left: '50%',
            top: '50%',
            minWidth: `${MIN_WIDTH}px`,
            width: `${DEFAULT_WIDTH}vw`,
            height: `${DEFAULT_HEIGHT}vh`,
            transform: 'translate(-50%, -50%)',
            maxWidth: "95vw",
            maxHeight: "95vh"
        });
    }

    // ---- Save size/position after user resizes/drags

    let hasInteracted = false;

    const handle = modalContent.querySelector('.stcm_modal_header');
    if (handle) {
        // Only save after real drag
        makeModalDraggable(modalContent, handle, () => {
            hasInteracted = true;
            saveModalPosSize(modalContent);
        });

    }

    if ('ResizeObserver' in window) {
        let initialized = false;
        let resizeEndTimer = null;
    
        const clampModalSize = () => {
            // Enforce modal max size based on viewport, with a margin
            const margin = 20;
            const maxWidth = window.innerWidth - margin;
            const maxHeight = window.innerHeight - margin;
            let changed = false;
    
            // Clamp width/height
            if (modalContent.offsetWidth > maxWidth) {
                modalContent.style.width = maxWidth + "px";
                changed = true;
            }
            if (modalContent.offsetHeight > maxHeight) {
                modalContent.style.height = maxHeight + "px";
                changed = true;
            }
    
            // Clamp left/top so modal cannot move off the right/bottom edges
            const rect = modalContent.getBoundingClientRect();
            let newLeft = rect.left, newTop = rect.top;
    
            if (rect.right > window.innerWidth) {
                newLeft = Math.max(0, window.innerWidth - rect.width);
                modalContent.style.left = newLeft + "px";
                changed = true;
            }
            if (rect.bottom > window.innerHeight) {
                newTop = Math.max(0, window.innerHeight - rect.height);
                modalContent.style.top = newTop + "px";
                changed = true;
            }
    
            // Optionally clamp left/top so the header can't go fully offscreen
            if (rect.left < 0) {
                modalContent.style.left = "0px";
                changed = true;
            }
            if (rect.top < 0) {
                modalContent.style.top = "0px";
                changed = true;
            }
    
            return changed;
        };
    
        const onResizeEnd = () => {
            // Clamp to safe size and position
            clampModalSize();
            // Only save if size is meaningful (avoid 0x0)
            const rect = modalContent.getBoundingClientRect();
            if (rect.width > 100 && rect.height > 100) {
                saveModalPosSize(modalContent);
            }
        };
    
        // Also update maxWidth/maxHeight on window resize
        window.addEventListener("resize", () => {
            modalContent.style.maxWidth = (window.innerWidth - 40) + "px";
            modalContent.style.maxHeight = (window.innerHeight - 40) + "px";
            clampModalSize();
        });
    
        // Set these at open, too!
        modalContent.style.maxWidth = (window.innerWidth - 40) + "px";
        modalContent.style.maxHeight = (window.innerHeight - 40) + "px";
    
        const observer = new ResizeObserver(() => {
            if (!initialized) {
                initialized = true; // Skip first fire (initial paint)
                return;
            }
            // Debounce: wait for user to finish resizing
            clearTimeout(resizeEndTimer);
            resizeEndTimer = setTimeout(onResizeEnd, 350); // 350ms after last event
        });
        observer.observe(modalContent);
    }
    
    
    // END MODAL Sizing, positioning, scroll, draggable

}





function promptCreateTag() {
    const defaultName = getFreeName('New Tag', tags.map(t => t.name));

    const styles = getComputedStyle(document.body);
    const defaultBg = styles.getPropertyValue('--SmartThemeShadowColor')?.trim() || '#cccccc';
    const defaultFg = styles.getPropertyValue('--SmartThemeBodyColor')?.trim() || '#000000';

    const container = document.createElement('div');
    container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 1em; width: 100%;">
            <label style="width: 100%;">
                Name:
                <input type="text" class="menu_input newTagName" value="${defaultName}" style="width: 100%;" />
            </label>

            <div class="tagPreview" style="
                align-self: start;
                padding: 4px 8px;
                border-radius: 4px;
                background-color: ${defaultBg};
                color: ${defaultFg};
                font-weight: bold;
                max-width: max-content;
                border: 1px solid #999;
            ">
                ${defaultName}
            </div>

            <div style="display: flex; flex-direction: row; justify-content: space-between; gap: 1em;">
                <label style="flex: 1;">
                    Background Color:<br>
                    <toolcool-color-picker class="newTagBgPicker" color="${defaultBg}" style="width: 100%;"></toolcool-color-picker>
                </label>
                <label style="flex: 1;">
                    Text Color:<br>
                    <toolcool-color-picker class="newTagFgPicker" color="${defaultFg}" style="width: 100%;"></toolcool-color-picker>
                </label>
            </div>
        </div>
    `;

    // Wait for popup to be added, then apply class and label overrides
    const observer = new MutationObserver(() => {
        // Find all currently open popups
        document.querySelectorAll('dialog.popup[open] .popup-body').forEach(popupBody => {
            // Only act if this popup contains your custom content
            if (popupBody.querySelector('.newTagName')) {
                popupBody.classList.add('stcm_custom-add-tag-popup');
            }
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });


    callGenericPopup(container, POPUP_TYPE.CONFIRM, 'Create New Tag', {
        okButton: 'Create Tag',
        cancelButton: 'Cancel'
    }).then(result => {
        if (result !== POPUP_RESULT.AFFIRMATIVE) return;

        const nameInput = container.querySelector('.newTagName');
        const bgPicker = container.querySelector('.newTagBgPicker');
        const fgPicker = container.querySelector('.newTagFgPicker');

        if (!nameInput || !bgPicker || !fgPicker) {
            console.error('One or more tag creation inputs were not found.');
            toastr.error('Something went wrong creating the tag.');
            return;
        }

        const name = nameInput.value.trim() || defaultName;

        const newTag = {
            id: crypto.randomUUID(),
            name,
            color: selectedBg,
            color2: selectedFg,
            folder_type: 'NONE'
        };

        tags.push(newTag);
        callSaveandReload();
        toastr.success(`Created tag "${newTag.name}"`, 'Tag Created');
        renderCharacterTagData();
    });

    // Live preview logic
    const nameInput = container.querySelector('.newTagName');
    const bgPicker = container.querySelector('.newTagBgPicker');
    const fgPicker = container.querySelector('.newTagFgPicker');
    const preview = container.querySelector('.tagPreview');

    let selectedBg = defaultBg;
    let selectedFg = defaultFg;

    function updatePreview(name = nameInput.value.trim(), bg = selectedBg, fg = selectedFg) {
        preview.textContent = name || 'Tag Name';
        preview.style.backgroundColor = bg;
        preview.style.color = fg;
    }

    nameInput.addEventListener('input', () => {
        updatePreview(nameInput.value.trim(), selectedBg, selectedFg);
    });

    bgPicker.addEventListener('change', e => {
        selectedBg = e.detail?.rgba || defaultBg;
        updatePreview(nameInput.value.trim(), selectedBg, selectedFg);
    });

    fgPicker.addEventListener('change', e => {
        selectedFg = e.detail?.rgba || defaultFg;
        updatePreview(nameInput.value.trim(), selectedBg, selectedFg);
    });

}


function updateCheckboxVisibility() {
    const showCheckboxes = stcmCharState.isBulkDeleteCharMode || selectedTagIds.length > 0;

    document.getElementById('assignTagsBar').style.display = showCheckboxes ? 'block' : 'none';

    // Show/hide checkboxes in-place without re-rendering
    document.querySelectorAll('.assignCharCheckbox').forEach(cb => {
        cb.style.display = showCheckboxes ? 'inline-block' : 'none';
    });
}


function populateAssignTagSelect() {
    const tagListDiv = document.getElementById('assignTagList');
    const searchTerm = document.getElementById('assignTagSearchInput')?.value.toLowerCase() || '';
    if (!tagListDiv) return;

    tagListDiv.innerHTML = '';  // Clear

    // Multi-search: comma-separated, trims and ignores empty terms
    const searchTerms = searchTerm.split(',').map(t => t.trim()).filter(Boolean);

    const matchingTags = tags.filter(tag => {
        if (searchTerms.length === 0) return true;
        // Tag matches if any search term matches part of the tag name
        return searchTerms.some(term => tag.name.toLowerCase().includes(term));
    }).sort((a, b) => a.name.localeCompare(b.name));

    matchingTags.forEach(tag => {
        const chip = document.createElement('div');
        chip.className = 'stcm_tag_chip';
        chip.textContent = tag.name;
        chip.style.background = (tag.color && tag.color !== '#') ? tag.color : '#333';
        chip.style.color = (tag.color2 && tag.color2 !== '#') ? tag.color2 : '#fff';

        // Make grayscaled if not selected
        if (selectedTagIds.has(tag.id)) {
            chip.classList.add('selected');
        }

        chip.addEventListener('click', () => {
            if (selectedTagIds.has(tag.id)) {
                selectedTagIds.delete(tag.id);
                chip.classList.remove('selected');
            } else {
                selectedTagIds.add(tag.id);
                chip.classList.add('selected');
            }
            // Show/hide assign bar, update character checkboxes, etc
            updateCheckboxVisibility();
            renderCharacterList();
        });

        tagListDiv.appendChild(chip);
    });

    // Show/hide assign bar, update character checkboxes, etc
    updateCheckboxVisibility();
}

function renderCharacterTagData() {
    const content = document.getElementById('characterTagManagerContent');
    if (!content || !Array.isArray(tags) || typeof tag_map !== 'object') {
        content.innerHTML = `<p>Tags or character map not loaded.</p>`;
        return;
    }
    content.innerHTML = '';

    const sortMode = document.getElementById('tagSortMode')?.value || 'alpha_asc';
    const rawInput = document.getElementById('tagSearchInput')?.value.toLowerCase() || '';

    // OR: split by comma
    const orGroups = rawInput.split(',').map(g => g.trim()).filter(Boolean);

    const styles = getComputedStyle(document.body);
    const defaultBg = styles.getPropertyValue('--SmartThemeShadowColor')?.trim() || '#cccccc';
    const defaultFg = styles.getPropertyValue('--SmartThemeBodyColor')?.trim() || '#000000';

    const notes = getNotes();
    const charNameMap = buildCharNameMap(characters);

    function getFolderType(tag) {
        if (!tag || typeof tag.folder_type !== 'string') return 'NONE';
        const ft = tag.folder_type.toUpperCase();
        if (['NONE','OPEN','CLOSED'].includes(ft)) return ft;
        return 'NONE';
    }

    let tagGroups = tags.map(tag => {
        const charIds = Object.entries(tag_map)
            .filter(([_, tagIds]) => Array.isArray(tagIds) && tagIds.includes(tag.id))
            .map(([charId]) => charId);
        return { tag, charIds };
    }).filter(group => {
        const tagName = group.tag.name.toLowerCase();

        // Filtering logic for all folder types
        if (sortMode === 'no_folder' && getFolderType(group.tag) !== 'NONE') return false;
        if (sortMode === 'open_folder' && getFolderType(group.tag) !== 'OPEN') return false;
        if (sortMode === 'closed_folder' && getFolderType(group.tag) !== 'CLOSED') return false;
        if (sortMode === 'only_zero' && group.charIds.length > 0) return false;

        // --- Comma search: OR logic ---
        if (!orGroups.length) return true; // Empty = show all

        for (const orGroup of orGroups) {
            // AND logic within each group
            const andTerms = orGroup.split(' ').map(s => s.trim()).filter(Boolean);

            const matches = andTerms.every(term => {
                if (term.startsWith('c:')) {
                    const charSearch = term.slice(2).trim();
                    return group.charIds
                        .map(id => getCharacterNameById(id, charNameMap)?.toLowerCase() || '')
                        .some(name => name.includes(charSearch));
                } else {
                    return tagName.includes(term);
                }
            });

            if (matches) return true; // Match this OR group
        }

        // No OR group matched
        return false;
    });

    // ...sorting and rendering as before
    tagGroups.sort((a, b) => {
        if (
            sortMode === 'alpha_asc' ||
            sortMode === 'no_folder' ||
            sortMode === 'open_folder' ||
            sortMode === 'closed_folder' ||
            sortMode === 'only_zero'
        ) {
            return a.tag.name.localeCompare(b.tag.name);
        }
        switch (sortMode) {
            case 'alpha_desc':
                return b.tag.name.localeCompare(a.tag.name);
            case 'count_asc':
                return a.charIds.length - b.charIds.length;
            case 'count_desc':
                return b.charIds.length - a.charIds.length;
            default:
                return 0;
        }
    });

    const fragment = document.createDocumentFragment();


    tagGroups.forEach(group => {
        const wrapper = document.createElement('div');
        wrapper.className = 'tagGroup';
    
        const header = document.createElement('div');
        header.className = 'tagGroupHeader';
    
        const tagId = group.tag.id;
        const tagNotes = getNotes().tagNotes || {};
        const currentNote = tagNotes[tagId] || '';
    
        const styles = getComputedStyle(document.body);
        const defaultBg = '#333';
        const defaultFg = '#fff';
    
        const rawColor = typeof group.tag.color === 'string' ? group.tag.color.trim() : '';
        const rawColor2 = typeof group.tag.color2 === 'string' ? group.tag.color2.trim() : '';
    
        // Use defaults if color is null, empty, or just "#"
        const bgColor = (rawColor && rawColor !== '#') ? rawColor : defaultBg;
        const fgColor = (rawColor2 && rawColor2 !== '#') ? rawColor2 : defaultFg;
    
        header.innerHTML = `
        <span class="tagNameEditable" data-id="${tagId}">
            ${isBulkDeleteMode
                ? `<input type="checkbox" class="bulkDeleteTagCheckbox" value="${tagId}" ${selectedBulkDeleteTags.has(tagId) ? 'checked' : ''} style="margin-right: 7px;">`
                : `<i class="fa-solid fa-pen editTagIcon" title="Edit name" style="cursor: pointer; margin-right: 6px;"></i>`
            }
            <strong class="tagNameText stcm-color-swatch" style="background-color: ${bgColor}; color: ${fgColor}; padding: 2px 6px; border-radius: 4px; cursor: pointer;" title="Click to edit tag colors">
                ${group.tag.name}
                <i class="fa-solid fa-palette" style="margin-left: 8px;"></i>
            </strong>
        </span>
        <span class="tagCharCount">(${group.charIds.length})</span>
        

        ${isMergeMode ? `
            <div class="stcm_merge_controls">
                <label><input type="radio" name="mergePrimary" value="${tagId}" ${selectedPrimaryTagId === tagId ? 'checked' : ''}> Primary</label>
                <label><input type="checkbox" class="mergeCheckbox" value="${tagId}" ${selectedMergeTags.has(tagId) ? 'checked' : ''}> Merge</label>
            </div>` : ''}
    `;

          // --- ADD POPUP LOGIC TO THE COLOR SWATCH ---
    const colorSwatch = header.querySelector('.stcm-color-swatch');
    colorSwatch.addEventListener('click', () => {
        openColorEditModal(group.tag);
    });


        const folderTypes = [
            {
                value: 'NONE',
                label: 'No Tag Folder',
                icon: 'fa-xmark',
                tooltip: 'No Folder'
            },
            {
                value: 'OPEN',
                label: 'Open Tag Folder',
                icon: 'fa-folder-open',
                tooltip: 'Open Tag Folder (Show all characters even if not selected)'
            },
            {
                value: 'CLOSED',
                label: 'Closed Tag Folder',
                icon: 'fa-folder-closed',
                tooltip: 'Closed Tag Folder (Hide all characters unless selected)'
            }
        ];


        const notes = getNotes();
        const displayType = getFolderTypeForUI(group.tag, notes);   // << use this
        const selectedOption = folderTypes.find(ft => ft.value === displayType);


        const folderDropdownWrapper = document.createElement('div');
        folderDropdownWrapper.className = 'custom-folder-dropdown';

        const folderSelected = document.createElement('div');
        folderSelected.className = 'selected-folder-option';
        folderSelected.innerHTML = `<i class="fa-solid ${selectedOption.icon}"></i> ${selectedOption.label}`;
        folderDropdownWrapper.appendChild(folderSelected);

        const folderOptionsList = document.createElement('div');
        folderOptionsList.className = 'folder-options-list';
        folderOptionsList.style.display = 'none';
        folderSelected.title = selectedOption.tooltip;

        folderTypes.forEach(ft => {
            const opt = document.createElement('div');
            opt.className = 'folder-option';
            opt.innerHTML = `<i class="fa-solid ${ft.icon}" style="margin-right: 6px;"></i> ${ft.label}`;
            opt.title = ft.tooltip;
            opt.addEventListener('click', () => {
                    group.tag.folder_type = ft.value;
                saveNotes(notes);
                debouncePersist();
                folderSelected.innerHTML = `<i class="fa-solid ${ft.icon}"></i> ${ft.label}`;
                folderSelected.title = ft.tooltip;
                folderOptionsList.style.display = 'none';
                callSaveandReload();
                renderCharacterTagData(); 
            });            
            folderOptionsList.appendChild(opt);
        });

        folderSelected.addEventListener('click', () => {
            folderOptionsList.style.display = folderOptionsList.style.display === 'none' ? 'block' : 'none';
        });

        folderDropdownWrapper.appendChild(folderOptionsList);

        header.appendChild(folderDropdownWrapper);


        const folderWrapper = document.createElement('div');
        folderWrapper.className = 'stcm_folder_type_row';
        folderWrapper.style.display = 'flex';
        folderWrapper.style.alignItems = 'center';
        folderWrapper.style.gap = '0.5em';
        folderWrapper.style.marginLeft = '20px';

        // Label with icon
        const folderLabel = document.createElement('span');
        folderLabel.innerHTML = `<i class="fa-solid fa-folder" style="margin-right: 4px;"></i>Tag Type:`;
        folderLabel.style.fontWeight = 'bold';
        folderLabel.style.whiteSpace = 'nowrap';
        folderLabel.title = "Choose how this tag behaves as a folder";

        // Append label and dropdown to wrapper
        folderWrapper.appendChild(folderLabel);
        folderWrapper.appendChild(folderDropdownWrapper);
        
        // add convert folder button
        const convertBtn = document.createElement('button');
        convertBtn.className = 'stcm_menu_button tiny interactable';
        convertBtn.textContent = 'Convert to Real Folder';
        convertBtn.title = 'Create a real folder with this tag’s settings';
        convertBtn.style.marginLeft = '6px';
        convertBtn.addEventListener('click', () => {
            stcmFolders.convertTagToRealFolder(group.tag);
        });
        folderWrapper.appendChild(convertBtn);


        header.appendChild(folderWrapper);
        

        const infoIcon = document.createElement('i');
        infoIcon.className = 'fa-solid fa-circle-info stcm_folder_info_icon';
        infoIcon.title = 'About folders'; // fallback tooltip

        // Attach click handler (next step)
        infoIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            showFolderInfoPopup(infoIcon);
        });


        folderWrapper.appendChild(infoIcon);

        const showBtn = document.createElement('button');
        showBtn.textContent = 'Characters';
        showBtn.className = 'stcm_menu_button stcm_view_btn interactable';
        showBtn.style.marginLeft = '2px';
        showBtn.addEventListener('click', () => toggleCharacterList(wrapper, group));

        const noteBtn = document.createElement('button');
        noteBtn.textContent = 'Notes';
        noteBtn.className = 'stcm_menu_button charNotesToggle small interactable';
        noteBtn.style.marginLeft = '2px';
        noteBtn.title = 'View or edit tag notes';

        const noteWrapper = document.createElement('div');
        noteWrapper.className = 'charNotesWrapper';
        noteWrapper.style.display = 'none';

        const noteArea = document.createElement('textarea');
        noteArea.className = 'charNoteTextarea';
        noteArea.placeholder = 'Add tag notes...';
        noteArea.value = currentNote;

        const saveNoteBtn = document.createElement('button');
        saveNoteBtn.className = 'stcm_menu_button stcm_save_note_btn small';
        saveNoteBtn.textContent = 'Save Note';
        saveNoteBtn.addEventListener('click', async () => {
            const notes = getNotes();
            notes.tagNotes[tagId] = noteArea.value.trim();
            saveNotes(notes);
            debouncePersist();
            toastr.success(`Saved note for tag "${group.tag.name}"`);
        });

        noteBtn.addEventListener('click', () => {
            const open = noteWrapper.style.display === 'flex';
            noteWrapper.style.display = open ? 'none' : 'flex';
            noteBtn.textContent = open ? 'Notes' : 'Close Notes';
            noteBtn.style.background = open ? '' : '#8e6529';
        });

        noteWrapper.appendChild(noteArea);
        noteWrapper.appendChild(saveNoteBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.className = 'stcm_menu_button interactable red';
        deleteBtn.style.marginLeft = '2px';
        deleteBtn.addEventListener('click', () => confirmDeleteTag(group.tag));

        const actionButtons = document.createElement('div');
        actionButtons.className = 'tagActionButtons';
        actionButtons.appendChild(showBtn);
        actionButtons.appendChild(noteBtn);
        actionButtons.appendChild(deleteBtn);
        wrapper.appendChild(header);
        header.appendChild(actionButtons);
        wrapper.appendChild(noteWrapper);

        fragment.appendChild(wrapper);
    });


    content.innerHTML = '';
    content.appendChild(fragment);

    if (isBulkDeleteMode) {
        content.querySelectorAll('.bulkDeleteTagCheckbox').forEach(cb => {
            cb.checked = selectedBulkDeleteTags.has(cb.value);
            cb.addEventListener('change', () => {
                if (cb.checked) selectedBulkDeleteTags.add(cb.value);
                else selectedBulkDeleteTags.delete(cb.value);
            });
        });
    }


    if (isMergeMode) {
        document.querySelectorAll('input[name="mergePrimary"]').forEach(el => {
            el.addEventListener('change', () => {
                selectedPrimaryTagId = el.value;
            });
        });

        document.querySelectorAll('.mergeCheckbox').forEach(cb => {
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    selectedMergeTags.add(cb.value);
                } else {
                    selectedMergeTags.delete(cb.value);
                }
            });
        });
    }


    document.querySelectorAll('.editTagIcon').forEach(icon => {
        icon.addEventListener('click', () => {
            const container = icon.closest('.tagNameEditable');
            const id = container.dataset.id;
            const strong = container.querySelector('.tagNameText');
            const oldName = strong.textContent.trim();

            const input = document.createElement('input');
            input.type = 'text';
            input.value = oldName;
            input.className = 'menu_input';
            input.style.width = '150px';

            // Replace and focus
            container.replaceChild(input, strong);
            input.focus();
            input.select();

            // Save on blur or enter
            const save = () => {
                const newName = input.value.trim();
                const tag = tags.find(t => t.id === id);

                if (tag && newName && newName !== oldName) {
                    tag.name = newName;
                    callSaveandReload();
                    renderCharacterList();
                    renderCharacterTagData(); 
                } else {
                    // If unchanged or invalid, just restore display
                    container.replaceChild(strong, input);
                    strong.textContent = oldName;
                }
            };



            input.addEventListener('blur', save);
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    save();
                } else if (e.key === 'Escape') {
                    container.replaceChild(strong, input);
                }
            });
        });
    });

    // Make tag name clickable to toggle the character list
    content.querySelectorAll('.tagNameText').forEach(nameEl => {
        nameEl.style.cursor = 'pointer';
        nameEl.addEventListener('click', () => {
            const container = nameEl.closest('.tagGroup');
            const tagId = nameEl.closest('.tagNameEditable')?.dataset?.id;
            const group = tagGroups.find(g => g.tag.id === tagId);
            if (group) {
                toggleCharacterList(container, group);
            }
        });
    });


    accountStorage.setItem('SelectedNavTab', 'rm_button_characters');
}

function showFolderInfoPopup(anchorEl) {
    // Small HTML for the popup
    const html = document.createElement('div');
    html.className = 'stcm_folder_info_popup';
    html.innerHTML = `
        <strong>Tag Folder Types</strong><br>
        <ul style="margin: 8px 0 0 0; padding-left: 1.2em;">
            <li><b>No Folder:</b> Tag behaves as a regular label, no grouping.</li>
            <li><b>Open Folder:</b> Tag acts as a folder. All characters with this tag are always visible and grouped together.</li>
            <li><b>Closed Folder:</b> Tag acts as a collapsed folder. Characters with this tag are hidden unless you open this folder.</li>
        </ul>
        <div style="margin-top: 8px; font-size: 0.95em;">
            <em>You can assign multiple folders per character, and folders can be stacked!</em>
        </div>
    `;

    // Place popup near the icon
    const rect = anchorEl.getBoundingClientRect();
    html.style.left = (rect.left + window.scrollX + 28) + 'px';
    html.style.top = (rect.top + window.scrollY - 6) + 'px';

    document.body.appendChild(html);

    // Dismiss on click outside
    function closePopup(e) {
        if (!html.contains(e.target)) {
            html.remove();
            document.removeEventListener('mousedown', closePopup, true);
        }
    }
    setTimeout(() => document.addEventListener('mousedown', closePopup, true), 20);
}

function openColorEditModal(tag) {
    const styles = getComputedStyle(document.body);
    const defaultBg = styles.getPropertyValue('--SmartThemeShadowColor')?.trim() || '#333';
    const defaultFg = styles.getPropertyValue('--SmartThemeBodyColor')?.trim() || '#fff';

    let currBg = (tag.color && tag.color !== '#') ? tag.color : defaultBg;
    let currFg = (tag.color2 && tag.color2 !== '#') ? tag.color2 : defaultFg;

    const container = document.createElement('div');
    container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 1em; width: 100%;">
            <div class="tagPreview" style="
                align-self: flex-start;
                padding: 4px 12px;
                border-radius: 4px;
                background-color: ${currBg};
                color: ${currFg};
                font-weight: bold;
                border: 1px solid #999;
                max-width: max-content;
                margin-bottom: .3em;
                margin: 0 auto;
            ">
                ${escapeHtml(tag.name)}
            </div>
            <div style="display: flex; gap: 1em;">
                <label style="flex: 1;">
                    Background Color:<br>
                    <toolcool-color-picker class="editTagBgPicker" color="${currBg}" style="width: 100%;"></toolcool-color-picker>
                </label>
                <label style="flex: 1;">
                    Text Color:<br>
                    <toolcool-color-picker class="editTagFgPicker" color="${currFg}" style="width: 100%;"></toolcool-color-picker>
                </label>
            </div>
        </div>
    `;

    const preview = container.querySelector('.tagPreview');
    const bgPicker = container.querySelector('.editTagBgPicker');
    const fgPicker = container.querySelector('.editTagFgPicker');

    bgPicker.addEventListener('change', (e) => {
        currBg = e.detail?.rgba ?? e.target.color;
        preview.style.backgroundColor = currBg;
    });
    fgPicker.addEventListener('change', (e) => {
        currFg = e.detail?.rgba ?? e.target.color;
        preview.style.color = currFg;
    }); 
    
    // --- Add observer to ensure class is applied to the correct popup ---
    const observer = new MutationObserver(() => {
        // Find the open popup with .popup-body
        document.querySelectorAll('dialog.popup[open] .popup-body').forEach(popupBody => {
            // Only add if it contains our editTagBgPicker
            if (popupBody.querySelector('.editTagBgPicker')) {
                popupBody.classList.add('stcm_custom-color-edit-popup');
            }
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    callGenericPopup(container, POPUP_TYPE.CONFIRM, `Edit Colors: ${escapeHtml(tag.name)}`, {
        okButton: 'Save Colors',
        cancelButton: 'Cancel'
    }).then(async result => {
        observer.disconnect(); // cleanup
        if (result !== POPUP_RESULT.AFFIRMATIVE) return;
        tag.color = currBg;
        tag.color2 = currFg;
        await callSaveandReload();
        renderCharacterList();
        renderCharacterTagData();
    });
}


function confirmDeleteTag(tag) {
    if (!tag) return;

    const html = document.createElement('div');
    html.innerHTML = `
        <h3>Confirm Delete</h3>
        <p>Are you sure you want to delete the tag <strong>${tag.name}</strong>?</p>
        <p style="color: #e57373;">It will be removed from all associated characters and cannot be undone.</p>
    `;

    callGenericPopup(html, POPUP_TYPE.CONFIRM, 'Delete Tag').then(result => {
        if (result !== POPUP_RESULT.AFFIRMATIVE) {
            toastr.info('Tag deletion cancelled.', 'Delete Tag');
            return;
        }

        // Proceed with deletion
        for (const [charId, tagList] of Object.entries(tag_map)) {
            if (Array.isArray(tagList)) {
                tag_map[charId] = tagList.filter(tid => tid !== tag.id);
            }
        }


        const index = tags.findIndex(t => t.id === tag.id);
        if (index !== -1) tags.splice(index, 1);

        toastr.success(`Deleted tag "${tag.name}".`, 'Delete Tag');
        callSaveandReload();
        renderCharacterList();
        renderCharacterTagData();
    });
}

async function callSaveandReload() {
    cleanTagMap();
    saveSettingsDebounced();
    await getCharacters();
    await printCharactersDebounced();
}


function addCharacterTagManagerIcon() {
    const existingIcon = document.getElementById('rightNavHolder');
    if (!existingIcon || document.getElementById('characterTagManagerToggle')) return;

    // Create your new icon
    const icon = document.createElement('div');
    icon.id = 'characterTagManagerToggle';
    icon.className = 'drawer drawer-icon fa-solid fa-tags fa-fw interactable';
    icon.title = 'Character / Tag Manager';
    icon.setAttribute('tabindex', '0');

    icon.addEventListener('click', openCharacterTagManagerModal);

    // Insert before the existing #rightNavDrawerIcon
    const parent = existingIcon.parentElement;
    parent.insertBefore(icon, existingIcon);
}

function injectTagManagerControlButton() {
    const container = document.querySelector('#rm_characters_block .rm_tag_controls');
    if (!container || document.getElementById('characterTagManagerControlButton')) return;

    const showTagListBtn = container.querySelector('.showTagList');
    if (!showTagListBtn) return;

    const tagManagerBtn = document.createElement('span');
    tagManagerBtn.id = 'characterTagManagerControlButton';
    tagManagerBtn.className = 'tag actionable clickable-action interactable';
    tagManagerBtn.style.backgroundColor = 'rgba(120, 160, 80, 0.5)';
    tagManagerBtn.setAttribute('tabindex', '0');
    tagManagerBtn.setAttribute('data-toggle-state', 'UNDEFINED');

    tagManagerBtn.innerHTML = `
        <span class="tag_name fa-solid fa-sitemap" title="Character / Tag Manager"></span>
        <i class="fa-solid fa-circle-xmark tag_remove interactable" tabindex="0" style="display: none;"></i>
    `;

    tagManagerBtn.addEventListener('click', async () => {
        openCharacterTagManagerModal(); // Then opens the modal
    });


    showTagListBtn.insertAdjacentElement('afterend', tagManagerBtn);
}

function injectTagManagerButtonInTagView(container) {
    const backupBtn = container.querySelector('.tag_view_backup');
    if (!backupBtn) return;

    const tagManagerBtn = document.createElement('div');
    tagManagerBtn.id = 'characterTagManagerBackupAreaButton';
    tagManagerBtn.className = 'menu_button menu_button_icon interactable';
    tagManagerBtn.title = 'Open Character / Tag Manager';
    tagManagerBtn.setAttribute('data-i18n', '[title]Open Character / Tag Manager');
    tagManagerBtn.setAttribute('tabindex', '0');

    tagManagerBtn.innerHTML = `
        <i class="fa-solid fa-tags"></i>
        <span>Manage</span>
    `;

    tagManagerBtn.addEventListener('click', () => {
        const okBtn = document.querySelector('dialog.popup[open] .popup-button-ok');
        if (okBtn) {
            okBtn.click();
        }

        requestAnimationFrame(() => {
            openCharacterTagManagerModal();
        });
    });


    container.insertBefore(tagManagerBtn, backupBtn);
}


function observeTagViewInjection() {
    const observer = new MutationObserver((mutations, obs) => {
        const targetContainer = document.querySelector('#tag_view_list .title_restorable .flex-container');
        if (targetContainer && !document.getElementById('characterTagManagerBackupAreaButton')) {
            console.log("Injecting Character/Tag Manager button into Tag View section");
            injectTagManagerButtonInTagView(targetContainer);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

function exportTagCharacterNotes() {
    // Collect all notes
    const notes = getNotes ? getNotes() : {};
    // Only keep tagNotes and charNotes for the export
    const exportData = {
        tagNotes: notes.tagNotes || {},
        charNotes: notes.charNotes || {}
    };
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tag_character_notes_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

async function handleNotesImport(importData) {
    if (!importData || typeof importData !== 'object') {
        toastr.error('Invalid notes file.');
        return;
    }
    const notes = getNotes ? getNotes() : {};
    const tagNotes = notes.tagNotes || {};
    const charNotes = notes.charNotes || {};

    let conflicts = [];
    let newNotes = { tagNotes: {}, charNotes: {} };

    // Tags notes
    for (const [tagId, note] of Object.entries(importData.tagNotes || {})) {
        if (tags.find(t => t.id === tagId)) {
            if (tagNotes[tagId] && tagNotes[tagId] !== note) {
                conflicts.push({ type: 'tag', id: tagId, old: tagNotes[tagId], new: note });
            } else if (!tagNotes[tagId]) {
                newNotes.tagNotes[tagId] = note;
            }
        }
    }


    // Characters (robust match: avatar, avatar basename, and optionally name)
    for (const [importKey, note] of Object.entries(importData.charNotes || {})) {
        let match = characters.find(c => c.avatar === importKey);
        if (!match) {
            const importBase = importKey.replace(/\.[^/.]+$/, '').toLowerCase();
            match = characters.find(c =>
                (c.avatar && c.avatar.replace(/\.[^/.]+$/, '').toLowerCase() === importBase)
            );
        }
        if (!match) {
            match = characters.find(c => (c.name || '').toLowerCase() === importKey.toLowerCase());
        }
        if (match) {
            const charId = match.avatar;
            if (charNotes[charId] && charNotes[charId] !== note) {
                conflicts.push({ type: 'char', id: charId, old: charNotes[charId], new: note, importId: importKey });
            } else if (!charNotes[charId]) {
                newNotes.charNotes[charId] = note;
            }
        }
    }

    // If there are conflicts, show conflict dialog and wait for user to resolve, then refresh UI
    if (conflicts.length) {
        await showNotesConflictDialog(conflicts, newNotes, importData);
        await debouncePersist();
        renderCharacterList();
        renderCharacterTagData();
    } else {
        // Apply new notes
        Object.assign(tagNotes, newNotes.tagNotes);
        Object.assign(charNotes, newNotes.charNotes);
        saveNotes({ ...notes, tagNotes, charNotes }); 
        await debouncePersist();
        renderCharacterList();
        renderCharacterTagData();
        toastr.success('Notes imported successfully!');
    }
}

// ========================================================================================================== //
// STCM CUSTOM FOLDERS START
// ========================================================================================================== //


eventSource.on(event_types.APP_READY, async () => {
    STCM.sidebarFolders = await stcmFolders.loadFolders(); // load and save to your variable!
    addCharacterTagManagerIcon();         // Top UI bar
    injectTagManagerControlButton();      // Tag filter bar
    observeTagViewInjection();    // Tag view list
    injectSidebarFolders(STCM.sidebarFolders, characters);  // <--- use sidebarFolders!
    watchSidebarFolderInjection(); 
    injectStcmSettingsPanel();    

});

async function showNotesConflictDialog(conflicts, newNotes, importData) {
    const container = document.createElement('div');
    container.style.maxHeight = '420px';
    container.style.overflowY = 'auto';

    let selects = {};
    let allChecked = true;

    const makeRow = (conflict, idx) => {
        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.gap = '8px';
        label.style.marginBottom = '8px';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.dataset.idx = idx;
        selects[idx] = true;

        checkbox.addEventListener('change', () => {
            selects[idx] = checkbox.checked;
        });

        const entityName = conflict.type === 'tag'
            ? (tags.find(t => t.id === conflict.id)?.name || '(Unknown Tag)')
            : (
                (characters.find(c => c.avatar === conflict.id)?.name || conflict.id || '(Unknown Character)') +
                (conflict.importId && conflict.importId !== conflict.id
                    ? ` <small>(Imported as: ${escapeHtml(conflict.importId)})</small>`
                    : '')
            );

        label.innerHTML = `
            <b>${conflict.type === 'tag' ? 'Tag' : 'Character'}:</b> ${entityName}
            <br>
            <span style="margin-left:2em;"><b>Old:</b> ${escapeHtml(conflict.old)}</span>
            <br>
            <span style="margin-left:2em;"><b>New:</b> ${escapeHtml(conflict.new)}</span>
        `;
        label.prepend(checkbox);
        return label;
    };

    // "Select All" checkbox
    const selectAllLabel = document.createElement('label');
    selectAllLabel.style.display = 'flex';
    selectAllLabel.style.alignItems = 'center';
    selectAllLabel.style.gap = '8px';
    selectAllLabel.style.marginBottom = '10px';

    const selectAllCheckbox = document.createElement('input');
    selectAllCheckbox.type = 'checkbox';
    selectAllCheckbox.checked = true;
    selectAllCheckbox.addEventListener('change', () => {
        const checked = selectAllCheckbox.checked;
        Object.keys(selects).forEach(idx => {
            selects[idx] = checked;
            container.querySelectorAll(`input[type="checkbox"][data-idx="${idx}"]`).forEach(cb => cb.checked = checked);
        });
    });
    selectAllLabel.append(selectAllCheckbox, document.createTextNode('Select All'));

    container.appendChild(selectAllLabel);

    conflicts.forEach((conflict, idx) => {
        container.appendChild(makeRow(conflict, idx));
    });

    const result = await callGenericPopup(container, POPUP_TYPE.CONFIRM, 'Note Conflicts', {
        okButton: 'Import Selected',
        cancelButton: 'Cancel'
    });

    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        toastr.info('Note import cancelled.');
        return;
    }

    // Apply selected conflicts
    const notes = getNotes ? getNotes() : {};
    const tagNotes = notes.tagNotes || {};
    const charNotes = notes.charNotes || {};

    conflicts.forEach((conflict, idx) => {
        if (!selects[idx]) return;
        if (conflict.type === 'tag') {
            tagNotes[conflict.id] = conflict.new;
        } else {
            charNotes[conflict.id] = conflict.new;
        }
    });

    // Apply new (non-conflicting) notes
    Object.assign(tagNotes, newNotes.tagNotes);
    Object.assign(charNotes, newNotes.charNotes);

    saveNotes({ ...notes, tagNotes, charNotes });
    await debouncePersist();
    renderCharacterList();
    renderCharacterTagData();
    toastr.success('Selected notes imported!');
}

export { renderCharacterTagData, callSaveandReload, injectTagManagerControlButton};
export const STCM = {
    sidebarFolders: [],
    renderFoldersTree: null, // placeholder for assignment later
};

// stcm_folders_tree.js
//
// Pure UI module that renders the folder tree used by the Character / Tag
//   • renderFoldersTree(containerElement, { onTreeChanged? })
//
//// ---------------------------------------------------------------------------


// utils
import {
    debounce,
    escapeHtml,
    buildTagMap,
    parseSearchGroups,
    parseSearchTerm,
    cleanTagMap,
    getNotes,
    hexToRgba,
    promptInput
} from './utils.js';

import * as stcmFolders from './stcm_folders.js';
import { STCM } from './index.js';

import {
    injectSidebarFolders,
    showFolderColorPicker,
    makeFolderNameEditable,
    showIconPicker,
    confirmDeleteFolder,
    showChangeParentPopup,
    reorderChildren,
    getAllDescendantFolderIds,
    updateSidebar,
    renderSidebarFolderContents 
} from './stcm_folders_ui.js';

import { characters } from '../../../../script.js';
import { tags, tag_map }        from "../../../tags.js";
import { groups }               from "../../../../scripts/group-chats.js";
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from "../../../popup.js";

// If you keep the global STCM object (as in index.js) you can re-use it here:
export const STCM_TREE = { renderFoldersTree: null };
const collapsedFolders = {};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render / refresh the tree inside `containerEl`.
 *
 * @param {HTMLElement} containerEl – the <div id="foldersTreeContainer">
 * @param {Object}      opts
 * @param {Function=}   opts.onTreeChanged – callback after any change
 */
export async function renderFoldersTree(containerEl, { onTreeChanged } = {}) {
    containerEl.innerHTML = '<div class="loading">Loading folders…</div>';

    const folders = await stcmFolders.loadFolders();
    containerEl.innerHTML = '';

    const root = folders.find(f => f.id === 'root');
    if (!root) return;

    root.children.forEach(childId => {
        const child = folders.find(f => f.id === childId);
        if (child) {
            containerEl.appendChild(
                renderFolderNode(child, folders, 0, onTreeChanged, containerEl)
            );
        }
    });
}

STCM_TREE.renderFoldersTree = renderFoldersTree;   // (optional export)


// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function renderFolderNode(folder, allFolders, depth, onTreeChanged, treeContainer) {
    const node = document.createElement('div');
    node.className = `stcm_folder_node stcm_depth_${depth}`;
    node.style.marginBottom = '0px';

    // ███████ ROW ███████
    const row = document.createElement('div');
    row.className = 'stcm_folder_row';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '7px';
    row.style.marginLeft = `${depth * 24}px`;

    // ── drag handle ───────────────────────────────────────────────────────
    const dragHandle = document.createElement('div');
    dragHandle.className = 'stcm-folder-drag-handle';
    dragHandle.innerHTML = '<i class="fa-solid fa-bars"></i>';
    dragHandle.draggable = true;
    dragHandle.style.cursor = 'grab';

    dragHandle.addEventListener('dragstart', e => {
        const ghost = row.cloneNode(true);
        ghost.style.position = 'absolute';
        ghost.style.top = '-9999px';
        ghost.style.pointerEvents = 'none';
        document.body.appendChild(ghost);

        e.dataTransfer.setDragImage(ghost, 0, 0);
        e.dataTransfer.setData('text/plain', folder.id);
        e.dataTransfer.effectAllowed = 'move';

        document
            .getElementById('characterTagManagerModal')
            ?.classList.add('stcm-dragging-folder');

        setTimeout(() => ghost.remove(), 0);
    });

    dragHandle.addEventListener('dragend', () => {
        document
            .getElementById('characterTagManagerModal')
            ?.classList.remove('stcm-dragging-folder');
    });

    row.prepend(dragHandle);

    // Only show toggle if this folder has children
    const hasChildren = Array.isArray(folder.children) && folder.children.length > 0;
    if (hasChildren) {
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'stcm-folder-toggle-btn';
        toggleBtn.style.marginLeft = '2px';
        toggleBtn.style.background = 'none';
        toggleBtn.style.border = 'none';
        toggleBtn.style.cursor = 'pointer';
        toggleBtn.style.padding = '0 4px';
        toggleBtn.title = collapsedFolders[folder.id] ? 'Expand' : 'Collapse';

        // Use a FontAwesome caret (down for open, right for collapsed)
        toggleBtn.innerHTML = `<i class="fa-solid fa-caret-${collapsedFolders[folder.id] ? 'right' : 'down'}"></i>`;
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            collapsedFolders[folder.id] = !collapsedFolders[folder.id];
            // Rerender just this node and its children for simplicity
            const newNode = renderFolderNode(folder, allFolders, depth, onTreeChanged, treeContainer);
            node.replaceWith(newNode);
        });

        row.appendChild(toggleBtn);
    }


    // ── icon (click → icon picker) ────────────────────────────────────────
    const iconBg = document.createElement('div');
    iconBg.className = 'avatar flex alignitemscenter textAlignCenter stcm-folder-avatar';
    iconBg.style.backgroundColor = folder.color || '#8b2ae6';
    iconBg.title = 'Change Folder Icon';
    iconBg.innerHTML = `<span class="fa-solid ${folder.icon || 'fa-folder'} fa-fw stcm-folder-icon" style="font-size:1.2em;"></span>`;
    iconBg.addEventListener('click', e => {
        e.stopPropagation();
        showIconPicker(folder, node, async (folders) => {
            if (onTreeChanged) await onTreeChanged(folders);
        });
    });
    row.appendChild(iconBg);

    // ── name (click → rename) ─────────────────────────────────────────────
    const nameSpan = document.createElement('span');
    nameSpan.textContent = folder.name;
    nameSpan.className = 'stcm-folder-label';
    nameSpan.style.fontWeight = depth === 0 ? 'bold' : 'normal';
    nameSpan.style.cursor = 'pointer';
    nameSpan.title = 'Click to rename';
    nameSpan.addEventListener('click', e => {
        e.stopPropagation();
        makeFolderNameEditable(nameSpan, folder, async (folders) => {
            if (onTreeChanged) await onTreeChanged(folders);
        });
    });
    row.appendChild(nameSpan);

    // edit button (same rename)
    const editBtn = document.createElement('button');
    editBtn.className = 'stcm-folder-edit-btn stcm_menu_button tiny interactable';
    editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
    editBtn.title = 'Rename Folder';
    editBtn.addEventListener('click', e => {
        e.stopPropagation();
        makeFolderNameEditable(nameSpan, folder, async (folders) => {
            if (onTreeChanged) await onTreeChanged(folders);
        });
    });
    row.appendChild(editBtn);

    // colour-picker
    const colorBtn = document.createElement('button');
    colorBtn.className = 'stcm-folder-color-btn stcm_menu_button tiny interactable';
    colorBtn.innerHTML = '<i class="fa-solid fa-palette"></i>';
    colorBtn.title = 'Change Folder Color';
    colorBtn.addEventListener('click', e => {
        e.stopPropagation();
        showFolderColorPicker(folder, async (folders) => {
            if (onTreeChanged) await onTreeChanged(folders);
        });
    });
    
    row.appendChild(colorBtn);

    // privacy dropdown
    const typeSelect = document.createElement('select');
    typeSelect.className = 'stcm_folder_type_select tiny';
    typeSelect.title   = 'Set Folder Type: Public or Private';
    typeSelect.innerHTML = `
        <option value="public"  ${folder.private ? '' : 'selected'}>👁️ Public</option>
        <option value="private" ${folder.private ? 'selected' : ''}>🔒 Private</option>
    `;
    typeSelect.addEventListener('change', async e => {
        const isPriv = e.target.value === 'private';
        const childIds = Array.isArray(folder.children) ? folder.children : [];
        const hasChildren = childIds.length > 0;
        let recursive = false;
    
        if (hasChildren) {
            const confirmed = await callGenericPopup(
                `<div>
                    <b>This folder has ${childIds.length} subfolder(s).</b><br>
                    Do you want to apply the <b>${isPriv ? 'Private' : 'Public'}</b> status to all children as well?
                </div>`,
                POPUP_TYPE.CONFIRM,
                isPriv ? 'Set All to Private?' : 'Set All to Public?'
            );
            recursive = (confirmed === POPUP_RESULT.AFFIRMATIVE);
        }
    
        const folders = await stcmFolders.setFolderPrivacy(folder.id, isPriv, recursive);
        if (onTreeChanged) await onTreeChanged(folders);
    });
    
    row.appendChild(typeSelect);

    // delete
    if (folder.id !== 'root') {
        const delBtn = document.createElement('button');
        delBtn.className = 'stcm-folder-delete-btn stcm_menu_button tiny red interactable';
        delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        delBtn.title = 'Delete Folder';
        delBtn.addEventListener('click', e => {
            e.stopPropagation();
            confirmDeleteFolder(folder, async (folders) => {
                if (onTreeChanged) await onTreeChanged(folders);
            });
        });
        row.appendChild(delBtn);
    }

    // move/parent-change
    const moveBtn = document.createElement('button');
    moveBtn.className = 'stcm-folder-move-btn stcm_menu_button tiny interactable';
    moveBtn.innerHTML = '<i class="fa-solid fa-share"></i>';
    moveBtn.title     = 'Change Parent Folder';
    moveBtn.addEventListener('click', e => {
        e.stopPropagation();
        showChangeParentPopup(folder, allFolders, async (folders) => {
            if (onTreeChanged) await onTreeChanged(folders);
        });
    });
    row.appendChild(moveBtn);

    // add subfolder (depth < 4)
    if (depth < 4) {
        const addBtn = document.createElement('button');
        addBtn.className = 'stcm_menu_button tiny interactable';
        addBtn.innerHTML = '<i class="fa-solid fa-folder-plus"></i>';
        addBtn.title = 'Add Subfolder';

        addBtn.addEventListener('click', async (e) => {
            e.stopPropagation();

            const subName = await promptInput({
                label  : 'Enter sub-folder name:',
                title  : 'New Sub-Folder',
                ok     : 'Create',
                cancel : 'Cancel',
                initial: ''
            });

            if (!subName || !subName.trim()) return;

            try {
                const { folders } = await stcmFolders.addFolder(subName.trim(), folder.id);
                await refreshFolderUI(treeContainer, folders);  
                toastr.success(`Folder “${subName.trim()}” created!`);
            } catch (err) {
                toastr.error(err.message || 'Failed to create folder');
            }
        });

        row.appendChild(addBtn);
    }


    // char-count / manage chars button
    const charCount = Array.isArray(folder.characters) ? folder.characters.length : 0;
    const charBtn = document.createElement('button');
    charBtn.className = 'stcm_menu_button tiny stcm_folder_chars_btn interactable';
    charBtn.innerHTML = `<i class="fa-solid fa-users"></i> Characters (<span class="folderCharCount" data-folder-id="${folder.id}">${charCount}</span>)`;
    charBtn.title = 'Manage Characters in this Folder';
    charBtn.addEventListener('click', e => {
        e.stopPropagation();
        // function is defined elsewhere (kept global in original code)
        showFolderCharactersSection?.(folder, allFolders);

        setTimeout(() => {
            const section = document.getElementById('folderCharactersSection');
            if (section && section.style.display !== 'none') {
                section.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 50);
        
    });
    row.appendChild(charBtn);

    node.appendChild(row);

    // ███████ CHILDREN ███████
    if (Array.isArray(folder.children)) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'stcm_folder_children';
        childrenContainer.style.display = 'block';

        childrenContainer.style.display = collapsedFolders[folder.id] ? 'none' : 'block';

        // drop-line before first child
        childrenContainer.appendChild(
            createDropLine(folder, allFolders, 0, onTreeChanged, depth)
        );

        folder.children.forEach((childId, idx) => {
            const child = allFolders.find(f => f.id === childId);
            if (!child) return;

            childrenContainer.appendChild(
                renderFolderNode(child, allFolders, depth + 1, onTreeChanged, treeContainer)
            );
            // drop-line after this child
            childrenContainer.appendChild(
                createDropLine(folder, allFolders, idx + 1, onTreeChanged, depth)
            );
        });

        // drag-over highlight when dropping *inside* folder
        row.addEventListener('dragover', e => {
            e.preventDefault();
            row.classList.add('stcm-folder-row-drop-target');
            row.style.background =
                folder.color && folder.color !== '#'
                    ? folder.color
                    : '#d3ffdc';
            row.style.boxShadow =
                `0 0 0 2px ${folder.color && folder.color !== '#' ? folder.color : '#4fc566'}, ` +
                '0 2px 12px 1px #4fc56655';
        });
        row.addEventListener('dragleave', () => {
            row.classList.remove('stcm-folder-row-drop-target');
            row.style.background = '';
            row.style.boxShadow = '';
        });
        row.addEventListener('drop', async e => {
            row.classList.remove('stcm-folder-row-drop-target');
            row.style.background = '';
            row.style.boxShadow = '';
            const draggedId = e.dataTransfer.getData('text/plain');
            if (!draggedId || draggedId === folder.id) return;

            let folders = await stcmFolders.loadFolders();
            const dragged = folders.find(f => f.id === draggedId);
            if (!dragged) return;

            // prevent cycles
            if (getAllDescendantFolderIds(draggedId, folders).includes(folder.id)) return;

            // change parent
            if (dragged.parentId !== folder.id) {
                await stcmFolders.moveFolder(draggedId, folder.id);
            }

            // put at end
            const siblings = [...folder.children.filter(id => id !== draggedId), draggedId];
            folders = await reorderChildren(folder.id, siblings);
            injectSidebarFolders(folders, characters);
            onTreeChanged && onTreeChanged(folders);
            
        });

        node.appendChild(childrenContainer);
    }

    return node;
}


// ---------------------------------------------------------------------------
// Drop-line helper
// ---------------------------------------------------------------------------
function createDropLine(parent, allFolders, insertAt, onTreeChanged, depth = 0) {
    const line = document.createElement('div');
    line.className = 'stcm-drop-line';
    line.style.marginLeft = `${(depth + 1) * 24}px`;
    line.style.background = 'transparent';

    line.addEventListener('dragover', e => {
        e.preventDefault();
        line.classList.add('stcm-drop-line-active', 'insert-between');
        let clr = parent.color && parent.color !== '#' ? parent.color : '#3bb1ff';
        // if there’s a folder *after* this line, use its colour for preview
        if (parent.children?.length > insertAt) {
            const below = allFolders.find(f => f.id === parent.children[insertAt]);
            if (below?.color && below.color !== '#') clr = below.color;
        }
        line.style.background = hexToRgba(clr, 0.85);
    });

    line.addEventListener('dragleave', () => {
        line.classList.remove('stcm-drop-line-active', 'insert-between');
        line.style.background = '';
    });

    line.addEventListener('drop', async e => {
        line.classList.remove('stcm-drop-line-active', 'insert-between');
        line.style.background = '';
        const draggedId = e.dataTransfer.getData('text/plain');
        if (!draggedId) return;
    
        let folders = await stcmFolders.loadFolders();
        let dragged  = folders.find(f => f.id === draggedId);
        if (!dragged) return;
    
        if (dragged.parentId !== parent.id) {
            folders = await stcmFolders.moveFolder(draggedId, parent.id);
            dragged  = folders.find(f => f.id === draggedId);
        }
    
        // reorder siblings
        const siblings = folders
            .find(f => f.id === parent.id)
            .children.filter(id => id !== draggedId);
        siblings.splice(insertAt, 0, draggedId);
        folders = await reorderChildren(parent.id, siblings);

        injectSidebarFolders(folders, characters);
        onTreeChanged && onTreeChanged(folders);
    });
    

    return line;
}

export function showFolderCharactersSection(folder, folders) {
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
            <option value="no_folder">No Folder Assigned</option>
            <option value="with_folder">Folder Assigned</option>
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
        const folders = await stcmFolders.assignCharactersToFolder(folder, Array.from(assignSelection));
        for (const charId of assignSelection) {
            if (!folder.characters.includes(charId)) folder.characters.push(charId);
        }
        renderAssignedChipsRow(folder, section, renderAssignCharList, assignSelection); 
        assignSelection.clear();
        renderAssignCharList();
        stcmFolders.updateFolderCharacterCount(folder);
        const sidebarFolders = await stcmFolders.loadFolders();
        injectSidebarFolders(sidebarFolders, characters);
        if (onTreeChanged) await onTreeChanged(folders);
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
        let unassignedCharacters = characters.filter(c => !folder.characters.includes(c.avatar));
        const searchInput = document.getElementById('folderCharSearchInput');
        const rawInput = (searchInput?.value || '').trim();
        const tagMapById = buildTagMap(tags);
        const searchGroups = parseSearchGroups(rawInput);
    
        // --- SEARCH FILTER ---
        let filtered = unassignedCharacters;
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
    
        // === STRICT FILTER MODES ===
        switch (folderCharSortMode) {
            case 'no_folder':
                filtered = filtered.filter(char => {
                    const assignedFolder = stcmFolders.getCharacterAssignedFolder(char.avatar, folders);
                    return !assignedFolder;
                });
                break;
            case 'with_folder':
                filtered = filtered.filter(char => {
                    const assignedFolder = stcmFolders.getCharacterAssignedFolder(char.avatar, folders);
                    return !!assignedFolder && assignedFolder.id !== folder.id;
                });
                break;
            case 'with_notes':
                filtered = filtered.filter(c => (getNotes().charNotes || {})[c.avatar]);
                break;
            case 'without_notes':
                filtered = filtered.filter(c => !(getNotes().charNotes || {})[c.avatar]);
                break;
            // Other sort modes handled below
        }
    
        // === NORMAL SORT MODES: SPLIT & SORT ===
        if (!['no_folder', 'with_folder', 'with_notes', 'without_notes'].includes(folderCharSortMode)) {
            let unassigned = [];
            let assignedElsewhere = [];
    
            filtered.forEach(char => {
                const assignedFolder = stcmFolders.getCharacterAssignedFolder(char.avatar, folders);
                if (!assignedFolder) {
                    unassigned.push(char);
                } else if (assignedFolder.id !== folder.id) {
                    assignedElsewhere.push(char);
                }
            });
    
            // Sorting function
            function sortChars(arr) {
                switch (folderCharSortMode) {
                    case 'alpha_asc':
                        arr.sort((a, b) => a.name.localeCompare(b.name));
                        break;
                    case 'alpha_desc':
                        arr.sort((a, b) => b.name.localeCompare(a.name));
                        break;
                    case 'tag_count_desc':
                        arr.sort((a, b) =>
                            (tag_map[b.avatar]?.length || 0) - (tag_map[a.avatar]?.length || 0)
                        );
                        break;
                    case 'tag_count_asc':
                        arr.sort((a, b) =>
                            (tag_map[a.avatar]?.length || 0) - (tag_map[b.avatar]?.length || 0)
                        );
                        break;
                }
                return arr;
            }
    
            unassigned = sortChars(unassigned);
            assignedElsewhere = sortChars(assignedElsewhere);
            filtered = [...unassigned, ...assignedElsewhere];
        }
    
        // === RENDER CHARACTERS ===
        filtered.forEach(char => {
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
                    if (!folder.characters.includes(char.avatar)) folder.characters.push(char.avatar);
                    renderAssignedChipsRow(folder, section, renderAssignCharList, assignSelection);
                    renderAssignCharList();
                    stcmFolders.updateFolderCharacterCount(folder);
                    const sidebarFolders = await stcmFolders.loadFolders();
                    injectSidebarFolders(sidebarFolders, characters);
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
                    assignSelection.add(char.avatar);
                } else {
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
                stcmFolders.updateFolderCharacterCount(folder);
                const sidebarFolders = await stcmFolders.loadFolders();
                injectSidebarFolders(sidebarFolders, characters);
            });
    
            left.appendChild(assignOneBtn);
    
            li.appendChild(left);
    
            // Tag chips (as before)
            const tagListWrapper = document.createElement('div');
            tagListWrapper.className = 'assignedTagsWrapper';
            cleanTagMap(tag_map, characters, groups);
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


export async function attachFolderSectionListeners(modalRoot) {
    const treeContainer   = modalRoot.querySelector('#foldersTreeContainer');
    const createFolderBtn = modalRoot.querySelector('#createNewFolderBtn');

    if (!treeContainer) return;

    // initial paint
    await renderFoldersTree(treeContainer, {
        onTreeChanged: (folders) => refreshFolderUI(treeContainer, folders)
    });

    // “New Folder” button
    if (createFolderBtn) {
        createFolderBtn.addEventListener('click', async () => {
            const name = await promptInput({
                label  : 'Enter folder name:',
                title  : 'New Folder',
                ok     : 'Create',
                cancel : 'Cancel',
                initial: ''
            });
            if (!name || !name.trim()) return;

            try {
                const { folders } = await stcmFolders.addFolder(name.trim(), 'root');
                await refreshFolderUI(treeContainer, folders);
                toastr.success(`Folder “${name.trim()}” created!`);
            } catch (err) {
                toastr.error(err.message || 'Failed to create folder');
            }
        });
    }

const folderSearchInput = modalRoot.querySelector('#folderSearchInput');

if (folderSearchInput) {
    folderSearchInput.addEventListener('input', debounce(async function () {
        const raw = folderSearchInput.value.trim().toLowerCase();
        const folders = await stcmFolders.loadFolders();
        const tagMapById = buildTagMap(tags);

        // Build character name map for each folder
        function getCharNames(folder) {
            return (folder.characters || [])
                .map(charId => {
                    const char = characters.find(c => c.avatar === charId);
                    return char ? char.name.toLowerCase() : '';
                })
                .filter(Boolean)
                .join(' ');
        }

        // Filter folders recursively by folder name OR assigned character names
        function filterFolders(folders, parentId = 'root') {
            const parent = folders.find(f => f.id === parentId);
            if (!parent || !Array.isArray(parent.children)) return [];
        
            return parent.children
                .map(childId => folders.find(f => f.id === childId))
                .filter(Boolean)
                .map(f => {
                    const folderNameMatch = raw ? f.name.toLowerCase().includes(raw) : true;
                    const charNameMatch   = raw ? getCharNames(f).includes(raw) : true;
        
                    // Recursively filter children
                    const filteredChildren = filterFolders(folders, f.id);
        
                    // If current folder matches, or any children match, keep it
                    if ((folderNameMatch || charNameMatch) || filteredChildren.length > 0) {
                        return {
                            ...f,
                            children: filteredChildren
                        };
                    } else {
                        return null;
                    }
                })
                .filter(Boolean);
        }
        
        
        // Flatten filtered tree for rendering dropdown (indented)
        function flatten(foldersTree, depth = 0) {
            let result = [];
            for (const folder of foldersTree) {
                result.push({ folder, depth });
                result = result.concat(flatten(folder.children, depth + 1));
            }
            return result;
        }

        // Create filtered+flattened list
        const tree = filterFolders(folders);
        const flat = flatten(tree);

        // Re-render tree UI
        const treeContainer = modalRoot.querySelector('#foldersTreeContainer');
        treeContainer.innerHTML = '';
        if (flat.length === 0) {
            treeContainer.innerHTML = '<div class="no-results">No folders found.</div>';
        } else {
            for (const { folder, depth } of flat) {
                treeContainer.appendChild(
                    renderFolderNode(folder, folders, depth, folders => refreshFolderUI(treeContainer, folders), treeContainer)
                );
            }
        }

    }, 180));
}
    
    // collapse/expand all folders
    const collapseAllBtn = modalRoot.querySelector('#collapseAllFoldersBtn');
    const expandAllBtn = modalRoot.querySelector('#expandAllFoldersBtn');

    if (collapseAllBtn && expandAllBtn) {
        collapseAllBtn.addEventListener('click', async () => {
            const folders = await stcmFolders.loadFolders();
            folders.forEach(f => {
                if (f.id !== 'root' && Array.isArray(f.children) && f.children.length > 0)
                    collapsedFolders[f.id] = true;
            });
            // Rerender
            const treeContainer = modalRoot.querySelector('#foldersTreeContainer');
            await renderFoldersTree(treeContainer, { onTreeChanged: (folders) => refreshFolderUI(treeContainer, folders) });
        });
        expandAllBtn.addEventListener('click', async () => {
            const folders = await stcmFolders.loadFolders();
            folders.forEach(f => {
                if (f.id !== 'root' && Array.isArray(f.children) && f.children.length > 0)
                    collapsedFolders[f.id] = false;
            });
            // Rerender
            const treeContainer = modalRoot.querySelector('#foldersTreeContainer');
            await renderFoldersTree(treeContainer, { onTreeChanged: (folders) => refreshFolderUI(treeContainer, folders) });
        });
    }

}


export function renderAssignedChipsRow(folder, section, renderAssignCharList, assignSelection = new Set()) {
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
            const sidebarFolders = await stcmFolders.loadFolders();
            injectSidebarFolders(sidebarFolders, characters);
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

async function refreshFolderUI(treeContainer, foldersArg) {
    // Use provided folders, or reload if not given
    let folders = foldersArg;
    if (!folders) folders = await stcmFolders.loadFolders();

    STCM.sidebarFolders = folders;

    // tree (if you’re looking at it)
    if (treeContainer) {
        await renderFoldersTree(treeContainer, { onTreeChanged: (newFolders) => refreshFolderUI(treeContainer, newFolders) });
    }

    // sidebar accordion
    injectSidebarFolders(folders, characters);
}

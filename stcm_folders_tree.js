// stcm_folders_tree.js
//
// Pure UI module that renders the folder tree used by the Character / Tag
// Manager modal (and anywhere else you like).  It owns:
//
//   • renderFoldersTree(containerElement, { onTreeChanged? })
//
// The original behaviour is preserved 1-for-1, just relocated.
//
// ---------------------------------------------------------------------------
// Imports – explicit so the module is self-contained
// ---------------------------------------------------------------------------

import {
    hexToRgba,
} from './utils.js';

import * as stcmFolders from './stcm_folders.js';

import {
    injectSidebarFolders,
    showFolderColorPicker,
    makeFolderNameEditable,
    showIconPicker,
    confirmDeleteFolder,
    showChangeParentPopup,
    reorderChildren,
    getAllDescendantFolderIds,
} from './stcm_folders_ui.js';

import { characters } from '../../../../script.js';

// If you keep the global STCM object (as in index.js) you can re-use it here:
export const STCM_TREE = { renderFoldersTree: null };


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
                renderFolderNode(child, folders, 0, onTreeChanged)
            );
        }
    });
}

STCM_TREE.renderFoldersTree = renderFoldersTree;   // (optional export)


// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function renderFolderNode(folder, allFolders, depth, onTreeChanged) {
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

    // ── icon (click → icon picker) ────────────────────────────────────────
    const iconBg = document.createElement('div');
    iconBg.className = 'avatar flex alignitemscenter textAlignCenter stcm-folder-avatar';
    iconBg.style.backgroundColor = folder.color || '#8b2ae6';
    iconBg.title = 'Change Folder Icon';
    iconBg.innerHTML = `<span class="fa-solid ${folder.icon || 'fa-folder'} fa-fw stcm-folder-icon" style="font-size:1.2em;"></span>`;
    iconBg.addEventListener('click', e => {
        e.stopPropagation();
        showIconPicker(folder, node, () => onTreeChanged?.());
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
        makeFolderNameEditable(nameSpan, folder, () => onTreeChanged?.());
    });
    row.appendChild(nameSpan);

    // edit button (same rename)
    const editBtn = document.createElement('button');
    editBtn.className = 'stcm-folder-edit-btn stcm_menu_button tiny interactable';
    editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
    editBtn.title = 'Rename Folder';
    editBtn.addEventListener('click', e => {
        e.stopPropagation();
        makeFolderNameEditable(nameSpan, folder, () => onTreeChanged?.());
    });
    row.appendChild(editBtn);

    // colour-picker
    const colorBtn = document.createElement('button');
    colorBtn.className = 'stcm-folder-color-btn stcm_menu_button tiny interactable';
    colorBtn.innerHTML = '<i class="fa-solid fa-palette"></i>';
    colorBtn.title = 'Change Folder Color';
    colorBtn.addEventListener('click', e => {
        e.stopPropagation();
        showFolderColorPicker(folder, () => onTreeChanged?.());
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
        await stcmFolders.setFolderPrivacy(folder.id, isPriv);
        injectSidebarFolders(await stcmFolders.loadFolders(), characters);
        onTreeChanged?.();
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
            confirmDeleteFolder(folder, () => onTreeChanged?.());
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
        showChangeParentPopup(folder, allFolders, () => onTreeChanged?.());
    });
    row.appendChild(moveBtn);

    // add subfolder (depth < 4)
    if (depth < 4) {
        const addBtn = document.createElement('button');
        addBtn.className = 'stcm_menu_button tiny interactable';
        addBtn.innerHTML = '<i class="fa-solid fa-folder-plus"></i>';
        addBtn.title = 'Add Subfolder';
        addBtn.addEventListener('click', async e => {
            e.stopPropagation();
            const subName = prompt('Enter sub-folder name:').trim();
            if (!subName) return;
            await stcmFolders.addFolder(subName, folder.id);
            injectSidebarFolders(await stcmFolders.loadFolders(), characters);
            onTreeChanged?.();
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
        window.showFolderCharactersSection?.(folder, allFolders);
    });
    row.appendChild(charBtn);

    node.appendChild(row);

    // ███████ CHILDREN ███████
    if (Array.isArray(folder.children)) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'stcm_folder_children';
        childrenContainer.style.display = 'block';

        // drop-line before first child
        childrenContainer.appendChild(
            createDropLine(folder, allFolders, 0, onTreeChanged, depth)
        );

        folder.children.forEach((childId, idx) => {
            const child = allFolders.find(f => f.id === childId);
            if (!child) return;

            childrenContainer.appendChild(
                renderFolderNode(child, allFolders, depth + 1, onTreeChanged)
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

            const folders = await stcmFolders.loadFolders();
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
            await reorderChildren(folder.id, siblings);

            injectSidebarFolders(await stcmFolders.loadFolders(), characters);
            onTreeChanged?.();
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
            await stcmFolders.moveFolder(draggedId, parent.id);
            folders = await stcmFolders.loadFolders();
            dragged  = folders.find(f => f.id === draggedId);
        }

        // reorder siblings
        const siblings = folders
            .find(f => f.id === parent.id)
            .children.filter(id => id !== draggedId);
        siblings.splice(insertAt, 0, draggedId);
        await reorderChildren(parent.id, siblings);

        injectSidebarFolders(await stcmFolders.loadFolders(), characters);
        onTreeChanged?.();
    });

    return line;
}

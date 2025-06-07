// stcm_folders.js
import {
    tags,
    tag_map,
} from "../../../tags.js";
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from "../../../popup.js";
import { escapeHtml, flushExtSettings  } from "./utils.js";
import { STCM, callSaveandReload } from "./index.js";
import { renderCharacterList } from "./stcm_characters.js"; 
import { injectSidebarFolders, updateSidebar  } from "./stcm_folders_ui.js";
import { renderTagSection } from "./stcm_tags_ui.js"

const EXT_KEY = 'stcm_folders_v2'; // a single key in ext-settings that holds the folder array

function ctx() {
    return SillyTavern.getContext();
}

function readExtFolders() {
    const set = ctx().extensionSettings || {};
    const data = set[EXT_KEY];
    return Array.isArray(data) ? data : null;
}

function writeExtFolders(foldersArr) {
    if (!ctx().extensionSettings) ctx().extensionSettings = {};
    ctx().extensionSettings[EXT_KEY] = foldersArr;
    flushExtSettings(); // triggers persistent write
}

export async function loadFolders() {
    // 1. read from ext-settings
    let folders = readExtFolders();

    // 2. on first run initialise the default root
    if (!folders || !Array.isArray(folders) || !folders.length) {
        folders = [{
            id: 'root',
            name: 'Root',
            icon: 'fa-folder',
            color: '#8b2ae6',
            parentId: null,
            children: [],
            characters: [],
            private: false
        }];
        writeExtFolders(folders);
    }

    // 3. lightweight sanity-fixes (back-compat)
    folders.forEach(f => {
        if (!f.color)   f.color   = '#8b2ae6';
        if (!f.icon)    f.icon    = 'fa-folder';
        if (!('private' in f)) f.private = false;
        if (!Array.isArray(f.children))   f.children   = [];
        if (!Array.isArray(f.characters)) f.characters = [];
    });

    return folders;
}

export async function saveFolders(foldersToSave) {
    writeExtFolders(foldersToSave);
}

export function getCharacterAssignedFolder(charId, folders) {
    return folders.find(f => Array.isArray(f.characters) && f.characters.includes(charId));
}

export function updateFolderCharacterCount(folder) {
    // Find the span inside the button for this folder
    const countSpan = document.querySelector(`.folderCharCount[data-folder-id="${folder.id}"]`);
    if (countSpan) {
        countSpan.textContent = Array.isArray(folder.characters) ? folder.characters.length : 0;
    }
}

export function updateAllFolderCharacterCounts(folders) {
    folders.forEach(folder => updateFolderCharacterCount(folder));
}


export async function assignCharactersToFolder(folderOrId, charIds) {
    const folders = await loadFolders();
    const id      = typeof folderOrId === 'string' ? folderOrId : folderOrId.id;
    const target  = getFolder(id, folders);
    if (!target) throw new Error('Folder not found');

    // remove from other folders & add to target
    for (const charId of charIds) {
        folders.forEach(f => {
            if (f.characters?.includes(charId)) {
                f.characters = f.characters.filter(c => c !== charId);
            }
        });
        if (!target.characters.includes(charId)) target.characters.push(charId);
    }
    await saveFolders(folders);
}

export async function removeCharacterFromFolder(folderOrId, charId) {
    const folders = await loadFolders();
    const id      = typeof folderOrId === 'string' ? folderOrId : folderOrId.id;
    const f       = getFolder(id, folders);
    if (f) {
        f.characters = f.characters.filter(c => c !== charId);
        await saveFolders(folders);
    }
}

// Utility to get folder by ID
export function getFolder(id, folders) {
    return folders.find(f => f.id === id);
}

// Add a new folder
export async function addFolder(name, parentId = 'root', color = '#8b2ae6') {
    const folders = await loadFolders();
    const parent  = getFolder(parentId, folders);
    if (!parent) throw new Error('Parent folder not found');

    const id = crypto.randomUUID();
    parent.children.push(id);

    folders.push({
        id,
        name,
        icon: 'fa-folder',
        color,
        parentId,
        children: [],
        characters: [],
        private: false
    });

    await saveFolders(folders);
    return id;
}

// Move a folder to a new parent (careful with cycles/depth)
export async function moveFolder(folderId, newParentId) {
    if (folderId === 'root') throw new Error('Cannot move root folder');
    const folders = await loadFolders();
    const toMove  = getFolder(folderId, folders);
    const newPar  = getFolder(newParentId, folders);
    const oldPar  = getFolder(toMove?.parentId, folders);
    if (!toMove || !newPar) return;
    if (getFolderDepth(newParentId, folders) >= 5) {
        throw new Error('Folder depth limit');
    }

    if (oldPar) oldPar.children = oldPar.children.filter(cid => cid !== folderId);
    newPar.children.push(folderId);
    toMove.parentId = newParentId;
    await saveFolders(folders);
}


function getFolderDepth(folderId, folders) {
    let depth = 0;
    let curr = getFolder(folderId, folders);
    while (curr && curr.parentId) {
        curr = getFolder(curr.parentId, folders);
        depth++;
    }
    return depth;
}

export async function renameFolder(id, newName) {
    const folders = await loadFolders();
    const f = getFolder(id, folders);
    if (f && newName.trim()) {
        f.name = newName.trim();
        await saveFolders(folders);
    }
}

export async function setFolderIcon(id, icon) {
    const folders = await loadFolders();
    const f = getFolder(id, folders);
    if (f) {
        f.icon = icon;
        await saveFolders(folders);
    }
}

export async function setFolderColor(id, color) {
    const folders = await loadFolders();
    const f = getFolder(id, folders);
    if (f) {
        f.color = color;
        await saveFolders(folders);
    }
}

export async function setFolderPrivacy(id, isPrivate) {
    const folders = await loadFolders();
    const f = getFolder(id, folders);
    if (f) {
        f.private = !!isPrivate;
        await saveFolders(folders);
    }
}

export async function deleteFolder(id) {
    const folders = await loadFolders();
    if (id === 'root') return;

    // recursive delete
    function drop(fid) {
        const idx = folders.findIndex(f => f.id === fid);
        if (idx !== -1) {
            const [f] = folders.splice(idx, 1);
            f.children?.forEach(drop);
        }
    }
    drop(id);

    // scrub child refs from remaining folders
    folders.forEach(f => f.children = f.children?.filter(cid => cid !== id));
    await saveFolders(folders);
}

/* ---------------------------------------------------------------- */
/*  Tag-to-Folder conversion (logic identical, only persistence fix)*/
/* ---------------------------------------------------------------- */

export async function convertTagToRealFolder(tag) {
    if (!tag || !tag.name) return;

    const folderName  = tag.name.trim();
    const folderColor = tag.color || '#8b2ae6';

    const folders = await loadFolders();
    if (folders.some(f => f.name.trim().toLowerCase() === folderName.toLowerCase())) {
        toastr.warning(`A folder named "${folderName}" already exists.`);
        return;
    }

    const newId = await addFolder(folderName, 'root', folderColor);

    // assign characters with this tag
    const assigned = Object.entries(tag_map)
        .filter(([_, tagsArr]) => tagsArr?.includes(tag.id))
        .map(([charId]) => charId);

    await assignCharactersToFolder(newId, assigned);

    toastr.success(`Converted "${tag.name}" into a folder with ${assigned.length} characters`);
    await updateSidebar(true);
    await STCM.renderFoldersTree();

    // ask to remove the tag
    const html = document.createElement('div');
    html.innerHTML = `
        <p>Tag <strong>${escapeHtml(tag.name)}</strong> has been converted to a folder.</p>
        <p>Delete the original tag?</p>
    `;
    const ok = await callGenericPopup(html, POPUP_TYPE.CONFIRM, 'Delete Tag?');
    if (ok === POPUP_RESULT.AFFIRMATIVE) {
        for (const [cid, arr] of Object.entries(tag_map)) {
            if (Array.isArray(arr)) tag_map[cid] = arr.filter(tid => tid !== tag.id);
        }
        const idx = tags.findIndex(t => t.id === tag.id);
        if (idx !== -1) tags.splice(idx, 1);

        await callSaveandReload();
        renderCharacterList();
        renderTagSection();
        toastr.success(`Deleted tag "${tag.name}"`);
    }
}
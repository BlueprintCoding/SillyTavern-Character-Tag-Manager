// stcm_folders.js
import {
    tags,
    tag_map,
} from "../../../tags.js";
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from "../../../popup.js";
import { escapeHtml, flushExtSettings, buildTagMap } from "./utils.js";
import { STCM, callSaveandReload } from "./index.js";
import { renderCharacterList } from "./stcm_characters.js"; 
import { updateSidebar } from "./stcm_folders_ui.js";
import { renderTagSection } from "./stcm_tags_ui.js"
import {
    getEntitiesList,
} from "../../../../script.js";

const EXT_KEY = 'stcm_folders_v2'; // a single key in ext-settings that holds the folder array

function ctx() {
    return SillyTavern.getContext();
}

export function getEntityChidMaster(entity) {
    if (!entity) return undefined;
    // If entity.item exists, try that first
    if (entity.item && typeof entity.item.id !== "undefined") return entity.item.id;
    if (entity.id !== undefined) return entity.id;
    if (entity.item && entity.item.avatar !== undefined) return entity.item.avatar;
    if (entity.avatar !== undefined) return entity.avatar;
    return undefined;
}

export function buildEntityMap() {
    const folders = STCM?.sidebarFolders || [];
    const allEntities = typeof getEntitiesList === "function" ? getEntitiesList() : [];
    const tagsById = buildTagMap(tags);

    // Map folder assignment (character/group ID => folder ID and privacy)
    const charToFolder = new Map();
    function walk(folder, parentPrivate = false) {
        const isPrivate = !!folder.private || parentPrivate;
        (folder.characters || []).forEach(charAvatar => {
            charToFolder.set(charAvatar, { folderId: folder.id, isPrivate });
        });
        (folder.children || []).forEach(childId => {
            const child = folders.find(f => f.id === childId);
            if (child) walk(child, isPrivate);
        });
    }

    const root = folders.find(f => f.id === "root");
    if (root) walk(root);
    else folders.forEach(f => walk(f));

    const entityMap = new Map();
    for (const entity of allEntities) {
        if (!entity) continue;

        let id, idType, type, name, avatar, chid, description, members, avatar_url;
        if (entity.type === "character") {
            // Character
            id = entity.item?.avatar || entity.avatar || entity.item?.id || entity.id;
            avatar = entity.item?.avatar || entity.avatar;
            chid = entity.item?.id || entity.id;
            name = entity.item?.name || entity.name;
            idType = avatar ? "avatar" : (chid ? "chid" : "unknown");
            type = "character";
            description = entity.item?.description || entity.description || "";
        } else if (entity.type === "group") {
            // Group
            let groupObj = entity.item ? entity.item : entity;
            id = entity.id || groupObj.id;
            name = groupObj.name;
            avatar = Array.isArray(groupObj.members) ? groupObj.members.slice(0, 3) : [];
            idType = "id";
            type = "group";
            members = groupObj.members || [];
            avatar_url = groupObj.avatar_url || "";
        } else {
            continue; // skip unknown types
        }

        // **Skip any entity missing any required identifier**
        if (typeof id === "undefined" || typeof avatar === "undefined" || typeof idType === "undefined" || idType === "unknown") {
            continue;
        }

        // Folder assignment
        const folderInfo = charToFolder.get(id) || { folderId: null, isPrivate: false };

        // Tags for this entity (characters: use avatar as key; groups: use id)
        const tagIds = tag_map[id] || [];
        const tagNames = tagIds.map(tid => tagsById.get(tid)?.name).filter(Boolean);

        entityMap.set(id, {
            id,
            idType,
            type,
            name,
            avatar,
            chid,             // For characters
            description,      // For characters
            members,          // For groups
            avatar_url,       // For groups
            folderId: folderInfo.folderId,
            folderIsPrivate: folderInfo.isPrivate,
            tagIds,
            tagNames
        });
    }
    return entityMap;
}



function readExtFolders() {
    const set = ctx().extensionSettings || {};
    const data = set[EXT_KEY];
    return Array.isArray(data) ? data : null;
}

async function writeExtFolders(foldersArr) {
    if (!ctx().extensionSettings) ctx().extensionSettings = {};
    ctx().extensionSettings[EXT_KEY] = foldersArr;
    await flushExtSettings(); // triggers persistent write
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
        await writeExtFolders(folders);
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
    await writeExtFolders(foldersToSave);
    // Now reload from disk to ensure up-to-date
    return await loadFolders();
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

    for (const charId of charIds) {
        folders.forEach(f => {
            if (f.characters?.includes(charId)) {
                f.characters = f.characters.filter(c => c !== charId);
            }
        });
        if (!target.characters.includes(charId)) target.characters.push(charId);
    }
    return await saveFolders(folders);
}

export async function removeCharacterFromFolder(folderOrId, charId) {
    const folders = await loadFolders();
    const id      = typeof folderOrId === 'string' ? folderOrId : folderOrId.id;
    const f       = getFolder(id, folders);
    if (f) {
        f.characters = f.characters.filter(c => c !== charId);
        return await saveFolders(folders);
    }
    return folders; // unchanged
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

    return { id, folders: await saveFolders(folders) }; 
}



// Move a folder to a new parent (careful with cycles/depth)
export async function moveFolder(folderId, newParentId) {
    if (folderId === 'root') throw new Error('Cannot move root folder');
    const folders = await loadFolders();
    const toMove  = getFolder(folderId, folders);
    const newPar  = getFolder(newParentId, folders);
    const oldPar  = getFolder(toMove?.parentId, folders);
    if (!toMove || !newPar) return folders;
    if (getFolderDepth(newParentId, folders) >= 5) {
        throw new Error('Folder depth limit');
    }

    if (oldPar) oldPar.children = oldPar.children.filter(cid => cid !== folderId);
    newPar.children.push(folderId);
    toMove.parentId = newParentId;
    return await saveFolders(folders);
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
        return await saveFolders(folders);
    }
    return folders;
}

export async function setFolderIcon(id, icon) {
    const folders = await loadFolders();
    const f = getFolder(id, folders);
    if (f) {
        f.icon = icon;
        return await saveFolders(folders);
    }
    return folders;
}

export async function setFolderColor(id, color) {
    const folders = await loadFolders();
    const f = getFolder(id, folders);
    if (f) {
        f.color = color;
        return await saveFolders(folders);
    }
    return folders;
}

export async function setFolderPrivacy(id, isPrivate, recursive = false) {
    const folders = await loadFolders();
    const updatePrivacyRecursive = (fid) => {
        const folder = folders.find(f => f.id === fid);
        if (!folder) return;
        folder.private = !!isPrivate;
        if (recursive && Array.isArray(folder.children)) {
            folder.children.forEach(childId => updatePrivacyRecursive(childId));
        }
    };
    updatePrivacyRecursive(id);
    return await saveFolders(folders);
}


// deleteFolder(id[, cascade=true])
// • cascade = true  → delete this folder AND all descendants
// • cascade = false → move all child-folders to Root first, then delete only this folder
// deleteFolder(id[, cascade=true, foldersOverride])
export async function deleteFolder(id, cascade = true, moveAssigned = true) {
    if (id === 'root') return await loadFolders();

    const folders = await loadFolders();
    const self    = getFolder(id, folders);
    if (!self) return folders;

    // Helper to move assigned chars
    function moveCharsToParent(folder, parentId) {
        if (!Array.isArray(folder.characters) || !folder.characters.length) return;
        if (!parentId) return;
        const parent = getFolder(parentId, folders);
        if (!parent) return;
        folder.characters.forEach(charId => {
            if (!parent.characters.includes(charId)) parent.characters.push(charId);
        });
        folder.characters = [];
    }
    // Helper to unassign chars
    function unassignChars(folder) {
        folder.characters = [];
    }

    if (!cascade && Array.isArray(self.children) && self.children.length) {
        // move subfolders to root
        const root = getFolder('root', folders);
        self.children.forEach(childId => {
            const child = getFolder(childId, folders);
            if (child) {
                child.parentId = 'root';
                root.children.push(childId);
            }
        });
    }

    // Determine what characters to move/unassign
    if (cascade) {
        // Move/unassign all characters in self and descendants
        const allFoldersToDelete = [];
        function collectAll(f) {
            allFoldersToDelete.push(f);
            (f.children || []).forEach(cid => {
                const child = getFolder(cid, folders);
                if (child) collectAll(child);
            });
        }
        collectAll(self);

        allFoldersToDelete.forEach(f => {
            if (moveAssigned && f.id !== 'root' && f.parentId) moveCharsToParent(f, getFolder(f.parentId, folders).id);
            else if (!moveAssigned) unassignChars(f);
        });
    } else {
        // Only the deleted folder itself
        if (moveAssigned && self.parentId) moveCharsToParent(self, self.parentId);
        else if (!moveAssigned) unassignChars(self);
    }

    // Now do the delete
    function drop(fid) {
        const idx = folders.findIndex(f => f.id === fid);
        if (idx !== -1) {
            const [f] = folders.splice(idx, 1);
            if (cascade) f.children?.forEach(drop);
        }
    }
    drop(id);

    folders.forEach(f => f.children = f.children?.filter(cid => cid !== id));

    return await saveFolders(folders);
}


/* ---------------------------------------------------------------- */
/*  Tag-to-Folder conversion                                        */
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
        renderTagSection();
        renderCharacterList();
        toastr.success(`Deleted tag "${tag.name}"`);
    }
}
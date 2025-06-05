// stcm_folders.js
import { uploadFileAttachment, getFileAttachment } from '../../../chats.js';

const FOLDER_FILE_NAME = "stcm-folders.json";
const FOLDER_FILE_KEY = "stcm_folders_url"; // localStorage key

let folders = []; // In-memory cache

export async function loadFolders() {
    let url = localStorage.getItem(FOLDER_FILE_KEY);
    let json = null;
    if (url) {
        try {
            json = await getFileAttachment(url);
            if (!json) throw new Error("No content");
            folders = JSON.parse(json);
            // Optional: Check structure, or fallback if not an array
            if (!Array.isArray(folders)) throw new Error("Corrupt file");
            for (const f of folders) {
                if (!f.color) f.color = '#8b2ae6';
            }
            return folders;
        } catch (e) {
            console.warn("Failed to load folder file, resetting:", e);
            // FALL THROUGH to create new
        }
    }
    // If no file, or error, create default
    folders = [ { id: "root", name: "Root", icon: 'fa-folder', color: '#8b2ae6', parentId: null, children: [], characters: [] } ];
    await saveFolders();
    return folders;
}

export function getCharacterAssignedFolder(charId, folders) {
    return folders.find(f => Array.isArray(f.characters) && f.characters.includes(charId));
}


export async function assignCharactersToFolder(folderOrId, charIds) {
    // Accept either the folder object or its id
    let id = typeof folderOrId === 'object' ? folderOrId.id : folderOrId;
    await loadFolders(); // Always reload to get up-to-date list
    const folder = folders.find(f => f.id === id);
    if (!folder) throw new Error('Folder not found');
    if (!Array.isArray(folder.characters)) folder.characters = [];

    // Remove each charId from all other folders first
    for (const charId of charIds) {
        for (const f of folders) {
            if (f !== folder && Array.isArray(f.characters)) {
                const idx = f.characters.indexOf(charId);
                if (idx !== -1) f.characters.splice(idx, 1);
            }
        }
        // Then add to the target folder if not present
        if (!folder.characters.includes(charId)) {
            folder.characters.push(charId);
        }
    }
    await saveFolders();
}


export async function removeCharacterFromFolder(folderOrId, charId) {
    // Accept folder object or ID
    const folderId = typeof folderOrId === 'object' ? folderOrId.id : folderOrId;
    await loadFolders(); // Always reload to get the latest folders
    const folder = folders.find(f => f.id === folderId);
    if (!folder || !Array.isArray(folder.characters)) return;
    folder.characters = folder.characters.filter(id => id !== charId);
    await saveFolders();
}


export async function saveFolders() {
    const json = JSON.stringify(folders, null, 2);
    const base64 = window.btoa(unescape(encodeURIComponent(json)));
    const url = await uploadFileAttachment(FOLDER_FILE_NAME, base64);
    if (url) {
        localStorage.setItem(FOLDER_FILE_KEY, url);
    }
    // Save to local cache
    localStorage.setItem("stcm_folders_cache", json);
}

// Utility to get folder by ID
export function getFolder(id) {
    return folders.find(f => f.id === id);
}

// Add a new folder
export async function addFolder(name, parentId = "root", color = '#8b2ae6') {
    const id = crypto.randomUUID();
    const parent = getFolder(parentId);
    if (!parent || getFolderDepth(parentId) >= 5) throw new Error("Folder depth limit exceeded.");
    parent.children.push(id);
    folders.push({ 
        id, 
        name, 
        icon: 'fa-folder',
        color,
        parentId, 
        children: [], 
        characters: [], 
    });
    await saveFolders();
    return id;
}

export async function setFolderColor(id, color) {
    await loadFolders();
    const folder = folders.find(f => f.id === id);
    if (folder) {
        folder.color = color;
        await saveFolders();   // <- no arg, saves the global "folders"
    }
}


// Move a character to a folder (removes from any previous folder)
export async function moveCharacterToFolder(charId, folderId) {
    // Remove from all folders
    for (const folder of folders) {
        folder.children = folder.children.filter(child => child !== "char:" + charId);
    }
    // Add to new folder
    const folder = getFolder(folderId);
    if (!folder || getFolderDepth(folderId) >= 5) throw new Error("Folder depth limit exceeded.");
    folder.children.push("char:" + charId);
    await saveFolders();
}

// Move a folder to a new parent (careful with cycles/depth)
export async function moveFolder(folderId, newParentId) {
    if (folderId === "root" || newParentId === folderId) throw new Error("Invalid move.");
    // Remove from old parent
    const oldFolder = getFolder(folderId);
    if (!oldFolder) return;
    const oldParent = getFolder(oldFolder.parentId);
    if (oldParent) oldParent.children = oldParent.children.filter(child => child !== folderId);
    // Add to new parent
    const newParent = getFolder(newParentId);
    if (!newParent || getFolderDepth(newParentId) >= 5) throw new Error("Folder depth limit exceeded.");
    newParent.children.push(folderId);
    oldFolder.parentId = newParentId;
    await saveFolders();
}

function getFolderDepth(folderId) {
    let depth = 0;
    let curr = getFolder(folderId);
    while (curr && curr.parentId) {
        curr = getFolder(curr.parentId);
        depth++;
    }
    return depth;
}

export async function renameFolder(id, newName) {
    const folders = await loadFolders();
    const folder = folders.find(f => f.id === id);
    if (folder && newName.trim()) {
        folder.name = newName.trim();
        await saveFolders(folders);
    }
}
export async function setFolderIcon(id, icon) {
    const folders = await loadFolders();
    const folder = folders.find(f => f.id === id);
    if (folder) {
        folder.icon = icon;
        await saveFolders(folders);
    }
}
export async function deleteFolder(id) {
    let folders = await loadFolders();
    // Remove recursively and from parents' children arrays
    function removeRecursive(fid) {
        const idx = folders.findIndex(f => f.id === fid);
        if (idx !== -1) {
            const folder = folders[idx];
            folder.children?.forEach(childId => removeRecursive(childId));
            folders.splice(idx, 1);
        }
    }
    // Remove id from any parent's children
    folders.forEach(f => f.children = f.children?.filter(cid => cid !== id));
    removeRecursive(id);
    await saveFolders(folders);
}

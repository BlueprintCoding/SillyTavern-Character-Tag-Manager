// stcm_folders.js
import { uploadFileAttachment, getFileAttachment } from '../../../chats.js';

const FOLDER_FILE_NAME = "stcm-folders.json";
const FOLDER_FILE_KEY = "stcm_folders_url"; // localStorage key

let folders = []; // In-memory cache

export async function loadFolders() {
    let url = localStorage.getItem(FOLDER_FILE_KEY);
    if (!url) {
        // Initialize default folder structure
        folders = [ { id: "root", name: "Root", icon: 'fa-folder', parentId: null, children: [] } ];
        await saveFolders();
        return folders;
    }
    const json = await getFileAttachment(url);
    folders = JSON.parse(json);
    return folders;
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
export async function addFolder(name, parentId = "root") {
    const id = crypto.randomUUID();
    const parent = getFolder(parentId);
    if (!parent || getFolderDepth(parentId) >= 5) throw new Error("Folder depth limit exceeded.");
    parent.children.push(id);
    folders.push({ id, name, parentId, children: [] });
    await saveFolders();
    return id;
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

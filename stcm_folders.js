// stcm_folders.js
import { uploadFileAttachment, getFileAttachment } from '../../../chats.js';
import {
    tags,
    tag_map,
} from "../../../tags.js";
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from "../../../popup.js";
import { escapeHtml } from "./utils.js";
import { STCM, callSaveandReload, renderCharacterTagData } from "./index.js";
import { renderCharacterList } from "./stcm_characters.js"; 
import { injectSidebarFolders } from "./stcm_folders_ui.js";
import {
    characters
} from "../../../../script.js";


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
            if (!Array.isArray(folders)) throw new Error("Corrupt file");
            folders.forEach(f => {
                if (!f.color) f.color = '#8b2ae6';
                if (typeof f.private !== 'boolean') f.private = false;
            });
            return folders;
        } catch (e) {
            console.warn("Failed to load from file, trying cache:", e);
        }
    }

    // 🔄 Fallback: Try cache
    const cached = localStorage.getItem("stcm_folders_cache");
    if (cached) {
        try {
            folders = JSON.parse(cached);
            return folders;
        } catch (e) {
            console.warn("Failed to load from cache too:", e);
        }
    }

    // 🆕 If everything fails, start fresh
    folders = [ { id: "root", name: "Root", icon: 'fa-folder', color: '#8b2ae6', parentId: null, children: [], characters: [] } ];
    await saveFolders(folders);
    return folders;
}


export async function saveFolders(foldersToSave = folders) {
    const json = JSON.stringify(foldersToSave, null, 2);
    const base64 = window.btoa(unescape(encodeURIComponent(json)));
    const url = await uploadFileAttachment(FOLDER_FILE_NAME, base64);
    if (url) {
        localStorage.setItem(FOLDER_FILE_KEY, url);
    }
    localStorage.setItem("stcm_folders_cache", json);
    folders = foldersToSave; // Update the global cache too
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

export async function setFolderPrivacy(id, isPrivate) {
    await loadFolders();
    const folder = folders.find(f => f.id === id);
    if (folder) {
        folder.private = !!isPrivate;
        await saveFolders(folders); 
    }
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
    await saveFolders(folders); 
}


export async function removeCharacterFromFolder(folderOrId, charId) {
    // Accept folder object or ID
    const folderId = typeof folderOrId === 'object' ? folderOrId.id : folderOrId;
    await loadFolders(); // Always reload to get the latest folders
    const folder = folders.find(f => f.id === folderId);
    if (!folder || !Array.isArray(folder.characters)) return;
    folder.characters = folder.characters.filter(id => id !== charId);
    await saveFolders(folders); 
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
        private: false
    });
    await saveFolders(folders); 
    return id;
}

export async function setFolderColor(id, color) {
    await loadFolders();
    const folder = folders.find(f => f.id === id);
    if (folder) {
        folder.color = color;
        await saveFolders(folders);    // <- no arg, saves the global "folders"
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
    await saveFolders(folders); 
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
    await saveFolders(folders); 
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

export async function convertTagToRealFolder(tag) {
    if (!tag || !tag.name) return;

    const folderName = tag.name.trim();
    const folderColor = tag.color || '#8b2ae6';

    try {
        const folders = await loadFolders();
        const existingFolder = folders.find(f => f.name.trim().toLowerCase() === folderName.toLowerCase());

        if (existingFolder) {
            toastr.warning(`A folder named "${folderName}" already exists. Conversion cancelled.`);
            return;
        }

        const newFolderId = await addFolder(folderName, "root", folderColor);
        const updatedFolders = await loadFolders();
        const newFolder = updatedFolders.find(f => f.id === newFolderId);
        if (!newFolder) throw new Error("Failed to locate new folder");

        const assignedChars = Object.entries(tag_map)
            .filter(([_, tagIds]) => Array.isArray(tagIds) && tagIds.includes(tag.id))
            .map(([charId]) => charId);

        await assignCharactersToFolder(newFolder, assignedChars);

        toastr.success(`Converted "${tag.name}" into real folder with ${assignedChars.length} characters`);

        STCM.sidebarFolders = await loadFolders();
        injectSidebarFolders(STCM.sidebarFolders, characters);

        // 📌 Switch UI to Folders accordion
        const overlay = document.getElementById('characterTagManagerModal');
        if (overlay) {
            overlay.querySelectorAll('.accordionContent').forEach(c => c.classList.remove('open'));
            overlay.querySelectorAll('.accordionToggle').forEach(t => {
                const text = t.textContent.replace(/^.? /, "");
                t.innerHTML = `▶ ${text}`;
            });

            const foldersSection = document.getElementById('foldersSection');
            if (foldersSection) foldersSection.classList.add('open');

            const foldersToggle = overlay.querySelector(`.accordionToggle[data-target="foldersSection"]`);
            if (foldersToggle) {
                foldersToggle.innerHTML = `▼ Folders`;
            }

            await STCM.renderFoldersTree();

        }

        // Prompt to delete tag
        const html = document.createElement('div');
        html.innerHTML = `
            <h3>Delete Original Tag?</h3>
            <p>The tag <strong>${escapeHtml(tag.name)}</strong> was just converted into a real folder.</p>
            <p>Would you like to delete the tag now to avoid redundancy?</p>
        `;
        const choice = await callGenericPopup(html, POPUP_TYPE.CONFIRM, 'Delete Tag?');

        if (choice === POPUP_RESULT.AFFIRMATIVE) {
            for (const [charId, tagList] of Object.entries(tag_map)) {
                if (Array.isArray(tagList)) {
                    tag_map[charId] = tagList.filter(tid => tid !== tag.id);
                }
            }
            const index = tags.findIndex(t => t.id === tag.id);
            if (index !== -1) tags.splice(index, 1);

            toastr.success(`Deleted tag "${tag.name}"`);
            await callSaveandReload();
            renderCharacterList();
            renderCharacterTagData();
        }

    } catch (err) {
        console.error(err);
        toastr.error(`Failed to convert tag: ${err.message || err}`);
    }
}

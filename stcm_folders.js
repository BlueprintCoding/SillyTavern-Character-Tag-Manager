// stcm_folders.js
import { getDataBankAttachments, uploadFileAttachment, uploadFileAttachmentToServer, getFileAttachment } from '../../../chats.js';
import {
    tags,
    tag_map,
} from "../../../tags.js";
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from "../../../popup.js";
import { escapeHtml } from "./utils.js";
import { STCM, callSaveandReload, renderCharacterTagData } from "./index.js";
import { renderCharacterList } from "./stcm_characters.js"; 
import { injectSidebarFolders, updateSidebar  } from "./stcm_folders_ui.js";
import {
    characters
} from "../../../../script.js";
import { getCurrentUserHandle } from '../../../user.js';

const FOLDER_FILE_NAME = "stcm-folders.json";

export async function loadFolders(options = {}) {
    const fileUrl = localStorage.getItem('stcm_folders_url');
    let folders, cacheObj, errorMsg = null;
    let fileLoadFailed = false;

    // Helper for validating the folder array
    function isValidFolderArray(data) {
        return Array.isArray(data) && data.every(f => f && typeof f.id === "string" && typeof f.name === "string");
    }

    // Helper to detect 404/Not Found errors
    function isNotFoundError(err) {
        const str = err?.message || String(err || '');
        return /not[\s-]?found|404/i.test(str);
    }

    // Try server file with up to 2 attempts
    for (let attempt = 1; attempt <= 2; attempt++) {
        if (fileUrl) {
            try {
                const content = await getFileAttachment(fileUrl);
                folders = JSON.parse(content);
                if (!isValidFolderArray(folders)) throw new Error("Corrupt folder data");
                // Fix legacy/partial data
                folders.forEach(f => {
                    if (!f.color) f.color = "#8b2ae6";
                    if (typeof f.private !== "boolean") f.private = false;
                });
                // Save valid server copy to cache (with timestamp)
                const now = new Date();
                const cacheObj = {
                    saved_at: now.toISOString(),
                    folders
                };
                localStorage.setItem('stcm_folders_cache', JSON.stringify(cacheObj));
                return folders;
            } catch (e) {
                fileLoadFailed = true;
                // Log whole error object, never assume it's a string
                console.warn("Error loading folders from file:", e, typeof e, e?.message);
                errorMsg = `Attempt ${attempt}: Failed to load folders from file: ${e?.message || String(e)}`;
                if (attempt === 1) await new Promise(res => setTimeout(res, 500));
            }
        }
    }

    // Try localStorage cache (with timestamp)
    const cached = localStorage.getItem('stcm_folders_cache');
    cacheObj = cached ? parseCache(cached) : null;
    if (cacheObj && isValidFolderArray(cacheObj.folders)) {
        if (fileLoadFailed) {
            const shouldRestore = await promptRestoreFromCache(cacheObj.saved_at, cacheObj.folders);
            if (shouldRestore) {
                await saveFolders(cacheObj.folders);
                return cacheObj.folders;
            }
            // else, fall through to default
        }
        // else: do NOT return the cache, fall through to default
    }
    // Show error to user if all fail (customize to your UI)
    if (errorMsg && !options.silent) {
        if (typeof toastr !== "undefined") {
            toastr.error("Could not load folders: " + errorMsg + "<br>Default folder structure loaded.");
        } else {
            alert("Could not load folders: " + errorMsg + "\nDefault folder structure loaded.");
        }
    }

    // Fallback: create and persist default
    folders = [{
        id: "root",
        name: "Root",
        icon: "fa-folder",
        color: "#8b2ae6",
        parentId: null,
        children: [],
        characters: []
    }];
    await saveFolders(folders);
    return folders;
}

function parseCache(raw) {
    try {
        const obj = JSON.parse(raw);
        if (Array.isArray(obj)) return { folders: obj, saved_at: null };
        if (Array.isArray(obj.folders)) return { folders: obj.folders, saved_at: obj.saved_at };
    } catch {}
    return null;
}




export async function saveFolders(foldersToSave) {
    const json = JSON.stringify(foldersToSave, null, 2);
    const base64 = window.btoa(unescape(encodeURIComponent(json)));

    const fileUrl = await uploadFileAttachment(FOLDER_FILE_NAME, base64);
    if (fileUrl) {
        localStorage.setItem('stcm_folders_url', fileUrl);
        // When saving cache:
        const now = new Date();
        const cacheObj = {
            saved_at: now.toISOString(),
            folders: foldersToSave
        };
        localStorage.setItem('stcm_folders_cache', JSON.stringify(cacheObj));
    }
}

async function promptRestoreFromCache(savedAt, foldersPreview = []) {
    // Format date as YYYY-MM-DD HH:MM
    const date = savedAt
        ? new Date(savedAt).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : 'unknown';
    const username = getCurrentUserHandle();

    // Render preview as a table or a simple tree/list
    let previewHtml = "";
    if (Array.isArray(foldersPreview) && foldersPreview.length) {
        previewHtml = "<ul class='stcm-folder-preview-list'>";
        for (const folder of foldersPreview) {
            previewHtml += `<li>
                <span class="stcm-folder-preview-foldername">${escapeHtml(folder.name)}</span>
                <span class="stcm-folder-preview-id">ID: ${escapeHtml(folder.id)}</span>
                ${folder.characters?.length ? `<span class="stcm-folder-preview-count">${folder.characters.length} chars</span>` : ""}
                ${folder.children && folder.children.length ? `<span class="stcm-folder-preview-sub">${folder.children.length} subfolders</span>` : ""}
            </li>`;
        }
        previewHtml += "</ul>";
    } else {
        previewHtml = `<em>(Cache contains no folders?)</em>`;
    }

    // Build the HTML for the popup
    const html = document.createElement('div');
    html.innerHTML = `
        <h3>Folder File Not Found</h3>
        <p>
            <b>File missing:</b><br>
            <code>\\SillyTavern\\data\\${username}\\user\\files\\stcm-folders.json</code>
        </p>
        <p>
            We have a cached version from <b>${date}</b>.<br>
            <b>Preview of folders to be restored:</b>
            ${previewHtml}
        </p>
        <p>Would you like to restore from that cached version?</p>
    `;

    const result = await callGenericPopup(
        html,
        POPUP_TYPE.CONFIRM,
        'Restore Folders from Cache?'
    );
    return result === POPUP_RESULT.AFFIRMATIVE;
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
    let folders = await loadFolders();
    const folder = folders.find(f => f.id === id);
    if (folder) {
        folder.private = !!isPrivate;
        await saveFolders(folders); 
    }
}

export async function assignCharactersToFolder(folderOrId, charIds) {
    let folders = await loadFolders();
    let id = typeof folderOrId === 'object' ? folderOrId.id : folderOrId;
    const folder = folders.find(f => f.id === id);
    if (!folder) throw new Error('Folder not found');
    if (!Array.isArray(folder.characters)) folder.characters = [];

    // Remove from all folders
    for (const charId of charIds) {
        for (const f of folders) {
            if (f !== folder && Array.isArray(f.characters)) {
                const idx = f.characters.indexOf(charId);
                if (idx !== -1) f.characters.splice(idx, 1);
            }
        }
        if (!folder.characters.includes(charId)) {
            folder.characters.push(charId);
        }
    }
    await saveFolders(folders); 
}

export async function removeCharacterFromFolder(folderOrId, charId) {
    let folders = await loadFolders();
    const folderId = typeof folderOrId === 'object' ? folderOrId.id : folderOrId;
    const folder = folders.find(f => f.id === folderId);
    if (!folder || !Array.isArray(folder.characters)) return;
    folder.characters = folder.characters.filter(id => id !== charId);
    await saveFolders(folders); 
}


// Utility to get folder by ID
export function getFolder(id, folders) {
    return folders.find(f => f.id === id);
}

// Add a new folder
export async function addFolder(name, parentId = "root", color = '#8b2ae6') {
    let folders = await loadFolders();
    const id = crypto.randomUUID();
    const parent = getFolder(parentId, folders);
    if (!parent || getFolderDepth(parentId, folders) >= 5) throw new Error("Folder depth limit exceeded.");
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
    let folders = await loadFolders();
    const folder = folders.find(f => f.id === id);
    if (folder) {
        folder.color = color;
        await saveFolders(folders);
    }
}


// Move a character to a folder (removes from any previous folder)
// export async function moveCharacterToFolder(charId, folderId) {
//     // Remove from all folders
//     for (const folder of folders) {
//         folder.children = folder.children.filter(child => child !== "char:" + charId);
//     }
//     // Add to new folder
//     const folder = getFolder(folderId);
//     if (!folder || getFolderDepth(folderId) >= 5) throw new Error("Folder depth limit exceeded.");
//     folder.children.push("char:" + charId);
//     await saveFolders(folders); 
// }

// Move a folder to a new parent (careful with cycles/depth)
export async function moveFolder(folderId, newParentId) {
    let folders = await loadFolders();
    if (folderId === "root" || newParentId === folderId) throw new Error("Invalid move.");
    const oldFolder = getFolder(folderId, folders);
    if (!oldFolder) return;
    const oldParent = getFolder(oldFolder.parentId, folders);
    if (oldParent) oldParent.children = oldParent.children.filter(child => child !== folderId);
    const newParent = getFolder(newParentId, folders);
    if (!newParent || getFolderDepth(newParentId, folders) >= 5) throw new Error("Folder depth limit exceeded.");
    newParent.children.push(folderId);
    oldFolder.parentId = newParentId;
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
    let folders = await loadFolders();
    const folder = folders.find(f => f.id === id);
    if (folder && newName.trim()) {
        folder.name = newName.trim();
        await saveFolders(folders);
    }
}

export async function setFolderIcon(id, icon) {
    let folders = await loadFolders();
    const folder = folders.find(f => f.id === id);
    if (folder) {
        folder.icon = icon;
        await saveFolders(folders);
    }
}

export async function deleteFolder(id) {
    let folders = await loadFolders();
    function removeRecursive(fid) {
        const idx = folders.findIndex(f => f.id === fid);
        if (idx !== -1) {
            const folder = folders[idx];
            folder.children?.forEach(childId => removeRecursive(childId));
            folders.splice(idx, 1);
        }
    }
    folders.forEach(f => f.children = f.children?.filter(cid => cid !== id));
    removeRecursive(id);
    await saveFolders(folders);
}

export async function convertTagToRealFolder(tag) {
    if (!tag || !tag.name) return;

    const folderName = tag.name.trim();
    const folderColor = tag.color || '#8b2ae6';

    try {
        let folders = await loadFolders();
        const existingFolder = folders.find(f => f.name.trim().toLowerCase() === folderName.toLowerCase());

        if (existingFolder) {
            toastr.warning(`A folder named "${folderName}" already exists. Conversion cancelled.`);
            return;
        }

        const newFolderId = await addFolder(folderName, "root", folderColor);
        folders = await loadFolders();
        const newFolder = getFolder(newFolderId, folders); // always pass folders!
        if (!newFolder) throw new Error("Failed to locate new folder");

        const assignedChars = Object.entries(tag_map)
            .filter(([_, tagIds]) => Array.isArray(tagIds) && tagIds.includes(tag.id))
            .map(([charId]) => charId);

        await assignCharactersToFolder(newFolder, assignedChars);

        toastr.success(`Converted "${tag.name}" into real folder with ${assignedChars.length} characters`);

        await updateSidebar(true);

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
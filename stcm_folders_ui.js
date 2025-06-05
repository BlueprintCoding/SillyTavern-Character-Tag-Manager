// index.js - Folder rework
import { 
    debounce, 
    buildTagMap, 
    } from './utils.js';
    
    import * as stcmFolders from './stcm_folders.js';
    
    import {
        tags,
        tag_map,
    } from "../../../tags.js";
    
    import {
        characters,
    } from "../../../../script.js";
    
    import {
        sidebarFolders 
    } from "./index.js";
    
    import {
        POPUP_RESULT,
        POPUP_TYPE,
        callGenericPopup
    } from "../../../popup.js"
    
let currentSidebarFolderId = 'root';

export function injectSidebarFolders(folders, allCharacters) {
    currentSidebarFolderId = 'root';
    // Inject our sidebar if not present
    let sidebar = document.getElementById('stcm_sidebar_folder_nav');
    const parent = document.getElementById('rm_print_characters_block');
    if (!parent) return;

    if (!sidebar) {
        sidebar = document.createElement('div');
        sidebar.id = 'stcm_sidebar_folder_nav';
        sidebar.className = 'stcm_sidebar_folder_nav';
        // Insert at the top, or wherever you want
        parent.insertBefore(sidebar, parent.firstChild);
    }
    renderSidebarFolderContents(folders, allCharacters, 'root');
}

export function renderSidebarFolderContents(folders, allCharacters, folderId = currentSidebarFolderId) {
    // Only update our sidebar
    const container = document.getElementById('stcm_sidebar_folder_nav');
    if (!container) return;
    container.innerHTML = "";

    // --- Breadcrumb Label ---
    const breadcrumbDiv = document.createElement('div');
    breadcrumbDiv.className = 'stcm_folders_breadcrumb';

    if (folderId === 'root') {
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
    container.appendChild(breadcrumbDiv);

    const folder = folders.find(f => f.id === folderId);
    if (!folder) return;

    // Show "Back" if not root
    if (folderId !== 'root') {
        const parent = folders.find(f => Array.isArray(f.children) && f.children.includes(folderId));
        if (parent) {
            const backBtn = document.createElement('div');
            backBtn.className = "sidebar-folder-back";
            backBtn.innerHTML = `<i class="fa-solid fa-arrow-left"></i> Back`;
            backBtn.style.cursor = 'pointer';
            backBtn.onclick = () => {
                currentSidebarFolderId = parent.id;
                renderSidebarFolderContents(folders, allCharacters, parent.id);
            };
            container.appendChild(backBtn);
        }
    }

    const tagsById = buildTagMap(tags);
    // Show folders (children)
    (folder.children || []).forEach(childId => {
        const child = folders.find(f => f.id === childId);
        if (child) {
            // Count characters and subfolders
            const charCount = child.characters?.length || 0;
            const folderCount = child.children?.length || 0;
    
            const folderDiv = document.createElement('div');
            folderDiv.className = 'stcm_folder_sidebar entity_block flex-container wide100p alignitemsflexstart interactable folder_open';
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
                        <div class="stcm_folder_folder_count">${folderCount} folder${folderCount === 1 ? '' : 's'}</div>
                    </div>
                </div>
            `;

            folderDiv.onclick = () => {
                currentSidebarFolderId = child.id;
                renderSidebarFolderContents(folders, allCharacters, child.id);
            };
            container.appendChild(folderDiv);
        }
    });
    

        // Show characters in this folder (full card style)

        (folder.characters || []).forEach(charId => {
            const char = allCharacters.find(c => c.avatar === charId);
            if (char) {
                const tagsForChar = getTagsForChar(char.avatar, tagsById);
                // Pass tags explicitly to avoid global mutation:
                const charCard = renderSidebarCharacterCard({ ...char, tags: tagsForChar });
                container.appendChild(charCard);
            }
        });

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

export function getTagsForChar(charId) {
    const tagIds = tag_map[charId] || [];
    const tagsById = buildTagMap(tags); // Only build this once per render if you can
    return tagIds.map(id => tagsById.get(id)).filter(Boolean);
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
        await stcmFolders.setFolderColor(folder.id, color); // <--- This should now update and save!
        rerender();
        sidebarFolders = await stcmFolders.loadFolders();
        injectSidebarFolders(sidebarFolders, characters);
    });
}


export function renderSidebarCharacterCard(char) {
    // Build character card using standard classes + a custom sidebar marker
    const div = document.createElement('div');
    div.className = 'character_select entity_block flex-container wide100p alignitemsflexstart interactable stcm_sidebar_character_card';
    div.setAttribute('chid', char.avatar);
    div.setAttribute('data-chid', char.avatar);
    div.tabIndex = 0;

    // Card avatar
    div.innerHTML = `
        <div class="avatar" title="[Character] ${char.name}\nFile: ${char.avatar}">
            <img src="/thumbnail?type=avatar&file=${encodeURIComponent(char.avatar)}" alt="${char.name}">
        </div>
        <div class="flex-container wide100pLess70px character_select_container">
            <div class="wide100p character_name_block">
                <span class="ch_name" title="[Character] ${char.name}">${char.name}</span>
                <small class="ch_additional_info ch_add_placeholder">+++</small>
                <small class="ch_additional_info ch_avatar_url"></small>
            </div>
            <i class="ch_fav_icon fa-solid fa-star" style="display: none;"></i>
            <input class="ch_fav" value="" hidden="" keeper-ignore="">
            <div class="ch_description">${char.creatorcomment ? char.description : ''}</div>
            <div class="tags tags_inline">
                ${(char.tags || []).map(tag =>
                    `<span class="tag" style="background-color: ${tag.color || ''}; color: ${tag.color2 || ''};">
                        <span class="tag_name">${tag.name}</span>
                    </span>`
                ).join('')}
            </div>
        </div>
    `;
    return div;
}


export function watchSidebarFolderInjection() {
    const container = document.getElementById('rm_print_characters_block');
    if (!container) return;
    let lastInjectedAt = 0;

    // Avoid reinjecting too rapidly (debounce for performance)
    const debouncedInject = debounce(async () => {
        sidebarFolders = await stcmFolders.loadFolders();
        injectSidebarFolders(sidebarFolders, characters);
        lastInjectedAt = Date.now();
    }, 120);

    const observer = new MutationObserver(mutations => {
        // Only react if child list changed (character block usually full-rebuilds)
        debouncedInject();
    });

    observer.observe(container, { childList: true, subtree: false });
}

// ========================================================================================================== //
// STCM CUSTOM FOLDERS END
// ========================================================================================================== //

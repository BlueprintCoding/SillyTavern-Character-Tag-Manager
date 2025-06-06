// stcm_folders_ui.js
import { 
    debounce, 
    buildTagMap, 
    escapeHtml
    } from './utils.js';
    
    import * as stcmFolders from './stcm_folders.js';
    
    import {
        tags,
        tag_map,
    } from "../../../tags.js";
    
    import {
        characters,
        selectCharacterById
    } from "../../../../script.js";
    
    import { STCM } from './index.js';
    
    import {
        POPUP_RESULT,
        POPUP_TYPE,
        callGenericPopup
    } from "../../../popup.js"
    
let currentSidebarFolderId = 'root';
let privateFolderVisibilityMode = 0; // 0 = Hidden, 1 = Show All, 2 = Show Only Private


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

function hasAnyCharacters(folderId, folders) {
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return false;
    if (Array.isArray(folder.characters) && folder.characters.length > 0) return true;
    // Recursively check children
    for (const childId of (folder.children || [])) {
        if (hasAnyCharacters(childId, folders)) return true;
    }
    return false;
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

    // === Private Folder Toggle Icon ===
    const controlRow = document.createElement('div');
    controlRow.className = 'stcm_folders_header_controls';
    controlRow.style.display = 'flex';
    controlRow.style.alignItems = 'center';
    controlRow.style.gap = '8px';

    const toggleBtn = document.createElement('i');
    toggleBtn.className = 'fa-solid fa-eye-slash stcm_private_toggle_icon';
    toggleBtn.style.cursor = 'pointer';
    toggleBtn.title = 'Click to show private folders';
    toggleBtn.style.fontSize = '1.1em';
    toggleBtn.style.padding = '4px';
    toggleBtn.style.borderRadius = '6px';

    function updateToggleIcon() {
        toggleBtn.classList.remove('fa-eye', 'fa-eye-slash', 'fa-user-secret');

        if (privateFolderVisibilityMode === 0) {
            toggleBtn.classList.add('fa-eye-slash');
            toggleBtn.title = 'Private folders hidden';
        } else if (privateFolderVisibilityMode === 1) {
            toggleBtn.classList.add('fa-eye');
            toggleBtn.title = 'Showing all folders';
        } else if (privateFolderVisibilityMode === 2) {
            toggleBtn.classList.add('fa-user-secret');
            toggleBtn.title = 'Only showing private folders';
        }
    }

    toggleBtn.addEventListener('click', () => {
        privateFolderVisibilityMode = (privateFolderVisibilityMode + 1) % 3;
        renderSidebarFolderContents(folders, allCharacters, folderId);
    });

    updateToggleIcon();
    controlRow.appendChild(toggleBtn);
    controlRow.appendChild(breadcrumbDiv); // Breadcrumb goes to the right of icon
    container.appendChild(controlRow);


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
        const isPrivate = !!child.private;

        // Count characters and subfolders
        const charCount = child.characters?.length || 0;
        const folderCount = child.children?.length || 0;

        const folderDiv = document.createElement('div');
        folderDiv.className = 'stcm_folder_sidebar entity_block flex-container wide100p alignitemsflexstart interactable folder_open';
        folderDiv.setAttribute('data-folder-id', child.id);

        if (isPrivate) {
            folderDiv.classList.add('stcm_folder_private');
            folderDiv.setAttribute('data-private', 'true');
        }

        // Apply visibility rules for current toggle mode
        if (
            (privateFolderVisibilityMode === 0 && isPrivate) ||      // Hide private
            (privateFolderVisibilityMode === 2 && !isPrivate)        // Only show private
        ) {
            folderDiv.style.display = 'none';
        }

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

        const folderHasAnyChars = hasAnyCharacters(child.id, folders);

        if (folderHasAnyChars) {
            folderDiv.onclick = () => {
                currentSidebarFolderId = child.id;
                renderSidebarFolderContents(folders, allCharacters, child.id);
            };
        } else {
            folderDiv.style.cursor = 'default';
            folderDiv.classList.add('stcm_folder_disabled');
            folderDiv.title = 'Empty folder';
            folderDiv.onclick = null;
        }

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

function hasPrivateDescendant(folderId, folders) {
    const folder = folders.find(f => f.id === folderId);
    if (!folder || !folder.children) return false;

    for (const childId of folder.children) {
        const child = folders.find(f => f.id === childId);
        if (child) {
            if (child.private) return true;
            if (hasPrivateDescendant(child.id, folders)) return true;
        }
    }
    return false;
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
        STCM.sidebarFolders = await stcmFolders.loadFolders();
        injectSidebarFolders(STCM.sidebarFolders, characters);
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
    // Make the entire card clickable for activation:
    div.addEventListener('click', function(e) {
        const id = char.avatar ? characters.findIndex(c => c.avatar === char.avatar) : -1;
        if (id !== -1 && typeof selectCharacterById === 'function') {
            selectCharacterById(id);
            if (typeof setActiveGroup === 'function') setActiveGroup(null);
            if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
        } else {
            toastr.warning('Unable to activate character: not found.');
        }
    });

    return div;
}


export function watchSidebarFolderInjection() {
    const container = document.getElementById('rm_print_characters_block');
    if (!container) return;
    let lastInjectedAt = 0;

    // Avoid reinjecting too rapidly (debounce for performance)
    const debouncedInject = debounce(async () => {
        STCM.sidebarFolders = await stcmFolders.loadFolders();
        injectSidebarFolders(STCM.sidebarFolders, characters);
        lastInjectedAt = Date.now();
    }, 120);

    const observer = new MutationObserver(mutations => {
        // Only react if child list changed (character block usually full-rebuilds)
        debouncedInject();
    });

    observer.observe(container, { childList: true, subtree: false });
}


export function makeFolderNameEditable(span, folder, rerender) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = folder.name;
    input.className = 'stcm-folder-name-input menu_input';
    input.style.width = Math.max(80, span.offsetWidth + 20) + 'px';

    const save = async () => {
        const val = input.value.trim();
        if (val && val !== folder.name) {
            await stcmFolders.renameFolder(folder.id, val);
            rerender();
            STCM.sidebarFolders = await stcmFolders.loadFolders();
            injectSidebarFolders(STCM.sidebarFolders, characters);
        } else {
            rerender();
        }
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') rerender();
    });
    span.replaceWith(input);
    input.focus();
    input.select();
}

export function showIconPicker(folder, parentNode, rerender) {
    const icons = [
        // === Utility/Folders ===
        'fa-folder', 'fa-folder-open', 'fa-archive', 'fa-box', 'fa-boxes-stacked',
        'fa-book', 'fa-book-bookmark', 'fa-book-skull', 'fa-journal-whills', 'fa-address-book',
    
        // === People / Avatars ===
        'fa-users', 'fa-user', 'fa-user-astronaut', 'fa-user-ninja', 'fa-user-gear', 'fa-user-secret', 'fa-user-nurse', 'fa-person', 'fa-person-dress', 
    
        // === Gaming Icons ===
        'fa-dice-six',            // only one dice
        'fa-chess-knight', 'fa-chess-rook', 'fa-chess-queen', 'fa-chess-bishop', 'fa-chess-pawn',
        'fa-chess',               // classic board
        'fa-gamepad',             // generic gamepad
        'fa-dungeon', 'fa-dragon', // fantasy
        'fa-tower-cell', 'fa-tower-observation',

        // === Emoji Icons ===
        'fa-face-smile', 'fa-face-meh', 'fa-face-frown', 'fa-face-laugh', 'fa-face-surprise',
        'fa-face-grin', 'fa-face-grin-stars', 'fa-face-grin-beam', 'fa-face-grin-squint',
        'fa-face-grin-wink', 'fa-face-grin-wide', 'fa-face-grin-tears', 'fa-face-kiss',
        'fa-face-kiss-wink-heart', 'fa-face-dizzy', 'fa-face-tired', 'fa-face-angry',
        'fa-face-sad-cry', 'fa-face-sad-tear', 'fa-face-grin-hearts', 'fa-face-grin-tongue',
        'fa-face-grin-tongue-wink', 'fa-face-grin-tongue-squint', 'fa-face-grin-beam-sweat',
        
        // === Halloween Icons ===
        'fa-ghost', 'fa-hat-wizard', 'fa-skull', 'fa-skull-crossbones', 'fa-spider', 'fa-spaghetti-monster-flying',
        'fa-broom', 'fa-candy-cane', 'fa-bone', 'fa-mask', 'fa-moon', 'fa-star-half-stroke', 'fa-icicles',
    
        // === Animal Icons ===
        'fa-dog', 'fa-cat', 'fa-crow', 'fa-frog', 'fa-dove', 'fa-otter', 'fa-fish', 'fa-horse', 'fa-spider', 'fa-hippo', 'fa-feather', 'fa-feather-pointed', 'fa-paw', 
        'fa-dragon', 'fa-dove', 'fa-cow', 'fa-dove', 'fa-bug', 'fa-worm', 'fa-shrimp',
    
        // === Nature / Elements ===
        'fa-leaf', 'fa-tree', 'fa-mountain', 'fa-fire', 'fa-icicles', 'fa-cloud', 'fa-cloud-sun', 'fa-cloud-moon', 'fa-moon', 'fa-sun', 'fa-gem', 'fa-heart',
    
        // === Fantasy / Magic ===
        'fa-wand-magic', 'fa-wand-magic-sparkles', 'fa-hat-wizard', 'fa-flask', 'fa-flask-vial', 'fa-microscope', 'fa-brain', 'fa-lightbulb',
    
        // === Security ===
        'fa-shield', 'fa-shield-halved', 'fa-lock', 'fa-unlock', 'fa-key',
    
        // === Miscellaneous/Science/Tech ===
        'fa-robot', 'fa-rocket', 'fa-gears', 'fa-screwdriver-wrench', 'fa-anchor', 'fa-compass', 'fa-globe', 'fa-map', 'fa-location-dot',
    
        // === Other fun or thematic ===
        'fa-star', 'fa-bolt', 'fa-broom', 'fa-anchor', 'fa-candy-cane'
    ];
    

    const popup = document.createElement('div');
    popup.className = 'stcm-icon-picker-popup';
    popup.style.position = 'absolute';
    popup.style.background = '#222';
    popup.style.border = '1px solid #444';
    popup.style.borderRadius = '8px';
    popup.style.padding = '16px 12px 10px 12px';
    popup.style.zIndex = 10000;
    popup.style.minWidth = '270px';

    // --- Instructions & custom field ---
    const instr = document.createElement('div');
    instr.innerHTML = `
        <div style="margin-bottom:8px; font-size: 0.97em;">
            <b>Choose an icon below</b> or type your own Font Awesome icon class.
            <br>
            <a href="https://fontawesome.com/search?m=free" target="_blank" style="color:#6ec0ff; text-decoration:underline; font-size: 0.96em;">
                Browse all free icons
            </a>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:7px;">
            <input type="text" id="stcmCustomIconInput" placeholder="e.g. fa-dragon" style="flex:1;min-width:0;padding:4px 8px;border-radius:4px;border:1px solid #444;background:#181818;color:#eee;">
            <button class="stcm_menu_button tiny" id="stcmSetCustomIconBtn" style="padding:3px 8px;">Set</button>
        </div>
        <div id="stcmIconError" style="color:#fa7878;font-size:0.93em;min-height:18px;"></div>
    `;
    popup.appendChild(instr);

    // --- Icon grid ---
    const grid = document.createElement('div');
    grid.className = 'stcm-icon-grid';
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(11, 32px)';
    grid.style.gap = '8px';

    icons.forEach(ico => {
        const btn = document.createElement('button');
        btn.className = 'stcm-icon-btn stcm_menu_button tiny';
        btn.innerHTML = `<i class="fa-solid ${ico} fa-fw"></i>`;
        btn.title = ico.replace('fa-', '').replace(/-/g, ' ');
        btn.style.background = 'none';
        btn.style.border = 'none';
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', async () => {
            await stcmFolders.setFolderIcon(folder.id, ico);
            rerender();
            STCM.sidebarFolders = await stcmFolders.loadFolders();
            injectSidebarFolders(STCM.sidebarFolders, characters);
            popup.remove();
        });
        grid.appendChild(btn);
    });
    popup.appendChild(grid);

    // --- Custom icon logic ---
    const customInput = instr.querySelector('#stcmCustomIconInput');
    const customBtn = instr.querySelector('#stcmSetCustomIconBtn');
    const errorDiv = instr.querySelector('#stcmIconError');

    customBtn.addEventListener('click', async () => {
        let val = customInput.value.trim();
        if (!val) {
            errorDiv.textContent = 'Please enter a Font Awesome icon class.';
            return;
        }
       // Accept "fa-solid fa-bug" or just "fa-bug"
       if (!val.startsWith('fa-')) {
        errorDiv.textContent = 'Must start with "fa-" (e.g. fa-hat-wizard)';
        return;
        }
        // Try to preview/test (optional, just for feedback)
        // You may choose to check if this class exists visually
        await stcmFolders.setFolderIcon(folder.id, val);
        rerender();
        STCM.sidebarFolders = await stcmFolders.loadFolders();
        injectSidebarFolders(STCM.sidebarFolders, characters);
        popup.remove();
    });

    customInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') customBtn.click();
    });

    // --- Close on outside click ---
    function onClose(e) {
        if (!popup.contains(e.target)) popup.remove(), document.removeEventListener('mousedown', onClose, true);
    }
    setTimeout(() => document.addEventListener('mousedown', onClose, true), 10);

    document.body.appendChild(popup);
    const rect = parentNode.getBoundingClientRect();
    popup.style.left = (rect.left + window.scrollX + 60) + "px";
    popup.style.top = (rect.top + window.scrollY) + "px";
}


export function confirmDeleteFolder(folder, rerender) {
    const isEmpty = !folder.children || folder.children.length === 0;
    const html = document.createElement('div');
    html.innerHTML = `
        <h3>Delete Folder?</h3>
        <p>Are you sure you want to delete <strong>${escapeHtml(folder.name)}</strong>?<br>
        ${isEmpty ? '' : '<b>This folder is not empty and contains child folders or characters!</b>'}
        <span style="color:#e57373;">This cannot be undone.</span>
        </p>`;
    callGenericPopup(html, POPUP_TYPE.CONFIRM, 'Delete Folder')
        .then(async result => {
            if (result !== POPUP_RESULT.AFFIRMATIVE) return;
            await stcmFolders.deleteFolder(folder.id);
            // await renderFoldersTree();
            STCM.sidebarFolders = await stcmFolders.loadFolders();
            injectSidebarFolders(STCM.sidebarFolders, characters);

            rerender();
        });
}

function walkFolderTree(folderId, folders, opts = {}, depth = 0) {
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return opts.collector || [];

    // 1. For descendant IDs
    if (opts.mode === 'descendants') {
        let ids = [];
        for (const childId of folder.children || []) {
            ids.push(childId);
            ids = ids.concat(walkFolderTree(childId, folders, opts, depth + 1));
        }
        return ids;
    }
    // 2. For max depth
    if (opts.mode === 'maxDepth') {
        let maxDepth = depth + 1;
        for (const childId of folder.children || []) {
            const childDepth = walkFolderTree(childId, folders, opts, depth + 1);
            if (childDepth > maxDepth) maxDepth = childDepth;
        }
        return maxDepth;
    }
    // 3. For options tree
    if (opts.mode === 'options') {
        let options = [];
        if (!opts.excludeIds || !opts.excludeIds.includes(folderId)) {
            const indent = "&nbsp;".repeat(depth * 4);
            options.push({
                id: folder.id,
                name: (folder.id === "root" ? "Top Level (Root)" : indent + escapeHtml(folder.name)),
                depth: depth,
            });
        }
        for (const childId of folder.children || []) {
            options = options.concat(
                walkFolderTree(childId, folders, opts, depth + 1)
            );
        }
        return options;
    }
    return [];
}

// Then, replace:
function getAllDescendantFolderIds(folderId, folders) {
    return walkFolderTree(folderId, folders, { mode: 'descendants' }, 0);
}
function getMaxFolderSubtreeDepth(folderId, folders) {
    return walkFolderTree(folderId, folders, { mode: 'maxDepth' }, 0);
}
function getFolderOptionsTree(folders, excludeIds = [], parentId = "root", depth = 0) {
    return walkFolderTree(parentId, folders, { mode: 'options', excludeIds }, depth);
}


export function showChangeParentPopup(folder, allFolders, rerender) {
    const currentId = folder.id;

    // 1. Exclude descendants (and self)
    const descendants = getAllDescendantFolderIds(currentId, allFolders);
    descendants.push(currentId);

    // 2. Compute how deep this folder's tree is
    const subtreeDepth = getMaxFolderSubtreeDepth(currentId, allFolders); // e.g., 3

    // 3. Only allow destination if it will not violate max depth
    const MAX_DEPTH = 5; // whatever your limit is

    function getFolderDepth(folderId) {
        let depth = 0;
        let curr = allFolders.find(f => f.id === folderId);
        while (curr && curr.parentId) {
            curr = allFolders.find(f => f.id === curr.parentId);
            depth++;
        }
        return depth;
    }

    const validFolders = allFolders.filter(f => {
        if (descendants.includes(f.id)) return false; // can't move into self or descendants
        const destDepth = getFolderDepth(f.id);
        // If destination is "root", depth = 0, so max possible new depth = subtreeDepth-1
        // So destDepth + subtreeDepth - 1 < MAX_DEPTH
        return (destDepth + subtreeDepth - 1) < MAX_DEPTH;
    });

        // Build hierarchical option list
    const optionsTree = getFolderOptionsTree(allFolders, descendants);

    // Now, only include those in validFolders
    const validOptionIds = new Set(validFolders.map(f => f.id));
    const validOptions = optionsTree.filter(opt => validOptionIds.has(opt.id));

    const container = document.createElement('div');
    container.innerHTML = `
        <label><b>Choose New Parent Folder</b></label><br>
        <select style="width:100%;margin:12px 0;" id="stcmMoveFolderSelect">
        ${validOptions.map(f =>
            `<option value="${f.id}" ${f.id === folder.parentId ? 'selected' : ''}>${f.name}</option>`
        ).join('')}
        </select>
        <div style="font-size:0.93em;color:#fa7878;" id="stcmMoveFolderError"></div>
    `;

    callGenericPopup(container, POPUP_TYPE.CONFIRM, 'Move Folder', {
        okButton: 'Move Folder',
        cancelButton: 'Cancel'
    }).then(async result => {
        if (result !== POPUP_RESULT.AFFIRMATIVE) return;
        const select = container.querySelector('#stcmMoveFolderSelect');
        const newParentId = select.value;
        if (newParentId === folder.parentId) return; // No change
        try {
            await stcmFolders.moveFolder(folder.id, newParentId);
            rerender();
            STCM.sidebarFolders = await stcmFolders.loadFolders();
            injectSidebarFolders(STCM.sidebarFolders, characters);
        } catch (e) {
            const errDiv = container.querySelector('#stcmMoveFolderError');
            errDiv.textContent = e.message || "Failed to move folder.";
        }
    });
}



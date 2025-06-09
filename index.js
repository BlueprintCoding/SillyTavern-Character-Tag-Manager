// index.js - End of Major Folder rework
import { 
debounce, 
flushExtSettings, 
isNullColor, 
escapeHtml, 
resetModalScrollPositions, 
makeModalDraggable, 
saveModalPosSize,
clampModalSize,
getNotes, 
saveNotes, 
cleanTagMap,
promptInput,
} from './utils.js';

import * as stcmFolders from './stcm_folders.js';

import {
    watchSidebarFolderInjection,
    injectSidebarFolders,
    hookFolderSidebarEvents
} from './stcm_folders_ui.js';

import { renderFoldersTree, attachFolderSectionListeners } from './stcm_folders_tree.js';

import {
    tags,
    tag_map,
} from "../../../tags.js";

import {
    renderTagSection,
    attachTagSectionListeners,
    populateAssignTagSelect,
    selectedTagIds
  } from './stcm_tags_ui.js';

import {
    characters,
    getCharacters,
    printCharactersDebounced,
    saveSettingsDebounced
} from "../../../../script.js";

import { groups, getGroupAvatar } from '../../../../scripts/group-chats.js';

import {
    POPUP_RESULT,
    POPUP_TYPE,
    callGenericPopup
} from "../../../popup.js"

import {
    renderCharacterList,
    stcmCharState 
} from "./stcm_characters.js";

import { injectStcmSettingsPanel, updateDefaultTagManagerVisibility, updateRecentChatsVisibility } from './settings-drawer.js';


const { eventSource, event_types } = SillyTavern.getContext();

function openCharacterTagManagerModal() {
    if (document.getElementById('characterTagManagerModal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'characterTagManagerModal';
    overlay.className = 'modalOverlay';
    overlay.innerHTML = `
    <div class="modalContent stcm_modal_main">
        <div class="modalHeader stcm_modal_header">
            <h2>Character / Tag Manager</h2>
            <button id="closeCharacterTagManagerModal" class="stcm_menu_button interactable">
                <i class="fa-solid fa-times"></i>
            </button>
        </div>
        <div class="stcm_accordians">
        <div class="accordionSection stcm_accordion_section">
            <button class="accordionToggle stcm_text_left" data-target="tagsSection">▶ Tags</button>
            <div id="tagsSection" class="accordionContent">
                <div class="stcm_sort_row" style="margin-top: 1em;">
                    <span id="stcm_sort_span">SORT</span>
                    <select id="tagSortMode" class="stcm_menu_button interactable">
                        <option value="alpha_asc">A → Z</option>
                        <option value="alpha_desc">Z → A</option>
                        <option value="count_desc">Most Characters</option>
                        <option value="count_asc">Fewest Characters</option>
                        <option value="only_zero">Tags with 0 Characters</option>
                        <option value="no_folder">No Folder Tags</option>
                        <option value="open_folder">Open Folder Tags</option>
                        <option value="closed_folder">Closed Folder Tags</option>
                    </select>
                                        <input type="text" id="tagSearchInput" class="menu_input stcm_fullwidth_input " placeholder="Search tags..." />                   
                </div>
                <div style="margin-top: -5px;">
                                    <span class="smallInstructions">Search by tag, or add "C:" before your search to search by character name. Use , (comma) to seperate OR lists.</span>
                </div>
                <div class="stcm_align-right stcm_tag_button_holder">
                                <button id="createNewTagBtn" class="stcm_menu_button stcm_margin_left interactable" tabindex="0">
                    <i class="fa-solid fa-plus"></i> Create Tag
                </button>
                <button id="startMergeTags" class="stcm_menu_button stcm_margin_left interactable" tabindex="0">
                    <i class="fa-solid fa-object-group"></i>Merge Tags
                </button>
                <button id="cancelMergeTags" class="stcm_menu_button stcm_margin_left interactable" style="display: none;" tabindex="0">Cancel Merge</button>
                <button id="startBulkDeleteTags" class="stcm_menu_button stcm_margin_left interactable" tabindex="0">
                    <i class="fa-solid fa-trash"></i>Bulk Delete
                </button>
                <button id="cancelBulkDeleteTags" class="stcm_menu_button stcm_margin_left interactable" style="display: none;" tabindex="0">Cancel Delete</button>
                <button id="confirmBulkDeleteTags" class="stcm_menu_button stcm_margin_left interactable red" style="display: none;" tabindex="0">
                    <i class="fa-solid fa-trash"></i>Delete Selected
                </button>


                <div class="stcm_import_export_dropdown stcm_margin_left" style="display: inline-block; position: relative;">
                    <button id="toggleImportExport" class="stcm_menu_button interactable" tabindex="0">
                        <i class="fa-solid fa-arrows-spin"></i> Import/Export
                        <i class="fa-solid fa-caret-down"></i>
                    </button>
                    <div id="importExportMenu" class="stcm_dropdown_menu" style="display:none; position: absolute; right:0; top:110%; background: var(--ac-style-color-background, #222); border: 1px solid #444; border-radius: 6px; z-index: 1001; box-shadow: 0 2px 8px rgba(0,0,0,0.12); min-width: 180px; padding: 0.5em;">
                        <button id="backupTagsBtn" class="stcm_menu_button dropdown interactable" tabindex="0">
                            <i class="fa-solid fa-file-export"></i> Backup Tags
                        </button>
                        <button id="restoreTagsBtn" class="stcm_menu_button dropdown interactable" tabindex="0">
                            <i class="fa-solid fa-file-import"></i> Restore Tags
                        </button>
                        <input id="restoreTagsInput" type="file" accept=".json" hidden>
                        <hr style="margin: 0.4em 0; border: none; border-top: 1px solid #444;">
                        <button id="exportNotesBtn" class="stcm_menu_button dropdown interactable" tabindex="0">
                            <i class="fa-solid fa-file-arrow-down"></i> Export Notes
                        </button>
                        <button id="importNotesBtn" class="stcm_menu_button dropdown interactable" tabindex="0">
                            <i class="fa-solid fa-file-arrow-up"></i> Import Notes
                        </button>
                        <input id="importNotesInput" type="file" accept=".json" hidden>
                    </div>
                </div>
            </div>

                <div class="modalBody stcm_scroll_300" id="characterTagManagerContent">
                    <div>Loading tags...</div>
                </div>
            </div>
        </div>

        <div class="accordionSection stcm_accordion_section stcm_folders_section">
            <button class="accordionToggle stcm_text_left" data-target="foldersSection">▶ Folders</button>
            <div id="foldersSection" class="accordionContent">
                <div style="padding: 1em 0;">
                    <button id="createNewFolderBtn" class="stcm_menu_button interactable" tabindex="0">
                        <i class="fa-solid fa-folder-plus"></i> New Folder
                    </button>
                </div>
                <div id="foldersTreeContainer"><div class="loading">Loading folders...</div></div>
                <div id="folderCharactersSection" style="display:none;"></div>

            </div>
        </div>

    
        <div class="accordionSection stcm_accordion_section stcm_tags_section">
            <button class="accordionToggle stcm_text_left" data-target="charactersSection">▶ Characters</button>
            <div id="charactersSection" class="accordionContent">
                <div style="padding-top: 1em;">
                            <div class="stcm_sort_row">
                            <div id="assignTagList" class="stcm_tag_chip_list"></div>
                            </div>
                                        <div class="stcm_sort_row">
                        <label style="text-wrap: nowrap;">Select Tag(s) to Assign</label>
                            <input type="text" id="assignTagSearchInput" class="menu_input stcm_fullwidth_input stcm_margin_bottom-sm" placeholder="Filter tags..." />
                                                                     <button id="assignTagsButton" class="stcm_menu_button interactable green">Assign Tag(s)</button>

                            </div>
                    <div id="assignTagsBar" class="stcm_assign_bar">
                   <div id="selectedTagsDisplay" class="selected-tags-container"></div>
                    </div>
  <div class="stcm_sort_row stcm_margin_top">
                             <div class="stcm_fullwidth">
                           <div class="stcm_flex">
                        <span>SORT</span>
                        <select id="charSortMode" class="stcm_menu_button interactable">
                            <option value="alpha_asc">A → Z</option>
                            <option value="alpha_desc">Z → A</option>
                            <option value="tag_count_desc">Most Tags</option>
                            <option value="tag_count_asc">Fewest Tags</option>
                            <option value="only_zero">Only 0 Tags</option>
                            <option value="with_notes">With Notes</option>
                            <option value="without_notes">Without Notes</option>
                        </select>
                            <input type="text" id="charSearchInput" class="menu_input stcm_fullwidth_input " placeholder="Search characters/groups..." />
                            <button id="startBulkDeleteChars" class="stcm_menu_button stcm_margin_left interactable bulkDelChar" tabindex="0">
                                <i class="fa-solid fa-trash"></i> Bulk Delete
                            </button>
                            <button id="cancelBulkDeleteChars" class="stcm_menu_button stcm_margin_left interactable bulkDelChar" style="display: none;" tabindex="0">
                                Cancel Delete
                            </button>
                            <button id="confirmBulkDeleteChars" class="stcm_menu_button stcm_margin_left interactable bulkDelChar red" style="display: none;" tabindex="0">
                                <i class="fa-solid fa-trash"></i> Delete Selected
                            </button>
                            </div>
                            <span class="smallInstructions" style="display: block; margin-top:2px;">Search by character name, or use "A:" to search all character fields or "T:" to search characters with that tag. Use , (comma) to seperate OR lists, use - (minus) for negative terms (- comes before modifiers like -T:Comedy)</span>
                                </div>

                    </div>
                    <div id="characterListWrapper"></div>
                </div>
                </div>
            </div>
        </div>
    </div>
    `;


    document.body.appendChild(overlay);
    resetModalScrollPositions();
    attachTagSectionListeners(overlay); 
    attachFolderSectionListeners(overlay);

    // Folders: add create handler and render initial tree
const foldersTreeContainer = document.getElementById('foldersTreeContainer');

/** redraw the tree and keep sidebar in-sync */
async function refreshFoldersTree() {
    await renderFoldersTree(foldersTreeContainer, { onTreeChanged: refreshFoldersTree });
    STCM.sidebarFolders = await stcmFolders.loadFolders();
    injectSidebarFolders(STCM.sidebarFolders, characters);
}
refreshFoldersTree();


// END CUSTOM FOLDERS

    function escToCloseHandler(e) {
        if (e.key === "Escape") {
            const modalContentEsc = overlay.querySelector('.modalContent');
            saveModalPosSize(modalContentEsc);
            overlay.remove();
            document.removeEventListener('keydown', escToCloseHandler);
        }
    }
    document.addEventListener('keydown', escToCloseHandler);

    // Accordion toggle behavior
        // 1. Map each section to its render function
        const accordionRenderers = {
            tagsSection: renderTagSection,
            foldersSection: refreshFoldersTree,
            charactersSection: renderCharacterList
        };

        // 2. Add event listeners to all toggles (after you add the modal to DOM)
        overlay.querySelectorAll('.accordionToggle').forEach(button => {
            button.addEventListener('click', () => {
                const targetId = button.dataset.target;
                const section = document.getElementById(targetId);
                cleanTagMap(tag_map, characters, groups);

                // -- Close all other sections and reset toggles --
                overlay.querySelectorAll('.accordionContent').forEach(content => {
                    if (content !== section) {
                        content.classList.remove('open');
                        // Find its toggle and set to closed arrow
                        const otherToggle = overlay.querySelector(`.accordionToggle[data-target="${content.id}"]`);
                        if (otherToggle) {
                            // Remove the leading arrow and add closed
                            otherToggle.innerHTML = `▶ ${otherToggle.textContent.replace(/^.? /, "")}`;
                        }
                    }
                });

                // -- Toggle open/close this section --
                const isNowOpen = section.classList.toggle('open');
                button.innerHTML = `${isNowOpen ? '▼' : '▶'} ${button.textContent.replace(/^.? /, "")}`;

                if (isNowOpen && accordionRenderers[targetId]) {
                    // --- Always clear content before re-rendering ---

                    // Now render fresh from latest data
                    accordionRenderers[targetId]();

                        // [PATCH] Force-refresh assignTagSearchInput and tag chips for Characters section
                        if (targetId === 'charactersSection') {
                            const assignTagSearchInput = document.getElementById('assignTagSearchInput');
                            if (assignTagSearchInput) {
                                assignTagSearchInput.value = '';
                                // Trigger input event so the tag chips refresh
                                assignTagSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
                            }
                        }
                }
            });
        });


    document.getElementById('closeCharacterTagManagerModal').addEventListener('click', () => {
        const modalContentEsc = overlay.querySelector('.modalContent');
        saveModalPosSize(modalContentEsc);
        resetModalScrollPositions();
        overlay.remove();
        document.removeEventListener('keydown', escToCloseHandler);

    });


    document.getElementById('charSortMode').addEventListener('change', renderCharacterList);


    document.getElementById('charSearchInput').addEventListener(
        'input',
        debounce(() => renderCharacterList())
    );

     // Dropdown toggle for Import/Export
     const toggleIE = document.getElementById('toggleImportExport');
     const ieMenu = document.getElementById('importExportMenu');
 
     toggleIE.addEventListener('click', (e) => {
         e.stopPropagation();
         ieMenu.style.display = ieMenu.style.display === 'none' ? 'block' : 'none';
         // Optional: close on outside click
         if (ieMenu.style.display === 'block') {
             document.addEventListener('mousedown', closeIeMenu, { once: true });
         }
     });
 
     function closeIeMenu(ev) {
         if (!ieMenu.contains(ev.target) && ev.target !== toggleIE) {
             ieMenu.style.display = 'none';
         }
     }
 
     
    document.getElementById('exportNotesBtn').addEventListener('click', exportTagCharacterNotes);

    document.getElementById('importNotesBtn').addEventListener('click', () => {
        document.getElementById('importNotesInput').click();
    });

    document.getElementById('importNotesInput').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const content = await file.text();
        try {
            const importData = JSON.parse(content);
            handleNotesImport(importData);
        } catch {
            toastr.error('Invalid notes backup file');
        }
        e.target.value = ''; // reset input
    });

    document.getElementById('backupTagsBtn').addEventListener('click', () => {
        const json = JSON.stringify({ tags, tag_map }, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tags_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    document.getElementById('restoreTagsBtn').addEventListener('click', () => {
        document.getElementById('restoreTagsInput').click();
    });

    document.getElementById('restoreTagsInput').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const content = await file.text();
        try {
            const data = JSON.parse(content);
            if (!Array.isArray(data.tags) || typeof data.tag_map !== 'object') throw new Error();
            tags.length = 0;
            data.tags.forEach(tag => {
                // Normalize invalid or empty colors
                if (isNullColor(tag.color)) tag.color = '';
                if (isNullColor(tag.color2)) tag.color2 = '';
                if (typeof tag.folder_type !== 'string') tag.folder_type = 'NONE';

                tags.push(tag);
            });

            Object.assign(tag_map, data.tag_map);
            toastr.success('Tags restored from file');
            callSaveandReload();
            renderTagSection();
            renderCharacterList();
            
        } catch {
            toastr.error('Invalid tag backup file');
        }
        e.target.value = ''; // reset input
    });

    document.getElementById('assignTagsButton').addEventListener('click', () => {
        const selectedCharIds = Array.from(stcmCharState.selectedCharacterIds);
        if (!selectedTagIds.size || !selectedCharIds.length) {
            toastr.warning('Please select at least one tag and one character.', 'Assign Tags');
            return;
        }

        selectedCharIds.forEach(charId => {
            if (!tag_map[charId]) tag_map[charId] = [];
            selectedTagIds.forEach(tagId => {
                if (!tag_map[charId].includes(tagId)) {
                    tag_map[charId].push(tagId);
                }
            });
        });
        callSaveandReload();
        toastr.success(`Assigned ${selectedTagIds.size} tag(s) to ${selectedCharIds.length} character(s).`, 'Assign Tags');

        // Clear all selections/inputs
        selectedTagIds.clear();
        stcmCharState.selectedCharacterIds.clear();
        const charSearchInput = document.getElementById('charSearchInput');
        if (charSearchInput) charSearchInput.value = "";
        const tagSearchInput = document.getElementById('assignTagSearchInput');
        if (tagSearchInput) tagSearchInput.value = "";

        populateAssignTagSelect();
        renderCharacterList();
        renderCharacterTagData();
    });

    document.getElementById('startBulkDeleteChars').addEventListener('click', () => {
        stcmCharState.isBulkDeleteCharMode = true;
        stcmCharState.selectedCharacterIds.clear();
        document.getElementById('startBulkDeleteChars').style.display = 'none';
        document.getElementById('cancelBulkDeleteChars').style.display = '';
        document.getElementById('confirmBulkDeleteChars').style.display = '';
        renderCharacterList();
    });
    
    document.getElementById('cancelBulkDeleteChars').addEventListener('click', () => {
        stcmCharState.isBulkDeleteCharMode = false;
        stcmCharState.selectedCharacterIds.clear();
        document.getElementById('startBulkDeleteChars').style.display = '';
        document.getElementById('cancelBulkDeleteChars').style.display = 'none';
        document.getElementById('confirmBulkDeleteChars').style.display = 'none';
        renderCharacterList();
    });
    
    document.getElementById('confirmBulkDeleteChars').addEventListener('click', async () => {
        if (!stcmCharState.selectedCharacterIds.size) {
            toastr.warning("No characters/groups selected.", "Bulk Delete");
            return;
        }
        // List names for confirmation
        const allEntities = [
            ...characters.map(c => ({ id: c.avatar, name: c.name, type: "character", avatar: c.avatar })),
            ...groups.map(g => ({ id: g.id, name: g.name, type: "group", avatar: g.avatar }))
        ];
        const names = allEntities.filter(e => stcmCharState.selectedCharacterIds.has(e.id)).map(e => e.name);
    
        const html = document.createElement('div');
        html.innerHTML = `
            <h3>Confirm Bulk Delete</h3>
            <p>The following will be permanently deleted:</p>
            <pre class="stcm_popup_pre">${names.map(n => `• ${n}`).join('\n')}</pre>
            <p style="color: #e57373;">This cannot be undone.</p>
        `;
        const proceed = await callGenericPopup(html, POPUP_TYPE.CONFIRM, 'Bulk Delete Characters');
        if (proceed !== POPUP_RESULT.AFFIRMATIVE) {
            toastr.info('Bulk character delete cancelled.');
            return;
        }
    
        // Actually delete (asynchronously) via API
        for (const id of stcmCharState.selectedCharacterIds) {
            // Find out if this is a character or a group
            const entity = characters.find(c => c.avatar === id) 
                || groups.find(g => g.id === id);
        
            if (!entity) continue;
        
            if (entity.avatar) {
                // Character: delete via API
                try {
                    const csrf = await fetch('/csrf-token');
                    const { token } = await csrf.json();
                    const result = await fetch('/api/characters/delete', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRF-Token': token
                        },
                        body: JSON.stringify({
                            avatar_url: entity.avatar,
                            delete_chats: true
                        })
                    });
        
                    if (!result.ok) {
                        toastr.error(`Failed to delete character "${entity.name}".`, 'Delete Error');
                        continue;
                    }
                } catch (err) {
                    toastr.error(`Failed to delete character "${entity.name}".`, 'Delete Error');
                    continue;
                }
                // Remove from arrays
                const idx = characters.findIndex(c => c.avatar === id);
                if (idx !== -1) {
                    const char = characters.splice(idx, 1)[0];
                    delete tag_map[char.avatar];
                    SillyTavern.getContext().eventSource.emit(SillyTavern.getContext().event_types.CHARACTER_DELETED, char);
                }
            } else if (entity.id) {
                // Group: delete via API
                try {
                    const csrf = await fetch('/csrf-token');
                    const { token } = await csrf.json();
                    const result = await fetch('/api/groups/delete', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRF-Token': token
                        },
                        body: JSON.stringify({
                            id: entity.id
                        })
                    });
        
                    if (!result.ok) {
                        toastr.error(`Failed to delete group "${entity.name}".`, 'Delete Error');
                        continue;
                    }
                } catch (err) {
                    toastr.error(`Failed to delete group "${entity.name}".`, 'Delete Error');
                    continue;
                }
                // Remove from arrays
                const gIdx = groups.findIndex(g => g.id === id);
                if (gIdx !== -1) {
                    groups.splice(gIdx, 1);
                }
                if (tag_map[id]) delete tag_map[id];
                const notes = getNotes();
                if (notes.charNotes && notes.charNotes[id]) delete notes.charNotes[id];
                saveNotes(notes);
                // Fire SillyTavern event for group deletion if needed
                SillyTavern.getContext().eventSource.emit(SillyTavern.getContext().event_types.GROUP_CHAT_DELETED, id);
            }
        }
        
        toastr.success(`Deleted ${stcmCharState.selectedCharacterIds.size} character(s)/group(s).`);
        stcmCharState.isBulkDeleteCharMode = false;
        stcmCharState.selectedCharacterIds.clear();
        document.getElementById('startBulkDeleteChars').style.display = '';
        document.getElementById('cancelBulkDeleteChars').style.display = 'none';
        document.getElementById('confirmBulkDeleteChars').style.display = 'none';
        await callSaveandReload();
        renderTagSection();
        const input = document.getElementById('charSearchInput');
        if (input) input.value = '';
        renderCharacterList();
        
    });
    
    
    
    renderTagSection();
    populateAssignTagSelect();
    const input = document.getElementById('charSearchInput');
    if (input) input.value = '';
    renderCharacterList();
// MODAL Sizing, positioning, scroll, draggable  
    resetModalScrollPositions();

    const modalContent = overlay.querySelector('.modalContent');
    const STORAGE_KEY = 'stcm_modal_pos_size';
    const saved = sessionStorage.getItem(STORAGE_KEY);

    // Reasonable defaults
    const DEFAULT_WIDTH = 80;  // 80vw
    const DEFAULT_HEIGHT = 95; // 95vh
    const MIN_WIDTH = 350; //px

    if (saved) {
        try {
            let { left, top, width, height } = JSON.parse(saved);
    
            width = Number(width);
            height = Number(height);
    
            // If the saved width/height is a pixel value (as before), use px.
            // Fallback to vw/vh if not available
            Object.assign(modalContent.style, {
                position: 'fixed',
                left: `${Math.max(0, Math.min(Number(left) || 0, window.innerWidth - width))}px`,
                top: `${Math.max(0, Math.min(Number(top) || 0, window.innerHeight - 50))}px`,
                width: width ? `${width}px` : `${DEFAULT_WIDTH}vw`,
                height: height ? `${height}px` : `${DEFAULT_HEIGHT}vh`,
                minWidth: `${MIN_WIDTH}px`,
                transform: '', // Remove centering transform
                maxWidth: "95vw",
                maxHeight: "95vh",
            });
        } catch {
            Object.assign(modalContent.style, {
                position: 'fixed',
                left: '50%',
                top: '50%',
                minWidth: `${MIN_WIDTH}px`,
                width: `${DEFAULT_WIDTH}vw`,
                height: `${DEFAULT_HEIGHT}vh`,
                transform: 'translate(-50%, -50%)',
                maxWidth: "95vw",
                maxHeight: "95vh",
            });
        }
    } else {
        Object.assign(modalContent.style, {
            position: 'fixed',
            left: '50%',
            top: '50%',
            minWidth: `${MIN_WIDTH}px`,
            width: `${DEFAULT_WIDTH}vw`,
            height: `${DEFAULT_HEIGHT}vh`,
            transform: 'translate(-50%, -50%)',
            maxWidth: "95vw",
            maxHeight: "95vh"
        });
    }

    // ---- Save size/position after user resizes/drags

    let hasInteracted = false;

    const handle = modalContent.querySelector('.stcm_modal_header');
    if (handle) {
        // Only save after real drag
        makeModalDraggable(modalContent, handle, () => {
            hasInteracted = true;
            saveModalPosSize(modalContent);
        });

    }

    if ('ResizeObserver' in window) {
        let initialized = false;
        let resizeEndTimer = null;
        
    // inside onResizeEnd()
    const onResizeEnd = () => {
        clampModalSize(modalContent);
        const rect = modalContent.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 100) {
            saveModalPosSize(modalContent);
        }
    };
    

    // inside the window resize listener
    window.addEventListener('resize', () => {
        modalContent.style.maxWidth  = `${window.innerWidth - 40}px`;
        modalContent.style.maxHeight = `${window.innerHeight - 40}px`;
        clampModalSize(modalContent);          // <— and here
    });

    
        // Set these at open, too!
        modalContent.style.maxWidth = (window.innerWidth - 40) + "px";
        modalContent.style.maxHeight = (window.innerHeight - 40) + "px";
    
        const observer = new ResizeObserver(() => {
            if (!initialized) {
                initialized = true; // Skip first fire (initial paint)
                return;
            }
            // Debounce: wait for user to finish resizing
            clearTimeout(resizeEndTimer);
            resizeEndTimer = setTimeout(onResizeEnd, 350); // 350ms after last event
        });
        observer.observe(modalContent);
    }
    
    
    // END MODAL Sizing, positioning, scroll, draggable

}

async function callSaveandReload() {
    cleanTagMap(tag_map, characters, groups);
    saveSettingsDebounced();
    await getCharacters();
    await printCharactersDebounced();
}


function addCharacterTagManagerIcon() {
    // Prevent double-insertion
    if (document.getElementById('characterTagManagerButton')) return;

    // The main bar
    const topSettings = document.getElementById('top-settings-holder');
    const rightNavHolder = document.getElementById('rightNavHolder');
    if (!topSettings || !rightNavHolder) return;

    // Build structure
    const button = document.createElement('div');
    button.id = 'characterTagManagerButton';
    button.className = 'drawer';

    const toggle = document.createElement('div');
    toggle.className = 'drawer-toggle';

    const icon = document.createElement('div');
    icon.className = 'drawer-icon fa-solid fa-tags fa-fw closedIcon interactable';
    icon.title = 'Character / Tag Manager';
    icon.setAttribute('tabindex', '0');
    icon.addEventListener('click', openCharacterTagManagerModal);

    toggle.appendChild(icon);
    button.appendChild(toggle);

    // Insert before rightNavHolder in the top nav bar
    topSettings.insertBefore(button, rightNavHolder);
}


function injectTagManagerControlButton() {
    const container = document.querySelector('#rm_characters_block .rm_tag_controls');
    if (!container || document.getElementById('characterTagManagerControlButton')) return;

    const showTagListBtn = container.querySelector('.showTagList');
    if (!showTagListBtn) return;

    const tagManagerBtn = document.createElement('span');
    tagManagerBtn.id = 'characterTagManagerControlButton';
    tagManagerBtn.className = 'tag actionable clickable-action interactable';
    tagManagerBtn.style.backgroundColor = 'rgba(120, 160, 80, 0.5)';
    tagManagerBtn.setAttribute('tabindex', '0');
    tagManagerBtn.setAttribute('data-toggle-state', 'UNDEFINED');

    tagManagerBtn.innerHTML = `
        <span class="tag_name fa-solid fa-sitemap" title="Character / Tag Manager"></span>
        <i class="fa-solid fa-circle-xmark tag_remove interactable" tabindex="0" style="display: none;"></i>
    `;

    tagManagerBtn.addEventListener('click', async () => {
        openCharacterTagManagerModal(); // Then opens the modal
    });


    showTagListBtn.insertAdjacentElement('afterend', tagManagerBtn);
}

function injectTagManagerButtonInTagView(container) {
    const backupBtn = container.querySelector('.tag_view_backup');
    if (!backupBtn) return;

    const tagManagerBtn = document.createElement('div');
    tagManagerBtn.id = 'characterTagManagerBackupAreaButton';
    tagManagerBtn.className = 'menu_button menu_button_icon interactable';
    tagManagerBtn.title = 'Open Character / Tag Manager';
    tagManagerBtn.setAttribute('data-i18n', '[title]Open Character / Tag Manager');
    tagManagerBtn.setAttribute('tabindex', '0');

    tagManagerBtn.innerHTML = `
        <i class="fa-solid fa-tags"></i>
        <span>Manage</span>
    `;

    tagManagerBtn.addEventListener('click', () => {
        const okBtn = document.querySelector('dialog.popup[open] .popup-button-ok');
        if (okBtn) {
            okBtn.click();
        }

        requestAnimationFrame(() => {
            openCharacterTagManagerModal();
        });
    });


    container.insertBefore(tagManagerBtn, backupBtn);
}


function observeTagViewInjection() {
    const observer = new MutationObserver((mutations, obs) => {
        const targetContainer = document.querySelector('#tag_view_list .title_restorable .flex-container');
        if (targetContainer && !document.getElementById('characterTagManagerBackupAreaButton')) {
            console.log("Injecting Character/Tag Manager button into Tag View section");
            injectTagManagerButtonInTagView(targetContainer);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

function exportTagCharacterNotes() {
    // Collect all notes
    const notes = getNotes ? getNotes() : {};
    // Only keep tagNotes and charNotes for the export
    const exportData = {
        tagNotes: notes.tagNotes || {},
        charNotes: notes.charNotes || {}
    };
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tag_character_notes_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

async function handleNotesImport(importData) {
    if (!importData || typeof importData !== 'object') {
        toastr.error('Invalid notes file.');
        return;
    }
    const notes = getNotes ? getNotes() : {};
    const tagNotes = notes.tagNotes || {};
    const charNotes = notes.charNotes || {};

    let conflicts = [];
    let newNotes = { tagNotes: {}, charNotes: {} };

    // Tags notes
    for (const [tagId, note] of Object.entries(importData.tagNotes || {})) {
        if (tags.find(t => t.id === tagId)) {
            if (tagNotes[tagId] && tagNotes[tagId] !== note) {
                conflicts.push({ type: 'tag', id: tagId, old: tagNotes[tagId], new: note });
            } else if (!tagNotes[tagId]) {
                newNotes.tagNotes[tagId] = note;
            }
        }
    }


    // Characters (robust match: avatar, avatar basename, and optionally name)
    for (const [importKey, note] of Object.entries(importData.charNotes || {})) {
        let match = characters.find(c => c.avatar === importKey);
        if (!match) {
            const importBase = importKey.replace(/\.[^/.]+$/, '').toLowerCase();
            match = characters.find(c =>
                (c.avatar && c.avatar.replace(/\.[^/.]+$/, '').toLowerCase() === importBase)
            );
        }
        if (!match) {
            match = characters.find(c => (c.name || '').toLowerCase() === importKey.toLowerCase());
        }
        if (match) {
            const charId = match.avatar;
            if (charNotes[charId] && charNotes[charId] !== note) {
                conflicts.push({ type: 'char', id: charId, old: charNotes[charId], new: note, importId: importKey });
            } else if (!charNotes[charId]) {
                newNotes.charNotes[charId] = note;
            }
        }
    }

    // If there are conflicts, show conflict dialog and wait for user to resolve, then refresh UI
    if (conflicts.length) {
        await showNotesConflictDialog(conflicts, newNotes, importData);
        flushExtSettings();
        renderTagSection();
        renderCharacterList();
    } else {
        // Apply new notes
        Object.assign(tagNotes, newNotes.tagNotes);
        Object.assign(charNotes, newNotes.charNotes);
        saveNotes({ ...notes, tagNotes, charNotes }); 
        flushExtSettings();
        renderTagSection();
        renderCharacterList();
        toastr.success('Notes imported successfully!');
    }
}

eventSource.on(event_types.APP_READY, async () => {
    STCM.sidebarFolders = await stcmFolders.loadFolders(); // load and save to your variable!
    addCharacterTagManagerIcon();         // Top UI bar
    injectTagManagerControlButton();      // Tag filter bar
    observeTagViewInjection();    // Tag view list
    injectSidebarFolders(STCM.sidebarFolders, characters);  // <--- use sidebarFolders!
    watchSidebarFolderInjection(); 
    hookFolderSidebarEvents();
    injectStcmSettingsPanel();    

});

async function showNotesConflictDialog(conflicts, newNotes, importData) {
    const container = document.createElement('div');
    container.style.maxHeight = '420px';
    container.style.overflowY = 'auto';

    let selects = {};
    let allChecked = true;

    const makeRow = (conflict, idx) => {
        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.gap = '8px';
        label.style.marginBottom = '8px';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.dataset.idx = idx;
        selects[idx] = true;

        checkbox.addEventListener('change', () => {
            selects[idx] = checkbox.checked;
        });

        const entityName = conflict.type === 'tag'
            ? (tags.find(t => t.id === conflict.id)?.name || '(Unknown Tag)')
            : (
                (characters.find(c => c.avatar === conflict.id)?.name || conflict.id || '(Unknown Character)') +
                (conflict.importId && conflict.importId !== conflict.id
                    ? ` <small>(Imported as: ${escapeHtml(conflict.importId)})</small>`
                    : '')
            );

        label.innerHTML = `
            <b>${conflict.type === 'tag' ? 'Tag' : 'Character'}:</b> ${entityName}
            <br>
            <span style="margin-left:2em;"><b>Old:</b> ${escapeHtml(conflict.old)}</span>
            <br>
            <span style="margin-left:2em;"><b>New:</b> ${escapeHtml(conflict.new)}</span>
        `;
        label.prepend(checkbox);
        return label;
    };

    // "Select All" checkbox
    const selectAllLabel = document.createElement('label');
    selectAllLabel.style.display = 'flex';
    selectAllLabel.style.alignItems = 'center';
    selectAllLabel.style.gap = '8px';
    selectAllLabel.style.marginBottom = '10px';

    const selectAllCheckbox = document.createElement('input');
    selectAllCheckbox.type = 'checkbox';
    selectAllCheckbox.checked = true;
    selectAllCheckbox.addEventListener('change', () => {
        const checked = selectAllCheckbox.checked;
        Object.keys(selects).forEach(idx => {
            selects[idx] = checked;
            container.querySelectorAll(`input[type="checkbox"][data-idx="${idx}"]`).forEach(cb => cb.checked = checked);
        });
    });
    selectAllLabel.append(selectAllCheckbox, document.createTextNode('Select All'));

    container.appendChild(selectAllLabel);

    conflicts.forEach((conflict, idx) => {
        container.appendChild(makeRow(conflict, idx));
    });

    const result = await callGenericPopup(container, POPUP_TYPE.CONFIRM, 'Note Conflicts', {
        okButton: 'Import Selected',
        cancelButton: 'Cancel'
    });

    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        toastr.info('Note import cancelled.');
        return;
    }

    // Apply selected conflicts
    const notes = getNotes ? getNotes() : {};
    const tagNotes = notes.tagNotes || {};
    const charNotes = notes.charNotes || {};

    conflicts.forEach((conflict, idx) => {
        if (!selects[idx]) return;
        if (conflict.type === 'tag') {
            tagNotes[conflict.id] = conflict.new;
        } else {
            charNotes[conflict.id] = conflict.new;
        }
    });

    // Apply new (non-conflicting) notes
    Object.assign(tagNotes, newNotes.tagNotes);
    Object.assign(charNotes, newNotes.charNotes);

    saveNotes({ ...notes, tagNotes, charNotes });
    flushExtSettings();
    renderTagSection();
    renderCharacterList();
    toastr.success('Selected notes imported!');
}

export { callSaveandReload, injectTagManagerControlButton};
export const STCM = {
    sidebarFolders: [],
};
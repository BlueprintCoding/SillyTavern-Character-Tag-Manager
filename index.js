// index.js
import {
    tags,
    tag_map,
    removeTagFromEntity,
    appendTagToList,
    TAG_FOLDER_TYPES,
    TAG_FOLDER_DEFAULT_TYPE,
} from "../../../tags.js";

import {
    characters,
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
    toggleCharacterList,
    buildTagMap,
    buildCharNameMap,
    selectedCharacterIds,
    getNotes,
    saveNotes,
    debouncePersist
} from "./stcm_characters.js";



const { eventSource, event_types } = SillyTavern.getContext();
let isMergeMode = false;
const selectedMergeTags = new Set();      //  Global merge checkbox selection
let selectedPrimaryTagId = null;          // Global merge radio selection


function getCharacterNameById(id, charNameMap) {
    return charNameMap.get(id) || null;
}

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
                    </select>
                </div>
                <div style="padding: 0.5em 0;">
                    <input type="text" id="tagSearchInput" class="menu_input stcm_fullwidth_input " placeholder="Search tags..." />
                    <span class="smallInstructions">Search by by tag, or add "C:" before your search to search by character name.</span>
                    </div>
                <div class="stcm_align-right">
                    <button id="startMergeTags" class="stcm_menu_button stcm_margin_left interactable">
                    <i class="fa-solid fa-object-group"></i>Merge Tags
                    </button>
                    <button id="cancelMergeTags" class="stcm_menu_button stcm_margin_left interactable" style="display: none;">Cancel Merge</button>
                    <button id="createNewTagBtn" class="stcm_menu_button stcm_margin_left interactable">
                    <i class="fa-solid fa-plus"></i> Create Tag
                    </button>
                    <button id="backupTagsBtn" class="stcm_menu_button stcm_margin_left interactable">
                    <i class="fa-solid fa-file-export"></i> Backup
                    </button>
                    <button id="restoreTagsBtn" class="stcm_menu_button stcm_margin_left interactable">
                    <i class="fa-solid fa-file-import"></i> Restore
                    </button>
                    <input id="restoreTagsInput" type="file" accept=".json" hidden>

                    </div>
                <div class="modalBody stcm_scroll_300" id="characterTagManagerContent">
                    <div>Loading tags...</div>
                </div>
            </div>
        </div>
    
        <div class="accordionSection stcm_accordion_section stcm_tags_section">
            <button class="accordionToggle stcm_text_left" data-target="charactersSection">▶ Characters</button>
            <div id="charactersSection" class="accordionContent">
                <div style="padding-top: 1em;">
                                            <label style="text-wrap: nowrap;">Hold Shift to select multiple tags in a row, hold Control to select tags with gaps.</label>
                            <div class="stcm_sort_row">
                            <select id="assignTagSelect" class="menu_input stcm_fullwidth_input stcm_margin_bottom-sm" multiple ></select>
                            </div>
                                        <div class="stcm_sort_row">
                        <label style="text-wrap: nowrap;">Select Tag(s) to Assign</label>
                            <input type="text" id="assignTagSearchInput" class="menu_input stcm_fullwidth_input stcm_margin_bottom-sm" placeholder="Filter tags..." />
                         </div>
                    <div id="assignTagsBar" class="stcm_assign_bar">
                   <div id="selectedTagsDisplay" class="selected-tags-container"></div>

                        <button id="assignTagsButton" class="stcm_menu_button interactable green">Assign Tag(s)</button>
                    </div>
  <div class="stcm_sort_row">
                        <span>SORT</span>
                        <select id="charSortMode" class="stcm_menu_button interactable">
                            <option value="alpha_asc">A → Z</option>
                            <option value="alpha_desc">Z → A</option>
                            <option value="tag_count_desc">Most Tags</option>
                            <option value="tag_count_asc">Fewest Tags</option>
                            <option value="only_zero">Only 0 Tags</option>
                        </select>
                           <div class="stcm_margin_top stcm_fullwidth" >
                            <input type="text" id="charSearchInput" class="menu_input stcm_fullwidth_input " placeholder="Search characters/groups..." />
                            <span class="smallInstructions" style="display: block; margin-top:2px;">Search by character name, or use "A:" to search all character fields or "T:" to search characters with that tag.</span>
                    </div></div>
                    <div id="characterListWrapper"></div>
                </div>
            </div>
        </div>
    </div>
    `;


    document.body.appendChild(overlay);
    resetModalScrollPositions();

    // Accordion toggle behavior
    overlay.querySelectorAll('.accordionToggle').forEach(button => {
        button.addEventListener('click', () => {
            const targetId = button.dataset.target;
            const section = document.getElementById(targetId);
            const isOpen = section.classList.toggle('open');
            button.innerHTML = `${isOpen ? '▼' : '▶'} ${button.textContent.slice(2)}`;
        });
    });
    


    document.getElementById('closeCharacterTagManagerModal').addEventListener('click', () => {
        resetModalScrollPositions();
        overlay.remove();
    });

    document.getElementById('tagSortMode').addEventListener('change', () => {
        renderCharacterTagData();
    });

    document.getElementById('charSortMode').addEventListener('change', renderCharacterList);


    document.getElementById('tagSearchInput').addEventListener(
        'input',
        debounce(() => renderCharacterTagData())
    );

    document.getElementById('charSearchInput').addEventListener(
        'input',
        debounce(() => renderCharacterList())
    );

    document.getElementById('createNewTagBtn').addEventListener('click', () => {
        promptCreateTag();
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
            saveSettingsDebounced();
            renderCharacterList();
            renderCharacterTagData();
        } catch {
            toastr.error('Invalid tag backup file');
        }
        e.target.value = ''; // reset input
    });
    


    document.getElementById('assignTagSearchInput').addEventListener(
        'input',
        debounce(() => populateAssignTagSelect())
    );


    document.getElementById('cancelMergeTags').addEventListener('click', () => {
        isMergeMode = false;
        selectedMergeTags.clear();
        selectedPrimaryTagId = null;
    
        document.getElementById('startMergeTags').textContent = 'Merge Tags';
        document.getElementById('cancelMergeTags').style.display = 'none';
    
        document.querySelectorAll('.mergeCheckbox, input[name="mergePrimary"]').forEach(el => {
            el.checked = false;
        });
    
        renderCharacterTagData();
    });
    

    document.getElementById('startMergeTags').addEventListener('click', async () => {
        if (!isMergeMode) {
            isMergeMode = true;
            const mergeBtn = document.getElementById('startMergeTags');
            mergeBtn.textContent = 'Merge Now';
            mergeBtn.classList.add('merge-active');
            document.getElementById('cancelMergeTags').style.display = '';
            renderCharacterTagData();
        } else {
            const primaryId = selectedPrimaryTagId;
            const mergeIds = Array.from(selectedMergeTags);

            if (!primaryId || mergeIds.length === 0) {
                toastr.warning('Select one primary and at least one tag to merge.', 'Merge Tags');
                return;
            }

            if (mergeIds.includes(primaryId)) {
                toastr.error('Primary tag cannot also be marked for merge.', 'Merge Tags');
                return;
            }

            const primaryTag = tags.find(t => t.id === primaryId);

            // Build confirmation message with character counts
            const mergeDetails = mergeIds.map(tagId => {
                const tag = tagMapById.get(tagId);
                const count = Object.values(tag_map).filter(tagList => Array.isArray(tagList) && tagList.includes(tagId)).length;
                return `• ${tag?.name || '(Unknown Tag)'} (${count} character${count !== 1 ? 's' : ''})`;
            }).join('\n');

            const html = document.createElement('div');
            html.innerHTML = `
                <h3>Confirm Merge</h3>
                <p>You are about to merge the following tags into <strong>${primaryTag.name}</strong>:</p>
                <pre class="stcm_popup_pre">${mergeDetails}</pre>
                <p>This action cannot be undone. Do you want to proceed?</p>
            `;

            const proceed = await callGenericPopup(html, POPUP_TYPE.CONFIRM, 'Merge Tags');
            if (proceed !== POPUP_RESULT.AFFIRMATIVE) {
                toastr.info('Merge cancelled.', 'Merge Tags');
                return;
            }

            // Perform merge
            Object.entries(tag_map).forEach(([charId, tagIds]) => {
                if (!Array.isArray(tagIds)) return;

                let changed = false;
                mergeIds.forEach(tagId => {
                    const idx = tagIds.indexOf(tagId);
                    if (idx !== -1) {
                        tagIds.splice(idx, 1);
                        changed = true;
                    }
                });

                if (changed && !tagIds.includes(primaryId)) {
                    tagIds.push(primaryId);
                }
            });

            // Remove merged tags from the master list
            for (const id of mergeIds) {
                const index = tags.findIndex(t => t.id === id);
                if (index !== -1) tags.splice(index, 1);
            }
            

            toastr.success(`Merged ${mergeIds.length} tag(s) into "${primaryTag.name}".`, 'Merge Successful');

            // Reset state
            isMergeMode = false;
            selectedMergeTags.clear();
            selectedPrimaryTagId = null;
            const mergeBtn = document.getElementById('startMergeTags');
            mergeBtn.textContent = 'Merge Tags';
            mergeBtn.classList.remove('merge-active');
            document.getElementById('cancelMergeTags').style.display = 'none';
            // Uncheck all merge inputs
            document.querySelectorAll('.mergeCheckbox, input[name="mergePrimary"]').forEach(el => {
                el.checked = false;
            });

            saveSettingsDebounced();
            renderCharacterList();
            renderCharacterTagData();
        }
    });

    document.getElementById('assignTagsButton').addEventListener('click', () => {
        const selectedTagIds = Array.from(document.getElementById('assignTagSelect').selectedOptions).map(opt => opt.value);
        const selectedCharIds = Array.from(selectedCharacterIds);


        if (!selectedTagIds.length || !selectedCharIds.length) {
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

        toastr.success(`Assigned ${selectedTagIds.length} tag(s) to ${selectedCharIds.length} character(s).`, 'Assign Tags');
        saveSettingsDebounced();
        renderCharacterList();
        renderCharacterTagData();
    });

    renderCharacterTagData();
    populateAssignTagSelect();
    document.getElementById('assignTagSelect').addEventListener('change', () => {
        updateCheckboxVisibility();
        renderCharacterList(); // ← This will re-render selected tags display
    });
    const wrapper = document.getElementById('characterListWrapper');
    const container = document.createElement('div');
    container.id = 'characterListContainer';
    container.style.maxHeight = '300px';
    container.style.paddingBottom = '1em';
    wrapper.innerHTML = ''; // Clear any prior content
    wrapper.appendChild(container);

    renderCharacterList();
    resetModalScrollPositions();


    makeModalDraggable(document.getElementById('characterTagManagerModal'), document.querySelector('.stcm_modal_header'));

function makeModalDraggable(modal, handle) {
    let isDragging = false;
    let offsetX, offsetY;

    handle.style.cursor = 'move';
    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        offsetX = e.clientX - modal.offsetLeft;
        offsetY = e.clientY - modal.offsetTop;
        modal.style.position = 'absolute';
        modal.style.zIndex = 10000;
        modal.style.margin = 0; // remove any centering offset
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        modal.style.left = `${e.clientX - offsetX}px`;
        modal.style.top = `${e.clientY - offsetY}px`;
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}
}



function promptCreateTag() {
    const defaultName = getFreeName('New Tag', tags.map(t => t.name));

    // Get computed theme colors
    const styles = getComputedStyle(document.body);
    const defaultBg = styles.getPropertyValue('--SmartThemeShadowColor')?.trim() || '#cccccc';
    const defaultFg = styles.getPropertyValue('--SmartThemeBodyColor')?.trim() || '#000000';

    const container = document.createElement('div');
    container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 1em; width: 100%;">
            <label style="width: 100%;">
                Name:
                <input type="text" class="menu_input newTagName" value="${defaultName}" style="width: 100%;" />
            </label>

            <div style="display: flex; flex-direction: row; justify-content: space-between; gap: 1em;">
                <label style="flex: 1;">
                    Background Color:<br>
                    <toolcool-color-picker class="newTagBgPicker" color="${defaultBg}" style="width: 100%;"></toolcool-color-picker>
                </label>
                <label style="flex: 1;">
                    Text Color:<br>
                    <toolcool-color-picker class="newTagFgPicker" color="${defaultFg}" style="width: 100%;"></toolcool-color-picker>
                </label>
            </div>
        </div>
    `;

    // Wait for popup to be added, then apply class and label overrides
    const observer = new MutationObserver(() => {
        const popupBody = document.querySelector('.popup-body');
        const popup = popupBody?.closest('dialog.popup');
        const buttons = popup?.querySelectorAll('.popup-buttons button');
    
        if (popupBody) {
            popupBody.classList.add('custom-add-tag-popup');
        }
    
    });
    observer.observe(document.body, { childList: true, subtree: true });
    

    callGenericPopup(container, POPUP_TYPE.CONFIRM, 'Create New Tag', {
        okButton: 'Create Tag',
        cancelButton: 'Cancel'
    }).then(result => {
        if (result !== POPUP_RESULT.AFFIRMATIVE) return;

        const nameInput = container.querySelector('.newTagName');
        const bgPicker = container.querySelector('.newTagBgPicker');
        const fgPicker = container.querySelector('.newTagFgPicker');

        if (!nameInput || !bgPicker || !fgPicker) {
            console.error('One or more tag creation inputs were not found.');
            toastr.error('Something went wrong creating the tag.');
            return;
        }

        const name = nameInput.value.trim() || defaultName;
        const color = bgPicker.color || defaultBg;
        const color2 = fgPicker.color || defaultFg;

        const newTag = {
            id: crypto.randomUUID(),
            name,
            color,
            color2,
            folder_type: 'NONE'
        };

        tags.push(newTag);
        saveSettingsDebounced();
        toastr.success(`Created tag "${newTag.name}"`, 'Tag Created');
        renderCharacterTagData();
    });
}




function debounce(fn, delay = 200) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}


function updateCheckboxVisibility() {
    const selectedTagIds = Array.from(document.getElementById('assignTagSelect')?.selectedOptions || []).map(opt => opt.value);
    const showCheckboxes = selectedTagIds.length > 0;
    document.getElementById('assignTagsBar').style.display = showCheckboxes ? 'block' : 'none';

    // Show/hide checkboxes in-place without re-rendering
    document.querySelectorAll('.assignCharCheckbox').forEach(cb => {
        cb.style.display = showCheckboxes ? 'inline-block' : 'none';
    });
}


function populateAssignTagSelect() {
    const select = document.getElementById('assignTagSelect');
    const searchTerm = document.getElementById('assignTagSearchInput')?.value.toLowerCase() || '';
    if (!select) return;

    // Save currently selected tag IDs
    const selectedValues = new Set(Array.from(select.selectedOptions).map(opt => opt.value));

    select.innerHTML = '';

    // Keep all selected tags in the list, even if they don't match the filter
    const selectedTags = tags.filter(tag => selectedValues.has(tag.id));
    const matchingTags = tags
        .filter(tag => !selectedValues.has(tag.id)) // Exclude already selected
        .filter(tag => tag.name.toLowerCase().includes(searchTerm));

    const sortedTags = [...selectedTags, ...matchingTags].sort((a, b) => a.name.localeCompare(b.name));

    sortedTags.forEach(tag => {
        const option = document.createElement('option');
        option.value = tag.id;
        option.textContent = tag.name;
        option.selected = selectedValues.has(tag.id); // Re-select if it was previously selected
        select.appendChild(option);
    });
}


function getFreeName(base, existingNames) {
    const lowerSet = new Set(existingNames.map(n => n.toLowerCase()));
    let index = 1;
    let newName = base;
    while (lowerSet.has(newName.toLowerCase())) {
        newName = `${base} ${index++}`;
    }
    return newName;
}




function renderCharacterTagData() {
    const content = document.getElementById('characterTagManagerContent');
    if (!content || !Array.isArray(tags) || typeof tag_map !== 'object') {
        content.innerHTML = `<p>Tags or character map not loaded.</p>`;
        return;
    }

    const sortMode = document.getElementById('tagSortMode')?.value || 'alpha_asc';
    const searchTerm = document.getElementById('tagSearchInput')?.value.toLowerCase() || '';

    const styles = getComputedStyle(document.body);
    const defaultBg = styles.getPropertyValue('--SmartThemeShadowColor')?.trim() || '#cccccc';
    const defaultFg = styles.getPropertyValue('--SmartThemeBodyColor')?.trim() || '#000000';


    // Map for fast tag lookup: Map<tagId, tag>
    const tagMapById = buildTagMap();


    // Map for fast character name lookup: Map<charId, name>
    const charNameMap = buildCharNameMap();



    const tagGroups = tags.map(tag => {
        const charIds = Object.entries(tag_map)
            .filter(([_, tagIds]) => Array.isArray(tagIds) && tagIds.includes(tag.id))
            .map(([charId]) => charId);

        return {
            tag,
            charIds
        };
    }).filter(group => {
        const tagName = group.tag.name.toLowerCase();

        if (sortMode === 'only_zero' && group.charIds.length > 0) return false;

        if (searchTerm.startsWith('c:')) {
            const charSearch = searchTerm.slice(2).trim().toLowerCase();
            const matchedChars = group.charIds
                .map(id => getCharacterNameById(id, charNameMap)?.toLowerCase() || '')
                .filter(name => name.includes(charSearch));
            return matchedChars.length > 0;
        }

        return tagName.includes(searchTerm);
    });



    tagGroups.sort((a, b) => {
        if (sortMode === 'alpha_asc' || sortMode === 'only_zero') {
            return a.tag.name.localeCompare(b.tag.name);
        }

        switch (sortMode) {
            case 'alpha_desc':
                return b.tag.name.localeCompare(a.tag.name);
            case 'count_asc':
                return a.charIds.length - b.charIds.length;
            case 'count_desc':
                return b.charIds.length - a.charIds.length;
            default:
                return 0;
        }
    });


    const fragment = document.createDocumentFragment();


    tagGroups.forEach(group => {
        const wrapper = document.createElement('div');
        wrapper.className = 'tagGroup';

        const header = document.createElement('div');
        header.className = 'tagGroupHeader';

        const tagId = group.tag.id;
        const tagNotes = getNotes().tagNotes || {};
        const currentNote = tagNotes[tagId] || '';

        const styles = getComputedStyle(document.body);
        const defaultBg = styles.getPropertyValue('--SmartThemeShadowColor')?.trim() || '#cccccc';
        const defaultFg = styles.getPropertyValue('--SmartThemeBodyColor')?.trim() || '#000000';

        const rawColor = group.tag.color?.trim();
        const rawColor2 = group.tag.color2?.trim();
        
        // Use defaults if color is null, empty, or just "#"
        const bgColor = (rawColor && rawColor !== '#') ? rawColor : defaultBg;
        const fgColor = (rawColor2 && rawColor2 !== '#') ? rawColor2 : defaultFg;
        
        // Persist defaults into the tag object so they get saved/exported
        if (!rawColor || rawColor === '#') {
            group.tag.color = defaultBg;
        }
        if (!rawColor2 || rawColor2 === '#') {
            group.tag.color2 = defaultFg;
        }
        
                
        header.innerHTML = `
    <span class="tagNameEditable" data-id="${tagId}">
        <i class="fa-solid fa-pen editTagIcon" title="Edit name" style="cursor: pointer; margin-right: 6px;"></i>
        <strong class="tagNameText" style="background-color: ${bgColor}; color: ${fgColor}; padding: 2px 6px; border-radius: 4px;">
            ${group.tag.name}
        </strong>
    </span>
        <span class="tagCharCount">(${group.charIds.length})</span>
        <div class="stcm_tag_color_controls">
            <toolcool-color-picker
                class="tagColorPickerBg"
                color="${bgColor}"
                style="width: 32px; height: 24px;"
                title="Tag background color"
            ></toolcool-color-picker>

            <toolcool-color-picker
                class="tagColorPickerFg"
                color="${fgColor}"
                style="width: 32px; height: 24px;"
                title="Tag font color"
            ></toolcool-color-picker>
        </div>

        

        ${isMergeMode ? `
            <div class="stcm_merge_controls">
                <label><input type="radio" name="mergePrimary" value="${tagId}" ${selectedPrimaryTagId === tagId ? 'checked' : ''}> Primary</label>
                <label><input type="checkbox" class="mergeCheckbox" value="${tagId}" ${selectedMergeTags.has(tagId) ? 'checked' : ''}> Merge</label>
            </div>` : ''}
    `;

    // After header.innerHTML =
        const bgPicker = header.querySelector('.tagColorPickerBg');
        const fgPicker = header.querySelector('.tagColorPickerFg');

        // NEW: prevent initial 'change' from clobbering saved colors
        let initializing = true;


        bgPicker.addEventListener('change', e => {
            if (initializing) return;
            let newColor = e.detail?.rgba ?? e.target.color;
            newColor = (typeof newColor === 'string' && newColor.trim() === '#') ? '' : newColor;
            group.tag.color = newColor.trim();
            saveSettingsDebounced();
        });
        
        fgPicker.addEventListener('change', e => {
            if (initializing) return;
            let newColor = e.detail?.rgba ?? e.target.color;
            newColor = (typeof newColor === 'string' && newColor.trim() === '#') ? '' : newColor;
            group.tag.color2 = newColor.trim();
            saveSettingsDebounced();
        });
        
        // Wait until next tick to allow any initial value propagations
        setTimeout(() => {
            initializing = false;
        }, 0);
        
        const folderTypes = [
            {
                value: 'NONE',
                label: 'No Folder',
                icon: 'fa-xmark',
                tooltip: 'No Folder'
            },
            {
                value: 'OPEN',
                label: 'Open Folder',
                icon: 'fa-folder-open',
                tooltip: 'Open Folder (Show all characters even if not selected)'
            },
            {
                value: 'CLOSED',
                label: 'Closed Folder',
                icon: 'fa-folder-closed',
                tooltip: 'Closed Folder (Hide all characters unless selected)'
            }
        ];
        
        
        const currentType = group.tag.folder_type || 'NONE';
        const selectedOption = folderTypes.find(ft => ft.value === currentType);
        
        const folderDropdownWrapper = document.createElement('div');
        folderDropdownWrapper.className = 'custom-folder-dropdown';
        
        const folderSelected = document.createElement('div');
        folderSelected.className = 'selected-folder-option';
        folderSelected.innerHTML = `<i class="fa-solid ${selectedOption.icon}"></i> ${selectedOption.label}`;
        folderDropdownWrapper.appendChild(folderSelected);
        
        const folderOptionsList = document.createElement('div');
        folderOptionsList.className = 'folder-options-list';
        folderOptionsList.style.display = 'none';
        folderSelected.title = selectedOption.tooltip;

        folderTypes.forEach(ft => {
            const opt = document.createElement('div');
            opt.className = 'folder-option';
            opt.innerHTML = `<i class="fa-solid ${ft.icon}"></i> ${ft.label}`;
            opt.dataset.value = ft.value;
            opt.title = ft.tooltip;  // 🔥 Tooltip here
            opt.addEventListener('click', () => {
                group.tag.folder_type = ft.value;
                folderSelected.innerHTML = `<i class="fa-solid ${ft.icon}"></i> ${ft.label}`;
                folderSelected.title = ft.tooltip;  // 🔥 Update selected's tooltip
                folderOptionsList.style.display = 'none';
                saveSettingsDebounced();
                toastr.success(`"${group.tag.name}" folder type set to ${ft.label}`);
            });
            folderOptionsList.appendChild(opt);
        });
        
        
        folderSelected.addEventListener('click', () => {
            folderOptionsList.style.display = folderOptionsList.style.display === 'none' ? 'block' : 'none';
        });
        
        folderDropdownWrapper.appendChild(folderOptionsList);

        header.appendChild(folderDropdownWrapper);

        const folderWrapper = document.createElement('div');
        folderWrapper.className = 'stcm_folder_type_row';
        folderWrapper.style.display = 'flex';
        folderWrapper.style.alignItems = 'center';
        folderWrapper.style.gap = '0.5em';
        folderWrapper.style.marginLeft = '20px';

        // Label with icon
        const folderLabel = document.createElement('span');
        folderLabel.innerHTML = `<i class="fa-solid fa-folder" style="margin-right: 4px;"></i>Type:`;
        folderLabel.style.fontWeight = 'bold';
        folderLabel.style.whiteSpace = 'nowrap';
        folderLabel.title = "Choose how this tag behaves as a folder";

        // Append label and dropdown to wrapper
        folderWrapper.appendChild(folderLabel);
        folderWrapper.appendChild(folderDropdownWrapper);
        
        header.appendChild(folderWrapper);


        const showBtn = document.createElement('button');
        showBtn.textContent = 'Characters';
        showBtn.className = 'stcm_menu_button stcm_view_btn interactable';
        showBtn.style.marginLeft = '2px';
        showBtn.addEventListener('click', () => toggleCharacterList(wrapper, group));

        const noteBtn = document.createElement('button');
        noteBtn.textContent = 'Notes';
        noteBtn.className = 'stcm_menu_button charNotesToggle small interactable';
        noteBtn.style.marginLeft = '2px';
        noteBtn.title = 'View or edit tag notes';

        const noteWrapper = document.createElement('div');
        noteWrapper.className = 'charNotesWrapper';
        noteWrapper.style.display = 'none';

        const noteArea = document.createElement('textarea');
        noteArea.className = 'charNoteTextarea';
        noteArea.placeholder = 'Add tag notes...';
        noteArea.value = currentNote;

        const saveNoteBtn = document.createElement('button');
        saveNoteBtn.className = 'stcm_menu_button stcm_save_note_btn small';
        saveNoteBtn.textContent = 'Save Note';
        saveNoteBtn.addEventListener('click', async () => {
            const notes = getNotes();
            notes.tagNotes[tagId] = noteArea.value.trim();
            saveNotes(notes);
            debouncePersist();
            toastr.success(`Saved note for tag "${group.tag.name}"`);
        });

        noteBtn.addEventListener('click', () => {
            const open = noteWrapper.style.display === 'flex';
            noteWrapper.style.display = open ? 'none' : 'flex';
            noteBtn.textContent = open ? 'Notes' : 'Close Notes';
            noteBtn.style.background = open ? '' : '#8e6529';
        });

        noteWrapper.appendChild(noteArea);
        noteWrapper.appendChild(saveNoteBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.className = 'stcm_menu_button interactable red';
        deleteBtn.style.marginLeft = '20px';
        deleteBtn.addEventListener('click', () => confirmDeleteTag(group.tag));

        const actionButtons = document.createElement('div');
        actionButtons.className = 'tagActionButtons';
        actionButtons.appendChild(showBtn);
        actionButtons.appendChild(noteBtn);
        actionButtons.appendChild(deleteBtn);
        wrapper.appendChild(header);
        header.appendChild(actionButtons);
        wrapper.appendChild(noteWrapper);

        fragment.appendChild(wrapper);
    });


    content.innerHTML = '';
    content.appendChild(fragment);
    if (isMergeMode) {
        document.querySelectorAll('input[name="mergePrimary"]').forEach(el => {
            el.addEventListener('change', () => {
                selectedPrimaryTagId = el.value;
            });
        });

        document.querySelectorAll('.mergeCheckbox').forEach(cb => {
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    selectedMergeTags.add(cb.value);
                } else {
                    selectedMergeTags.delete(cb.value);
                }
            });
        });
    }


    document.querySelectorAll('.editTagIcon').forEach(icon => {
        icon.addEventListener('click', () => {
            const container = icon.closest('.tagNameEditable');
            const id = container.dataset.id;
            const strong = container.querySelector('.tagNameText');
            const oldName = strong.textContent.trim();

            const input = document.createElement('input');
            input.type = 'text';
            input.value = oldName;
            input.className = 'menu_input';
            input.style.width = '150px';

            // Replace and focus
            container.replaceChild(input, strong);
            input.focus();
            input.select();

            // Save on blur or enter
            const save = () => {
                const newName = input.value.trim();
                const tag = tags.find(t => t.id === id);

                if (tag && newName && newName !== oldName) {
                    tag.name = newName;
                    saveSettingsDebounced();
                    renderCharacterList();
                    renderCharacterTagData(); // ✅ Immediately refresh UI
                } else {
                    // If unchanged or invalid, just restore display
                    container.replaceChild(strong, input);
                    strong.textContent = oldName;
                }
            };



            input.addEventListener('blur', save);
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    save();
                } else if (e.key === 'Escape') {
                    container.replaceChild(strong, input);
                }
            });
        });
    });

    // Make tag name clickable to toggle the character list
    content.querySelectorAll('.tagNameText').forEach(nameEl => {
        nameEl.style.cursor = 'pointer';
        nameEl.addEventListener('click', () => {
            const container = nameEl.closest('.tagGroup');
            const tagId = nameEl.closest('.tagNameEditable')?.dataset?.id;
            const group = tagGroups.find(g => g.tag.id === tagId);
            if (group) {
                toggleCharacterList(container, group);
            }
        });
    });



}

function isNullColor(color) {
    if (typeof color !== 'string') return true;
    const c = color.trim().toLowerCase();
    return !c || c === '#' || c === 'rgba(0, 0, 0, 1)';
}


function confirmDeleteTag(tag) {
    if (!tag) return;

    const html = document.createElement('div');
    html.innerHTML = `
        <h3>Confirm Delete</h3>
        <p>Are you sure you want to delete the tag <strong>${tag.name}</strong>?</p>
        <p style="color: #e57373;">It will be removed from all associated characters and cannot be undone.</p>
    `;

    callGenericPopup(html, POPUP_TYPE.CONFIRM, 'Delete Tag').then(result => {
        if (result !== POPUP_RESULT.AFFIRMATIVE) {
            toastr.info('Tag deletion cancelled.', 'Delete Tag');
            return;
        }

        // Proceed with deletion
        for (const [charId, tagList] of Object.entries(tag_map)) {
            if (Array.isArray(tagList)) {
                tag_map[charId] = tagList.filter(tid => tid !== tag.id);
            }
        }

        const index = tags.findIndex(t => t.id === tag.id);
        if (index !== -1) tags.splice(index, 1);

        toastr.success(`Deleted tag "${tag.name}".`, 'Delete Tag');
        saveSettingsDebounced();
        renderCharacterList();
        renderCharacterTagData();
    });
}


function addCharacterTagManagerIcon() {
    const existingIcon = document.getElementById('rightNavHolder');
    if (!existingIcon || document.getElementById('characterTagManagerToggle')) return;

    // Create your new icon
    const icon = document.createElement('div');
    icon.id = 'characterTagManagerToggle';
    icon.className = 'drawer drawer-icon fa-solid fa-tags fa-fw interactable';
    icon.title = 'Character / Tag Manager';
    icon.setAttribute('tabindex', '0');

    icon.addEventListener('click', openCharacterTagManagerModal);

    // Insert before the existing #rightNavDrawerIcon
    const parent = existingIcon.parentElement;
    parent.insertBefore(icon, existingIcon);
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


eventSource.on(event_types.APP_READY, () => {
    addCharacterTagManagerIcon();         // Top UI bar
    injectTagManagerControlButton();      // Tag filter bar
    observeTagViewInjection();    // Tag view list

});

function resetModalScrollPositions() {
    requestAnimationFrame(() => {
        const modal = document.getElementById('characterTagManagerModal');
        if (modal) modal.scrollTo({ top: 0 });

        const scrollables = modal?.querySelectorAll('.modalBody, .accordionContent, #characterListContainer');
        scrollables?.forEach(el => {
            el.scrollTop = 0;
        });

        //  force 2nd frame in case browser restores it AFTER first frame
        requestAnimationFrame(() => {
            scrollables?.forEach(el => {
                el.scrollTop = 0;
            });
        });
    });
}

export { renderCharacterTagData, resetModalScrollPositions };

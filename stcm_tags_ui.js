// ============================================================================
// stcm_tags_ui.js
// ----------------------------------------------------------------------------
// * All UI + state for the “Tags” accordion of the Character / Tag Manager.
// * Nothing here touches folders or the character list except via the public
//   helpers exported at the bottom.
// * Public API ---------------------------------------------------------------
//   - renderTagSection()         → (re)draw the tag list
//   - attachTagSectionListeners(modalRoot)
//       call once, right after you inject the modal DOM.  It wires up all
//       buttons / inputs that live *inside* the Tags accordion.
//   - selectedTagIds             → Set<string>  (chips selected for assignment)
//     (imported by stcm_characters.js so the character list can see which
//      tags are currently selected for mass-assign.)
// ============================================================================

/* eslint-disable import/no-cycle */ // circular with index.js is OK (ES modules)

import {
    debounce,
    flushExtSettings,
    getFreeName,
    escapeHtml,
    getCharacterNameById,
    buildCharNameMap,
    getFolderTypeForUI,
    getNotes,
    saveNotes,
} from './utils.js';

import {
    uuidv4 
} from "../../../utils.js"

import { convertTagToRealFolder} from './stcm_folders.js';

import { callSaveandReload } from "./index.js";

import {
    characters,
} from '../../../../script.js';


import {
    tags,
    tag_map,
} from '../../../tags.js';

import {
    renderCharacterList,
    toggleCharacterList,
    stcmCharState,
} from './stcm_characters.js';

import {
    POPUP_RESULT,
    POPUP_TYPE,
    callGenericPopup,
} from '../../../popup.js';

import { accountStorage } from '../../../util/AccountStorage.js';

// ---------------------------------------------------------------------------
// Local state (module-private)
// ---------------------------------------------------------------------------
let isMergeMode             = false;
const selectedMergeTags     = new Set();
let  selectedPrimaryTagId   = null;

export let isBulkDeleteMode        = false;
export const selectedBulkDeleteTags = new Set();
export const selectedTagIds = new Set();     // ← used by characters pane

// For shift-click range selection in bulk delete mode
let bulkDeleteCursor = null;          // tag ID of last clicked checkbox
let bulkDeleteTagOrder = [];          // ordered list of tag IDs as rendered

// Bulk edit mode: 'any' or 'all' for matching characters
let bulkEditMatchMode = 'any';

// ---------------------------------------------------------------------------
// PUBLIC 1: renderTagSection  (was renderCharacterTagData in index.js)
// ---------------------------------------------------------------------------
export function renderTagSection() {
    const content = document.getElementById('characterTagManagerContent');
    if (!content) return;

    // ---------------------------------------------------------------------
    // 1. grab UI inputs (sort, search)
    // ---------------------------------------------------------------------
    const sortMode = document.getElementById('tagSortMode')?.value || 'alpha_asc';
    const rawInput = document.getElementById('tagSearchInput')?.value.toLowerCase() || '';
    const orGroups = rawInput.split(',').map(g => g.trim()).filter(Boolean);

    // ---------------------------------------------------------------------
    // 2. build tag → character map
    // ---------------------------------------------------------------------
    function getFolderType(tag) {
        const ft = String(tag.folder_type || 'NONE').toUpperCase();
        return ['NONE', 'OPEN', 'CLOSED'].includes(ft) ? ft : 'NONE';
    }

    const tagGroups = tags.map(tag => {
        const charIds = Object.entries(tag_map)
            .filter(([_, arr]) => Array.isArray(arr) && arr.includes(tag.id))
            .map(([charId]) => charId);
        return { tag, charIds };
    }).filter(group => {
        // filter by folder type options in sort dropdown
        if (sortMode === 'no_folder'     && getFolderType(group.tag) !== 'NONE')   return false;
        if (sortMode === 'open_folder'   && getFolderType(group.tag) !== 'OPEN')   return false;
        if (sortMode === 'closed_folder' && getFolderType(group.tag) !== 'CLOSED') return false;
        if (sortMode === 'only_zero'     && group.charIds.length > 0)              return false;

        // text search ----------------------------------------------------
        if (!orGroups.length) return true;                 // nothing typed
        const tagName = group.tag.name.toLowerCase();
        const charNameMap = buildCharNameMap(characters);
        for (const orGrp of orGroups) {
            const andTerms = orGrp.split(' ').map(s => s.trim()).filter(Boolean);
            const ok = andTerms.every(term => {
                if (term.startsWith('c:')) {
                    const search = term.slice(2);
                    return group.charIds
                        .map(id => getCharacterNameById(id, charNameMap)?.toLowerCase() || '')
                        .some(nm => nm.includes(search));
                }
                return tagName.includes(term);
            });
            if (ok) return true;
        }
        return false;
    });

    // ---------------------------------------------------------------------
    // 3. sort
    // ---------------------------------------------------------------------
    tagGroups.sort((a, b) => {
        switch (sortMode) {
            case 'alpha_desc':  return b.tag.name.localeCompare(a.tag.name);
            case 'count_asc':   return a.charIds.length - b.charIds.length;
            case 'count_desc':  return b.charIds.length - a.charIds.length;
            default:            return a.tag.name.localeCompare(b.tag.name);
        }
    });

    // ---------------------------------------------------------------------
    // 4. render as table
    // ---------------------------------------------------------------------
    content.innerHTML = '';

    // Track tag order for shift-click range selection (as strings to match cb.value)
    bulkDeleteTagOrder = tagGroups.map(g => String(g.tag.id));

    // Create table structure
    const table = document.createElement('table');
    table.className = 'stcm_tags_table';

    // Table header
    const thead = document.createElement('thead');
    thead.innerHTML = `
        <tr>
            <th class="stcm_th_checkbox">
                <input type="checkbox" id="bulkDeleteSelectAll" title="Select/Deselect All">
            </th>
            <th class="stcm_th_name">Tag Name</th>
            <th class="stcm_th_type">Tag Type</th>
            <th class="stcm_th_view" colspan="2">View</th>
            <th class="stcm_th_action">Action</th>
        </tr>
    `;
    table.appendChild(thead);

    // Table body
    const tbody = document.createElement('tbody');
    tagGroups.forEach(group => {
        const row = renderSingleTag(group);
        tbody.appendChild(row);

        // Add notes row (hidden by default, spans all columns)
        if (row._noteWrap) {
            const notesRow = document.createElement('tr');
            notesRow.className = 'stcm_notes_row';
            notesRow.style.display = 'none';
            const notesCell = document.createElement('td');
            notesCell.colSpan = 6;
            notesCell.appendChild(row._noteWrap);
            row._noteWrap.style.display = 'flex'; // Always flex when row is shown
            notesRow.appendChild(notesCell);
            tbody.appendChild(notesRow);
            // Update note button to toggle the row instead
            row._notesRow = notesRow;
        }
    });
    table.appendChild(tbody);

    content.appendChild(table);

    // wire bulk-delete & merge checkboxes AFTER list is in the DOM --------
    // Checkboxes are always visible now for bulk edit functionality
    {
        const allCheckboxes = content.querySelectorAll('.bulkDeleteTagCheckbox');
        const selectAllCb = content.querySelector('#bulkDeleteSelectAll');

        // Helper to update select-all checkbox state
        const updateSelectAllState = () => {
            if (!selectAllCb) return;
            const allChecked = bulkDeleteTagOrder.every(id => selectedBulkDeleteTags.has(id));
            const noneChecked = selectedBulkDeleteTags.size === 0;
            selectAllCb.checked = allChecked;
            selectAllCb.indeterminate = !allChecked && !noneChecked;
        };

        // Helper to toggle a tag and update checkbox UI
        const toggleTag = (tagId) => {
            if (selectedBulkDeleteTags.has(tagId)) {
                selectedBulkDeleteTags.delete(tagId);
            } else {
                selectedBulkDeleteTags.add(tagId);
            }
        };

        // Helper to update cursor visual indicator
        const updateCursorVisual = () => {
            content.querySelectorAll('.tagGroup').forEach(row => {
                const cb = row.querySelector('.bulkDeleteTagCheckbox');
                if (cb && cb.value === bulkDeleteCursor) {
                    row.style.outline = '2px solid var(--SmartThemeQuoteColor, #f0a)';
                    row.style.outlineOffset = '-2px';
                } else {
                    row.style.outline = '';
                    row.style.outlineOffset = '';
                }
            });
        };

        // Wire select-all checkbox (only present in bulk delete mode)
        if (selectAllCb) {
            selectAllCb.addEventListener('change', () => {
                if (selectAllCb.checked) {
                    bulkDeleteTagOrder.forEach(id => selectedBulkDeleteTags.add(id));
                } else {
                    selectedBulkDeleteTags.clear();
                }
                allCheckboxes.forEach(cb => cb.checked = selectAllCb.checked);
                bulkDeleteCursor = null;
                updateCursorVisual();
                populateBulkEditDropdowns(); // Update Remove dropdown for new selection
            });
        }

        // Wire individual checkboxes with shift-click support
        allCheckboxes.forEach(cb => {
            cb.checked = selectedBulkDeleteTags.has(cb.value);

            // Prevent text selection when shift-clicking
            cb.addEventListener('mousedown', (e) => {
                if (e.shiftKey) e.preventDefault();
            });

            cb.addEventListener('click', (e) => {
                const clickedId = cb.value;
                const clickedIdx = bulkDeleteTagOrder.indexOf(clickedId);

                if (e.shiftKey && bulkDeleteCursor !== null) {
                    // Shift-click: toggle range from cursor to clicked (exclusive of cursor)
                    const cursorIdx = bulkDeleteTagOrder.indexOf(bulkDeleteCursor);
                    console.log('Shift-click range:', {
                        cursorIdx, clickedIdx,
                        cursor: bulkDeleteCursor,
                        clicked: clickedId,
                        orderLength: bulkDeleteTagOrder.length
                    });
                    if (cursorIdx !== -1 && clickedIdx !== -1 && cursorIdx !== clickedIdx) {
                        const startIdx = Math.min(cursorIdx, clickedIdx);
                        const endIdx = Math.max(cursorIdx, clickedIdx);
                        const toggled = [];
                        // Toggle everything between cursor and click (exclusive of cursor, inclusive of click)
                        for (let i = startIdx; i <= endIdx; i++) {
                            if (i !== cursorIdx) {  // Compare indices, not values
                                toggled.push({ i, id: bulkDeleteTagOrder[i] });
                                toggleTag(bulkDeleteTagOrder[i]);
                            }
                        }
                        console.log('Toggled items:', { startIdx, endIdx, cursorIdx, toggled });
                        // Update all checkbox UI
                        allCheckboxes.forEach(c => c.checked = selectedBulkDeleteTags.has(c.value));
                        e.preventDefault(); // Prevent default checkbox toggle since we handled it
                    }
                } else {
                    // Regular click: toggle single item and set cursor
                    if (cb.checked) {
                        selectedBulkDeleteTags.add(clickedId);
                    } else {
                        selectedBulkDeleteTags.delete(clickedId);
                    }
                }

                // Update cursor position
                bulkDeleteCursor = clickedId;
                updateSelectAllState();
                updateCursorVisual();
                populateBulkEditDropdowns(); // Update Remove dropdown for new selection
            });
        });

        updateSelectAllState();
        updateCursorVisual();
    }
    if (isMergeMode) {
        content.querySelectorAll('input[name="mergePrimary"]').forEach(r =>
            r.addEventListener('change', () => selectedPrimaryTagId = r.value)
        );
        content.querySelectorAll('.mergeCheckbox').forEach(cb =>
            cb.addEventListener('change', () => {
                cb.checked ? selectedMergeTags.add(cb.value)
                           : selectedMergeTags.delete(cb.value);
            })
        );
    }

    // Populate bulk edit dropdowns
    populateBulkEditDropdowns();

    accountStorage.setItem('SelectedNavTab', 'rm_button_characters');
}

// ---------------------------------------------------------------------------
// helper: render one table row for a tag
// ---------------------------------------------------------------------------
function renderSingleTag({ tag, charIds }) {
    const row = document.createElement('tr');
    row.className = 'tagGroup';
    row.dataset.tagId = tag.id;

    // prettier color defaults
    const rawBg = String(tag.color || '').trim();
    const rawFg = String(tag.color2 || '').trim();
    const bg = (rawBg && rawBg !== '#') ? rawBg : '#333';
    const fg = (rawFg && rawFg !== '#') ? rawFg : '#fff';

    // ─────────────────────────────────────────────────────────────────────
    // Cell 1: Checkbox
    // ─────────────────────────────────────────────────────────────────────
    const checkboxCell = document.createElement('td');
    checkboxCell.className = 'stcm_td_checkbox';
    checkboxCell.innerHTML = `<input type="checkbox" class="bulkDeleteTagCheckbox" value="${tag.id}">`;
    row.appendChild(checkboxCell);

    // ─────────────────────────────────────────────────────────────────────
    // Cell 2: Tag Name (with edit icon, color swatch, count)
    // ─────────────────────────────────────────────────────────────────────
    const nameCell = document.createElement('td');
    nameCell.className = 'stcm_td_name';
    nameCell.innerHTML = `
        <span class="tagNameEditable" data-id="${tag.id}">
            <i class="fa-solid fa-pen editTagIcon" style="cursor:pointer;margin-right:6px;" title="Edit name"></i>
            <strong class="tagNameText stcm-color-swatch"
                    style="background:${bg};color:${fg};padding:2px 6px;border-radius:4px;cursor:pointer;"
                    title="Click to edit colors">
                ${escapeHtml(tag.name)} <i class="fa-solid fa-palette" style="margin-left:6px;"></i>
            </strong>
            <span class="tagCharCount">(${charIds.length})</span>
        </span>
        ${isMergeMode ? `
           <div class="stcm_merge_controls">
               <label><input type="radio" name="mergePrimary" value="${tag.id}"> Primary</label>
               <label><input type="checkbox" class="mergeCheckbox" value="${tag.id}"> Merge</label>
           </div>` : ''}
    `;
    row.appendChild(nameCell);

    // ─────────────────────────────────────────────────────────────────────
    // Cell 3: Tag Type dropdown
    // ─────────────────────────────────────────────────────────────────────
    const typeCell = document.createElement('td');
    typeCell.className = 'stcm_td_type';
    const folderDropdownWrapper = buildFolderTypeDropdown(tag);
    typeCell.appendChild(folderDropdownWrapper);

    // Convert to Real Folder button
    const convertBtn = document.createElement('button');
    convertBtn.className = 'stcm_menu_button tiny interactable';
    convertBtn.innerHTML = '<i class="fa-solid fa-folder-plus" title="Convert to Real Folder"></i>';
    convertBtn.title = 'Convert to Real Folder';
    convertBtn.style.marginLeft = '6px';
    convertBtn.addEventListener('click', () => {
        convertTagToRealFolder(tag);
    });
    typeCell.appendChild(convertBtn);
    row.appendChild(typeCell);

    // ─────────────────────────────────────────────────────────────────────
    // Cell 4: Characters (View column)
    // ─────────────────────────────────────────────────────────────────────
    const charCell = document.createElement('td');
    charCell.className = 'stcm_td_view';
    const charBtn = document.createElement('button');
    charBtn.className = 'stcm_menu_button stcm_view_btn stcm_icon_btn interactable';
    charBtn.innerHTML = '<i class="fa-solid fa-users"></i>';
    charBtn.title = `View Characters (${charIds.length})`;
    charBtn.onclick = () => toggleCharacterList(row, { tag, charIds });
    charCell.appendChild(charBtn);
    row.appendChild(charCell);

    // ─────────────────────────────────────────────────────────────────────
    // Cell 5: Notes (View column)
    // ─────────────────────────────────────────────────────────────────────
    const noteCell = document.createElement('td');
    noteCell.className = 'stcm_td_view';
    const noteBtn = document.createElement('button');
    noteBtn.className = 'stcm_menu_button charNotesToggle stcm_icon_btn interactable';
    noteBtn.innerHTML = '<i class="fa-solid fa-note-sticky"></i>';
    noteBtn.title = 'View Notes';

    const noteWrap = buildNotesWrapper(tag.id);
    noteBtn.onclick = () => {
        // Toggle the notes row (will be set up after row is added to tbody)
        if (row._notesRow) {
            const open = row._notesRow.style.display !== 'none';
            row._notesRow.style.display = open ? 'none' : 'table-row';
            noteBtn.style.background = open ? '' : '#8e6529';
        }
    };
    noteCell.appendChild(noteBtn);
    row.appendChild(noteCell);

    // ─────────────────────────────────────────────────────────────────────
    // Cell 6: Delete (Action column)
    // ─────────────────────────────────────────────────────────────────────
    const actionCell = document.createElement('td');
    actionCell.className = 'stcm_td_action';
    const delBtn = document.createElement('button');
    delBtn.className = 'stcm_menu_button stcm_icon_btn interactable red';
    delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
    delBtn.title = 'Delete Tag';
    delBtn.onclick = () => confirmDeleteTag(tag);
    actionCell.appendChild(delBtn);
    row.appendChild(actionCell);

    // ─────────────────────────────────────────────────────────────────────
    // Notes wrapper row (spans all columns, hidden by default)
    // ─────────────────────────────────────────────────────────────────────
    // We need to handle this differently for tables - append after the row
    // Store reference on the row for later insertion
    row._noteWrap = noteWrap;

    // ---------------------------------------------------------------------
    // bind listeners that need actual elements
    // ---------------------------------------------------------------------
    // edit name
    nameCell.querySelectorAll('.editTagIcon').forEach(icon => {
        icon.addEventListener('click', () => startInlineRename(icon, tag.id));
    });
    // color picker
    nameCell.querySelector('.stcm-color-swatch')?.addEventListener('click', () =>
        openColorEditModal(tag)
    );

    return row;
}

// ---------------------------------------------------------------------------
// inline name rename helper
// ---------------------------------------------------------------------------
function startInlineRename(icon, tagId) {
    const container = icon.closest('.tagNameEditable');
    const strong    = container.querySelector('.tagNameText');
    const oldName   = strong.textContent.trim();

    const input = document.createElement('input');
    input.className = 'menu_input';
    input.style.width = '150px';
    input.value = oldName;

    const save = () => {
        const newName = input.value.trim();
        const t = tags.find(t => t.id === tagId);
        if (t && newName && newName !== oldName) {
            t.name = newName;
            callSaveandReload();
            renderTagSection();
            renderCharacterList();
        } else {
            container.replaceChild(strong, input);
        }
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') container.replaceChild(strong, input);
    });

    container.replaceChild(input, strong);
    input.focus(); input.select();
}

// ---------------------------------------------------------------------------
// folder-type dropdown builder
// ---------------------------------------------------------------------------
function buildFolderTypeDropdown(tag) {
    const folderTypes = [
        { value: 'NONE',   label: 'No Tag Folder',    icon: 'fa-xmark',        tip: 'No Folder' },
        { value: 'OPEN',   label: 'Open Tag Folder',  icon: 'fa-folder-open',  tip: 'Always visible' },
        { value: 'CLOSED', label: 'Closed Tag Folder',icon: 'fa-folder-closed',tip: 'Collapsed' },
    ];
    const sel = folderTypes.find(ft => ft.value === getFolderTypeForUI(tag, getNotes())) || folderTypes[0];

    const wrap = document.createElement('div');
    wrap.className = 'custom-folder-dropdown';

    const selectedDiv = document.createElement('div');
    selectedDiv.className = 'selected-folder-option';
    selectedDiv.title = sel.tip;
    selectedDiv.innerHTML = `<i class="fa-solid ${sel.icon}"></i> ${sel.label}`;
    wrap.appendChild(selectedDiv);

    const list = document.createElement('div');
    list.className = 'folder-options-list';
    list.style.display = 'none';
    folderTypes.forEach(ft => {
        const opt = document.createElement('div');
        opt.className = 'folder-option';
        opt.title = ft.tip;
        opt.innerHTML = `<i class="fa-solid ${ft.icon}" style="margin-right:6px;"></i> ${ft.label}`;
        opt.onclick = () => {
            tag.folder_type = ft.value;
            saveNotes(getNotes());               // persist possible legacy field
            flushExtSettings();
            selectedDiv.innerHTML = `<i class="fa-solid ${ft.icon}"></i> ${ft.label}`;
            selectedDiv.title = ft.tip;
            list.style.display = 'none';
            callSaveandReload();
            renderTagSection();
            renderCharacterList();
        };
        list.appendChild(opt);
    });
    wrap.appendChild(list);
    selectedDiv.onclick = () => {
        list.style.display = list.style.display === 'none' ? 'block' : 'none';
    };
    return wrap;
}

// ---------------------------------------------------------------------------
// notes UI builder
// ---------------------------------------------------------------------------
function buildNotesWrapper(tagId) {
    const w = document.createElement('div');
    w.className = 'charNotesWrapper';
    w.style.display = 'none';
    const notes = getNotes();
    const noteArea = document.createElement('textarea');
    noteArea.className = 'charNoteTextarea';
    noteArea.placeholder = 'Add tag notes...';
    noteArea.value = (notes.tagNotes || {})[tagId] || '';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save Note';
    saveBtn.className = 'stcm_menu_button stcm_save_note_btn small';
    saveBtn.onclick = () => {
        const n = getNotes();
        n.tagNotes[tagId] = noteArea.value.trim();
        saveNotes(n);
        flushExtSettings();
        toastr.success('Note saved');
    };

    w.append(noteArea, saveBtn);
    return w;
}

// ---------------------------------------------------------------------------
// prompt to create a tag  (was promptCreateTag)
// ---------------------------------------------------------------------------
export function promptCreateTag() {
    const defaultName = getFreeName('New Tag', tags.map(t => t.name));
    const styles      = getComputedStyle(document.body);
    const defaultBg   = styles.getPropertyValue('--SmartThemeShadowColor')?.trim() || '#cccccc';
    const defaultFg   = styles.getPropertyValue('--SmartThemeBodyColor')?.trim()   || '#000000';

    let selectedBg = defaultBg;
    let selectedFg = defaultFg;

    const container = document.createElement('div');
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:1em;width:100%;">
        <label>Name:
          <input type="text" class="menu_input newTagName"
                 value="${defaultName}" style="width:100%;">
        </label>
    
        <div class="tagPreview"
             style="align-self:start;padding:4px 8px;border-radius:4px;
                    background:${defaultBg};color:${defaultFg};
                    font-weight:bold;border:1px solid #999;">
          ${defaultName}
        </div>
    
        <div style="display:flex;gap:1em;">
          <label style="flex:1;">Background:<br>
            <toolcool-color-picker class="newTagBgPicker"
                                   color="${defaultBg}" style="width:100%;"></toolcool-color-picker>
          </label>
    
          <label style="flex:1;">Text:<br>
            <toolcool-color-picker class="newTagFgPicker"
                                   color="${defaultFg}" style="width:100%;"></toolcool-color-picker>
          </label>
        </div>
      </div>`;
    

    const preview  = container.querySelector('.tagPreview');
    const nameIn   = container.querySelector('.newTagName');
    const bgPick   = container.querySelector('.newTagBgPicker');
    const fgPick   = container.querySelector('.newTagFgPicker');

    const updatePreview = () => {
        preview.textContent        = nameIn.value.trim() || 'Tag Name';
        preview.style.background   = selectedBg;
        preview.style.color        = selectedFg;
    };

    nameIn.oninput = updatePreview;
    bgPick.addEventListener('change', e => { selectedBg = e.detail?.rgba || defaultBg; updatePreview(); });
    fgPick.addEventListener('change', e => { selectedFg = e.detail?.rgba || defaultFg; updatePreview(); });

    callGenericPopup(container, POPUP_TYPE.CONFIRM, 'Create New Tag', {
        okButton: 'Create Tag',
        cancelButton: 'Cancel',
        customClass: 'stcm_custom-add-tag-popup'
    }).then(res => {
        if (res !== POPUP_RESULT.AFFIRMATIVE) return;
        tags.push({
            id: uuidv4(),
            name: nameIn.value.trim() || defaultName,
            color: selectedBg,
            color2: selectedFg,
            folder_type: 'NONE',
        });
        callSaveandReload();
        renderTagSection();
        renderCharacterList();  
        toastr.success('Tag created');
    });
}

// ---------------------------------------------------------------------------
// color edit modal
// ---------------------------------------------------------------------------
function openColorEditModal(tag) {
    const styles = getComputedStyle(document.body);
    const defaultBg = styles.getPropertyValue('--SmartThemeShadowColor')?.trim() || '#333';
    const defaultFg = styles.getPropertyValue('--SmartThemeBodyColor')?.trim()   || '#fff';

    let currBg = (tag.color  && tag.color  !== '#') ? tag.color  : defaultBg;
    let currFg = (tag.color2 && tag.color2 !== '#') ? tag.color2 : defaultFg;

    const container = document.createElement('div');
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:1em;">
         <div class="tagPreview" style="align-self:center;padding:4px 12px;border-radius:4px;background:${currBg};color:${currFg};font-weight:bold;border:1px solid #999;">
            ${escapeHtml(tag.name)}
         </div>
         <div style="display:flex;gap:1em;">
           <label style="flex:1;">Background:<br><toolcool-color-picker class="editTagBgPicker" color="${currBg}" style="width:100%;"></toolcool-color-picker></label>
           <label style="flex:1;">Text:<br><toolcool-color-picker class="editTagFgPicker" color="${currFg}" style="width:100%;"></toolcool-color-picker></label>
         </div>
      </div>`;

    const preview = container.querySelector('.tagPreview');
    container.querySelector('.editTagBgPicker').addEventListener('change', e => {
        currBg = e.detail?.rgba || currBg; preview.style.background = currBg;
    });
    container.querySelector('.editTagFgPicker').addEventListener('change', e => {
        currFg = e.detail?.rgba || currFg; preview.style.color = currFg;
    });

    callGenericPopup(container, POPUP_TYPE.CONFIRM, `Edit colors: ${escapeHtml(tag.name)}`, {
        okButton: 'Save Colors',
        cancelButton: 'Cancel',
        customClass: 'stcm_custom-color-edit-popup'
    }).then(res => {
        if (res !== POPUP_RESULT.AFFIRMATIVE) return;
        tag.color  = currBg;
        tag.color2 = currFg;
        flushExtSettings();
        renderTagSection();
        renderCharacterList();
    });
}

/**
 * Adds .stcm_custom-color-edit-popup to any open popup that
 * contains one of our ToolCool colour–pickers.  Makes the picker
 * dropdown overflow visible so the user can interact with it.
 */
(function installColourPickerPopupObserver () {
    // One observer for the whole doc is enough
    const observer = new MutationObserver(mutations => {
        for (const m of mutations) {
            // Check every element that got *added*
            m.addedNodes.forEach(n => {
                if (!(n instanceof HTMLElement)) return;

                // 1) if the added node **is** a popup-body, check it directly
                // 2) otherwise, look inside it for any popup-bodies
                const bodies = n.matches('dialog.popup[open] .popup-body')
                    ? [n]
                    : Array.from(n.querySelectorAll('dialog.popup[open] .popup-body'));

                bodies.forEach(body => {
                    // Add the class only once and only if a picker is present
                    if (
                        !body.classList.contains('stcm_custom-color-edit-popup') &&
                        body.querySelector(
                            '.newTagBgPicker, .newTagFgPicker, .editTagBgPicker, .editTagFgPicker'
                        )
                    ) {
                        body.classList.add('stcm_custom-color-edit-popup');

                        //
                        // ✨ OPTIONAL CLEAN-UP ✨
                        // When the dialog closes, remove the class again
                        //
                        body.closest('dialog.popup')?.addEventListener(
                            'close',
                            () => body.classList.remove('stcm_custom-color-edit-popup'),
                            { once: true }
                        );
                    }
                });
            });
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();

// ──────────────────────────────────────────────────────────────────────────
// Deletion snapshot + undo helpers (module-private)
// ──────────────────────────────────────────────────────────────────────────

let lastTagDeletionUndo = null; // { createdAt, items: [{ tag:{...}, charIds:[...] }] }

function cloneTagForRestore(t) {
    return {
        id: t.id,
        name: t.name,
        color: t.color,
        color2: t.color2,
        folder_type: t.folder_type || 'NONE',
    };
}

function buildTagDeletionSnapshot(tagIds) {
    const mapEntries = Object.entries(tag_map);
    const items = tagIds.map(tid => {
        const tag = tags.find(t => t.id === tid);
        if (!tag) return null;
        const charIds = mapEntries
            .filter(([_, arr]) => Array.isArray(arr) && arr.includes(tid))
            .map(([cid]) => cid);
        return { tag: cloneTagForRestore(tag), charIds };
    }).filter(Boolean);

    return { createdAt: new Date().toISOString(), items };
}

async function showUndoDeletionPopup(snapshot) {
    // Build a compact summary list
    const listHtml = snapshot.items.map(it =>
        `<li><strong>${escapeHtml(it.tag.name)}</strong> &nbsp;<small>(${it.charIds.length} assigned)</small></li>`
    ).join('');

    const html = document.createElement('div');
    html.innerHTML = `
        <h3>Tags deleted</h3>
        <p>You can undo this action to restore the tag(s) and re-apply them to all previously tagged characters.</p>
        <ul style="margin-left:1.2em">${listHtml}</ul>
        <p><small>Snapshot: ${escapeHtml(snapshot.createdAt)}</small></p>
    `;

    const res = await callGenericPopup(html, POPUP_TYPE.CONFIRM, 'Undo tag deletion?', {
        okButton: 'Undo',
        cancelButton: 'Close'
    });

    if (res === POPUP_RESULT.AFFIRMATIVE) {
        await undoTagDeletion(snapshot);
    }
}

async function undoTagDeletion(snapshot) {
    // 1) Restore missing tags
    snapshot.items.forEach(({ tag }) => {
        if (!tags.some(t => t.id === tag.id)) {
            tags.push({ ...tag });
        }
    });

    // 2) Re-apply tag id to all captured entities
    snapshot.items.forEach(({ tag, charIds }) => {
        charIds.forEach(cid => {
            if (!tag_map[cid]) tag_map[cid] = [];
            if (!tag_map[cid].includes(tag.id)) tag_map[cid].push(tag.id);
        });
    });

    await callSaveandReload();
    renderTagSection();
    renderCharacterList();
    toastr.success(`Restored ${snapshot.items.length} tag${snapshot.items.length > 1 ? 's' : ''} and re-applied assignments.`);
}


// ---------------------------------------------------------------------------
// tag deletion (single)
// ---------------------------------------------------------------------------
function confirmDeleteTag(tag) {
    // Build snapshot before deletion so we can undo later
    const snapshot = buildTagDeletionSnapshot([tag.id]);

    // Pretty confirm with count
    const assignedCount = snapshot.items[0]?.charIds?.length || 0;
    const html = document.createElement('div');
    html.innerHTML = `
      <h3>Confirm Delete</h3>
      <p>Delete tag <strong>${escapeHtml(tag.name)}</strong> and remove it from all characters?</p>
      <p><small>Currently assigned to ${assignedCount} item${assignedCount === 1 ? '' : 's'}.</small></p>
      <p style="color:#e57373;">This cannot be undone (unless you click Undo in the next step).</p>`;

    callGenericPopup(html, POPUP_TYPE.CONFIRM, 'Delete Tag')
      .then(async res => {
        if (res !== POPUP_RESULT.AFFIRMATIVE) return;

        // Perform deletion
        Object.values(tag_map).forEach(arr => {
            if (Array.isArray(arr)) {
                const idx = arr.indexOf(tag.id);
                if (idx !== -1) arr.splice(idx, 1);
            }
        });
        const i = tags.findIndex(t => t.id === tag.id);
        if (i !== -1) tags.splice(i, 1);

        await callSaveandReload();
        renderTagSection();
        renderCharacterList();

        // Save undo snapshot and offer Undo
        lastTagDeletionUndo = snapshot;
        toastr.success('Tag deleted.');
        showUndoDeletionPopup(lastTagDeletionUndo);
      });
}


// ---------------------------------------------------------------------------
// Bulk edit helper functions
// ---------------------------------------------------------------------------

/**
 * Get all character IDs that match the currently selected tags
 * based on the bulkEditMatchMode ('any' or 'all')
 */
function getCharactersMatchingSelectedTags() {
    if (selectedBulkDeleteTags.size === 0) return [];

    const selectedTagIds = [...selectedBulkDeleteTags];
    const allCharIds = Object.keys(tag_map);

    return allCharIds.filter(charId => {
        const charTags = tag_map[charId] || [];
        if (bulkEditMatchMode === 'all') {
            // Character must have ALL selected tags
            return selectedTagIds.every(tid => charTags.includes(tid));
        } else {
            // Character must have ANY selected tag
            return selectedTagIds.some(tid => charTags.includes(tid));
        }
    });
}

/**
 * Add a tag to all characters matching the selected tags
 */
async function bulkAddTagToMatchingCharacters(tagId) {
    const matchingChars = getCharactersMatchingSelectedTags();
    if (matchingChars.length === 0) {
        toastr.warning('No characters match the selected tags.', 'Bulk Edit');
        return;
    }

    const tag = tags.find(t => t.id === tagId);
    const tagName = tag?.name || 'Unknown';

    let addedCount = 0;
    matchingChars.forEach(charId => {
        if (!tag_map[charId]) tag_map[charId] = [];
        if (!tag_map[charId].includes(tagId)) {
            tag_map[charId].push(tagId);
            addedCount++;
        }
    });

    await callSaveandReload();
    toastr.success(`Added "${tagName}" to ${addedCount} character(s).`, 'Bulk Edit');
    renderTagSection();
    renderCharacterList();
}

/**
 * Remove a tag from all characters matching the selected tags
 */
async function bulkRemoveTagFromMatchingCharacters(tagId) {
    const matchingChars = getCharactersMatchingSelectedTags();
    if (matchingChars.length === 0) {
        toastr.warning('No characters match the selected tags.', 'Bulk Edit');
        return;
    }

    const tag = tags.find(t => t.id === tagId);
    const tagName = tag?.name || 'Unknown';

    let removedCount = 0;
    matchingChars.forEach(charId => {
        if (!tag_map[charId]) return;
        const idx = tag_map[charId].indexOf(tagId);
        if (idx !== -1) {
            tag_map[charId].splice(idx, 1);
            removedCount++;
        }
    });

    await callSaveandReload();
    toastr.success(`Removed "${tagName}" from ${removedCount} character(s).`, 'Bulk Edit');
    renderTagSection();
    renderCharacterList();
}

/**
 * Handle creating a new tag and adding it to matching characters
 */
async function handleNewTagInput() {
    const addSelect = document.getElementById('bulkAddTagSelect');
    if (!addSelect) return;

    // Replace dropdown with input field
    const wrapper = addSelect.parentElement;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'menu_input';
    input.placeholder = 'New tag name...';
    input.style.width = '150px';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'stcm_menu_button small interactable';
    cancelBtn.textContent = '✕';
    cancelBtn.title = 'Cancel';
    cancelBtn.style.marginLeft = '4px';

    const container = document.createElement('span');
    container.className = 'stcm_new_tag_input_wrapper';
    container.appendChild(input);
    container.appendChild(cancelBtn);

    wrapper.replaceChild(container, addSelect);
    input.focus();

    const cleanup = () => {
        wrapper.replaceChild(addSelect, container);
        addSelect.value = '';
        populateBulkEditDropdowns();
    };

    cancelBtn.addEventListener('click', cleanup);

    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Escape') {
            cleanup();
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            const newName = input.value.trim();
            if (!newName) {
                cleanup();
                return;
            }

            // Check if tag already exists
            const existing = tags.find(t => t.name.toLowerCase() === newName.toLowerCase());
            if (existing) {
                toastr.warning(`Tag "${newName}" already exists.`, 'Bulk Edit');
                cleanup();
                return;
            }

            // Create the new tag
            const styles = getComputedStyle(document.body);
            const defaultBg = styles.getPropertyValue('--SmartThemeShadowColor')?.trim() || '#cccccc';
            const defaultFg = styles.getPropertyValue('--SmartThemeBodyColor')?.trim() || '#000000';

            const newTag = {
                id: uuidv4(),
                name: newName,
                color: defaultBg,
                color2: defaultFg,
                folder_type: 'NONE',
            };
            tags.push(newTag);

            // Add to matching characters
            const matchingChars = getCharactersMatchingSelectedTags();
            if (matchingChars.length > 0) {
                matchingChars.forEach(charId => {
                    if (!tag_map[charId]) tag_map[charId] = [];
                    if (!tag_map[charId].includes(newTag.id)) {
                        tag_map[charId].push(newTag.id);
                    }
                });
                toastr.success(`Created "${newName}" and added to ${matchingChars.length} character(s).`, 'Bulk Edit');
            } else {
                toastr.success(`Created tag "${newName}".`, 'Bulk Edit');
            }

            await callSaveandReload();
            cleanup();
            renderTagSection();
            renderCharacterList();
        }
    });

    input.addEventListener('blur', (e) => {
        // Only cleanup if we're not clicking the cancel button
        if (e.relatedTarget !== cancelBtn) {
            // Delay to allow enter key to process
            setTimeout(() => {
                if (document.contains(container)) {
                    cleanup();
                }
            }, 150);
        }
    });
}

/**
 * Populate the bulk edit Add and Remove dropdowns
 * - Add dropdown: all existing tags
 * - Remove dropdown: only tags present on characters matching selected tags
 */
export function populateBulkEditDropdowns() {
    const addSelect = document.getElementById('bulkAddTagSelect');
    const removeSelect = document.getElementById('bulkRemoveTagSelect');

    if (!addSelect || !removeSelect) return;

    // Build sorted tag list
    const sortedTags = [...tags].sort((a, b) => a.name.localeCompare(b.name));

    // Populate Add dropdown with all tags
    addSelect.innerHTML = `
        <option value="">+ Add tag...</option>
        <option value="__new__">Create new tag...</option>
    `;
    sortedTags.forEach(tag => {
        const opt = document.createElement('option');
        opt.value = tag.id;
        opt.textContent = tag.name;
        addSelect.appendChild(opt);
    });

    // Populate Remove dropdown with only tags on matching characters
    const matchingChars = getCharactersMatchingSelectedTags();

    // Collect all tag IDs present on matching characters
    const tagsOnMatchingChars = new Set();
    matchingChars.forEach(charId => {
        const charTags = tag_map[charId] || [];
        charTags.forEach(tid => tagsOnMatchingChars.add(tid));
    });

    // Filter to only tags that exist on matching characters
    const removableTags = sortedTags.filter(tag => tagsOnMatchingChars.has(tag.id));

    removeSelect.innerHTML = `<option value="">- Remove tag...</option>`;
    if (removableTags.length === 0 && selectedBulkDeleteTags.size > 0) {
        const opt = document.createElement('option');
        opt.disabled = true;
        opt.textContent = '(no tags to remove)';
        removeSelect.appendChild(opt);
    } else {
        removableTags.forEach(tag => {
            const opt = document.createElement('option');
            opt.value = tag.id;
            opt.textContent = tag.name;
            removeSelect.appendChild(opt);
        });
    }
}

// ---------------------------------------------------------------------------
// PUBLIC 2: attachTagSectionListeners  (one-time, after modal DOM is present)
// ---------------------------------------------------------------------------
export function attachTagSectionListeners(modalRoot) {
    // search / sort inputs
    modalRoot.querySelector('#tagSortMode')
        ?.addEventListener('change', renderTagSection);
    modalRoot.querySelector('#tagSearchInput')
        ?.addEventListener('input', debounce(renderTagSection, 180));

    // create-tag button
    modalRoot.querySelector('#createNewTagBtn')
        ?.addEventListener('click', promptCreateTag);

    // ─────────────────────────────────────────────────────────────────────
    // Bulk edit controls: All/Any radio, Add dropdown, Remove dropdown
    // ─────────────────────────────────────────────────────────────────────

    // All/Any radio buttons
    modalRoot.querySelectorAll('input[name="bulkEditMatch"]').forEach(radio => {
        radio.addEventListener('change', () => {
            bulkEditMatchMode = radio.value;
            populateBulkEditDropdowns(); // Update Remove dropdown for new match mode
        });
    });

    // Add tag dropdown
    const addSelect = modalRoot.querySelector('#bulkAddTagSelect');
    addSelect?.addEventListener('change', async () => {
        const val = addSelect.value;
        if (!val) return;

        if (val === '__new__') {
            handleNewTagInput();
            return;
        }

        if (selectedBulkDeleteTags.size === 0) {
            toastr.warning('Please select at least one tag to match characters.', 'Bulk Edit');
            addSelect.value = '';
            return;
        }

        await bulkAddTagToMatchingCharacters(val);
        addSelect.value = '';
    });

    // Remove tag dropdown
    const removeSelect = modalRoot.querySelector('#bulkRemoveTagSelect');
    removeSelect?.addEventListener('change', async () => {
        const val = removeSelect.value;
        if (!val) return;

        if (selectedBulkDeleteTags.size === 0) {
            toastr.warning('Please select at least one tag to match characters.', 'Bulk Edit');
            removeSelect.value = '';
            return;
        }

        await bulkRemoveTagFromMatchingCharacters(val);
        removeSelect.value = '';
    });

    // merge / bulk-delete buttons -----------------------------

    const mergeBtn = modalRoot.querySelector('#startMergeTags');
    mergeBtn?.addEventListener('click', async () => {
        if (!isMergeMode) {
            // first click → enter merge mode
            isMergeMode = true;
            selectedMergeTags.clear();
            selectedPrimaryTagId = null;
            mergeBtn.textContent = 'Merge Now';
            modalRoot.querySelector('#cancelMergeTags').style.display = '';
            renderTagSection();
            renderCharacterList();
        } else {
            // second click → do the merge
            await performMerge(modalRoot);
        }
    });


    modalRoot.querySelector('#cancelMergeTags')
        ?.addEventListener('click', () => { isMergeMode = false;
            selectedMergeTags.clear(); selectedPrimaryTagId = null;
            modalRoot.querySelector('#startMergeTags').textContent = 'Merge Tags';
            modalRoot.querySelector('#cancelMergeTags').style.display = 'none';
            renderTagSection();
        });

    modalRoot.querySelector('#startBulkDeleteTags')
        ?.addEventListener('click', () => { isBulkDeleteMode = true;
            selectedBulkDeleteTags.clear();
            bulkDeleteCursor = null;
            modalRoot.querySelector('#cancelBulkDeleteTags').style.display = '';
            modalRoot.querySelector('#confirmBulkDeleteTags').style.display = '';
            modalRoot.querySelector('#startBulkDeleteTags').style.display = 'none';
            renderTagSection();
        });

    modalRoot.querySelector('#cancelBulkDeleteTags')
        ?.addEventListener('click', () => { isBulkDeleteMode = false;
            selectedBulkDeleteTags.clear();
            bulkDeleteCursor = null;
            modalRoot.querySelector('#cancelBulkDeleteTags').style.display = 'none';
            modalRoot.querySelector('#confirmBulkDeleteTags').style.display = 'none';
            modalRoot.querySelector('#startBulkDeleteTags').style.display = '';
            renderTagSection();
        });

        // confirm bulk-delete (with Undo)
        modalRoot.querySelector('#confirmBulkDeleteTags')
            ?.addEventListener('click', async () => {
                if (!selectedBulkDeleteTags.size) {
                    toastr.warning('No tags selected'); return;
                }

                const toDelete = tags.filter(t => selectedBulkDeleteTags.has(t.id));
                const snapshot = buildTagDeletionSnapshot(toDelete.map(t => t.id));

                const listHtml = toDelete.map(t => `<li>${escapeHtml(t.name)}</li>`).join('');
                const html = document.createElement('div');
                html.innerHTML = `
                    <h3>Bulk delete</h3>
                    <p>Delete the following ${toDelete.length} tag${toDelete.length>1?'s':''} and remove them from all characters?</p>
                    <ul style="margin-left:1.2em">${listHtml}</ul>
                    <p style="color:#e57373;">This cannot be undone (unless you click Undo in the next step).</p>
                `;
                const res = await callGenericPopup(html, POPUP_TYPE.CONFIRM, 'Bulk delete tags');
                if (res !== POPUP_RESULT.AFFIRMATIVE) return;

                // Perform deletion
                snapshot.items.forEach(({ tag }) => {
                    Object.values(tag_map).forEach(arr => {
                        if (!Array.isArray(arr)) return;
                        const idx = arr.indexOf(tag.id);
                        if (idx !== -1) arr.splice(idx, 1);
                    });
                    const i = tags.findIndex(t => t.id === tag.id);
                    if (i !== -1) tags.splice(i, 1);
                });

                isBulkDeleteMode = false;
                selectedBulkDeleteTags.clear();
                bulkDeleteCursor = null;
                modalRoot.querySelector('#cancelBulkDeleteTags').style.display = 'none';
                modalRoot.querySelector('#confirmBulkDeleteTags').style.display = 'none';
                modalRoot.querySelector('#startBulkDeleteTags').style.display = '';

                await callSaveandReload();
                renderTagSection();
                renderCharacterList();

                // Store + offer Undo
                lastTagDeletionUndo = snapshot;
                toastr.success(`Deleted ${snapshot.items.length} tag${snapshot.items.length>1?'s':''}.`);
                showUndoDeletionPopup(lastTagDeletionUndo);
            });


    // ---------------------------------------------------------------------
    // assign-tag chip search (lives under Characters accordion but tag logic)
    // ---------------------------------------------------------------------
    modalRoot.querySelector('#assignTagSearchInput')
        ?.addEventListener('input', debounce(populateAssignTagSelect, 180));
    populateAssignTagSelect();   // initial chips
}

// ---------------------------------------------------------------------------
// assign-tag chips row logic (shared with Characters section)
// ---------------------------------------------------------------------------
export function populateAssignTagSelect() {
    const listDiv   = document.getElementById('assignTagList');
    const searchVal = (document.getElementById('assignTagSearchInput')?.value || '').toLowerCase();
    if (!listDiv) return;

    const terms = searchVal.split(',').map(t => t.trim()).filter(Boolean);
    listDiv.innerHTML = '';

    tags.filter(t => {
        if (!terms.length) return true;
        return terms.some(term => t.name.toLowerCase().includes(term));
    }).sort((a, b) => a.name.localeCompare(b.name))
      .forEach(tag => {
        const chip = document.createElement('div');
        chip.className = 'stcm_tag_chip';
        chip.textContent = tag.name;
        chip.style.background = (tag.color  && tag.color  !== '#') ? tag.color  : '#333';
        chip.style.color      = (tag.color2 && tag.color2 !== '#') ? tag.color2 : '#fff';
        if (selectedTagIds.has(tag.id)) chip.classList.add('selected');
        chip.onclick = () => {
            if (selectedTagIds.has(tag.id)) selectedTagIds.delete(tag.id);
            else                            selectedTagIds.add(tag.id);
            chip.classList.toggle('selected');
            updateAssignBarVisibility();
            renderCharacterList();
        };
        listDiv.appendChild(chip);
    });

    updateAssignBarVisibility();
}

function updateAssignBarVisibility() {
    const bar = document.getElementById('assignTagsBar');
    if (!bar) return;
    const show = stcmCharState.isBulkDeleteCharMode || selectedTagIds.size > 0;
    bar.style.display = show ? 'block' : 'none';
    // update individual checkboxes in character list on the fly
    document.querySelectorAll('.assignCharCheckbox').forEach(cb => {
        cb.style.display = show ? 'inline-block' : 'none';
    });
}

// ---------------------------------------------------------------------------
// bulk helpers used by the Characters accordion when user clicks “Assign Tags”
// ---------------------------------------------------------------------------
export async function assignSelectedTagsTo(selectedCharIds) {
    if (!selectedTagIds.size || !selectedCharIds.length) {
        toastr.warning('Select at least one tag and one character');
        return false;
    }
    selectedCharIds.forEach(cid => {
        tag_map[cid] ||= [];
        selectedTagIds.forEach(tid => {
            if (!tag_map[cid].includes(tid)) tag_map[cid].push(tid);
        });
    });
    await callSaveandReload();
    toastr.success(`Assigned ${selectedTagIds.size} tag(s)`);
    selectedTagIds.clear();
    populateAssignTagSelect();
    renderCharacterList();
    return true;
}

// === helper ===
async function performMerge(modalRoot) {
    const primaryId = selectedPrimaryTagId;
    const mergeIds  = [...selectedMergeTags];

    if (!primaryId || mergeIds.length === 0) {
        toastr.warning('Select one primary and at least one tag to merge.','Merge Tags');
        return;
    }
    if (mergeIds.includes(primaryId)) {
        toastr.error('Primary tag cannot also be marked for merge.','Merge Tags');
        return;
    }

    // --- confirmation popup -------------------------------------------------
    const tagNames = tags.reduce((m,t)=> (m[t.id]=t.name,m), {});
    const html = document.createElement('div');
    html.innerHTML = `
        <h3>Merge Tags</h3>
        <p>Primary: <strong>${escapeHtml(tagNames[primaryId])}</strong></p>
        <p>Merging:</p>
        <ul style="margin-left:1.2em">${mergeIds.map(id=>`<li>${escapeHtml(tagNames[id])}</li>`).join('')}</ul>
        <p style="color:#e57373">This cannot be undone.</p>`;
    const res = await callGenericPopup(html, POPUP_TYPE.CONFIRM, 'Merge tags?');
    if (res !== POPUP_RESULT.AFFIRMATIVE) return;   // user cancelled

    // --- 1) rewrite tag_map -----------------------------------------------
    Object.values(tag_map).forEach(arr => {
        if (!Array.isArray(arr)) return;
        let changed = false;
        mergeIds.forEach(id => {
            const idx = arr.indexOf(id);
            if (idx !== -1) { arr.splice(idx,1); changed = true; }
        });
        if (changed && !arr.includes(primaryId)) arr.push(primaryId);
    });

    // --- 2) remove merged tags from master list ---------------------------
    mergeIds.forEach(id => {
        const i = tags.findIndex(t=>t.id===id);
        if (i!==-1) tags.splice(i,1);
    });

    toastr.success(`Merged ${mergeIds.length} tag${mergeIds.length>1?'s':''}.`);

    // --- 3) reset UI & persist --------------------------------------------
    isMergeMode = false;
    selectedMergeTags.clear();
    selectedPrimaryTagId = null;
    modalRoot.querySelector('#startMergeTags').textContent = 'Merge Tags';
    modalRoot.querySelector('#cancelMergeTags').style.display = 'none';

    await callSaveandReload();
    renderTagSection();
    renderCharacterList();
}


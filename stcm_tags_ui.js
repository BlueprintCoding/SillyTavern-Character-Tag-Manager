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
    // 4. render
    // ---------------------------------------------------------------------
    content.innerHTML = '';
    const frag = document.createDocumentFragment();

    tagGroups.forEach(group => frag.appendChild(renderSingleTag(group)));
    content.appendChild(frag);

    // wire bulk-delete & merge checkboxes AFTER list is in the DOM --------
    if (isBulkDeleteMode) {
        content.querySelectorAll('.bulkDeleteTagCheckbox').forEach(cb => {
            cb.checked = selectedBulkDeleteTags.has(cb.value);
            cb.addEventListener('change', () => {
                cb.checked ? selectedBulkDeleteTags.add(cb.value)
                           : selectedBulkDeleteTags.delete(cb.value);
            });
        });
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

    accountStorage.setItem('SelectedNavTab', 'rm_button_characters');
}

// ---------------------------------------------------------------------------
// helper: render one <div class="tagGroup">
// ---------------------------------------------------------------------------
function renderSingleTag({ tag, charIds }) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tagGroup';

    const header = document.createElement('div');
    header.className = 'tagGroupHeader';

    // prettier color defaults
    const rawBg = String(tag.color || '').trim();
    const rawFg = String(tag.color2 || '').trim();
    const bg = (rawBg && rawBg !== '#') ? rawBg : '#333';
    const fg = (rawFg && rawFg !== '#') ? rawFg : '#fff';

    header.innerHTML = `
        <span class="tagNameEditable" data-id="${tag.id}">
            ${isBulkDeleteMode
                ? `<input type="checkbox" class="bulkDeleteTagCheckbox" value="${tag.id}" style="margin-right:7px;">`
                : `<i class="fa-solid fa-pen editTagIcon" style="cursor:pointer;margin-right:6px;" title="Edit name"></i>`
            }
            <strong class="tagNameText stcm-color-swatch"
                    style="background:${bg};color:${fg};padding:2px 6px;border-radius:4px;cursor:pointer;"
                    title="Click to edit colors">
                ${escapeHtml(tag.name)} <i class="fa-solid fa-palette" style="margin-left:6px;"></i>
            </strong>
        </span>
        <span class="tagCharCount">(${charIds.length})</span>
        ${isMergeMode ? `
           <div class="stcm_merge_controls">
               <label><input type="radio" name="mergePrimary" value="${tag.id}"> Primary</label>
               <label><input type="checkbox" class="mergeCheckbox" value="${tag.id}"> Merge</label>
           </div>` : ''}
    `;

    // ─────────────────────────────────────────────────────────────────────
    // Tag Type / Folder-Type row
    // ─────────────────────────────────────────────────────────────────────

    // Build dropdown using your own builder function (to keep logic DRY)
    const folderDropdownWrapper = buildFolderTypeDropdown(tag);

    const folderWrapper = document.createElement('div');
    folderWrapper.className = 'stcm_folder_type_row';
    folderWrapper.style.display = 'flex';
    folderWrapper.style.alignItems = 'center';
    folderWrapper.style.gap = '0.5em';
    folderWrapper.style.marginLeft = '20px';

    // Label with icon
    const folderLabel = document.createElement('span');
    folderLabel.innerHTML = `<i class="fa-solid fa-folder" style="margin-right: 4px;"></i>Tag Type:`;
    folderLabel.style.fontWeight = 'bold';
    folderLabel.style.whiteSpace = 'nowrap';
    folderLabel.title = "Choose how this tag behaves as a folder";

    // Append label and dropdown to wrapper
    folderWrapper.appendChild(folderLabel);
    folderWrapper.appendChild(folderDropdownWrapper);

    // Convert to Real Folder button
    const convertBtn = document.createElement('button');
    convertBtn.className = 'stcm_menu_button tiny interactable';
    convertBtn.textContent = 'Convert to Real Folder';
    convertBtn.title = 'Create a real folder with this tag’s settings';
    convertBtn.style.marginLeft = '6px';
    convertBtn.addEventListener('click', () => {
        // Be sure you have this method in your stcmFolders API!
        import('./stcm_folders.js').then(mod => {
            mod.convertTagToRealFolder && mod.convertTagToRealFolder(tag);
        });
    });
    folderWrapper.appendChild(convertBtn);

    // Info icon for Tag Folders
    const infoIcon = document.createElement('i');
    infoIcon.className = 'fa-solid fa-circle-info stcm_folder_info_icon';
    infoIcon.title = 'About folders';
    infoIcon.style.marginLeft = '6px';
    infoIcon.style.cursor = 'pointer';
    infoIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        // You must define showFolderInfoPopup or import it.
        if (typeof showFolderInfoPopup === 'function') showFolderInfoPopup(infoIcon);
        else alert("This would show folder info help.");
    });
    folderWrapper.appendChild(infoIcon);

    header.appendChild(folderWrapper);

    // ---------------------------------------------------------------------
    // action buttons: Characters / Notes / Delete
    // ---------------------------------------------------------------------
    const actionBar = document.createElement('div');
    actionBar.className = 'tagActionButtons';

    // Characters
    const charBtn = document.createElement('button');
    charBtn.textContent = 'Characters';
    charBtn.className = 'stcm_menu_button stcm_view_btn interactable';
    charBtn.onclick = () => toggleCharacterList(wrapper, { tag, charIds });
    actionBar.appendChild(charBtn);

    // Notes
    const noteBtn = document.createElement('button');
    noteBtn.textContent = 'Notes';
    noteBtn.className = 'stcm_menu_button charNotesToggle small interactable';

    const noteWrap = buildNotesWrapper(tag.id);
    noteBtn.onclick = () => {
        const open = noteWrap.style.display === 'flex';
        noteWrap.style.display = open ? 'none' : 'flex';
        noteBtn.textContent  = open ? 'Notes' : 'Close Notes';
        noteBtn.style.background = open ? '' : '#8e6529';
    };
    actionBar.appendChild(noteBtn);

    // Delete
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.className = 'stcm_menu_button interactable red';
    delBtn.onclick = () => confirmDeleteTag(tag);
    actionBar.appendChild(delBtn);

    header.appendChild(actionBar);
    wrapper.appendChild(header);
    wrapper.appendChild(noteWrap);

    // ---------------------------------------------------------------------
    // bind listeners that need actual elements
    // ---------------------------------------------------------------------
    // edit name
    header.querySelectorAll('.editTagIcon').forEach(icon => {
        icon.addEventListener('click', () => startInlineRename(icon, tag.id));
    });
    // color picker
    header.querySelector('.stcm-color-swatch')?.addEventListener('click', () =>
        openColorEditModal(tag)
    );

    return wrapper;
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
            id: crypto.randomUUID(),
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


// ---------------------------------------------------------------------------
// tag deletion
// ---------------------------------------------------------------------------
function confirmDeleteTag(tag) {
    const html = document.createElement('div');
    html.innerHTML = `
      <h3>Confirm Delete</h3>
      <p>Delete tag <strong>${escapeHtml(tag.name)}</strong> and remove it from all characters?</p>
      <p style="color:#e57373;">This cannot be undone.</p>`;

    callGenericPopup(html, POPUP_TYPE.CONFIRM, 'Delete Tag')
      .then(res => {
        if (res !== POPUP_RESULT.AFFIRMATIVE) return;
        // strip from tag_map
        Object.values(tag_map).forEach(arr => {
            if (Array.isArray(arr)) {
                const idx = arr.indexOf(tag.id);
                if (idx !== -1) arr.splice(idx, 1);
            }
        });
        // remove from master list
        const i = tags.findIndex(t => t.id === tag.id);
        if (i !== -1) tags.splice(i, 1);

        callSaveandReload();
        renderTagSection();
        renderCharacterList();
        toastr.success('Tag deleted');
      });
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
            modalRoot.querySelector('#cancelBulkDeleteTags').style.display = '';
            modalRoot.querySelector('#confirmBulkDeleteTags').style.display = '';
            modalRoot.querySelector('#startBulkDeleteTags').style.display = 'none';
            renderTagSection();
        });

    modalRoot.querySelector('#cancelBulkDeleteTags')
        ?.addEventListener('click', () => { isBulkDeleteMode = false;
            selectedBulkDeleteTags.clear();
            modalRoot.querySelector('#cancelBulkDeleteTags').style.display = 'none';
            modalRoot.querySelector('#confirmBulkDeleteTags').style.display = 'none';
            modalRoot.querySelector('#startBulkDeleteTags').style.display = '';
            renderTagSection();
        });

    // confirm bulk-delete
    modalRoot.querySelector('#confirmBulkDeleteTags')
        ?.addEventListener('click', async () => {
            if (!selectedBulkDeleteTags.size) {
                toastr.warning('No tags selected'); return;
            }
            const names = tags.filter(t => selectedBulkDeleteTags.has(t.id))
                              .map(t => escapeHtml(t.name)).join('<br>');
            const html = document.createElement('div');
            html.innerHTML = `<h3>Bulk delete</h3><p>Delete these tags?</p><pre>${names}</pre>`;
            const res = await callGenericPopup(html, POPUP_TYPE.CONFIRM, 'Bulk delete tags');
            if (res !== POPUP_RESULT.AFFIRMATIVE) return;

            // perform deletion
            selectedBulkDeleteTags.forEach(tid => {
                Object.values(tag_map).forEach(arr => {
                    if (Array.isArray(arr)) {
                        const idx = arr.indexOf(tid);
                        if (idx !== -1) arr.splice(idx, 1);
                    }
                });
                const i = tags.findIndex(t => t.id === tid);
                if (i !== -1) tags.splice(i, 1);
            });
            isBulkDeleteMode = false;
            selectedBulkDeleteTags.clear();
            modalRoot.querySelector('#cancelBulkDeleteTags').style.display = 'none';
            modalRoot.querySelector('#confirmBulkDeleteTags').style.display = 'none';
            modalRoot.querySelector('#startBulkDeleteTags').style.display = '';
            callSaveandReload();
            renderTagSection();
            renderCharacterList();
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


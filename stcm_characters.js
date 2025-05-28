import { tags, tag_map, removeTagFromEntity } from "../../../tags.js";
import { characters, saveSettingsDebounced } from "../../../../script.js";
import { groups, getGroupAvatar } from "../../../../scripts/group-chats.js";
import { POPUP_RESULT, POPUP_TYPE, callGenericPopup } from "../../../popup.js";
import { renderCharacterTagData, resetModalScrollPositions } from "./index.js";
import { uploadFileAttachment, getFileAttachment } from '../../../chats.js';


(async () => {
    await restoreNotesFromFile();  // Only runs if not already cached
    renderCharacterList();         // After loading notes
})();

let persistDebounceTimer;
function debouncePersist() {
    clearTimeout(persistDebounceTimer);
    persistDebounceTimer = setTimeout(persistNotesToFile, 500);
}


async function persistNotesToFile() {
    const raw = getNotes();
    const notes = {
        charNotes: Object.fromEntries(Object.entries(raw.charNotes || {}).filter(([_, v]) => v.trim() !== '')),
        tagNotes: Object.fromEntries(Object.entries(raw.tagNotes || {}).filter(([_, v]) => v.trim() !== '')),
    };

    const json = JSON.stringify(notes, null, 2);
    const base64 = window.btoa(unescape(encodeURIComponent(json)));

    const fileUrl = await uploadFileAttachment('stcm-notes.json', base64);
    if (fileUrl) {
        localStorage.setItem('stcm_notes_url', fileUrl);
        localStorage.setItem('stcm_notes_cache', JSON.stringify(notes));
    }
}

function getNotes() {
    try {
        const data = JSON.parse(localStorage.getItem('stcm_notes_cache') || '{}');
        return {
            charNotes: data.charNotes || {},
            tagNotes: data.tagNotes || {},
        };
    } catch {
        return { charNotes: {}, tagNotes: {} };
    }
}


async function restoreNotesFromFile() {
    const fileUrl = localStorage.getItem('stcm_notes_url');
    if (!fileUrl) return;

    try {
        const content = await getFileAttachment(fileUrl);
        const parsed = JSON.parse(content);
        localStorage.setItem('stcm_notes_cache', JSON.stringify(parsed));
    } catch (e) {
        console.error('Failed to restore notes from file', e);
        toastr.error('Could not read ST Character and Tag notes file.');
    }
}


function saveNotes(notes) {
    localStorage.setItem('stcm_notes_cache', JSON.stringify(notes));
}


const selectedCharacterIds = new Set();

function buildTagMap() {
    return new Map(tags.map(tag => [tag.id, tag]));
}

function buildCharNameMap() {
    return new Map(characters.map(char => [char.avatar, char.name]));
}

function renderCharacterList() {
    const container = document.getElementById('characterListContainer');
    if (!container) return;

    const tagMapById = buildTagMap();

    const selectedTagIds = Array.from(document.getElementById('assignTagSelect')?.selectedOptions || []).map(opt => opt.value);
    const selectedTagsDisplay = document.getElementById('selectedTagsDisplay');
    selectedTagsDisplay.innerHTML = '';

    if (selectedTagIds.length > 0) {
        const tagMapById = buildTagMap();
        selectedTagIds.forEach(tagId => {
            const tag = tagMapById.get(tagId);
            if (!tag) return;

            const tagEl = document.createElement('span');
            tagEl.className = 'selectedTagBox';
            tagEl.textContent = tag.name;

            selectedTagsDisplay.appendChild(tagEl);
        });
    }

    const showCheckboxes = selectedTagIds.length > 0;
    document.getElementById('assignTagsBar').style.display = showCheckboxes ? 'block' : 'none';

    const searchTerm = document.getElementById('charSearchInput')?.value.toLowerCase() || '';
    const sortMode = document.getElementById('charSortMode')?.value || 'alpha_asc';

    const allEntities = [
        ...characters.map(c => ({ type: 'character', id: c.avatar, name: c.name, avatar: c.avatar })),
        ...groups.map(g => ({ type: 'group', id: g.id, name: g.name, avatar: g.avatar }))
    ];

    allEntities.forEach(entity => {
        entity.tagCount = Array.isArray(tag_map[entity.id]) ? tag_map[entity.id].length : 0;
    });

    const filtered = allEntities.filter(e => {
        const lowerSearch = searchTerm.toLowerCase();

        if (lowerSearch.startsWith('a:')) {
            const rawQuery = lowerSearch.slice(2).trim();
            const charObj = characters.find(c => c.avatar === e.id);
            if (charObj) {
                return Object.values(charObj).some(val =>
                    typeof val === 'string' && val.toLowerCase().includes(rawQuery)
                );
            }
            return false;
        }

        if (lowerSearch.startsWith('t:')) {
            const rawQuery = lowerSearch.slice(2).trim();
            const tagIds = tag_map[e.id] || [];
            return tagIds.some(tagId => {
                const tag = tagMapById.get(tagId);
                return tag?.name.toLowerCase().includes(rawQuery);
            });
        }

        return e.name.toLowerCase().includes(lowerSearch);
    });

    const visible = sortMode === 'only_zero'
        ? filtered.filter(e => e.tagCount === 0)
        : filtered;

    visible.sort((a, b) => {
        switch (sortMode) {
            case 'alpha_asc': return a.name.localeCompare(b.name);
            case 'alpha_desc': return b.name.localeCompare(a.name);
            case 'tag_count_desc': return b.tagCount - a.tagCount;
            case 'tag_count_asc': return a.tagCount - b.tagCount;
            default: return 0;
        }
    });

    container.innerHTML = '';
    if (visible.length === 0) {
        container.innerHTML = `<div>No characters or groups found.</div>`;
        return;
    }

    const list = document.createElement('ul');
    list.className = 'charList';

    visible.forEach(entity => {
        const li = document.createElement('li');
        li.classList.add('charListItemWrapper'); // optional class for spacing
    
        const metaWrapper = document.createElement('div');
        metaWrapper.className = 'charMeta stcm_flex_row_between';
    
        // === Left side ===
        const leftSide = document.createElement('div');
        leftSide.className = 'charLeftSide';
    
        const img = document.createElement('img');
        img.className = 'stcm_avatar_thumb';
        img.alt = entity.name;
        img.src = entity.avatar ? `/characters/${entity.avatar}` : 'img/ai4.png';
        img.onerror = () => img.src = 'img/ai4.png';
        leftSide.appendChild(img);
    
        const rightContent = document.createElement('div');
        rightContent.className = 'charMetaRight';
    
        const nameRow = document.createElement('div');
        nameRow.className = 'charNameRow';
    
        const label = document.createElement('label');
        label.className = 'customCheckboxWrapper';
    
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'assignCharCheckbox';
        checkbox.value = entity.id;
        checkbox.checked = selectedCharacterIds.has(entity.id);
        checkbox.style.display = showCheckboxes ? 'inline-block' : 'none';
    
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                selectedCharacterIds.add(entity.id);
            } else {
                selectedCharacterIds.delete(entity.id);
            }
        });
    
        const checkmark = document.createElement('span');
        checkmark.className = 'customCheckbox';
    
        label.appendChild(checkbox);
        label.appendChild(checkmark);
        nameRow.appendChild(label);
    
        const nameSpan = document.createElement('span');
        nameSpan.className = 'charName';
        nameSpan.textContent = `${entity.name} (${entity.tagCount} tag${entity.tagCount !== 1 ? 's' : ''})`;
        nameRow.appendChild(nameSpan);
    
        // Notes button
        const notes = getNotes();
        const currentNote = notes.charNotes[entity.id] || '';
    
        const noteBtn = document.createElement('button');
        noteBtn.className = 'stcm_menu_button small charNotesToggle';
        noteBtn.textContent = 'Notes';
        noteBtn.title = 'View or edit notes';
        noteBtn.style.marginLeft = '8px';
    
        nameRow.appendChild(noteBtn);
        rightContent.appendChild(nameRow);
    
        // Note editor wrapper
        const noteWrapper = document.createElement('div');
        noteWrapper.className = 'charNotesWrapper';
        noteWrapper.style.display = 'none';
    
        const textarea = document.createElement('textarea');
        textarea.className = 'charNoteTextarea';
        textarea.placeholder = 'Add character notes...';
        textarea.value = currentNote;
    
        const saveBtn = document.createElement('button');
        saveBtn.className = 'stcm_menu_button stcm_save_note_btn small';
        saveBtn.textContent = 'Save Note';
    
        saveBtn.addEventListener('click', async () => {
            const updated = getNotes();
            updated.charNotes[entity.id] = textarea.value.trim();
            saveNotes(updated);
            debouncePersist();
            toastr.success(`Saved note for ${entity.name}`);
        });
    
        noteBtn.addEventListener('click', () => {
            const isOpen = noteWrapper.style.display === 'flex';
            noteWrapper.style.display = isOpen ? 'none' : 'flex';
            noteBtn.textContent = isOpen ? 'Notes' : 'Close Notes';
            noteBtn.style.background = isOpen ? '' : 'rgb(169, 122, 50)';
        });
    
        noteWrapper.appendChild(textarea);
        noteWrapper.appendChild(saveBtn);
        rightContent.appendChild(noteWrapper);
    
        const excerpt = (characters.find(c => c.avatar === entity.id)?.description || '')
            .slice(0, 500).trim() + '…';
    
        const excerptSpan = document.createElement('span');
        excerptSpan.className = 'charExcerpt';
        excerptSpan.textContent = excerpt;
    
        rightContent.appendChild(excerptSpan);
    
        const tagListWrapper = document.createElement('div');
        tagListWrapper.className = 'assignedTagsWrapper';
    
        const tagMapById = buildTagMap();
        const assignedTags = tag_map[entity.id] || [];
        assignedTags.forEach(tagId => {
            const tag = tagMapById.get(tagId);
            if (!tag) return;
    
            const tagBox = document.createElement('span');
            tagBox.className = 'tagBox';
            tagBox.textContent = tag.name;
    
            const removeBtn = document.createElement('span');
            removeBtn.className = 'removeTagBtn';
            removeBtn.textContent = ' ✕';
            removeBtn.addEventListener('click', () => {
                removeTagFromEntity(tag, entity.id);
                saveSettingsDebounced();
                renderCharacterList();
                renderCharacterTagData();
            });
    
            tagBox.appendChild(removeBtn);
            tagListWrapper.appendChild(tagBox);
        });
    
        rightContent.appendChild(tagListWrapper);
        leftSide.appendChild(rightContent);
        metaWrapper.appendChild(leftSide);
    
        // === Right Controls ===
        const rightControls = document.createElement('div');
        rightControls.className = 'charRowRightFixed';
    
        const deleteIcon = document.createElement('i');
        deleteIcon.className = 'fa-solid fa-trash interactable stcm_delete_icon';
        deleteIcon.title = 'Delete Character';
    
        deleteIcon.addEventListener('click', async () => {
            const confirmed = await callGenericPopup(
                `Are you sure you want to permanently delete <strong>${entity.name}</strong>?`,
                POPUP_TYPE.CONFIRM,
                'Delete Character'
            );
            if (confirmed !== POPUP_RESULT.AFFIRMATIVE) return;
    
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
                return;
            }
    
            const idx = characters.findIndex(c => c.avatar === entity.id);
            if (idx !== -1) {
                const char = characters.splice(idx, 1)[0];
                delete tag_map[char.avatar];
                SillyTavern.getContext().eventSource.emit(SillyTavern.getContext().event_types.CHARACTER_DELETED, char);
            }
    
            toastr.error(`Character "${entity.name}" permanently deleted.`, 'Delete Successful');
            saveSettingsDebounced();
            renderCharacterList();
            renderCharacterTagData();
        });
    
        rightControls.appendChild(deleteIcon);
        metaWrapper.appendChild(rightControls);
        li.appendChild(metaWrapper);
        list.appendChild(li);
    });
    
    
    container.appendChild(list);    
}

function toggleCharacterList(container, group) {
    const existingList = container.querySelector('.charList');
    const toggleBtn = container.querySelector('.stcm_view_btn');

    if (existingList) {
        existingList.remove();
        if (toggleBtn) {
            toggleBtn.textContent = 'Characters';
            toggleBtn.classList.remove('active');
        }
        return;
    }

    const list = document.createElement('ul');
    list.className = 'charList';

    group.charIds.forEach(charId => {
        let entity = characters.find(c => c.avatar === charId);
        let isGroup = false;

        if (!entity && typeof groups !== 'undefined') {
            entity = groups.find(g => g.id === charId);
            isGroup = !!entity;
        }

        const name = entity?.name || (isGroup ? `Group ${charId}` : `Character ${charId}`);
        const li = document.createElement('li');

        const metaWrapper = document.createElement('div');
        metaWrapper.className = 'charMeta stcm_flex_row';

        const img = document.createElement('img');
        img.className = 'stcm_avatar_thumb';
        img.alt = name;

        if (isGroup && entity) {
            try {
                const avatarEl = getGroupAvatar(entity);
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = avatarEl[0]?.outerHTML || '';
                const thumb = tempDiv.querySelector('img');
                img.src = thumb?.src || 'img/ai4.png';
            } catch (e) {
                console.warn(`Error loading avatar for group ${entity?.name || charId}`, e);
                img.src = 'img/ai4.png';
            }
        } else {
            img.src = entity?.avatar ? `/characters/${entity.avatar}` : 'img/ai4.png';
        }

        img.onerror = () => {
            img.onerror = null;
            img.src = 'img/ai4.png';
        };

        const nameSpan = document.createElement('span');
        nameSpan.className = 'charName';
        nameSpan.textContent = name;

        metaWrapper.appendChild(img);
        metaWrapper.appendChild(nameSpan);

        const unassignBtn = document.createElement('button');
        unassignBtn.className = 'stcm_menu_button stcm_unassign interactable small';
        unassignBtn.textContent = 'Unassign';
        unassignBtn.addEventListener('click', () => {
            const tag = tags.find(t => t.id === group.tag.id);
            removeTagFromEntity(tag, charId);
        
            // Update in-memory group state
            group.charIds = group.charIds.filter(id => id !== charId);
        
            // Update DOM
            li.remove();
        
            // Update character count on the tag accordion
            const countSpan = container.querySelector('.tagGroupHeader .tagCharCount');
            if (countSpan) {
                countSpan.textContent = `(${group.charIds.length})`;
            }
        
            // 🔄 Save and Refresh both sections
            saveSettingsDebounced();
            renderCharacterList();
            renderCharacterTagData(); // imported from index.js
        });
        

        li.appendChild(metaWrapper);
        li.appendChild(unassignBtn);
        list.appendChild(li);
    });

    container.appendChild(list);

    if (toggleBtn) {
        toggleBtn.textContent = 'Close Characters';
        toggleBtn.classList.add('active');
    }
}

export {
    renderCharacterList,
    toggleCharacterList,
    buildTagMap,
    buildCharNameMap,
    selectedCharacterIds,
    getNotes,
    saveNotes,
    debouncePersist
};

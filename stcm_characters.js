//stcm_characters.js
import { debouncePersist,
    buildTagMap,
    getNotes,
    saveNotes,
    restoreNotesFromFile
 } from './utils.js';
import { tags, tag_map, removeTagFromEntity, searchCharByName, getTagKeyForEntity } from "../../../tags.js";
import { characters, setActiveCharacter } from "../../../../script.js";
import { groups, getGroupAvatar } from "../../../../scripts/group-chats.js";
import { POPUP_RESULT, POPUP_TYPE, callGenericPopup } from "../../../popup.js";
import { renderCharacterTagData, callSaveandReload } from "./index.js";
import { uploadFileAttachment, getFileAttachment } from '../../../chats.js';


(async () => {
    await restoreNotesFromFile();  // Only runs if not already cached
    renderCharacterList();         // After loading notes
})();

function parseSearchTerms(raw) {
    // Split on spaces, except within quotes
    const matches = raw.match(/(-?[AT]?:?"[^"]+"|-?[AT]?:?\S+)/g) || [];
    return matches.map(term => {
        let positive = true, field = 'name', value = term;
        if (value.startsWith('-')) {
            positive = false;
            value = value.slice(1);
        }
        if (value.toUpperCase().startsWith('A:')) {
            field = 'a';
            value = value.slice(2);
        } else if (value.toUpperCase().startsWith('T:')) {
            field = 't';
            value = value.slice(2);
        } else if (value.startsWith(':')) {
            // Edge: :foo is invalid, just treat as name
            value = value.slice(1);
        }
        // Remove quotes
        value = value.replace(/^"|"$/g, '').trim();
        return { positive, field, value: value.toLowerCase() };
    }).filter(t => t.value);
}

function searchCharByAvatar(avatarFilename, { suppressLogging = false } = {}) {
    const entity = characters.find(c => c.avatar === avatarFilename);
    // console.log("DEBUG SEARCHCHAR:", searchCharByName(entity)); // <-- Add this!
    console.log("DEBUG ENTITY:", getTagKeyForEntity(entity)); // <-- Add this!
    const key = entity && getTagKeyForEntity(entity);
    if (!key && !suppressLogging) toastr.warning(`Character with avatar ${avatarFilename} not found.`);
    return key;
}



function renderCharacterList() {
    const container = document.getElementById('characterListContainer');
    if (!container) return;

    const tagMapById = buildTagMap(tags);

    const selectedTagIds = Array.from(document.getElementById('assignTagSelect')?.selectedOptions || []).map(opt => opt.value);
    const selectedTagsDisplay = document.getElementById('selectedTagsDisplay');
    selectedTagsDisplay.innerHTML = '';

    if (selectedTagIds.length > 0) {
        const tagMapById = buildTagMap(tags);
        selectedTagIds.forEach(tagId => {
            const tag = tagMapById.get(tagId);
            if (!tag) return;

            const tagEl = document.createElement('span');
            tagEl.className = 'selectedTagBox';
            tagEl.textContent = tag.name;

            selectedTagsDisplay.appendChild(tagEl);
        });
    }

    const showCheckboxes = stcmCharState.isBulkDeleteCharMode || selectedTagIds.length > 0;

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

    const rawInput = document.getElementById('charSearchInput')?.value || '';
    const searchTerms = parseSearchTerms(rawInput);
    
    const filterEntity = (entity) => {
        const charObj = characters.find(c => c.avatar === entity.id);
        const tagIds = tag_map[entity.id] || [];
        const tagNames = tagIds.map(tagId => (tagMapById.get(tagId)?.name?.toLowerCase() || ""));
        const allFields = charObj ? Object.values(charObj).filter(v => typeof v === 'string').join(' ').toLowerCase() : '';
        const name = entity.name.toLowerCase();
    
        for (const term of searchTerms) {
            let match = false;
            if (term.field === 'a') {
                match = allFields.includes(term.value);
            } else if (term.field === 't') {
                match = tagNames.some(tagName => tagName.includes(term.value));
            } else { // default: name
                match = name.includes(term.value);
            }
            if (term.positive && !match) return false;
            if (!term.positive && match) return false;
        }
        return true;
    };
    
    const filtered = allEntities.filter(filterEntity);    

    const notes = getNotes();
    let visible = filtered;

    if (sortMode === 'only_zero') {
        visible = filtered.filter(e => e.tagCount === 0);
    } else if (sortMode === 'with_notes') {
        visible = filtered.filter(e =>
            (notes.charNotes[e.id] || '').trim().length > 0
        );
    } else if (sortMode === 'without_notes') {
        visible = filtered.filter(e =>
            !(notes.charNotes[e.id] || '').trim()
        );
    }

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
        li.classList.add('charListItemWrapper');
        if (entity.type === 'character') {
            li.setAttribute('data-avatar', entity.avatar); // for avatar-based lookup
            li.setAttribute('data-name', entity.name);     // optionally store name
        }
        

        const metaWrapper = document.createElement('div');
        metaWrapper.className = 'charMeta stcm_flex_row_between';

        // === Left side ===
        const leftSide = document.createElement('div');
        leftSide.className = 'charLeftSide';

        const img = document.createElement('img');
        img.className = 'stcm_avatar_thumb charActivate'; 
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
        checkbox.checked = stcmCharState.selectedCharacterIds.has(entity.id);
        checkbox.style.display = showCheckboxes ? 'inline-block' : 'none';

        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                stcmCharState.selectedCharacterIds.add(entity.id);
            } else {
                stcmCharState. selectedCharacterIds.delete(entity.id);
            }
        });

        const checkmark = document.createElement('span');
        checkmark.className = 'customCheckbox';

        label.appendChild(checkbox);
        label.appendChild(checkmark);
        nameRow.appendChild(label);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'charName charActivate'; // <-- add charActivate
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

        const tagMapById = buildTagMap(tags);
        const assignedTags = tag_map[entity.id] || [];
        assignedTags.forEach(tagId => {
            const tag = tagMapById.get(tagId);
            if (!tag) return;

            const tagBox = document.createElement('span');
            tagBox.className = 'tagBox';
            tagBox.textContent = tag.name;

            // PLACE THE COLOR FALLBACK LOGIC **HERE**:
            const defaultBg = '#333';
            const defaultFg = '#fff';

            // Use tag color if set, otherwise fallback
            const bgColor = (typeof tag.color === 'string' && tag.color.trim() && tag.color.trim() !== '#') ? tag.color.trim() : defaultBg;
            const fgColor = (typeof tag.color2 === 'string' && tag.color2.trim() && tag.color2.trim() !== '#') ? tag.color2.trim() : defaultFg;

            tagBox.style.backgroundColor = bgColor;
            tagBox.style.color = fgColor;

            // Remove button
            const removeBtn = document.createElement('span');
            removeBtn.className = 'removeTagBtn';
            removeBtn.textContent = ' ✕';
            removeBtn.addEventListener('click', () => {
                removeTagFromEntity(tag, entity.id);
                callSaveandReload();
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
            callSaveandReload();
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
        img.className = 'stcm_avatar_thumb charActivate';
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
        nameSpan.className = 'charName charActivate';
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
            callSaveandReload();
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

// name click listener
document.addEventListener('click', function(e) {
    const target = e.target;
    if (target.classList.contains('charActivate')) {
        const li = target.closest('.charListItemWrapper');
        if (li && li.closest('#characterListContainer')) {
            const avatar = li.getAttribute('data-avatar');
            const name = li.getAttribute('data-name');
            let charKey = null;
            if (avatar) {
                charKey = searchCharByAvatar(avatar);
                console.log('Avatar:', avatar, 'charKey from avatar:', charKey);
            } else if (name) {
                charKey = searchCharByName(name);
                console.log('Name:', name, 'charKey from name:', charKey);
            }
            if (charKey) {
                console.log('Activating character with key:', charKey);
                setActiveCharacter(charKey);
                if (typeof setActiveGroup === 'function') setActiveGroup(null);
                if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
            } else {
                console.warn('No charKey found!');
            }
        }
    }
});



export {
    renderCharacterList,
    toggleCharacterList
};

export const stcmCharState = {
    isBulkDeleteCharMode: false,
    selectedCharacterIds: new Set(),
};
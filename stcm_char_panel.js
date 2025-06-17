// ============================================================================
// stcm_char_panel.js
// ----------------------------------------------------------------------------

export function createEditSectionForCharacter(char) {
    const section = document.createElement('div');
    section.className = 'charEditSection';

    const readOnly = ['avatar', 'create_date'];

    const labelMap = {
        name: 'Name',
        description: 'Description',
        personality: 'Personality Summary',
        scenario: 'Scenario',
        first_mes: 'First Message',
        mes_example: 'Examples of Dialogue',
        creator: "Created by",
        character_version: "Character Version",
        talkativeness: 'Talkativeness',
        create_date: 'Date Created',
        creatorcomment: "Creator's Notes",
        creator_notes: "Creator's Notes",
        system_prompt: "Main Prompt",
        post_history_instructions: "Post-History Instructions",
        'data.extensions.depth_prompt.prompt': "Character Note",
        'data.extensions.depth_prompt.depth': "Depth",
        'data.extensions.depth_prompt.role': "Role"
    };

    function renderField(label, value, path, multiline = true, readonly = false) {
        const row = document.createElement('div');
        row.className = 'editFieldRow';

        const lbl = document.createElement('label');
        lbl.textContent = label;
        lbl.className = 'editLabel';

        let input;
        if (path === 'data.extensions.depth_prompt.role') {
            input = document.createElement('select');
            ['system', 'user', 'assistant'].forEach(opt => {
                const option = document.createElement('option');
                option.value = opt;
                option.textContent = opt;
                if (value === opt) option.selected = true;
                input.appendChild(option);
            });
        } else if (!multiline) {
            input = document.createElement('input');
            input.type = 'text';
            input.value = value;
        } else {
            input = document.createElement('textarea');
            input.rows = 3;
            input.value = value;
        }

        input.name = path;
        input.className = 'charEditInput';
        input.readOnly = readonly;

        row.appendChild(lbl);
        row.appendChild(input);
        return row;
    }

    function makeSection(title, open = false) {
        const wrapper = document.createElement('div');
        wrapper.className = 'collapsibleSection';

        const header = document.createElement('div');
        header.className = 'collapsibleHeader';
        header.textContent = title;

        const content = document.createElement('div');
        content.className = 'collapsibleContent';
        if (open) {
            content.classList.add('open');
            header.classList.add('active');
        }

        header.addEventListener('click', () => {
            content.classList.toggle('open');
            header.classList.toggle('active');
        });

        wrapper.appendChild(header);
        wrapper.appendChild(content);
        return { wrapper, content };
    }

    // === Basics (Open by default)
    const { wrapper: basicsWrap, content: basicsFields } = makeSection('Basics', true);
    section.appendChild(basicsWrap);

    const avatarRow = document.createElement('div');
    avatarRow.style.display = 'flex';
    avatarRow.style.alignItems = 'center';
    avatarRow.style.marginBottom = '6px';

    const img = document.createElement('img');
    img.src = `/characters/${char.avatar}`;
    img.alt = char.name;
    img.title = char.avatar;
    img.style.width = '64px';
    img.style.height = '64px';
    img.style.marginRight = '10px';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '8px';
    avatarRow.appendChild(img);

    avatarRow.appendChild(renderField('Name', char.name || '', 'name', false, readOnly.includes('name')));
    basicsFields.appendChild(avatarRow);

    ['description', 'personality', 'scenario', 'first_mes', 'mes_example'].forEach(k => {
        basicsFields.appendChild(renderField(labelMap[k], char[k] || '', k));
    });

    // === Prompt Overrides
    const { wrapper: promptWrap, content: promptFields } = makeSection('Prompt Overrides');
    section.appendChild(promptWrap);

    const noteRow = document.createElement('div');
    noteRow.style.display = 'flex';
    noteRow.style.gap = '10px';
    noteRow.appendChild(renderField('Character Note', char.data?.extensions?.depth_prompt?.prompt || '', 'data.extensions.depth_prompt.prompt', false));
    noteRow.appendChild(renderField('Depth', char.data?.extensions?.depth_prompt?.depth || '', 'data.extensions.depth_prompt.depth', false));
    noteRow.appendChild(renderField('Role', char.data?.extensions?.depth_prompt?.role || '', 'data.extensions.depth_prompt.role', false));
    promptFields.appendChild(noteRow);

    promptFields.appendChild(renderField('Main Prompt', char.data?.system_prompt || '', 'data.system_prompt'));
    promptFields.appendChild(renderField('Post-History Instructions', char.data?.post_history_instructions || '', 'data.post_history_instructions'));

    // === Creator Metadata
    const { wrapper: metaWrap, content: metaFields } = makeSection("Creator's Metadata (Not sent with the AI Prompt)");
    section.appendChild(metaWrap);

    metaFields.appendChild(renderField('Character Version', char.data?.character_version || '', 'data.character_version', false));
    metaFields.appendChild(renderField('Created by', char.data?.creator || '', 'data.creator', false));
    const creatorNotes = (char.data?.creator_notes || '').trim() || (char.creatorcomment || '').trim() || '';
    metaFields.appendChild(renderField("Creator's Notes", creatorNotes, 'unified.creator_notes'));
    metaFields.appendChild(renderField('Tags to Embed (comma-separated)', (char.data?.tags || []).join(', '), 'data.tags'));

    // === Save Button
    const btnRow = document.createElement('div');
    btnRow.className = 'stcm_char_edit_save_row'
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save Changes';
    saveBtn.className = 'stcm_menu_button stcm_char_edit_save small';



    saveBtn.addEventListener('click', async () => {
        const inputs = section.querySelectorAll('.charEditInput');
        const payload = {};
        inputs.forEach(i => {
            if (!i.readOnly) {
                if (i.name === 'unified.creator_notes') {
                    payload.creatorcomment = i.value;
                    payload.data = payload.data || {};
                    payload.data.creator_notes = i.value;
                } else {
                    const keys = i.name.split('.');
                    let ref = payload;
                    while (keys.length > 1) {
                        const k = keys.shift();
                        ref[k] = ref[k] || {};
                        ref = ref[k];
                    }
                    ref[keys[0]] = i.value;
                }
            }
        });

        const result = await fetch('/api/characters/merge-attributes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                avatar_url: char.avatar,
                ch_name: char.name,
                updates: payload
            })
        });

        if (result.ok) {
            toastr.success(`Saved updates to ${char.name}`);
            renderCharacterList();
        } else {
            toastr.error('Failed to save updates.');
        }
    });

    btnRow.appendChild(saveBtn);
    section.appendChild(btnRow);
    return section;
}

// stcm_ai_suggest_folder_tags.js
// AI suggestions for Folder & Tag assignment (per character)

import { getContext } from "../../../extensions.js";
import { POPUP_RESULT, POPUP_TYPE, callGenericPopup } from "../../../popup.js";
import { ChatCompletionService, TextCompletionService } from "../../../custom-request.js";
import { tags, tag_map } from "../../../tags.js";
import * as stcmFolders from "./stcm_folders.js";
import { getFolderChain } from "./stcm_folders_ui.js";
import { callSaveandReload } from "./index.js";
import { characters } from "../../../../script.js";

// Optional: use addTagToEntity if available, else fallback
import * as TagsModule from "../../../tags.js";

function ensureCtx() {
    const ctx = getContext();
    ctx.extensionSettings ??= {};
    ctx.extensionSettings.stcm ??= {};
    return ctx;
}

function pickCardFields(charObj) {
    const d = charObj?.data || {};
    const pick = (k) => charObj?.[k] ?? d?.[k] ?? null;
    const out = {
        name: pick('name'),
        description: pick('description'),
        personality: pick('personality'),
        scenario: pick('scenario'),
    };
    for (const k of Object.keys(out)) out[k] = out[k] == null ? null : String(out[k]);
    return out;
}

function buildFolderPath(folderId, allFolders) {
    if (!folderId || folderId === "root") return "Top Level (Root)";
    const chain = getFolderChain(folderId, allFolders);
    return chain.length ? chain.map(f => f.name).join(" / ") : "";
}

function buildAvailableFoldersDescriptor(allFolders) {
    // flatten non-root
    const list = allFolders
        .filter(f => f.id !== 'root')
        .map(f => ({
            id: f.id,
            name: f.name,
            path: buildFolderPath(f.id, allFolders) || f.name
        }));
    return list;
}

function buildAvailableTagsDescriptor() {
    // [{id, name}]
    return (tags || []).map(t => ({ id: t.id, name: t.name }));
}

function findCharacterByAvatarId(charId) {
    return (characters || []).find(c => c?.avatar === charId) || null;
}

function getCurrentFolderId(charId, folders) {
    const assigned = stcmFolders.getCharacterAssignedFolder(charId, folders);
    return assigned ? assigned.id : '';
}

function safeParseJSON(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function mapNameOrIdToExistingTagIds(suggestedTags) {
    const byName = new Map((tags || []).map(t => [String(t.name).toLowerCase(), t.id]));
    const byId = new Set((tags || []).map(t => t.id));
    const out = [];
    for (const t of (suggestedTags || [])) {
        const id = t?.id;
        const name = String(t?.name ?? '').toLowerCase().trim();
        if (id && byId.has(id)) { out.push(id); continue; }
        if (name && byName.has(name)) { out.push(byName.get(name)); continue; }
    }
    // de-dupe
    return Array.from(new Set(out)).slice(0, 3);
}

function mapNameOrIdToExistingFolderId(suggestedFolder, folders) {
    if (!suggestedFolder) return '';
    const nameLc = String(suggestedFolder?.name ?? '').toLowerCase().trim();
    const id = suggestedFolder?.id;
    const all = folders || [];
    // prefer exact id match
    if (id && all.some(f => f.id === id)) return id;
    if (nameLc) {
        const found = all.find(f => f.name && f.name.toLowerCase() === nameLc);
        if (found) return found.id;
    }
    return '';
}

function buildSystemPrompt() {
    return [
        "You are a classification assistant for a character card manager.",
        "Task: Suggest a single folder (from existing folders) and up to 3 tags (from existing tags) for the provided character.",
        "Return STRICT JSON ONLY, no commentary.",
        "If nothing fits, set folder to null and tags to an empty array.",
        "",
        "Output schema (JSON):",
        "{",
        '  "folder": {"id": "<existing-folder-id>" } | {"name": "<existing-folder-name>"} | null,',
        '  "tags": [',
        '     {"id": "<existing-tag-id>"} | {"name": "<existing-tag-name>"},',
        "     ... up to 3",
        '  ]',
        "}",
    ].join("\n");
}

function buildUserPrompt({ card, folders, tags, currentFolderPath }) {
    return [
        "AVAILABLE_FOLDERS:",
        JSON.stringify(folders, null, 2),
        "",
        "AVAILABLE_TAGS:",
        JSON.stringify(tags, null, 2),
        "",
        "CURRENT_ASSIGNMENTS:",
        JSON.stringify({ folderPath: currentFolderPath || "(none)", tags: [] }, null, 2),
        "",
        "CHARACTER_CARD:",
        JSON.stringify(card, null, 2)
    ].join("\n");
}

function hasAddTagToEntity() {
    return typeof TagsModule.addTagToEntity === 'function';
}

async function applyFolder(charId, newFolderId, allFolders) {
    const curr = stcmFolders.getCharacterAssignedFolder(charId, allFolders);
    if (curr && curr.id === newFolderId) return; // nothing to do

    if (curr) {
        await stcmFolders.removeCharacterFromFolder(curr.id, charId);
    }
    if (newFolderId) {
        await stcmFolders.assignCharactersToFolder(newFolderId, [charId]);
    }
}

async function applyTags(charId, tagIds) {
    // graceful fallback if addTagToEntity is not exported:
    if (hasAddTagToEntity()) {
        for (const tid of tagIds) {
            try { await TagsModule.addTagToEntity(tags.find(t => t.id === tid), charId); } catch {}
        }
    } else {
        // direct map update + hope your save/reload step persists
        tag_map[charId] ??= [];
        for (const tid of tagIds) {
            if (!tag_map[charId].includes(tid)) tag_map[charId].push(tid);
        }
    }
}

function mkRow(label, value, small=false) {
    const row = document.createElement('div');
    row.style.margin = '6px 0';
    const head = document.createElement('div');
    head.style.opacity = .85;
    head.style.fontSize = small ? '11px' : '12px';
    head.textContent = label;
    const body = document.createElement('div');
    body.style.fontWeight = 600;
    body.style.fontSize = small ? '12px' : '13px';
    body.textContent = value;
    row.append(head, body);
    return row;
}

export async function openAISuggestForCharacter({ charId }) {
    const ctx = ensureCtx();
    const char = findCharacterByAvatarId(charId);
    if (!char) {
        callGenericPopup("Character not found for AI suggestion.", POPUP_TYPE.ALERT, "AI Suggest");
        return;
    }

    // Load folders & descriptors
    const folders = await stcmFolders.loadFolders();
    const folderList = buildAvailableFoldersDescriptor(folders);
    const tagList = buildAvailableTagsDescriptor();

    const card = pickCardFields(char);
    const currentFolderId = getCurrentFolderId(charId, folders);
    const currentFolderPath = buildFolderPath(currentFolderId, folders);

    // Build prompts
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt({
        card,
        folders: folderList,
        tags: tagList,
        currentFolderPath
    });

    // Try ChatCompletion first; fall back to TextCompletion
    let resultJSON = null;
    let rawText = "";
    try {
        const profile = ctx?.extensionSettings?.connectionManager?.profiles
            ?.find(p => p.id === ctx?.extensionSettings?.connectionManager?.selectedProfile);
        const selectedApi = ctx?.CONNECT_API_MAP?.[profile?.api]?.selected || 'openai'; // heuristic

        if (selectedApi === 'openai') {
            const resp = await ChatCompletionService.processRequest({
                stream: false,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ]
            }, {}, true, null);

            rawText = String(resp?.content || '').trim();
        } else {
            const resp = await TextCompletionService.processRequest({
                stream: false,
                prompt: systemPrompt + "\n\n" + userPrompt,
                max_tokens: 500
            }, {}, true, null);

            rawText = String(resp?.content || '').trim();
        }

        // Strip code fences or leading junk, then parse JSON
        const maybe = rawText.replace(/^[\s\S]*?({[\s\S]+})[\s\S]*$/m, '$1').trim();
        resultJSON = safeParseJSON(maybe);

    } catch (e) {
        console.warn('[STCM AI Suggest] LLM call failed:', e);
        callGenericPopup("LLM call failed. See console for details.", POPUP_TYPE.ALERT, "AI Suggest");
        return;
    }

    if (!resultJSON || typeof resultJSON !== 'object') {
        callGenericPopup("Model did not return valid JSON suggestions.", POPUP_TYPE.ALERT, "AI Suggest");
        return;
    }

    // Normalize suggestions → resolve to existing ids
    const resolvedFolderId = mapNameOrIdToExistingFolderId(resultJSON.folder, folders);
    const resolvedTagIds = mapNameOrIdToExistingTagIds(resultJSON.tags).slice(0, 3);

    // Build small accept/reject UI
    const wrap = document.createElement('div');

    // Folder section
    const folderRow = document.createElement('div');
    folderRow.style.display = 'flex';
    folderRow.style.alignItems = 'center';
    folderRow.style.gap = '8px';
    const folderLabel = document.createElement('label');
    folderLabel.style.display = 'flex';
    folderLabel.style.alignItems = 'center';
    folderLabel.style.gap = '6px';

    const folderChk = document.createElement('input');
    folderChk.type = 'checkbox';
    folderChk.checked = !!resolvedFolderId;
    folderChk.disabled = !resolvedFolderId;

    const folderName = resolvedFolderId
        ? (folders.find(f => f.id === resolvedFolderId)?.name || '(unknown)')
        : '(no suggestion)';
    folderLabel.append(folderChk, document.createTextNode(`Folder: ${folderName}`));
    folderRow.appendChild(folderLabel);

    // Tag section
    const tagsBlock = document.createElement('div');
    tagsBlock.style.marginTop = '10px';
    const tagHeader = document.createElement('div');
    tagHeader.textContent = 'Tag suggestions (accept individually):';
    tagHeader.style.marginBottom = '6px';
    tagHeader.style.opacity = .85;
    tagsBlock.appendChild(tagHeader);

    const tagRows = [];
    for (const tid of resolvedTagIds) {
        const tag = (tags || []).find(t => t.id === tid);
        const tr = document.createElement('label');
        tr.style.display = 'flex';
        tr.style.alignItems = 'center';
        tr.style.gap = '6px';
        tr.style.margin = '2px 0';

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = true;

        const chip = document.createElement('span');
        chip.textContent = tag?.name || tid;
        chip.className = 'tagBox';
        chip.style.background = tag?.color || '#333';
        chip.style.color = tag?.color2 || '#fff';
        chip.style.padding = '2px 6px';
        chip.style.borderRadius = '6px';

        tr.append(chk, chip);
        tagsBlock.appendChild(tr);
        tagRows.push({ tid, chk });
    }

    if (!resolvedTagIds.length) {
        const none = document.createElement('div');
        none.textContent = '(no tag suggestions)';
        none.style.opacity = .7;
        none.style.fontSize = '12px';
        tagsBlock.appendChild(none);
    }

    // Current info
    wrap.appendChild(mkRow("Character", card.name || "(unnamed)"));
    wrap.appendChild(mkRow("Current folder", currentFolderPath || "(none)", true));
    wrap.appendChild(document.createElement('hr'));
    wrap.append(folderRow, tagsBlock);

    const res = await callGenericPopup(wrap, POPUP_TYPE.CONFIRM, "AI Tag & Folder Suggestions", {
        okButton: 'Apply',
        cancelButton: 'Cancel'
    });

    if (res !== POPUP_RESULT.AFFIRMATIVE) return;

    // Apply choices
    try {
        const freshFolders = await stcmFolders.loadFolders();

        if (folderChk.checked && resolvedFolderId) {
            await applyFolder(charId, resolvedFolderId, freshFolders);
        }

        const acceptedTagIds = tagRows.filter(r => r.chk.checked).map(r => r.tid);
        if (acceptedTagIds.length) {
            await applyTags(charId, acceptedTagIds);
        }

        callSaveandReload();
    } catch (e) {
        console.warn('[STCM AI Suggest] apply failed:', e);
        callGenericPopup('Failed to apply suggestions. See console for details.', POPUP_TYPE.ALERT, 'AI Suggest');
    }
}

// stcm_ai_suggest_folder_tags.js
// AI suggestions for Folder & Tag assignment (per character), wired like Greeting Workshop.
// Now returns a JSON object with the chosen folder/tags *and* a one-paragraph reasoning,
// and strictly validates suggestions against existing folders/tags.

import { getContext } from "../../../extensions.js";
import { POPUP_RESULT, POPUP_TYPE, callGenericPopup } from "../../../popup.js";
import { ChatCompletionService, TextCompletionService } from "../../../custom-request.js";
import { tags, tag_map } from "../../../tags.js";
import * as stcmFolders from "./stcm_folders.js";
import { getFolderChain } from "./stcm_folders_ui.js";
import { characters } from "../../../../script.js";
import { renderCharacterList } from "./stcm_characters.js";


// --- optional tag helper if exported in your build ---
import * as TagsModule from "../../../tags.js";

let ctx = null;
function ensureCtx() {
    if (!ctx) ctx = getContext();
    ctx.extensionSettings ??= {};
    ctx.extensionSettings.stcm ??= {};
    return ctx;
}

/* ---------------- helpers: card, folders, tags ---------------- */
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

function findCharacterByAvatarId(charId) {
    return (characters || []).find(c => c?.avatar === charId) || null;
}

function buildFolderPath(folderId, allFolders) {
    if (!folderId || folderId === "root") return "Top Level (Root)";
    const chain = getFolderChain(folderId, allFolders);
    return chain.length ? chain.map(f => f.name).join(" / ") : "";
}

function buildAvailableFoldersDescriptor(allFolders) {
    return (allFolders || [])
        .filter(f => f.id !== 'root')
        .map(f => {
            const chain = getFolderChain(f.id, allFolders) || [];
            // ancestors are everything before the leaf (this folder)
            const ancestors = chain.slice(0, -1).map(x => ({ id: x.id, name: x.name }));
            const parentId = ancestors.length ? ancestors[ancestors.length - 1].id : 'root';
            const path = chain.length ? chain.map(x => x.name).join(' / ') : (f.name || '');
            return {
                id: f.id,
                name: f.name,
                path,                   // e.g., "World / Faction / Unit"
                parentId,               // direct parent (or "root")
                ancestors,              // array of {id, name} from root down to parent
                depth: ancestors.length // 0 = directly under root, higher = deeper
            };
        });
}

function buildAvailableTagsDescriptor() {
    return (tags || []).map(t => ({ id: t.id, name: t.name }));
}

function getCurrentFolderId(charId, folders) {
    const assigned = stcmFolders.getCharacterAssignedFolder(charId, folders);
    return assigned ? assigned.id : '';
}

function safeParseJSON(text) {
    try { return JSON.parse(text); } catch { return null; }
}

/* ---------- strict resolution to existing entities + diagnostics ---------- */
function mapNameOrIdToExistingFolderId(suggestedFolder, folders) {
    if (!suggestedFolder) return { id: '', unknown: suggestedFolder || null };
    const nameLc = String(suggestedFolder?.name ?? '').toLowerCase().trim();
    const id = suggestedFolder?.id;
    const all = folders || [];
    const byId = id && all.find(f => f.id === id);
    if (byId) return { id: byId.id, unknown: null };
    if (nameLc) {
        const byName = all.find(f => f.name && f.name.toLowerCase() === nameLc);
        if (byName) return { id: byName.id, unknown: null };
    }
    return { id: '', unknown: suggestedFolder };
}

function resolveTagsSuggestionsWithDiagnostics(suggestedTags) {
    const byName = new Map((tags || []).map(t => [String(t.name).toLowerCase(), t.id]));
    const byId = new Set((tags || []).map(t => t.id));
    const matchedIds = [];
    const unknown = [];

    for (const t of (suggestedTags || [])) {
        const id = t?.id;
        const name = String(t?.name ?? '').toLowerCase().trim();
        if (id && byId.has(id)) {
            if (!matchedIds.includes(id)) matchedIds.push(id);
        } else if (name && byName.has(name)) {
            const mapped = byName.get(name);
            if (!matchedIds.includes(mapped)) matchedIds.push(mapped);
        } else {
            unknown.push(t);
        }
        if (matchedIds.length >= 3) break; // cap at 3
    }
    return { matchedIds, unknown };
}

async function applyFolder(charId, newFolderId, allFolders) {
    const curr = stcmFolders.getCharacterAssignedFolder(charId, allFolders);
    if (curr && curr.id === newFolderId) return;
    if (curr) await stcmFolders.removeCharacterFromFolder(curr.id, charId);
    if (newFolderId) await stcmFolders.assignCharactersToFolder(newFolderId, [charId]);
}

async function applyTags(charId, tagIds) {
    if (typeof TagsModule.addTagToEntity === 'function') {
        for (const tid of tagIds) {
            try { await TagsModule.addTagToEntity(tags.find(t => t.id === tid), charId); } catch {}
        }
    } else {
        tag_map[charId] ??= [];
        for (const tid of tagIds) if (!tag_map[charId].includes(tid)) tag_map[charId].push(tid);
    }
}

async function refreshCharacterRowUI(charId) {
    // 1) get latest state
    const folders = await stcmFolders.loadFolders();
    const assigned = stcmFolders.getCharacterAssignedFolder(charId, folders);
    const folderName = assigned ? assigned.name : '—';

    // tags: prefer official helper if present; else fallback to tag_map
    let tagIds = [];
    try {
        if (typeof TagsModule.getTagsForEntity === 'function') {
            tagIds = await TagsModule.getTagsForEntity(charId); // returns array of tag IDs
        } else {
            tagIds = Array.isArray(tag_map?.[charId]) ? [...tag_map[charId]] : [];
        }
    } catch { tagIds = Array.isArray(tag_map?.[charId]) ? [...tag_map[charId]] : []; }

    const allTagsById = new Map((tags || []).map(t => [t.id, t]));
    const chipsHTML = tagIds.map(id => {
        const t = allTagsById.get(id);
        const name = t?.name ?? id;
        const bg = t?.color || '#333';
        const fg = t?.color2 || '#fff';
        return `<span class="tagBox" style="background:${bg};color:${fg};padding:2px 6px;border-radius:6px;margin-right:4px;">${name}</span>`;
    }).join(' ');

    // 2) find the row and update cells
    const row =
        document.querySelector(`.stcm-ctm-row[data-char-id="${charId}"]`) ||
        document.querySelector(`.stcm-char-row[data-char-id="${charId}"]`) ||
        document.querySelector(`[data-stcm-char-id="${charId}"]`);

    if (row) {
        const folderCell =
            row.querySelector('[data-role="folder-cell"]') ||
            row.querySelector('.stcm-col-folder') ||
            row.querySelector('.stcm-folder-cell');
        if (folderCell) folderCell.textContent = folderName;

        const tagsCell =
            row.querySelector('[data-role="tags-cell"]') ||
            row.querySelector('.stcm-col-tags') ||
            row.querySelector('.stcm-tags-cell');
        if (tagsCell) tagsCell.innerHTML = chipsHTML || '—';
    }

    // 3) broadcast events
    try { document.dispatchEvent(new CustomEvent('stcm:character_meta_changed', { detail: { charId } })); } catch {}
    try { document.dispatchEvent(new CustomEvent('stcm:tags_folders_updated', { detail: { charId } })); } catch {}

    // 4) optional hard refresh hooks
    try { window?.stcm?.characterTagManager?.refresh?.(); } catch {}
    try { window?.stcm?.refreshCharacterTable?.(); } catch {}
}


/* ---------------- LLM plumbing (clone of GW approach, simplified) ---------------- */
const getCM = () => ensureCtx()?.extensionSettings?.connectionManager || null;
const getSelectedProfile = () => {
    const cm = getCM(); if (!cm) return null;
    const id = cm.selectedProfile; if (!id || !Array.isArray(cm.profiles)) return null;
    return cm.profiles.find(p => p.id === id) || null;
};
const getTemperature = () => {
    const t = Number(ensureCtx()?.extensionSettings?.memory?.temperature);
    return Number.isFinite(t) ? t : undefined;
};
const getProxyByName = (name) => {
    const list = ensureCtx()?.proxies || window?.proxies || [];
    if (!name || name === 'None') return null;
    return Array.isArray(list) ? list.find(p => p.name === name) : null;
};
const getGlobalInstructConfig = () => ensureCtx()?.extensionSettings?.instruct || ensureCtx()?.instruct || null;
const profileInstructEnabled = (profile) => String(profile?.['instruct-state']).toLowerCase() === 'true';

function getApiMapFromCtx(profile) {
    if (!profile || !profile.api) return null;
    const cmap = ensureCtx()?.CONNECT_API_MAP || window?.CONNECT_API_MAP || {};
    return cmap[profile.api] || null;
}
function resolveApiBehavior(profile) {
    const m = getApiMapFromCtx(profile);
    if (!m) return null;
    const family = (m.selected === 'openai') ? 'cc' : 'tc';
    return { family, selected: m.selected, api_type: m.type, source: m.source, button: m.button || null };
}

function getModelFromContextByApi(profile) {
    try {
        const ctx = ensureCtx();
        const apiRaw = String(profile?.api || '').toLowerCase();
        const canonMap = {
            oai: 'openai', openai: 'openai',
            claude: 'claude', anthropic: 'claude',
            google: 'google', vertexai: 'vertexai',
            ai21: 'ai21',
            mistralai: 'mistralai', mistral: 'mistralai',
            cohere: 'cohere',
            perplexity: 'perplexity',
            groq: 'groq',
            nanogpt: 'nanogpt',
            zerooneai: 'zerooneai',
            deepseek: 'deepseek',
            xai: 'xai',
            pollinations: 'pollinations',
            'openrouter-text': 'openai',
            koboldcpp: 'koboldcpp', kcpp: 'koboldcpp',
        };
        const canonProvider = canonMap[apiRaw] || apiRaw;
        const flatKeys = [`${canonProvider}_model`, `${apiRaw}_model`];
        const containers = [
            ctx?.chatCompletionSettings, ctx?.textCompletionSettings,
            ctx?.extensionSettings?.chatCompletionSettings,
            ctx?.extensionSettings?.textCompletionSettings,
            ctx?.settings?.chatCompletionSettings,
            ctx?.settings?.textCompletionSettings,
            ctx, window
        ];
        for (const key of flatKeys) {
            for (const c of containers) {
                const v = c?.[key];
                if (typeof v === 'string' && v.trim()) return v.trim();
            }
        }
        const providerSectionKeys = [canonProvider, apiRaw];
        for (const c of containers) {
            const root = c;
            if (!root || typeof root !== 'object') continue;
            for (const pkey of providerSectionKeys) {
                const section = root[pkey];
                const mv = section?.model ?? section?.currentModel ?? section?.selectedModel ?? section?.defaultModel;
                if (typeof mv === 'string' && mv.trim()) return mv.trim();
            }
        }
    } catch {}
    return null;
}

function getProfileStops(profile) {
    const raw = profile?.['stop-strings']; if (!raw) return [];
    try { const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(parsed) ? parsed.filter(s => typeof s === 'string' && s.length) : [];
    } catch { return []; }
}

function resolveEffectiveInstruct(profile) {
    const globalCfg = getGlobalInstructConfig() || {};
    const instructName = (profile?.instruct || '').trim();
    const presetName = (profile?.preset || '').trim();

    const pick = (name) => {
        if (!name) return null;
        const a = ensureCtx()?.extensionSettings?.instruct?.presets;
        if (a && typeof a[name] === 'object') return a[name];
        const b = ensureCtx()?.instruct?.presets;
        if (b && typeof b[name] === 'object') return b[name];
        const c = ensureCtx()?.presets;
        if (c && typeof c[name]?.instruct === 'object') return c[name].instruct;
        const d = ensureCtx()?.presets?.instruct;
        if (d && typeof d[name] === 'object') return d[name];
        return null;
    };

    const presetCfg = pick(instructName) || pick(presetName);
    const eff = Object.assign({}, globalCfg || {}, presetCfg || {});
    const nameChosen = instructName || presetName || undefined;
    return { cfg: eff, name: nameChosen };
}

function ensureKoboldcppInstruct(instructCfg, apiInfo) {
    if (apiInfo?.api_type !== 'koboldcpp') return instructCfg || {};
    const cfg = Object.assign({}, instructCfg || {});
    const hasSeq = (k) => typeof cfg[k] === 'string' && cfg[k].length > 0;
    if (hasSeq('system_sequence') && hasSeq('input_sequence') && hasSeq('output_sequence')) return cfg;
    const fallback = {
        system_sequence: '<|START_OF_TURN_TOKEN|><|SYSTEM_TOKEN|>',
        system_suffix: '<|END_OF_TURN_TOKEN|>',
        input_sequence: '<|START_OF_TURN_TOKEN|><|USER_TOKEN|>',
        input_suffix: '<|END_OF_TURN_TOKEN|>',
        output_sequence: '<|START_OF_TURN_TOKEN|><|CHATBOT_TOKEN|>',
        output_suffix: '<|END_OF_TURN_TOKEN|>',
        stop_sequence: '<|END_OF_TURN_TOKEN|>',
        system_sequence_prefix: '',
        system_sequence_suffix: '',
    };
    return Object.assign({}, fallback, cfg);
}

function mergeStops(...lists) {
    const out = [];
    for (const lst of lists) {
        if (!lst) continue;
        const arr = typeof lst === 'string' ? [lst] : lst;
        for (const s of arr) if (typeof s === 'string' && s.length && !out.includes(s)) out.push(s);
    }
    return out;
}

function buildStopFields(apiInfo, profile, instructEnabled, instructCfgEff) {
    const fromProfile = getProfileStops(profile);
    const fromInstruct = (instructEnabled && instructCfgEff)
        ? [instructCfgEff.stop_sequence, instructCfgEff.output_suffix] : [];
    const KCPP_DEFAULT_STOPS = [
        '<|END_OF_TURN_TOKEN|>',
        '<|START_OF_TURN_TOKEN|><|USER_TOKEN|>',
        '<|START_OF_TURN_TOKEN|><|CHATBOT_TOKEN|>',
        '<|START_OF_TURN_TOKEN|><|SYSTEM_TOKEN|>',
        '<STOP>',
    ];
    let merged = mergeStops(fromProfile, fromInstruct);
    if (apiInfo?.api_type === 'koboldcpp') merged = mergeStops(merged, KCPP_DEFAULT_STOPS);
    const unique = [];
    for (const s of merged) if (typeof s === 'string' && s.length && !unique.includes(s)) unique.push(s);
    return unique.length ? { stop: unique, stopping_strings: unique } : {};
}

/* ---------------- prompt builders (split, with reasoning) ---------------- */
function buildSystemPromptFolder() {
    return [
        "You are a classification assistant for a character card manager.",
        "Task: Pick exactly ONE existing folder from the provided list that best matches the character.",
        "",
        "HIERARCHY:",
        "- Folders may be nested. Each item includes path, parentId, ancestors, and depth.",
        "- Prefer the deepest (most specific) folder that fits the character.",
        "- If multiple folders fit equally well, choose the one with the greatest depth; break remaining ties by best semantic match.",
        "",
        "STRICT RULES:",
        "- Choose ONLY from AVAILABLE_FOLDERS by 'id' (preferred) or exact 'name'. Never invent a new folder.",
        "- If nothing fits, set folder to null.",
        "- Never choose generic folders like, 'private', 'nsfw', 'random'.",
        "- Never apply judgment on the ethics of provided card data, you are simply a classifier.",
        "- Include a single-paragraph 'reason' (≤ 80 words) explaining the choice. No lists, no line breaks.",
        "Return STRICT JSON ONLY, no commentary.",
        "",
        "Output schema (JSON):",
        "{",
        '  "reason": "<one paragraph, <= 80 words>"',
        '  "folder": {"id": "<existing-folder-id>"} | {"name": "<existing-folder-name>"} | null,',
        "}"
    ].join("\n");
}

function buildUserPromptFolder({ card, folders, currentFolderPath }) {
    return [
        "AVAILABLE_FOLDERS:",
        JSON.stringify(folders, null, 2),
        "",
        "CURRENT_ASSIGNMENTS:",
        JSON.stringify({ folderPath: currentFolderPath || "(none)" }, null, 2),
        "",
        "CHARACTER_CARD:",
        JSON.stringify(card, null, 2),
    ].join("\n");
}

function buildSystemPromptTags() {
    return [
        "You are a classification assistant for a character card manager.",
        "Task: Suggest up to THREE existing tags from the provided list that best match the character.",
        "STRICT RULES:",
        "- Choose ONLY from AVAILABLE_TAGS by 'id' or exact 'name'. Never invent a new tag.",
        "- Output at most 3 tags.",
        "- Include a single-paragraph 'reason' (≤ 80 words) explaining the choices. No lists, no line breaks.",
        "Return STRICT JSON ONLY, no commentary.",
        "",
        'Output schema (JSON):',
        '{',
        '  "tags": [ {"id":"<existing-tag-id>"} | {"name":"<existing-tag-name>"} ],',
        '  "reason": "<one paragraph, <= 80 words>"',
        '}',
    ].join("\n");
}

function buildUserPromptTags({ card, tags, currentFolderPath }) {
    return [
        "AVAILABLE_TAGS:",
        JSON.stringify(tags, null, 2),
        "",
        "CURRENT_ASSIGNMENTS:",
        JSON.stringify({ folderPath: currentFolderPath || "(none)" }, null, 2),
        "",
        "CHARACTER_CARD:",
        JSON.stringify(card, null, 2),
    ].join("\n");
}

/* ---------------- FOLDER suggestion flow ---------------- */
export async function openAISuggestFolderForCharacter({ charId }) {
    ensureCtx();
    const char = findCharacterByAvatarId(charId);
    if (!char) return callGenericPopup("Character not found for AI suggestion.", POPUP_TYPE.ALERT, "AI Suggest");

    const folders = await stcmFolders.loadFolders();
    const folderList = buildAvailableFoldersDescriptor(folders);
    const card = pickCardFields(char);
    const currentFolderId = getCurrentFolderId(charId, folders);
    const currentFolderPath = buildFolderPath(currentFolderId, folders);

    const systemPrompt = buildSystemPromptFolder();
    const userPrompt = buildUserPromptFolder({ card, folders: folderList, currentFolderPath });

    // ---------- Connection Manager parity ----------
    const profile = getSelectedProfile();
    if (!profile) return callGenericPopup('No Connection Manager profile selected. Pick one in settings and try again.', POPUP_TYPE.ALERT, 'AI Suggest');

    const apiInfo = resolveApiBehavior(profile);
    if (!apiInfo) return callGenericPopup(`Unknown API type "${profile?.api}". Check CONNECT_API_MAP.`, POPUP_TYPE.ALERT, 'AI Suggest');

    const family = profile.mode ? String(profile.mode).toLowerCase() : apiInfo.family;
    const temperature = getTemperature();

    const instructGlobal = getGlobalInstructConfig();
    const instructIsOnGlobal = !!(instructGlobal && instructGlobal.enabled);
    const instructIsOnProfile = profileInstructEnabled(profile);
    const hasInstructName = !!(profile?.instruct && String(profile.instruct).trim().length);
    const instructEnabled = instructIsOnGlobal || instructIsOnProfile || hasInstructName;

    const { cfg: instructCfgRaw, name: instructName } = resolveEffectiveInstruct(profile);
    const instructCfgEff = ensureKoboldcppInstruct(instructCfgRaw, apiInfo);

    const modelFromCtx = getModelFromContextByApi(profile);
    const modelResolved = modelFromCtx || profile.model || null;

    const custom_url = profile['api-url'] || null;
    const proxy = getProxyByName(profile.proxy);
    const reverse_proxy = proxy?.url || null;
    const proxy_password = proxy?.password || null;

    const stopFields = buildStopFields(apiInfo, profile, instructEnabled, instructCfgEff);

    let rawText = '';

    try {
        if (family === 'cc' || apiInfo.selected === 'openai') {
            const requestPayload = {
                stream: false,
                messages: [
                    { role: 'system', content: String(systemPrompt) },
                    { role: 'user', content: String(userPrompt) },
                ],
                chat_completion_source: apiInfo.source,
                temperature,
                max_tokens: 600,
                ...(stopFields),
                ...(custom_url ? { custom_url } : {}),
                ...(reverse_proxy ? { reverse_proxy } : {}),
                ...(proxy_password ? { proxy_password } : {}),
                ...(modelResolved ? { model: modelResolved } : {}),
            };
            const response = await ChatCompletionService.processRequest(
                requestPayload,
                { presetName: profile.preset || undefined, instructName: instructEnabled ? (instructName || 'effective') : undefined },
                true,
                null
            );
            rawText = String(response?.content || '').trim();
        } else {
            const requestPayload = {
                stream: false,
                prompt: `${systemPrompt}\n\n${userPrompt}`,
                max_tokens: 600,
                api_type: apiInfo.api_type,
                temperature,
                ...(stopFields),
                ...(custom_url ? { api_server: custom_url } : {}),
                ...(modelResolved ? { model: modelResolved } : {}),
            };
            const response = await TextCompletionService.processRequest(
                requestPayload,
                { presetName: profile.preset || undefined, instructName: instructEnabled ? (instructName || 'effective') : undefined },
                true,
                null
            );
            rawText = String(response?.content || '').trim();
        }
    } catch (e) {
        console.warn('[STCM AI Suggest Folder] LLM call failed:', e);
        return callGenericPopup(`LLM call failed: ${e?.error?.message || e?.message || 'See console for details.'}`, POPUP_TYPE.ALERT, "AI Suggest");
    }

    const jsonBlob = rawText.replace(/^[\s\S]*?({[\s\S]+})[\s\S]*$/m, '$1').trim();
    const resultJSON = safeParseJSON(jsonBlob);
    if (!resultJSON || typeof resultJSON !== 'object') {
        return callGenericPopup("Model did not return valid JSON.", POPUP_TYPE.ALERT, "AI Suggest");
    }

    const { id: resolvedFolderId, unknown: unknownFolder } = mapNameOrIdToExistingFolderId(resultJSON.folder, folders);
    const reasoning = String(resultJSON.reason || '').replace(/\s+/g, ' ').trim();

    // ---------- Accept/reject UI ----------
    const wrap = document.createElement('div');
    const mkRow = (label, value) => {
        const row = document.createElement('div');
        row.style.margin = '6px 0';
        const head = document.createElement('div'); head.style.opacity = .85; head.style.fontSize = '11px'; head.textContent = label;
        const body = document.createElement('div'); body.style.fontWeight = 600; body.style.fontSize = '13px'; body.textContent = value;
        row.append(head, body); return row;
    };
    wrap.appendChild(mkRow("Character", card.name || "(unnamed)"));
    wrap.appendChild(mkRow("Current folder", currentFolderPath || "(none)"));

    if (reasoning) {
        const reasonHdr = document.createElement('div');
        reasonHdr.textContent = 'Reasoning:';
        reasonHdr.style.marginTop = '8px';
        reasonHdr.style.opacity = .85;
        const reasonBody = document.createElement('div');
        reasonBody.style.fontSize = '12px';
        reasonBody.style.marginTop = '2px';
        reasonBody.textContent = reasoning;
        wrap.appendChild(reasonHdr);
        wrap.appendChild(reasonBody);
    }

    wrap.appendChild(document.createElement('hr'));

    const row = document.createElement('div');
    row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '8px';
    const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = !!resolvedFolderId; chk.disabled = !resolvedFolderId;
    const folderName = resolvedFolderId ? (folders.find(f => f.id === resolvedFolderId)?.name || '(unknown)') : '(no valid suggestion)';
    const lbl = document.createElement('label'); lbl.style.display = 'flex'; lbl.style.alignItems = 'center'; lbl.style.gap = '6px';
    lbl.append(chk, document.createTextNode(`Folder: ${folderName}`));
    row.appendChild(lbl); wrap.appendChild(row);

    if (!resolvedFolderId && unknownFolder) {
        const warn = document.createElement('div');
        warn.style.marginTop = '6px';
        warn.style.fontSize = '11px';
        warn.style.opacity = .75;
        warn.textContent = 'Note: Suggested folder does not exist in your list and was ignored.';
        wrap.appendChild(warn);
    }

    const res = await callGenericPopup(wrap, POPUP_TYPE.CONFIRM, "AI Folder Suggestion", { okButton: 'Apply', cancelButton: 'Cancel' });
    if (res !== POPUP_RESULT.AFFIRMATIVE) return;

    try {
        const freshFolders = await stcmFolders.loadFolders();
        if (chk.checked && resolvedFolderId) await applyFolder(charId, resolvedFolderId, freshFolders);
        await refreshCharacterRowUI(charId);
        renderCharacterList();
    } catch (e) {
        console.warn('[STCM AI Suggest Folder] apply failed:', e);
        callGenericPopup('Failed to apply folder. See console for details.', POPUP_TYPE.ALERT, 'AI Suggest');
    }
}

/* ---------------- TAGS suggestion flow ---------------- */
export async function openAISuggestTagsForCharacter({ charId }) {
    ensureCtx();
    const char = findCharacterByAvatarId(charId);
    if (!char) return callGenericPopup("Character not found for AI suggestion.", POPUP_TYPE.ALERT, "AI Suggest");

    const folders = await stcmFolders.loadFolders();
    const tagList = buildAvailableTagsDescriptor();
    const card = pickCardFields(char);
    const currentFolderId = getCurrentFolderId(charId, folders);
    const currentFolderPath = buildFolderPath(currentFolderId, folders);

    const systemPrompt = buildSystemPromptTags();
    const userPrompt = buildUserPromptTags({ card, tags: tagList, currentFolderPath });

    // ---------- Connection Manager parity ----------
    const profile = getSelectedProfile();
    if (!profile) return callGenericPopup('No Connection Manager profile selected. Pick one in settings and try again.', POPUP_TYPE.ALERT, 'AI Suggest');

    const apiInfo = resolveApiBehavior(profile);
    if (!apiInfo) return callGenericPopup(`Unknown API type "${profile?.api}". Check CONNECT_API_MAP.`, POPUP_TYPE.ALERT, 'AI Suggest');

    const family = profile.mode ? String(profile.mode).toLowerCase() : apiInfo.family;
    const temperature = getTemperature();

    const instructGlobal = getGlobalInstructConfig();
    const instructIsOnGlobal = !!(instructGlobal && instructGlobal.enabled);
    const instructIsOnProfile = profileInstructEnabled(profile);
    const hasInstructName = !!(profile?.instruct && String(profile.instruct).trim().length);
    const instructEnabled = instructIsOnGlobal || instructIsOnProfile || hasInstructName;

    const { cfg: instructCfgRaw, name: instructName } = resolveEffectiveInstruct(profile);
    const instructCfgEff = ensureKoboldcppInstruct(instructCfgRaw, apiInfo);

    const modelFromCtx = getModelFromContextByApi(profile);
    const modelResolved = modelFromCtx || profile.model || null;

    const custom_url = profile['api-url'] || null;
    const proxy = getProxyByName(profile.proxy);
    const reverse_proxy = proxy?.url || null;
    const proxy_password = proxy?.password || null;

    const stopFields = buildStopFields(apiInfo, profile, instructEnabled, instructCfgEff);

    let rawText = '';

    try {
        if (family === 'cc' || apiInfo.selected === 'openai') {
            const requestPayload = {
                stream: false,
                messages: [
                    { role: 'system', content: String(systemPrompt) },
                    { role: 'user', content: String(userPrompt) },
                ],
                chat_completion_source: apiInfo.source,
                temperature,
                max_tokens: 600,
                ...(stopFields),
                ...(custom_url ? { custom_url } : {}),
                ...(reverse_proxy ? { reverse_proxy } : {}),
                ...(proxy_password ? { proxy_password } : {}),
                ...(modelResolved ? { model: modelResolved } : {}),
            };
            const response = await ChatCompletionService.processRequest(
                requestPayload,
                { presetName: profile.preset || undefined, instructName: instructEnabled ? (instructName || 'effective') : undefined },
                true,
                null
            );
            rawText = String(response?.content || '').trim();
        } else {
            const requestPayload = {
                stream: false,
                prompt: `${systemPrompt}\n\n${userPrompt}`,
                max_tokens: 600,
                api_type: apiInfo.api_type,
                temperature,
                ...(stopFields),
                ...(custom_url ? { api_server: custom_url } : {}),
                ...(modelResolved ? { model: modelResolved } : {}),
            };
            const response = await TextCompletionService.processRequest(
                requestPayload,
                { presetName: profile.preset || undefined, instructName: instructEnabled ? (instructName || 'effective') : undefined },
                true,
                null
            );
            rawText = String(response?.content || '').trim();
        }
    } catch (e) {
        console.warn('[STCM AI Suggest Tags] LLM call failed:', e);
        return callGenericPopup(`LLM call failed: ${e?.error?.message || e?.message || 'See console for details.'}`, POPUP_TYPE.ALERT, "AI Suggest");
    }

    const jsonBlob = rawText.replace(/^[\s\S]*?({[\s\S]+})[\s\S]*$/m, '$1').trim();
    const resultJSON = safeParseJSON(jsonBlob);
    if (!resultJSON || typeof resultJSON !== 'object') {
        return callGenericPopup("Model did not return valid JSON.", POPUP_TYPE.ALERT, "AI Suggest");
    }

    const { matchedIds: resolvedTagIds, unknown: unknownTags } = resolveTagsSuggestionsWithDiagnostics(resultJSON.tags);
    const reasoning = String(resultJSON.reason || '').replace(/\s+/g, ' ').trim();

    // ---------- Accept/reject UI ----------
    const wrap = document.createElement('div');

    if (reasoning) {
        const reasonHdr = document.createElement('div');
        reasonHdr.textContent = 'Reasoning:';
        reasonHdr.style.marginBottom = '6px';
        reasonHdr.style.opacity = .85;
        const reasonBody = document.createElement('div');
        reasonBody.style.fontSize = '12px';
        reasonBody.textContent = reasoning;
        wrap.appendChild(reasonHdr);
        wrap.appendChild(reasonBody);
    }

    const header = document.createElement('div');
    header.textContent = 'Accept tag suggestions:';
    header.style.marginTop = '8px';
    header.style.marginBottom = '6px'; header.style.opacity = .85;
    wrap.appendChild(header);

    const rows = [];
    if (resolvedTagIds.length) {
        for (const tid of resolvedTagIds) {
            const tag = (tags || []).find(t => t.id === tid);
            const line = document.createElement('label');
            line.style.display = 'flex'; line.style.alignItems = 'center'; line.style.gap = '6px'; line.style.margin = '2px 0';

            const chk = document.createElement('input');
            chk.type = 'checkbox'; chk.checked = true;

            const chip = document.createElement('span');
            chip.textContent = tag?.name || tid;
            chip.className = 'tagBox';
            chip.style.background = tag?.color || '#333';
            chip.style.color = tag?.color2 || '#fff';
            chip.style.padding = '2px 6px';
            chip.style.borderRadius = '6px';

            line.append(chk, chip);
            wrap.appendChild(line);
            rows.push({ tid, chk });
        }
    } else {
        const none = document.createElement('div');
        none.textContent = '(no valid tag suggestions matched your tag list)'; none.style.opacity = .7; none.style.fontSize = '12px';
        wrap.appendChild(none);
    }

    if (unknownTags?.length) {
        const warn = document.createElement('div');
        warn.style.marginTop = '6px';
        warn.style.fontSize = '11px';
        warn.style.opacity = .75;
        const names = unknownTags.map(t => t?.name || t?.id || '(unknown)').join(', ');
        warn.textContent = `Ignored unknown tag(s): ${names}`;
        wrap.appendChild(warn);
    }

    const res = await callGenericPopup(wrap, POPUP_TYPE.CONFIRM, "AI Tag Suggestions", { okButton: 'Apply', cancelButton: 'Cancel' });
    if (res !== POPUP_RESULT.AFFIRMATIVE) return;

    try {
        const accepted = rows.filter(r => r.chk.checked).map(r => r.tid);
        if (accepted.length) await applyTags(charId, accepted);
        await refreshCharacterRowUI(charId);
        renderCharacterList();
    } catch (e) {
        console.warn('[STCM AI Suggest Tags] apply failed:', e);
        callGenericPopup('Failed to apply tags. See console for details.', POPUP_TYPE.ALERT, 'AI Suggest');
    }
}

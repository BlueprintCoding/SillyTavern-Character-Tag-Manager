// stcm_custom_greetings.js
// SillyTavern Character Manager – Custom Greeting Workshop
// Opens a mini chat with the active LLM to craft the first greeting,
// then replaces the starting message in the main chat on accept.

import { getContext } from "../../../extensions.js";
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from "../../../popup.js";
import {
    eventSource,
    messageFormatting,
    syncSwipeToMes,
    generateRaw as stGenerateRaw,
} from "../../../../script.js";
import { TextCompletionService, ChatCompletionService } from "../../../custom-request.js";



let ctx = null;
function ensureCtx() {
    if (!ctx) ctx = getContext();
    ctx.extensionSettings ??= {};
    ctx.extensionSettings.stcm ??= {};
}

// Persist per character so sessions don't collide
const STATE_KEY = () => {
    const id = (ctx?.characterId ?? 'global');
    return `stcm_gw_state_${id}`;
};

function saveSession() {
    try {
        const payload = {
            miniTurns,
            preferredScene,
        };
        localStorage.setItem(STATE_KEY(), JSON.stringify(payload));
    } catch { }
}

function loadSession() {
    try {
        const raw = localStorage.getItem(STATE_KEY());
        if (!raw) return { miniTurns: [], preferredScene: null };
        const parsed = JSON.parse(raw);
        return {
            miniTurns: Array.isArray(parsed?.miniTurns) ? parsed.miniTurns : [],
            preferredScene: parsed?.preferredScene ?? null,
        };
    } catch {
        return { miniTurns: [], preferredScene: null };
    }
}



// Store the user's preferred scene (if they star one)
let preferredScene = null; // { text: string, ts: string }
let preferredEls = null;   // { wrap: HTMLElement, bubble: HTMLElement }


// Build an optional block the LLM can use to preserve the liked scene
function buildPreferredSceneBlock() {
    if (!preferredScene || !preferredScene.text) return '';
    return [
        'The user liked your last message, keep it ≈90–95% the same and apply only the explicit edits from USER_INSTRUCTION.',
        '---',
        preferredScene.text,
        '---'
    ].join('\n');
}

function clearPreferredUI() {
    if (!preferredEls) return;
    const { bubble } = preferredEls;
    bubble.style.boxShadow = '';
    const oldBadge = bubble.querySelector('.gw-preferred-badge');
    if (oldBadge) oldBadge.remove();
    preferredEls = null;
}

function markPreferred(wrap, bubble, text) {
    // if clicking the same one again → toggle off
    if (preferredScene && preferredScene.ts === wrap.dataset.ts) {
        preferredScene = null;
        clearPreferredUI();
        return;
    }

    // new preferred → clear any previous one
    clearPreferredUI();

    preferredScene = { text, ts: wrap.dataset.ts };
    preferredEls = { wrap, bubble };

    bubble.style.boxShadow = '0 0 0 2px #ffd54f66';

    // create a single badge
    const badge = document.createElement('div');
    badge.className = 'gw-preferred-badge';
    badge.textContent = 'Preferred';
    Object.assign(badge.style, {
        position: 'absolute',
        left: '8px',
        bottom: '8px',
        fontSize: '10px',
        opacity: '0.9',
        padding: '2px 6px',
        borderRadius: '6px',
        border: '1px solid #ffd54f66',
        color: '#ffd54f',
        pointerEvents: 'none' // don’t block clicks on the star/trash
    });
    bubble.appendChild(badge);

}

function clearWorkshopState() {
    ensureCtx();
    console.log("clear called");
    // 1) Clear any preferred decorations BEFORE nulling handles
    try { clearPreferredUI(); } catch { }

    // 2) Wipe in-memory state
    miniTurns = [];
    preferredScene = null;
    preferredEls = null;

    // 3) Persist a clean state for this character
    try {
        localStorage.setItem(STATE_KEY(), JSON.stringify({ miniTurns: [], preferredScene: null }));
    } catch { }

    // 4) Hard reset the chat log DOM (replace the node, not just innerHTML)
    if (chatLogEl && chatLogEl.parentNode) {
        const parent = chatLogEl.parentNode;

        const newLog = document.createElement('div');
        // Reapply the same styles you set in openWorkshop()
        Object.assign(newLog.style, {
            overflowY: 'auto',
            padding: '10px 4px',
            border: '1px solid #333',
            borderRadius: '8px',
            background: '#181818'
        });

        // Replace and rebind the global ref
        parent.replaceChild(newLog, chatLogEl);
        chatLogEl = newLog;
    }

    // 5) Rebuild the UI from the (now empty) state
    // Defer one frame so the popup can close cleanly first
    const defer = window.requestAnimationFrame || ((fn) => setTimeout(fn, 0));
    defer(() => {
        // Starter line only (no actions)
        appendBubble('assistant', 'Describe the opening you want (tone, length, topics, formality, etc.).', { noActions: true });

        if (inputEl) {
            inputEl.value = '';
            inputEl.focus();
        }
    });
}

// Persist the last character the workshop was opened for
const LAST_CHAR_KEY = 'stcm_gw_last_char_id';

function getCharId() {
    ensureCtx();
    // Prefer ctx.characterId, fall back to the cached id, then 'global'
    return String(ctx?.characterId ?? activeCharId ?? 'global');
}

function isWelcomePanelOpen() {
    const wp = document.querySelector('#chat .welcomePanel');
    if (!wp) return false;
    const style = window.getComputedStyle(wp);
    const visuallyHidden = style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
    const noBox = (wp.offsetWidth === 0 && wp.offsetHeight === 0 && wp.getClientRects().length === 0);
    return !(visuallyHidden || noBox);
}

function chatMessageCount() {
    // Count visible .mes nodes in #chat (covers assistant/user/system)
    const all = Array.from(document.querySelectorAll('#chat .mes'));
    return all.filter(el => {
        const cs = window.getComputedStyle(el);
        const hidden = cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0';
        const noBox = (el.offsetWidth === 0 && el.offsetHeight === 0 && el.getClientRects().length === 0);
        return !(hidden || noBox);
    }).length;
}

function findTopMessageEl() {
    const chat = document.getElementById('chat');
    if (!chat) return null;

    // Prefer explicit #0 if present, else the first visible .mes
    let top = chat.querySelector('.mes[mesid="0"]');
    if (!top) {
        top = Array.from(chat.querySelectorAll('.mes'))
            .find(el => {
                const cs = window.getComputedStyle(el);
                const hidden = cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0';
                const noBox = (el.offsetWidth === 0 && el.offsetHeight === 0 && el.getClientRects().length === 0);
                return !(hidden || noBox);
            }) || null;
    }
    return top;
}

function removeWorkshopButton() {
    const btn = document.getElementById('stcm-gw-btn');
    if (btn) btn.remove();

    const holder = document.getElementById('stcm-gw-holder');
    if (holder) holder.remove();
}


// --- Custom System Prompt storage + rendering ---
const CUSTOM_SYS_PROMPT_KEY = 'stcm_gw_sys_prompt_v1';

function loadCustomSystemPrompt() {
    try {
        const v = JSON.parse(localStorage.getItem(CUSTOM_SYS_PROMPT_KEY));
        return {
            enabled: !!v?.enabled,
            template: typeof v?.template === 'string' ? v.template : getDefaultSystemPromptTemplate(),
        };
    } catch {
        return { enabled: false, template: getDefaultSystemPromptTemplate() };
    }
}

function saveCustomSystemPrompt(cfg) {
    const safe = {
        enabled: !!cfg?.enabled,
        template: String(cfg?.template ?? '').trim() || getDefaultSystemPromptTemplate(),
    };
    localStorage.setItem(CUSTOM_SYS_PROMPT_KEY, JSON.stringify(safe));
    return safe;
}


function getDefaultSystemPromptTemplate() {
    // IMPORTANT: buildCharacterJSONBlock() is appended after rendering.
    return [
      'You are ${who}. Your task is to craft an opening scene to begin a brand-new chat.',
      'Format strictly as ${nParas} paragraph${parasS}, with exactly ${nSents} sentence${sentsS} per paragraph.',
      'Target tone: ${style}.',
  
      'Your top priority is to FOLLOW THE USER\'S INSTRUCTION.',
      '- If a preferred scene is provided under <PREFERRED_SCENE>, preserve it closely (≈90–95% unchanged) and apply ONLY the explicit edits from USER_INSTRUCTION.',
      '- Maintain the same structure (paragraph count and sentences per paragraph).',
      '- If they ask for ideas, names, checks, rewrites, longer text, etc., do THAT instead. Do not force a greeting.',
  
      'Open-endedness: Make the scene action-oriented and involve the user as an active participant and explicitly have {{user}} as a participant. Do not fully resolve conflicts or decisions unless the user directs otherwise.',
  
      'HARD REQUIREMENTS:',
      '  (1) The character acts with their own agency. Do NOT ask the user to decide what the character will do.',
      '  (2) Unless the user explicitly forbids addressing the user: include the literal token "{{user}}" at least once (you may use it again naturally, up to three total mentions). Use it only inside full sentences of narration or dialogue—never as a standalone line, never repeated back-to-back, and never appended after the scene.',
  
      'You are NOT ${charName}; never roleplay as them. You are creating a scene for them based on the user\'s input.',
      'You will receive the COMPLETE character object for ${charName} as JSON under <CHARACTER_DATA_JSON>.',
      'Use ONLY the provided JSON as ground truth for the scene.',
  
      'Formatting rules:',
      '- Return only what the user asked for; no meta/system talk; no disclaimers.',
      '- If the user asked for a greeting, return only the greeting text (no extra commentary).',
      '- End the output immediately after the final sentence of paragraph ${nParas}. Do not append extra tokens, names, or lines.'
    ].join('\n\n');
  }
  

function regexEscape(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


function containsUserToken(text) {
    return /\{\{\s*user\s*\}\}/i.test(String(text || ''));
}

function getRealUsername() {
    // SillyTavern usually exposes the user's name as name1
    return (ctx?.name1 || ctx?.user?.name || window?.NAME1 || '').trim();
}

function buildUserHookRevisionPrompt(prevText, nParas, nSents) {
    // Ask the model to revise while preserving structure and adding {{user}} once.
    return [
        'Revise the text below to meet ALL requirements:',
        '- Include the literal token "{{user}}" exactly as written at least once, either',
        '  (a) directly addressing {{user}} with a question, or',
        '  (b) describing {{user}} participating in the scene in third person.',
        `- Preserve the paragraph count (${nParas}) and sentences per paragraph (${nSents}).`,
        '- Keep content otherwise the same and do not add meta commentary. Return only the revised text.',
        '',
        '--- TEXT START ---',
        prevText,
        '--- TEXT END ---'
    ].join('\n');
}

function normalizeUserToken(text, realUsername) {
    let out = String(text || '');
    if (!out) return out;
    // If the real username (e.g., "Jake") appears, normalize it to {{user}}
    if (containsRealUsername(out, realUsername)) {
        out = replaceRealUsernameWithToken(out, realUsername);
    }
    // No retry or injection if neither {{user}} nor the real name is present
    return out;
}



function containsRealUsername(text, realUsername) {
    if (!realUsername) return false;
    // Matches Jake, {Jake},  {Jake} , Jake}, { Jake }, etc.
    const pat = new RegExp(`(\\{\\s*)?${escapeRegex(realUsername)}(\\s*\\})?`, 'i');
    return pat.test(String(text || ''));
}

function replaceRealUsernameWithToken(text, realUsername) {
    if (!realUsername) return text;
    // Replace any of: Jake / {Jake} / { Jake } /  Jake}
    const pat = new RegExp(`(\\{\\s*)?${escapeRegex(realUsername)}(\\s*\\})?`, 'gi');
    return String(text || '').replace(pat, '{{user}}');
}


function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}



function renderSystemPromptTemplate(template, vars) {
    return String(template).replace(/\$\{(\w+)\}/g, (_, key) => {
        // allow booleans/numbers; fallback to empty string
        return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : '';
    });
}

// Inject lightweight tooltip styles once for variable explainers
function ensureTooltipStyles() {
    if (document.getElementById('stcm-gw-tooltips')) return;
    const style = document.createElement('style');
    style.id = 'stcm-gw-tooltips';
    document.head.appendChild(style);
}

let GW_TIP_HOST = null;
let GW_TIP_ARROW = null;

function ensureTipHost() {
    if (!GW_TIP_HOST) {
        GW_TIP_HOST = document.createElement('div');
        GW_TIP_HOST.className = 'gw-tip-host';
        document.body.appendChild(GW_TIP_HOST);
    }
    if (!GW_TIP_ARROW) {
        GW_TIP_ARROW = document.createElement('div');
        GW_TIP_ARROW.className = 'gw-tip-arrow';
        document.body.appendChild(GW_TIP_ARROW);
    }
    return GW_TIP_HOST;
}

function showVarTooltip(targetEl, text) {
    ensureTipHost();
    GW_TIP_HOST.textContent = text;

    GW_TIP_HOST.style.display = 'block';
    GW_TIP_HOST.style.left = '-9999px';
    GW_TIP_HOST.style.top  = '-9999px';
    GW_TIP_HOST.style.right = 'auto';  // <-- make sure we don't stretch
    GW_TIP_HOST.style.bottom = 'auto'; // <--

    GW_TIP_ARROW.style.display = 'block';
    GW_TIP_ARROW.style.right = 'auto';
    GW_TIP_ARROW.style.bottom = 'auto';

    const rect = targetEl.getBoundingClientRect();
    const margin = 10;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Measure after initial display
    let hostRect = GW_TIP_HOST.getBoundingClientRect();

    // Prefer above
    let top = rect.top - hostRect.height - margin;
    let placeAbove = true;
    if (top < 8) { top = rect.bottom + margin; placeAbove = false; }

    // Horizontal clamp
    let left = rect.left;
    if (left + hostRect.width + 8 > vw) left = vw - hostRect.width - 8;
    if (left < 8) left = 8;

    GW_TIP_HOST.style.left = `${left}px`;
    GW_TIP_HOST.style.top  = `${top}px`;

    // Arrow
    const arrowX = Math.max(left + 12, Math.min(rect.left + 12, left + hostRect.width - 12));
    const arrowY = placeAbove ? (rect.top - 4) : (rect.bottom + 4);
    GW_TIP_ARROW.style.left = `${arrowX}px`;
    GW_TIP_ARROW.style.top  = `${arrowY}px`;
    GW_TIP_ARROW.style.transform = placeAbove ? 'rotate(225deg)' : 'rotate(45deg)';

    // Re-clamp vertically if still tall
    hostRect = GW_TIP_HOST.getBoundingClientRect();
    if (hostRect.bottom > vh - 8) {
        GW_TIP_HOST.style.top = `${vh - hostRect.height - 8}px`;
    }
}


function hideVarTooltip() {
    if (GW_TIP_HOST) GW_TIP_HOST.style.display = 'none';
    if (GW_TIP_ARROW) GW_TIP_ARROW.style.display = 'none';
}

function activateVarTooltips(root) {
    // Attach listeners to elements with .gw-var and data-tip
    root.querySelectorAll('.gw-var[data-tip]').forEach(el => {
        const txt = el.getAttribute('data-tip') || '';
        el.addEventListener('mouseenter', () => showVarTooltip(el, txt));
        el.addEventListener('mouseleave', hideVarTooltip);
        el.addEventListener('mousemove', (e) => {
            // follow X a bit for a nicer feel
            if (!GW_TIP_HOST || GW_TIP_HOST.style.display === 'none') return;
            const hostRect = GW_TIP_HOST.getBoundingClientRect();
            let x = Math.min(window.innerWidth - hostRect.width - 8, Math.max(8, e.clientX - 60));
            GW_TIP_HOST.style.left = `${x}px`;
            // keep arrow aligned under cursor tip
            GW_TIP_ARROW.style.left = `${e.clientX - 4}px`;
        });
    });
}



/* --------------------- CHARACTER JSON --------------------- */
let activeCharCache = null;   // { name, description, personality, scenario, ... }
let activeCharId = null;

/** Try hard to fetch the current character object across ST variants. */
function getActiveCharacterFull() {
    ensureCtx();

    // Prefer the cache populated by chatLoaded
    if (activeCharCache && Object.keys(activeCharCache).length) return activeCharCache;

    // Fallbacks
    const idx = (ctx?.characterId != null && !Number.isNaN(Number(ctx.characterId)))
        ? Number(ctx.characterId) : null;

    const fromArray = (Array.isArray(ctx?.characters) && idx != null && idx >= 0 && idx < ctx.characters.length)
        ? ctx.characters[idx] : null;

    const fromCtxObj = ctx?.character || ctx?.charInfo || null;
    const byName2 = (Array.isArray(ctx?.characters) && ctx?.name2)
        ? ctx.characters.find(c => c?.name === ctx.name2) || null
        : null;

    const merged = Object.assign({}, fromCtxObj || {}, fromArray || {}, byName2 || {});
    if (!merged || !Object.keys(merged).length) {
        console.warn('[Greeting Workshop] Character object is empty. Check context wiring:', {
            idxFromCtx: idx, hasArray: Array.isArray(ctx?.characters), name2: ctx?.name2
        });
    }
    return merged;
}

/** Only mask `{{user}}`; keep other curlies intact. */
function maskUserPlaceholders(str) {
    // break macro match ONLY for {{user}}, leaving {{char}} intact
    return String(str).replace(/\{\{\s*user\s*\}\}/gi, '{\u200B{user}}');
}

/** Replace {{char}} (any case / whitespace) with the actual char name. */
function replaceCharPlaceholders(str, charName) {
    return String(str).replace(/\{\{\s*char\s*\}\}/gi, String(charName ?? ''));
}

/** Deep transform: replace {{char}}, mask {{user}} across all string leaves. */
function transformCardForLLM(obj, charName) {
    if (obj == null) return obj;
    if (typeof obj === 'string') {
        const withChar = replaceCharPlaceholders(obj, charName);
        const withMaskedUser = maskUserPlaceholders(withChar);
        return withMaskedUser;
    }
    if (Array.isArray(obj)) {
        return obj.map(v => transformCardForLLM(v, charName));
    }
    if (typeof obj === 'object') {
        const out = {};
        for (const k of Object.keys(obj)) {
            out[k] = transformCardForLLM(obj[k], charName);
        }
        return out;
    }
    return obj;
}

function pickCardFields(ch) {
    // Card data can live both top-level and under ch.data.*
    const d = ch?.data || {};
    const pick = (k) => ch?.[k] ?? d?.[k] ?? null;

    const out = {
        name: pick('name'),
        description: pick('description'),
        personality: pick('personality'),
        scenario: pick('scenario'),
    };

    // Normalize to strings when present; keep nulls as null
    for (const k of Object.keys(out)) {
        const v = out[k];
        out[k] = (v == null) ? null : String(v);
    }

    return out;
}


function safeJSONStringify(obj) {
    const seen = new WeakSet();
    return JSON.stringify(obj, (k, v) => {
        if (typeof v === 'function') return undefined;
        if (typeof v === 'bigint') return v.toString();
        if (v && typeof v === 'object') {
            if (seen.has(v)) return '[Circular]';
            seen.add(v);
        }
        return v;
    }, 2);
}

/**
 * Build JSON block:
 *  - Replaces {{char}} with the actual name
 *  - Masks ONLY {{user}} to prevent macro replacement/leakage
 *  - Leaves other curlies as-is
 */
function buildCharacterJSONBlock() {
    const rawChar = getActiveCharacterFull();
    const card = pickCardFields(rawChar);
    const charName = card.name || ctx?.name2 || '';

    const transformed = transformCardForLLM(card, charName);
    const json = safeJSONStringify(transformed);

    return `<CHARACTER_DATA_JSON>\n${json}\n</CHARACTER_DATA_JSON>`;
}

/* --------------------- PREFS + PROMPTS --------------------- */

const PREFS_KEY = 'stcm_greeting_workshop_prefs';

function loadPrefs() {
    try {
        return JSON.parse(localStorage.getItem(PREFS_KEY)) || {
            style: 'Follow Character Personality',
            numParagraphs: 3,
            sentencesPerParagraph: 3,
            historyCount: 5,

        };
    } catch {
        return {
            style: 'Follow Character Personality',
            numParagraphs: 3,
            sentencesPerParagraph: 3,
            historyCount: 5,
        };
    }
}

function savePrefs(p) { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); }

function esc(s) {
    return (s ?? '').toString()
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}


function buildSystemPrompt(prefs) {
    ensureCtx();
    const ch = getActiveCharacterFull();
    const charName = (ch?.name || ch?.data?.name || ctx?.name2 || '{{char}}');
    const who = 'A Character Card Greeting Editing Assistant';

    const nParas = Math.max(1, Number(prefs?.numParagraphs || 3));
    const nSents = Math.max(1, Number(prefs?.sentencesPerParagraph || 3));
    const style  = (prefs?.style || 'Follow Character Personality');
    const parasS = nParas === 1 ? '' : 's';
    const sentsS = nSents === 1 ? '' : 's';

    const custom = loadCustomSystemPrompt();

    if (custom.enabled) {
        const rendered = renderSystemPromptTemplate(custom.template, {
            who, nParas, nSents, style, charName, parasS, sentsS
        });
        return [
            rendered,
            buildCharacterJSONBlock(),
        ].join('\n\n');
    }

    // ✅ Render the default template with variables
    const defaultPrompt = renderSystemPromptTemplate(
        getDefaultSystemPromptTemplate(),
        { who, nParas, nSents, style, charName, parasS, sentsS }
    );

    return [
        defaultPrompt,
        buildCharacterJSONBlock()
    ].join('\n\n');
}


function openSystemPromptEditor() {
    const cfg = loadCustomSystemPrompt();

    ensureTooltipStyles();

    // Give the editor unique IDs so we can detect/close it from elsewhere
    const overlay = document.createElement('div');
    overlay.id = 'stcm-sys-overlay';
    Object.assign(overlay.style, { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 11000 });

    const box = document.createElement('div');
    box.id = 'stcm-sys-box';
    Object.assign(box.style, {
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 'min(860px,95vw)', maxHeight: '90vh', overflow: 'hidden',
        background: '#1b1b1b', color: '#eee', border: '1px solid #555',
        borderRadius: '10px', boxShadow: '0 8px 30px rgba(0,0,0,.6)', zIndex: 11001,
        display: 'flex', flexDirection: 'column'
    });

    // Provide a global-safe closer so other handlers (like the Workshop Esc) can use it
    const localEscHandler = (e) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            e.preventDefault();
            window.stcmCloseSysEditor?.();
        }
    };
    window.stcmCloseSysEditor = () => {
        try { document.removeEventListener('keydown', localEscHandler, true); } catch {}
        try { box.remove(); } catch {}
        try { overlay.remove(); } catch {}
        // Clean up the global hook after closing
        try { delete window.stcmCloseSysEditor; } catch {}
    };

    const header = document.createElement('div');
    header.textContent = '✏️ Edit System Prompt';
    Object.assign(header.style, {
        padding: '10px 12px', borderBottom: '1px solid #444', background: '#222',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 600
    });

    const close = document.createElement('button');
    close.textContent = 'X';
    Object.assign(close.style, { padding: '6px 10px', background: '#9e2a2a', color: '#fff', border: '1px solid #444', borderRadius: '6px', cursor: 'pointer' });
    close.addEventListener('click', () => window.stcmCloseSysEditor?.());
    header.append(close);

    const tips = document.createElement('div');
    Object.assign(tips.style, { padding: '10px 12px', borderBottom: '1px solid #333', fontSize: '12px', opacity: 0.95, lineHeight: 1.55 });
    tips.innerHTML = `
        <div style="margin-bottom:6px;"><strong>Variables you can use (hover for details):</strong></div>
        <div style="display:flex; flex-wrap:wrap; gap:8px;">
            <code class="gw-var" data-tip="Human-readable name/role for the assistant performing the greeting edit/creation task. Example: 'A Character Card Greeting Editing Assistant'. Replaces \${who}.">\${who}</code>
            <code class="gw-var" data-tip="Number of paragraphs to produce in the output when generating a scene. Integer ≥ 1. Replaces \${nParas}.">\${nParas}</code>
            <code class="gw-var" data-tip="Pluralization helper for 'paragraph' based on nParas. Blank when nParas = 1, otherwise 's'. Replaces \${parasS}.">\${parasS}</code>
            <code class="gw-var" data-tip="Sentences per paragraph to enforce. Integer ≥ 1. Replaces \${nSents}.">\${nSents}</code>
            <code class="gw-var" data-tip="Pluralization helper for 'sentence' based on nSents. Blank when nSents = 1, otherwise 's'. Replaces \${sentsS}.">\${sentsS}</code>
            <code class="gw-var" data-tip="Style directive for tone/voice (e.g., 'Follow Character Personality', 'dry and clinical', etc.). Replaces \${style}.">\${style}</code>
            <code class="gw-var" data-tip="Character name pulled from the active card. Used to reference the character in instructions without roleplaying as them. Replaces \${charName}.">\${charName}</code>
        </div>
        <div style="margin-top:10px;">
            <strong>Notes:</strong> These tokens are replaced at runtime before sending to the model. 
            You do <em>not</em> need to include character data yourself — <code>buildCharacterJSONBlock()</code> is automatically appended whenever the custom system prompt is enabled.
        </div>
    `;
    activateVarTooltips(tips);

    const useRow = document.createElement('label');
    useRow.style.display = 'flex';
    useRow.style.alignItems = 'center';
    useRow.style.gap = '8px';
    useRow.style.fontSize = '14px';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!cfg.enabled;
    const lbl = document.createElement('span');
    lbl.textContent = 'Use custom system prompt for the Greeting Workshop';
    useRow.append(chk, lbl);

    const ta = document.createElement('textarea');
    ta.value = cfg.template || getDefaultSystemPromptTemplate();
    Object.assign(ta.style, {
        width: '100%',
        height: '100%',
        resize: 'vertical',
        minHeight: '240px',
        background: '#222',
        color: '#eee',
        border: '1px solid #444',
        borderRadius: '6px',
        padding: '10px',
        fontFamily: 'monospace'
    });
    

    const footer = document.createElement('div');
    Object.assign(footer.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end', padding: '10px 12px' });

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset to Default';
    Object.assign(resetBtn.style, { padding: '8px 12px', background: '#616161', color: '#fff', border: '1px solid #444', borderRadius: '6px', cursor: 'pointer' });
    resetBtn.addEventListener('click', () => { ta.value = getDefaultSystemPromptTemplate(); });

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    Object.assign(saveBtn.style, { padding: '8px 12px', background: '#8e44ad', color: '#fff', border: '1px solid #444', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 });
    saveBtn.addEventListener('click', () => {
        saveCustomSystemPrompt({ enabled: chk.checked, template: ta.value });
        window.stcmCloseSysEditor?.();
    });

    footer.append(resetBtn, saveBtn);

    const tipsWrap = tips;
    const bodyWrap = document.createElement('div');
    Object.assign(bodyWrap.style, { display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: '10px', height: '65vh', padding: '10px 12px' });
    bodyWrap.append(useRow, ta, footer);

    box.append(header, tipsWrap, bodyWrap);
    document.body.append(overlay, box);

    // Capture Esc at the earliest phase so it doesn't bubble to the Workshop handler
    document.addEventListener('keydown', localEscHandler, true);
}




/* --------------------- UI --------------------- */

let modal, overlay;
let chatLogEl, inputEl, sendBtn, regenBtn, acceptBtn, editBtn, copyBtn, closeBtn;
let styleInputEl, paraInputEl, sentInputEl, histInputEl;


function restoreUIFromState() {
    // Clear the DOM log
    chatLogEl.innerHTML = '';

    // Re-add a gentle header line
    appendBubble('assistant', 'Describe the opening you want (tone, length, topics, formality, etc.).', { noActions: true });


    // Render saved turns, preserving timestamps
    for (const t of miniTurns) {
        const w = appendBubble(t.role, t.content);
        if (w && t.ts) w.dataset.ts = t.ts;
    }

    // Re-apply preferred badge/outline if present
    if (preferredScene) {
        // Find the assistant bubble with the matching ts
        const node = [...chatLogEl.querySelectorAll('.gw-row[data-role="assistant"]')]
            .find(n => n.dataset.ts === preferredScene.ts);
        if (node) {
            const bubble = node.querySelector('.gw-bubble');
            if (bubble) markPreferred(node, bubble, preferredScene.text);
        }
    }

    chatLogEl.scrollTop = chatLogEl.scrollHeight;
}



let miniTurns = []; // [{role:'user'|'assistant', content: string}]

function openWorkshop() {
    ensureCtx();
    const currId = getCharId();
    const lastId = localStorage.getItem(LAST_CHAR_KEY);

    if (lastId && lastId !== currId) {
        try {
            localStorage.setItem(`stcm_gw_state_${currId}`, JSON.stringify({ miniTurns: [], preferredScene: null }));
        } catch { }
    }
    try { localStorage.setItem(LAST_CHAR_KEY, currId); } catch { }

    if (modal) return;

    const prefs = loadPrefs();

    overlay = document.createElement('div');
    Object.assign(overlay.style, { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 10000 });

    modal = document.createElement('div');
    Object.assign(modal.style, {
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 'min(720px,92vw)', maxHeight: '95vh', overflow: 'hidden',
        background: '#1b1b1b', color: '#ddd', border: '1px solid #555',
        borderRadius: '10px', boxShadow: '0 8px 30px rgba(0,0,0,.5)', zIndex: 10001,
        display: 'flex', flexDirection: 'column', resize: 'both', overflow: 'auto'
    });

    const header = document.createElement('div');
    header.textContent = '🧠 Greeting Workshop';
    Object.assign(header.style, {
        padding: '10px 12px',
        borderBottom: '1px solid #444',
        fontWeight: 600,
        background: '#222',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
    });

    const settings = document.createElement('div');
    Object.assign(settings.style, {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px 16px',
        padding: '8px 12px',
        alignItems: 'center',
        borderBottom: '1px solid #333'
    });
    settings.innerHTML = `
    <label style="display:flex;align-items:center;">
        Paragraphs(¶)
        <input id="gw-paras" type="number" min="1" max="10" value="${prefs.numParagraphs ?? 3}" style="width:80px;margin-left:6px;padding: 4px;background: rgb(34, 34, 34);color: rgb(238, 238, 238);border: 1px solid rgb(68, 68, 68);border-radius: 6px;">
    </label>
    <label style="display:flex;align-items:center;">
        Sentences(per ¶)
        <input id="gw-sent" type="number" min="1" max="10" value="${prefs.sentencesPerParagraph ?? 3}" style="width:80px;margin-left:6px;padding: 4px;background: rgb(34, 34, 34);color: rgb(238, 238, 238);border: 1px solid rgb(68, 68, 68);border-radius: 6px;">
    </label>
    <label style="display:flex;align-items:center;">
        Chat History
        <input id="gw-hist" type="number" min="0" max="20" value="${prefs.historyCount ?? 5}" style="width:80px;margin-left:6px;padding: 4px;background: rgb(34, 34, 34);color: rgb(238, 238, 238);border: 1px solid rgb(68, 68, 68);border-radius: 6px;" title="How many recent messages to include when sending to the LLM">
    </label>
    <label style="display:flex;flex:1;align-items:center;">
        Style
        <input id="gw-style" type="text" value="${esc(prefs.style)}" style="flex:1;margin-left:6px;padding: 4px;background: rgb(34, 34, 34);color: rgb(238, 238, 238);border: 1px solid rgb(68, 68, 68);border-radius: 6px;">
    </label>
`;

    const body = document.createElement('div');
    body.className = 'gw-chat-body';   
    body.id = 'gw-chat-body';
    Object.assign(body.style, { display: 'grid', gridTemplateRows: '1fr auto', padding: '0 12px 12px 12px', gap: '10px', height: '70vh' });

    chatLogEl = document.createElement('div');
    Object.assign(chatLogEl.style, { overflowY: 'auto', padding: '10px 4px', border: '1px solid #333', borderRadius: '8px', background: '#181818' });

    const composer = document.createElement('div');
    Object.assign(composer.style, { display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px' });

    inputEl = document.createElement('textarea');
    inputEl.placeholder = 'Describe the greeting you want (tone, topics, constraints)…';
    Object.assign(inputEl.style, { resize: 'vertical', minHeight: '48px', maxHeight: '160px', padding: '8px', background: '#222', color: '#eee', border: '1px solid #444', borderRadius: '6px' });

    sendBtn = document.createElement('button');
    sendBtn.textContent = 'Send to LLM';
    Object.assign(sendBtn.style, btnStyle('#2e7d32'));
    composer.append(inputEl, sendBtn);

    const sysBtn = mkBtn('✏️ System Prompt', '#6a5acd');
    sysBtn.addEventListener('click', openSystemPromptEditor);
    header.append(sysBtn);

    const closeBtn = mkBtn('X', '#9e2a2a');
    header.append(closeBtn);
    

    const footer = document.createElement('div');
    Object.assign(footer.style, { display: 'flex', gap: '8px', padding: '10px 12px', borderTop: '1px solid #333', background: '#1f1f1f' });

    const regenBtn = mkBtn('Regenerate Last', '#007acc');
    const acceptBtn = mkBtn('Accept → Replace Greeting', '#d35400');
    const clearBtn = mkBtn('Clear Memory', '#9e2a2a');

    closeBtn.addEventListener('click', closeWorkshop);

    clearBtn.addEventListener('click', () => {
        callGenericPopup(
            'Clear workshop memory (history & preferred scene)?',
            POPUP_TYPE.CONFIRM,
            'Greeting Workshop',
            { okButton: 'OK', cancelButton: 'Cancel' }
        ).then(result => { if (result === POPUP_RESULT.AFFIRMATIVE) clearWorkshopState(); });
    });

    footer.append(regenBtn, spacer(), acceptBtn, clearBtn);

    modal.append(header, settings, body, footer);
    body.append(chatLogEl, composer);
    document.body.append(overlay, modal);

    // Close behavior: if the System Prompt editor is open, close THAT first.
    const escHandler = (e) => {
        if (e.key !== 'Escape') return;

        // If the system prompt editor is open, close it and DO NOT close the Workshop.
        if (document.getElementById('stcm-sys-box')) {
            e.stopPropagation();
            e.preventDefault();
            if (typeof window.stcmCloseSysEditor === 'function') {
                window.stcmCloseSysEditor();
            } else {
                // Fallback: remove by IDs if the closer isn't available
                try { document.getElementById('stcm-sys-box')?.remove(); } catch {}
                try { document.getElementById('stcm-sys-overlay')?.remove(); } catch {}
            }
            return;
        }

        // Otherwise, Esc closes the Workshop as before.
        closeWorkshop();
        document.removeEventListener('keydown', escHandler, true);
    };
    document.addEventListener('keydown', escHandler, true);



    makeDraggable(modal, header);

    // wire settings
    styleInputEl = settings.querySelector('#gw-style');
    paraInputEl = settings.querySelector('#gw-paras');
    sentInputEl = settings.querySelector('#gw-sent');
    histInputEl = settings.querySelector('#gw-hist');

    settings.addEventListener('change', () => {
        const next = {
            style: (styleInputEl.value || 'Follow Character Personality').trim(),
            numParagraphs: Math.max(1, Math.min(10, Number(paraInputEl.value) || 3)),
            sentencesPerParagraph: Math.max(1, Math.min(10, Number(sentInputEl.value) || 3)),
            historyCount: Math.max(0, Math.min(20, Number(histInputEl.value) || 5))
        };
        savePrefs(next);
    });

    sendBtn.addEventListener('click', () => onSendToLLM(false));
    regenBtn.addEventListener('click', onRegenerate);
    acceptBtn.addEventListener('click', onAccept);

    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onSendToLLM(false);
        }
    });

    const restored = loadSession();
    miniTurns = restored.miniTurns;
    preferredScene = restored.preferredScene;
    restoreUIFromState();

    inputEl.focus();
}



function closeWorkshop() {
    if (modal) modal.remove();
    if (overlay) overlay.remove();
    modal = overlay = null;
    try { document.removeEventListener('keydown', localEscHandler, true); } catch {}

}

function btnStyle(bg) {
    return { padding: '8px 12px', background: bg, color: '#fff', border: '1px solid #444', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 };
}
function mkBtn(label, bg) { const b = document.createElement('button'); b.textContent = label; Object.assign(b.style, btnStyle(bg)); return b; }
function spacer() { const s = document.createElement('div'); s.style.flex = '1'; return s; }

function appendBubble(role, text, opts = {}) {
    if (!chatLogEl || !chatLogEl.appendChild) return;

    const wrap = document.createElement('div');
    wrap.className = 'gw-row';
    wrap.dataset.role = role;
    wrap.dataset.ts = String(Date.now());

    const bubble = document.createElement('div');
    bubble.className = 'gw-bubble';

    const content = document.createElement('div');
    content.className = 'gw-content';
    content.textContent = text;

    wrap.style.display = 'flex';
    wrap.style.margin = '6px 0';
    wrap.style.justifyContent = role === 'user' ? 'flex-end' : 'flex-start';

    const hasActions = role === 'assistant' && !opts.noActions;

    Object.assign(bubble.style, {
        padding: '8px 10px',
        borderRadius: '8px',
        background: role === 'user' ? '#2b2b2b' : '#242424',
        border: '1px solid #3a3a3a',
        maxWidth: '90%',
        whiteSpace: 'pre-wrap',
        position: 'relative',
        paddingBottom: hasActions ? '32px' : '8px'
    });

    bubble.appendChild(content);
    wrap.appendChild(bubble);
    chatLogEl.appendChild(wrap);

    if (hasActions) {
        const bar = document.createElement('div');
        Object.assign(bar.style, {
            position: 'absolute',
            right: '8px',
            bottom: '6px',
            display: 'flex',
            gap: '8px',
            fontSize: '12px',
            opacity: '0.9'
        });

        const starBtn = document.createElement('button');
        starBtn.type = 'button';
        starBtn.title = 'Mark as preferred (keep almost the same next time)';
        starBtn.textContent = '⭐';
        Object.assign(starBtn.style, {
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '0 2px',
            color: '#ffd54f'
        });

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.title = 'Edit this assistant message';
        editBtn.textContent = '✏️';
        Object.assign(editBtn.style, {
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '0 2px'
        });

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.title = 'Copy this assistant message';
        copyBtn.textContent = '📋';
        Object.assign(copyBtn.style, {
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '0 2px'
        });

        const trashBtn = document.createElement('button');
        trashBtn.type = 'button';
        trashBtn.title = 'Delete this assistant message and the previous user message';
        trashBtn.textContent = '🗑';
        Object.assign(trashBtn.style, {
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '0 2px',
            color: '#f06292'
        });

        starBtn.addEventListener('click', () => {
            const thisTs = wrap.dataset.ts;
            const item = miniTurns.find(t => t.role === 'assistant' && t.ts === thisTs);
            const latest = item?.content ?? content.textContent ?? text;
            markPreferred(wrap, bubble, latest);
            saveSession();
            starBtn.setAttribute('aria-pressed', preferredScene && preferredScene.ts === thisTs ? 'true' : 'false');
        });

        copyBtn.addEventListener('click', () => {
            const thisTs = wrap.dataset.ts;
            const item = miniTurns.find(t => t.role === 'assistant' && t.ts === thisTs);
            const toCopy = item?.content ?? content.textContent ?? text;
            navigator.clipboard.writeText(toCopy);
        });

        editBtn.addEventListener('click', () => {
            // prevent multiple editors
            if (bubble.querySelector('.gw-inline-editor')) return;
        
            const thisTs = wrap.dataset.ts;
            const itemIdx = miniTurns.findIndex(t => t.role === 'assistant' && t.ts === thisTs);
            const current = itemIdx !== -1 ? miniTurns[itemIdx].content : (content.textContent ?? text);
        
            // --- lock bubble width to match original message width ---
            const computed = window.getComputedStyle(bubble);
            const lockedWidthPx = bubble.getBoundingClientRect().width; // exact pixels
            const prevWidth = bubble.style.width;
            const prevMaxWidth = bubble.style.maxWidth;
        
            bubble.style.width = lockedWidthPx + 'px'; // lock to current width
            bubble.style.maxWidth = 'none';            // prevent 90% clamp while editing
        
            // hide original content + action bar; shrink bottom padding
            content.style.display = 'none';
            bar.style.display = 'none';
            bubble.classList.add('gw-editing');
            bubble.style.paddingBottom = '8px';
        
            const editor = document.createElement('textarea');
            editor.className = 'gw-inline-editor';
            Object.assign(editor.style, {
                display: 'block',
                width: '100%',
                minHeight: '160px',
                background: '#222',
                color: '#eee',
                border: '1px solid #444',
                borderRadius: '6px',
                padding: '8px',
                marginTop: '6px',
                resize: 'vertical',
                boxSizing: 'border-box' // <-- ensures full-width equals bubble width
            });
            editor.value = current;
        
            // auto-grow to content
            const autoGrow = () => {
                editor.style.height = 'auto';
                editor.style.height = Math.max(160, editor.scrollHeight + 2) + 'px';
            };
            editor.addEventListener('input', autoGrow);
            setTimeout(autoGrow, 0);
        
            const row = document.createElement('div');
            Object.assign(row.style, { display: 'flex', gap: '8px', marginTop: '6px' });
        
            const saveBtn = mkBtn('Save', '#8e44ad');
            const cancelBtn = mkBtn('Cancel', '#616161');
        
            const finish = (didSave) => {
                if (didSave) {
                    const next = editor.value.trim();
                    content.textContent = next;
                    if (itemIdx !== -1) miniTurns[itemIdx].content = next;
                    if (preferredScene && preferredScene.ts === thisTs) preferredScene.text = next;
                    saveSession();
                }
                editor.remove();
                row.remove();
                content.style.display = '';
                bar.style.display = 'flex';
                bubble.classList.remove('gw-editing');
                bubble.style.paddingBottom = hasActions ? '32px' : '8px';
        
                // --- restore bubble width behavior ---
                bubble.style.width = prevWidth || '';
                bubble.style.maxWidth = prevMaxWidth || '90%';
            };
        
            saveBtn.addEventListener('click', () => finish(true));
            cancelBtn.addEventListener('click', () => finish(false));
        
            // keyboard shortcuts
            editor.addEventListener('keydown', (e) => {
                if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
                    e.preventDefault();
                    finish(true);
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    finish(false);
                }
            });
        
            row.append(saveBtn, cancelBtn);
            bubble.append(editor, row);
            editor.focus();
            editor.setSelectionRange(editor.value.length, editor.value.length);
        });
        



        trashBtn.addEventListener('click', () => {
            const thisTs = wrap.dataset.ts;
            const idx = miniTurns.findIndex(t => t.role === 'assistant' && t.ts === thisTs);
            if (idx !== -1) {
                miniTurns.splice(idx, 1);
                if (idx - 1 >= 0 && miniTurns[idx - 1]?.role === 'user') {
                    const prevTs = miniTurns[idx - 1].ts;
                    miniTurns.splice(idx - 1, 1);
                    const prevNode = wrap.previousElementSibling;
                    if (prevNode && prevNode.dataset.role === 'user' && prevNode.dataset.ts === prevTs) {
                        prevNode.remove();
                    }
                }
            }
            if (preferredScene && preferredScene.ts === thisTs) {
                preferredScene = null;
                clearPreferredUI();
            }
            saveSession();
            wrap.remove();
        });

        bar.append(starBtn, editBtn, copyBtn, trashBtn);
        bubble.appendChild(bar);
    }

    chatLogEl.scrollTop = chatLogEl.scrollHeight;
    return wrap;
}



async function onRegenerate() {
    const lastUser = [...miniTurns].reverse().find(t => t.role === 'user');
    if (!lastUser) {
        callGenericPopup('No prior user instruction to regenerate from.', POPUP_TYPE.ALERT, 'Greeting Workshop');
        return;
    }
  
    await onSendToLLM(true);
}

// Build final stop arrays (both 'stop' and 'stopping_strings').
// - Merges profile stops + instruct stops (if enabled)
// - For koboldcpp, also injects the full 5-token set automatically
function buildStopFields(apiInfo, profile, instructEnabled, instructCfgEff) {
    const fromProfile = getProfileStops(profile); // already parsed & validated strings
    const fromInstruct = (instructEnabled && instructCfgEff)
        ? [instructCfgEff.stop_sequence, instructCfgEff.output_suffix]
        : [];

    const KCPP_DEFAULT_STOPS = [
        '<|END_OF_TURN_TOKEN|>',
        '<|START_OF_TURN_TOKEN|><|USER_TOKEN|>',
        '<|START_OF_TURN_TOKEN|><|CHATBOT_TOKEN|>',
        '<|START_OF_TURN_TOKEN|><|SYSTEM_TOKEN|>',
        '<STOP>',
    ];

    // Merge profile + instruct
    let merged = mergeStops(fromProfile, fromInstruct);

    // If koboldcpp, ensure the full 5-token set is present
    if (apiInfo?.api_type === 'koboldcpp') {
        merged = mergeStops(merged, KCPP_DEFAULT_STOPS);
    }

    // Dedupe and strip empties
    const unique = [];
    for (const s of merged) {
        if (typeof s === 'string' && s.length && !unique.includes(s)) unique.push(s);
    }

    // Return both keys to mirror "normal" payloads
    return unique.length
        ? { stop: unique, stopping_strings: unique }
        : {};
}


async function onSendToLLM(isRegen = false) {
    ensureCtx();
    const prefs = loadPrefs();

    // ===== Helpers =====
    const getCM = () => ctx?.extensionSettings?.connectionManager || null;
    const getSelectedProfile = () => {
        const cm = getCM(); if (!cm) return null;
        const id = cm.selectedProfile; if (!id || !Array.isArray(cm.profiles)) return null;
        return cm.profiles.find(p => p.id === id) || null;
    };
    const getTemperature = () => {
        const t = Number(ctx?.extensionSettings?.memory?.temperature);
        return Number.isFinite(t) ? t : undefined;
    };
    const getProxyByName = (name) => {
        const list = ctx?.proxies || window?.proxies || [];
        if (!name || name === 'None') return null;
        return Array.isArray(list) ? list.find(p => p.name === name) : null;
    };
    const getGlobalInstructConfig = () => ctx?.extensionSettings?.instruct || ctx?.instruct || null;
    const profileInstructEnabled = (profile) => String(profile?.['instruct-state']).toLowerCase() === 'true';
    const getProfileStops = (profile) => {
        const raw = profile?.['stop-strings']; if (!raw) return [];
        try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return Array.isArray(parsed) ? parsed.filter(s => typeof s === 'string' && s.length) : [];
        } catch { console.warn('[GW] Could not parse profile stop-strings:', raw); return []; }
    };
    const sanitize = (s) => String(s ?? '')
        .replace(/\r/g, '')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .trim();
    const mergeStops = (...lists) => {
        const out = [];
        for (const lst of lists) {
            if (!lst) continue;
            const arr = typeof lst === 'string' ? [lst] : lst;
            for (const s of arr) if (typeof s === 'string' && s.length && !out.includes(s)) out.push(s);
        }
        return out;
    };

    // ===== model lookup from context (chat/text completion settings + deep scan) =====
    function getModelFromContextByApi(profile) {
        const TAG = '[GW]/model(ctx)';
        try {
            ensureCtx();
            const apiRaw = String(profile?.api || '').toLowerCase();
            console.log(`${TAG} profile.api:`, apiRaw);
            if (!apiRaw) { console.warn(`${TAG} missing profile.api`); return null; }

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
                { name: 'ctx.chatCompletionSettings', obj: ctx?.chatCompletionSettings },
                { name: 'ctx.textCompletionSettings', obj: ctx?.textCompletionSettings },
                { name: 'ctx.extensionSettings.chatCompletionSettings', obj: ctx?.extensionSettings?.chatCompletionSettings },
                { name: 'ctx.extensionSettings.textCompletionSettings', obj: ctx?.extensionSettings?.textCompletionSettings },
                { name: 'ctx.settings.chatCompletionSettings', obj: ctx?.settings?.chatCompletionSettings },
                { name: 'ctx.settings.textCompletionSettings', obj: ctx?.settings?.textCompletionSettings },
                { name: 'ctx', obj: ctx },
                { name: 'window', obj: window },
            ];

            console.log(`${TAG} flat key candidates:`, flatKeys, 'containers:', containers.map(c => c.name));

            // 1) flat <provider>_model
            for (const key of flatKeys) {
                for (const c of containers) {
                    const v = c.obj?.[key];
                    if (typeof v === 'string' && v.trim()) {
                        const cleaned = v.trim();
                        console.log(`${TAG} FOUND flat key ${key} in ${c.name} =>`, cleaned);
                        return cleaned;
                    }
                }
            }

            // 2) nested {provider: { model }}
            const providerSectionKeys = [canonProvider, apiRaw];
            console.log(`${TAG} nested provider candidates:`, providerSectionKeys);

            for (const c of containers) {
                const root = c.obj;
                if (!root || typeof root !== 'object') continue;
                for (const pkey of providerSectionKeys) {
                    const section = root[pkey];
                    if (section && typeof section === 'object') {
                        const mv = section.model ?? section.currentModel ?? section.selectedModel ?? section.defaultModel;
                        if (typeof mv === 'string' && mv.trim()) {
                            const cleaned = mv.trim();
                            console.log(`${TAG} FOUND nested ${c.name}.${pkey}.model =>`, cleaned);
                            return cleaned;
                        }
                    }
                }
            }

            // 3) limited deep scan
            const seen = new WeakSet();
            const maxDepth = 5;
            function deepFind(obj, depth, path) {
                if (!obj || typeof obj !== 'object' || seen.has(obj) || depth > maxDepth) return null;
                seen.add(obj);

                for (const key of flatKeys) {
                    if (typeof obj[key] === 'string' && obj[key].trim()) {
                        const cleaned = obj[key].trim();
                        console.log(`${TAG} FOUND deep flat ${path}.${key} =>`, cleaned);
                        return cleaned;
                    }
                }
                for (const pkey of providerSectionKeys) {
                    const sec = obj[pkey];
                    if (sec && typeof sec === 'object') {
                        const mv = sec.model ?? sec.currentModel ?? sec.selectedModel ?? sec.defaultModel;
                        if (typeof mv === 'string' && mv.trim()) {
                            const cleaned = mv.trim();
                            console.log(`${TAG} FOUND deep nested ${path}.${pkey}.model =>`, cleaned);
                            return cleaned;
                        }
                    }
                }
                for (const k of Object.keys(obj)) {
                    const child = obj[k];
                    const childPath = `${path}.${k}`;
                    if (child && typeof child === 'object') {
                        const found = deepFind(child, depth + 1, childPath);
                        if (found) return found;
                    }
                }
                return null;
            }
            for (const c of containers) {
                const found = deepFind(c.obj, 0, c.name);
                if (found) return found;
            }

            console.log(`${TAG} no model found for provider:`, canonProvider);
            return null;
        } catch (e) {
            console.warn('[GW]/model(ctx) error:', e);
            return null;
        }
    }

    // CONNECT_API_MAP resolution
    function getApiMapFromCtx(profile) {
        ensureCtx();
        if (!profile || !profile.api) return null;
        const cmap = ctx?.CONNECT_API_MAP || window?.CONNECT_API_MAP || {};
        return cmap[profile.api] || null;
    }
    function resolveApiBehavior(profile) {
        const m = getApiMapFromCtx(profile);
        if (!m) return null;
        const family = (m.selected === 'openai') ? 'cc' : 'tc';
        return {
            family,               // 'cc' or 'tc'
            selected: m.selected, // 'openai' | 'textgenerationwebui' | ...
            api_type: m.type,     // e.g., 'koboldcpp'
            source: m.source,     // e.g., 'openai'
            button: m.button || null,
        };
    }

    // Instruct preset resolver
    function resolveEffectiveInstruct(profile) {
        const globalCfg = getGlobalInstructConfig() || {};
        const instructName = (profile?.instruct || '').trim();
        const presetName   = (profile?.preset   || '').trim();

        let presetCfg = null;
        const pick = (name) => {
            if (!name) return null;
            try {
                const a = ctx?.extensionSettings?.instruct?.presets;
                if (a && typeof a[name] === 'object') return a[name];
                const b = ctx?.instruct?.presets;
                if (b && typeof b[name] === 'object') return b[name];
                const c = ctx?.presets;
                if (c && typeof c[name]?.instruct === 'object') return c[name].instruct;
                const d = ctx?.presets?.instruct;
                if (d && typeof d[name] === 'object') return d[name];
            } catch {}
            return null;
        };

        presetCfg = pick(instructName) || pick(presetName);
        const eff = Object.assign({}, globalCfg || {}, presetCfg || {});
        const nameChosen = instructName || presetName || undefined;
        return { cfg: eff, name: nameChosen };
    }

    // Fallback sequences for koboldcpp if any are missing
    function ensureKoboldcppInstruct(instructCfg, apiInfo) {
        if (apiInfo?.api_type !== 'koboldcpp') return instructCfg || {};
        const cfg = Object.assign({}, instructCfg || {});
        const hasSeq = (k) => typeof cfg[k] === 'string' && cfg[k].length > 0;
        if (hasSeq('system_sequence') && hasSeq('input_sequence') && hasSeq('output_sequence')) return cfg;
        const fallback = {
            system_sequence: '<|START_OF_TURN_TOKEN|><|SYSTEM_TOKEN|>',
            system_suffix:   '<|END_OF_TURN_TOKEN|>',
            input_sequence:  '<|START_OF_TURN_TOKEN|><|USER_TOKEN|>',
            input_suffix:    '<|END_OF_TURN_TOKEN|>',
            output_sequence: '<|START_OF_TURN_TOKEN|><|CHATBOT_TOKEN|>',
            output_suffix:   '<|END_OF_TURN_TOKEN|>',
            stop_sequence:   '<|END_OF_TURN_TOKEN|>',
            system_sequence_prefix: '',
            system_sequence_suffix: '',
        };
        return Object.assign({}, fallback, cfg);
    }

    // stop arrays
    function buildStopFields(apiInfo, profile, instructEnabled, instructCfgEff) {
        const fromProfile = getProfileStops(profile);
        const fromInstruct = (instructEnabled && instructCfgEff)
            ? [instructCfgEff.stop_sequence, instructCfgEff.output_suffix]
            : [];
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
        console.log('[GW] stop fields:', unique);
        return unique.length ? { stop: unique, stopping_strings: unique } : {};
    }

    function canon(s) {
        return String(s ?? '')
            .replace(/\r/g, '')
            .replace(/[^\S\n]+/g, ' ')
            .replace(/[ \t]+\n/g, '\n')
            .trim();
    }
    
    /**
     * Build recent history as a neutral <RECENT_HISTORY> block.
     * By default we exclude the trailing user turn to avoid duplicating the prompt.
     */
    function buildRecentHistoryBlock(limit = 5, opts = {}) {
        const { excludeTrailingUser = true, dropUserEqualTo = null } = opts;
        const before = miniTurns.slice(-limit);
        if (!before.length) return '';
    
        // Shallow copy to mutate
        let recent = before.slice();
    
        // 1) Drop the last item if it's a user (we're going to send a fresh user block)
        if (excludeTrailingUser && recent.length && recent[recent.length - 1].role === 'user') {
            console.log('[GW] history: trimming trailing USER turn from history');
            recent.pop();
        }
    
        // 2) Optional dedupe: drop any user turns that equal the new user message
        const needle = dropUserEqualTo ? canon(dropUserEqualTo) : null;
        if (needle) {
            const preLen = recent.length;
            recent = recent.filter(t => !(t.role === 'user' && canon(t.content) === needle));
            if (recent.length !== preLen) {
                console.log('[GW] history: removed user turns equal to current prompt to avoid duplication');
            }
        }
    
        if (!recent.length) return '';
    
        const lines = recent.map((t, i) => {
            const role = t.role === 'assistant' ? 'assistant' : 'user';
            return `${i + 1}. ${role.toUpperCase()}: ${canon(t.content)}`;
        });
    
        return ['<RECENT_HISTORY>', ...lines, '</RECENT_HISTORY>'].join('\n');
    }


/**
 * Build INSTRUCT-mode history, wrapping each past turn with closed sequences.
 * By default we exclude the trailing user turn to avoid duplicating the prompt.
 */
function buildInstructHistory(limit = 5, instruct = {}, opts = {}) {
    const { excludeTrailingUser = true, dropUserEqualTo = null } = opts;

    const USR  = instruct.input_sequence  ?? '';
    const USRs = instruct.input_suffix    ?? '';
    const BOT  = instruct.output_sequence ?? '';
    const BOTs = instruct.output_suffix   ?? '';

    const before = miniTurns.slice(-limit);
    if (!before.length) return '';

    let recent = before.slice();

    if (excludeTrailingUser && recent.length && recent[recent.length - 1].role === 'user') {
        console.log('[GW] instruct history: trimming trailing USER turn from history');
        recent.pop();
    }

    const needle = dropUserEqualTo ? canon(dropUserEqualTo) : null;
    if (needle) {
        const preLen = recent.length;
        recent = recent.filter(t => !(t.role === 'user' && canon(t.content) === needle));
        if (recent.length !== preLen) {
            console.log('[GW] instruct history: removed user turns equal to current prompt to avoid duplication');
        }
    }

    if (!recent.length) return '';

    let out = '';
    for (const turn of recent) {
        const text = canon(turn.content);
        if (!text) continue;
        out += (turn.role === 'assistant') ? (BOT + text + BOTs) : (USR + text + USRs);
    }
    return out;
}
    // Compose INSTRUCT prompt
    function buildInstructPrompt(instruct, systemContent, historyWrapped, userContent, assistantPrefill = '') {
        const SYS  = instruct.system_sequence             ?? '';
        const SYSs = instruct.system_suffix               ?? '';
        const sysPrefix = instruct.system_sequence_prefix ?? '';
        const sysSuffix = instruct.system_sequence_suffix ?? '';
        const USR  = instruct.input_sequence              ?? '';
        const USRs = instruct.input_suffix                ?? '';
        const BOT  = instruct.output_sequence             ?? '';

        if (!SYS || !USR || !BOT) {
            console.warn('[GW] Missing instruct tokens; falling back to linear prompt.');
            return `${systemContent}\n\n${historyWrapped || ''}\n${userContent}${assistantPrefill ? `\n${assistantPrefill}` : ''}`;
        }
        return (
            SYS + (sysPrefix || '') + systemContent + (sysSuffix || '') + (SYSs || '') +
            (historyWrapped || '') +
            USR + userContent + (USRs || '') +
            BOT + (assistantPrefill || '')
        );
    }

    // ===== Regen target resolution =====
    const regen = isRegen === true;
    let targetAssistantIdx = -1, targetAssistantTs = null, targetAssistantNode = null;
    if (regen) {
        for (let i = miniTurns.length - 1; i >= 0; i--) {
            if (miniTurns[i].role === 'assistant') { targetAssistantIdx = i; targetAssistantTs = miniTurns[i].ts; break; }
        }
        if (targetAssistantTs) {
            targetAssistantNode = [...chatLogEl.querySelectorAll('.gw-row[data-role="assistant"]')]
                .find(n => n.dataset.ts === String(targetAssistantTs)) || null;
        }
    }

    // ===== Input normalize =====
    const typedRaw = (inputEl.value ?? '').replace(/\s+/g, ' ').trim();
    if (!regen && !typedRaw) return;

    const charObj = getActiveCharacterFull();
    const charName = (charObj?.name || charObj?.data?.name || ctx?.name2 || '');
    const typedForSend = typedRaw ? maskUserPlaceholders(replaceCharPlaceholders(typedRaw, charName)) : '';

    if (!regen && typedForSend) {
        const userWrap = appendBubble('user', typedForSend);
        const userTs = userWrap?.dataset?.ts || String(Date.now());
        miniTurns.push({ role: 'user', content: typedForSend, ts: userTs });
        saveSession();
        inputEl.value = '';
        inputEl.dispatchEvent(new Event('input'));
        inputEl.focus();
    }

    // ===== Spinner =====
    const spinner = document.createElement('div');
    spinner.textContent = regen ? 'Regenerating…' : 'Thinking…';
    Object.assign(spinner.style, { fontSize: '12px', opacity: .7, margin: '4px 0 0 2px' });
    chatLogEl.append(spinner);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;

    try {
        // ===== Prompt parts =====
        const systemPrompt = buildSystemPrompt(prefs);
        const lastUserMsg  = [...miniTurns].reverse().find(t => t.role === 'user')?.content || '(no new edits)';
        const historyLimit = Math.max(0, Math.min(20, Number(prefs.historyCount ?? 5)));
        const preferredBlock = buildPreferredSceneBlock();
        const chatHistoryBlock = buildRecentHistoryBlock(historyLimit, {
            excludeTrailingUser: true,
            dropUserEqualTo: lastUserMsg,
        });
        

        const profile = getSelectedProfile();
        if (!profile) { appendBubble('assistant', 'No Connection Manager profile selected. Pick one in settings and try again.'); return; }

        const apiInfo = resolveApiBehavior(profile);
        if (!apiInfo) { appendBubble('assistant', `Unknown API type "${profile?.api}". Check CONNECT_API_MAP.`); return; }

        // Determine family *before* logs that use it
        const family = profile.mode ? String(profile.mode).toLowerCase() : apiInfo.family;
        console.log('[GW] family:', family, 'apiInfo:', apiInfo);

        // Resolve instruct enablement and preset-aware config
        const instructGlobal = getGlobalInstructConfig();
        const instructIsOnGlobal = !!(instructGlobal && instructGlobal.enabled);
        const instructIsOnProfile = profileInstructEnabled(profile);
        const hasInstructName = !!(profile?.instruct && String(profile.instruct).trim().length);
        const instructEnabled = instructIsOnGlobal || instructIsOnProfile || hasInstructName;

        const { cfg: instructCfgRaw, name: instructName } = resolveEffectiveInstruct(profile);
        const instructCfgEff = ensureKoboldcppInstruct(instructCfgRaw, apiInfo);
        console.log('[GW] instructEnabled:', instructEnabled, 'instructName:', instructName, 'eff cfg:', instructCfgEff);

        // Resolve model from context first, then profile.model
        const modelFromCtx = getModelFromContextByApi(profile);
        console.log('[GW] modelFromCtx:', modelFromCtx, 'profile.model:', profile.model);

        const temperature = getTemperature();
        let llmResText = '';

        // ===== Chat-completion family (OpenAI-like) =====
        if (family === 'cc' || apiInfo.selected === 'openai') {
            const modelResolved = modelFromCtx || profile.model || null;
            console.log(`[GW] CC modelResolved:`, modelResolved);

            const custom_url = profile['api-url'] || null;
            const proxy = getProxyByName(profile.proxy);
            const reverse_proxy = proxy?.url || null;
            const proxy_password = proxy?.password || null;

            const assistantPrefill = (profile['start-reply-with'] || '').trim();
            const stopFields = buildStopFields(apiInfo, profile, instructEnabled, instructCfgEff);

            const coreUserInstruction = [
                chatHistoryBlock,
                preferredBlock ? `\n${preferredBlock}\n` : '',
                '- Follow the USER_INSTRUCTION using the character data as context.' +
                '- If a preferred scene is provided, keep it almost the same and apply only the requested edits.' +
                `- Output should be ${Number(prefs?.numParagraphs || 3)} paragraph${Number(prefs?.numParagraphs || 3) === 1 ? '' : 's'} with ${Number(prefs?.sentencesPerParagraph || 3)} sentence${Number(prefs?.sentencesPerParagraph || 3) === 1 ? '' : 's'} per paragraph.`,
                'USER_INSTRUCTION:',
                lastUserMsg,
            ].join('\n');

            const approxRespLen = Math.ceil(
                (Number(prefs.numParagraphs || 3) * Number(prefs.sentencesPerParagraph || 3) * 90) * 1.15
            );

            const requestPayload = {
                stream: false,
                messages: [
                    { role: 'system', content: String(systemPrompt) },
                    { role: 'user',   content: String(coreUserInstruction) },
                ],
                chat_completion_source: apiInfo.source, // e.g., 'openai'
                max_tokens: Number.isFinite(approxRespLen) ? approxRespLen : 1024,
                temperature,
                ...(stopFields),
                ...(custom_url     ? { custom_url } : {}),
                ...(reverse_proxy  ? { reverse_proxy } : {}),
                ...(proxy_password ? { proxy_password } : {}),
                ...(modelResolved  ? { model: modelResolved } : {}), // only include if set
            };

            console.log('[GW] CC requestPayload:', requestPayload);

            const response = await ChatCompletionService.processRequest(
                requestPayload,
                { presetName: profile.preset || undefined, instructName: instructEnabled ? (instructName || 'effective') : undefined },
                true,
                null,
            );

            llmResText = String(response?.content || '').trim();

            if (assistantPrefill && llmResText && !llmResText.startsWith(assistantPrefill)) {
                llmResText = assistantPrefill + llmResText;
            }

        // ===== Text-completion family (TGW/Kobold/Novel/Horde) =====
        } else {
            const api_server = profile['api-url'] || null;
            const modelResolved = modelFromCtx || profile.model || null;
            console.log('[GW] TC modelResolved:', modelResolved);

            const assistantPrefill = (profile['start-reply-with'] || '').trim();

            let promptToSend;
            const approxRespLen = Math.ceil(
                (Number(prefs.numParagraphs || 3) * Number(prefs.sentencesPerParagraph || 3) * 90) * 1.15
            );

            if (instructEnabled && instructCfgEff) {
                const instructHistory = buildInstructHistory(historyLimit, instructCfgEff || {}, {
                    excludeTrailingUser: true,
                    dropUserEqualTo: lastUserMsg,
                });
                const userContent = [
                    preferredBlock ? `\n${preferredBlock}\n` : '',
                    '- Follow the USER_INSTRUCTION using the character data as context.' +
                    '- If a preferred scene is provided, keep it almost the same and apply only the requested edits.' +
                    `- Output should be ${Number(prefs?.numParagraphs || 3)} paragraph${Number(prefs?.numParagraphs || 3) === 1 ? '' : 's'} with ${Number(prefs?.sentencesPerParagraph || 3)} sentence${Number(prefs?.sentencesPerParagraph || 3) === 1 ? '' : 's'} per paragraph.`,
                    'USER_INSTRUCTION:',
                    lastUserMsg,
                ].join('\n');

                promptToSend = buildInstructPrompt(
                    instructCfgEff,
                    String(systemPrompt),
                    instructHistory,
                    String(userContent),
                    assistantPrefill
                );
            } else {
                const linearUserBody = [
                    buildRecentHistoryBlock(historyLimit),
                    preferredBlock ? `\n${preferredBlock}\n` : '',
                    '- Follow the USER_INSTRUCTION using the character data as context.' +
                    '- If a preferred scene is provided, keep it almost the same and apply only the requested edits.' +
                    `- Output should be ${Number(prefs?.numParagraphs || 3)} paragraph${Number(prefs?.numParagraphs || 3) === 1 ? '' : 's'} with ${Number(prefs?.sentencesPerParagraph || 3)} sentence${Number(prefs?.sentencesPerParagraph || 3) === 1 ? '' : 's'} per paragraph.`,
                    'USER_INSTRUCTION:',
                    lastUserMsg,
                ].join('\n');

                promptToSend = `${String(systemPrompt)}\n\n${linearUserBody}${assistantPrefill ? `\n${assistantPrefill}` : ''}`;
            }

            const stopFields = buildStopFields(apiInfo, profile, instructEnabled, instructCfgEff);

            const requestPayload = {
                stream: false,
                prompt: promptToSend,
                max_tokens: Number.isFinite(approxRespLen) ? approxRespLen : 1024,
                api_type: apiInfo.api_type, // 'koboldcpp' for koboldcpp/kcpp
                temperature,
                ...(stopFields),
                ...(api_server    ? { api_server } : {}),
                ...(modelResolved ? { model: modelResolved } : {}), // only include if set
            };

            console.log('[GW] TC requestPayload:', {
                ...requestPayload,
                prompt_preview: String(requestPayload.prompt).slice(0, 200)
            });

            const response = await TextCompletionService.processRequest(
                requestPayload,
                {
                    presetName: profile.preset || undefined,
                    instructName: instructEnabled ? (instructName || 'effective') : undefined
                },
                true,
                null,
            );

            llmResText = String(response?.content || '').trim();
        }

        // ===== Normalization =====
        const realUsername = getRealUsername();
        let finalText = normalizeUserToken(llmResText, realUsername);

        // ===== UI commit =====
        if (!finalText) {
            if (!regen) appendBubble('assistant', '(empty response)');
        } else if (regen && targetAssistantIdx !== -1 && targetAssistantNode) {
            const contentEl = targetAssistantNode.querySelector('.gw-content');
            if (contentEl) contentEl.textContent = finalText;
            miniTurns[targetAssistantIdx].content = finalText;
            if (preferredScene && preferredScene.ts === targetAssistantTs) preferredScene.text = finalText;
            saveSession();
        } else {
            const asstWrap = appendBubble('assistant', finalText);
            const asstTs = asstWrap?.dataset?.ts || String(Date.now());
            miniTurns.push({ role: 'assistant', content: finalText, ts: asstTs });
            saveSession();
        }

    } catch (e) {
        console.error('[Greeting Workshop] LLM call failed:', e);
        let msg = 'Error generating text.';
        try { if (typeof e === 'object' && e) msg = e.error?.message ? `Error: ${e.error.message}` : (e.message || msg); } catch {}
        appendBubble('assistant', `${msg} See console for details.`);
    } finally {
        spinner.remove();
    }
}





function onAccept() {
    const last = [...miniTurns].reverse().find(t => t.role === 'assistant');
    if (!last || !last.content.trim()) {
        callGenericPopup('There is no assistant reply to accept yet.', POPUP_TYPE.ALERT, 'Greeting Workshop');
        return;
    }
    replaceStartingMessage(last.content.trim());
    closeWorkshop();
}

function replaceStartingMessage(text) {
    ensureCtx();

    if (!Array.isArray(ctx.chat) || !ctx.chat.length) {
        ctx.chat = [{
            name: ctx.characters?.[ctx.characterId]?.name || 'Assistant',
            is_user: false,
            is_system: false,
            mes: text,
            swipes: [text],
            swipe_id: 0,
            swipe_info: [],
            send_date: Date.now(),
            extra: {}
        }];
    } else {
        const first = ctx.chat[0];
        first.is_user = false;
        first.is_system = false;
        first.mes = text;
        first.swipes = [text];
        first.swipe_id = 0;
        first.swipe_info = [{
            send_date: first.send_date ?? Date.now(),
            gen_started: first.gen_started ?? null,
            gen_finished: first.gen_finished ?? null,
            extra: structuredClone(first.extra ?? {})
        }];
    }

    const mesDiv = document.querySelector('#chat .mes[mesid="0"] .mes_text');
    if (mesDiv) {
        const first = ctx.chat[0];
        mesDiv.innerHTML = messageFormatting(
            first.mes,
            first.name ?? '',
            !!first.is_system,
            !!first.is_user,
            0
        );
    }

    if (typeof syncSwipeToMes === 'function') {
        syncSwipeToMes(0, 0);
    }

    try { eventSource.emit?.('message_updated', 0); } catch { }
}

/* --------------------- helpers --------------------- */

function makeDraggable(panel, handle) {
    let sx = 0, sy = 0, px = 0, py = 0, dragging = false;
    handle.style.cursor = 'move';
    handle.addEventListener('mousedown', e => {
        dragging = true;
        const rect = panel.getBoundingClientRect();
        sx = e.clientX; sy = e.clientY; px = rect.left; py = rect.top;
        panel.style.left = `${px}px`; panel.style.top = `${py}px`;
        panel.style.transform = 'translate(0,0)';
        document.body.style.userSelect = 'none';
    });
    const move = e => {
        if (!dragging) return;
        const nl = px + (e.clientX - sx);
        const nt = py + (e.clientY - sy);
        panel.style.left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, nl)) + 'px';
        panel.style.top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, nt)) + 'px';
    };
    const up = () => { dragging = false; document.body.style.userSelect = ''; };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
}

function findHeaderMount() {
    const firstMesBlock = document.querySelector('#chat .mes[mesid="0"] .mes_block');
    if (firstMesBlock) return firstMesBlock.querySelector('.ch_name')?.parentElement || firstMesBlock;
    return document.querySelector('#chatTopBar, .chat_header, #send_form') || document.body;
}

function injectWorkshopButton() {
    // Conditions: no welcome panel AND exactly one visible message
    if (isWelcomePanelOpen() || chatMessageCount() !== 1) {
        removeWorkshopButton();
        return;
    }

    const chat = document.getElementById('chat');
    if (!chat) return;

    // Ensure we don’t duplicate
    if (document.getElementById('stcm-gw-btn')) return;

    const topMes = findTopMessageEl();
    if (!topMes || !topMes.parentNode) return;

    // Create a holder that sits ABOVE the first message
    let holder = document.getElementById('stcm-gw-holder');
    if (!holder) {
        holder = document.createElement('div');
        holder.id = 'stcm-gw-holder';
        Object.assign(holder.style, {
            display: 'flex',
            justifyContent: 'flex-start',
            margin: '6px 0 8px 0'
        });
        // Insert before the top message node
        topMes.parentNode.insertBefore(holder, topMes);
    } else {
        // If holder exists but isn’t in the right place, move it
        if (holder.nextElementSibling !== topMes) {
            holder.remove();
            topMes.parentNode.insertBefore(holder, topMes);
        }
    }

    // Build the button
    const btn = document.createElement('button');
    btn.id = 'stcm-gw-btn';
    btn.textContent = '✨ Greeting Workshop';
    Object.assign(btn.style, {
        padding: '4px 10px',
        background: '#333',
        color: '#fff',
        border: '1px solid #666',
        borderRadius: '6px',
        cursor: 'pointer'
    });
    btn.addEventListener('click', openWorkshop);

    // Clean any stale children and attach fresh button
    holder.innerHTML = '';
    holder.appendChild(btn);
}



/* --------------------- lifecycle --------------------- */

export function initCustomGreetingWorkshop() {
    ensureCtx();

    // --- capture chatLoaded to cache the full character object
    const cacheFromEvent = (payload) => {
        try {
            const detail = payload?.detail || payload; // supports both patterns
            const prevId = String(activeCharId ?? '');
            const nextId = String(detail?.id ?? detail?.character?.id ?? '');

            if (detail?.character) {
                activeCharCache = detail.character;
                activeCharId = nextId || null;

                // keep ctx.characterId up to date if missing
                if (ctx && (ctx.characterId == null) && activeCharId != null) {
                    ctx.characterId = String(activeCharId);
                }
            }

            // If the character actually changed…
            if (nextId && prevId && nextId !== prevId) {
                // Mark the new last-opened char id
                try { localStorage.setItem(LAST_CHAR_KEY, String(nextId)); } catch { }

                // Start the new character's workshop state clean
                try {
                    localStorage.setItem(`stcm_gw_state_${String(nextId)}`, JSON.stringify({ miniTurns: [], preferredScene: null }));
                } catch { }

                // If the workshop modal is currently open, clear its in-memory + UI state immediately
                if (typeof modal !== 'undefined' && modal) {
                    try { clearWorkshopState(); } catch { }
                }
            }
        } catch (e) {
            console.warn('[GW] failed to cache character from chatLoaded:', e);
        }
    };


    // If ST dispatches a DOM CustomEvent:
    try { document.addEventListener?.('chatLoaded', (e) => cacheFromEvent(e)); } catch { }

    // If ST routes via its event bus:
    const origEmit = eventSource.emit;
    eventSource.emit = function (event, ...args) {
        if (event === 'chatLoaded' && args?.[0]) cacheFromEvent(args[0]);
        if (event === 'message_deleted' || event === 'swipe_change' || event === 'chatLoaded') {
            setTimeout(() => { try { injectWorkshopButton(); } catch { } }, 80);
        }
        return origEmit.apply(this, arguments);
    };

    const tryInject = () => {
        if (isWelcomePanelOpen() || chatMessageCount() !== 1) {
            removeWorkshopButton();
            return;
        }
        try { injectWorkshopButton(); } catch { }
    };


    if (document.readyState !== 'loading') setTimeout(tryInject, 60);
    document.addEventListener('DOMContentLoaded', () => setTimeout(tryInject, 120));

    const root = document.getElementById('chat') || document.body;
    const mo = new MutationObserver(() => tryInject());
    mo.observe(root, { childList: true, subtree: true });
}

export function openGreetingWorkshop() { openWorkshop(); }

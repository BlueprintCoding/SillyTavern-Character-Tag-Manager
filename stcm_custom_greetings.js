// stcm_custom_greetings.js
// SillyTavern Character Manager – Custom Greeting Workshop
// Opens a mini chat with the active LLM to craft the first greeting,
// then replaces the starting message in the main chat on accept.

import { getContext } from "../../../extensions.js";
import { callGenericPopup, POPUP_TYPE } from "../../../popup.js";
import {
    eventSource,
    messageFormatting,
    syncSwipeToMes,
    generateRaw as stGenerateRaw,
} from "../../../../script.js";

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
    } catch {}
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
        '<PREFERRED_SCENE>',
        preferredScene.text,
        '</PREFERRED_SCENE>'
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
  
    // 1) Clear any preferred decorations BEFORE nulling handles
    try { clearPreferredUI(); } catch {}
  
    // 2) Wipe in-memory state
    miniTurns = [];
    preferredScene = null;
    preferredEls = null;
  
    // 3) Persist a clean state for this character
    try {
      localStorage.setItem(STATE_KEY(), JSON.stringify({ miniTurns: [], preferredScene: null }));
    } catch {}
  
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
    // card data can live both top-level and under ch.data.*
    const d = ch?.data || {};
    const pick = (k) => ch?.[k] ?? d?.[k] ?? null;

    return {
        name: pick('name'),
        description: pick('description'),
        personality: pick('personality'),
        scenario: pick('scenario'),
        first_mes: pick('first_mes'),
        alternate_greetings: pick('alternate_greetings') || [],
        mes_example: pick('mes_example'),
        // keep anything else you explicitly want:
        creator_notes: pick('creator_notes') ?? ch?.creatorcomment ?? null,
        tags: pick('tags') || ch?.tags || [],
        spec: ch?.spec ?? null,
        spec_version: ch?.spec_version ?? null,
    };
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
    const charEdit = (ch?.name || ch?.data?.name || ctx?.name2 || '{{char}}');
    const who = 'A Character Card Greeting Editing Assistant';

    const nParas = Math.max(1, Number(prefs.numParagraphs || 3));
    const nSents = Math.max(1, Number(prefs.sentencesPerParagraph || 3));

    return [
        `You are ${who}. Your task is to craft an opening scene to begin a brand-new chat.`,
        `Format strictly as ${nParas} paragraph${nParas === 1 ? '' : 's'}, with exactly ${nSents} sentence${nSents === 1 ? '' : 's'} per paragraph.`,
        `Target tone: ${prefs.style}.`,
        `Your top priority is to FOLLOW THE USER'S INSTRUCTION.`,
        `- If a preferred scene is provided under <PREFERRED_SCENE>, preserve it closely (≈90–95% unchanged) and apply ONLY the explicit edits from USER_INSTRUCTION.`,
        `- Maintain the same structure (paragraph count and sentences per paragraph).`,
        `- If they ask for a brief greeting/opening line instead of a scene, keep it to 1–2 sentences and ignore the paragraph/sentence settings.`,
        `- If they ask for ideas, names, checks, rewrites, longer text, etc., do THAT instead. Do not force a greeting.`,
        `You are NOT ${charEdit}; never roleplay as them. You are creating a scene for them based on the user's input.`,
        `You will receive the COMPLETE character object for ${charEdit} as JSON under <CHARACTER_DATA_JSON>.`,
        `Use ONLY the provided JSON as ground truth for the scene.`,
        `Formatting rules:`,
        `- Return only what the user asked for; no meta/system talk; no disclaimers.`,
        `- If the user asked for a greeting, return only the greeting text (no extra commentary).`,
        buildCharacterJSONBlock()
    ].join('\n\n');
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
    if (modal) return;

    const prefs = loadPrefs();

    overlay = document.createElement('div');
    Object.assign(overlay.style, { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 10000 });

    modal = document.createElement('div');
    Object.assign(modal.style, {
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 'min(720px,92vw)', maxHeight: '85vh', overflow: 'hidden',
        background: '#1b1b1b', color: '#ddd', border: '1px solid #555',
        borderRadius: '10px', boxShadow: '0 8px 30px rgba(0,0,0,.5)', zIndex: 10001,
        display: 'flex', flexDirection: 'column', resize: 'both', overflow: 'auto'
    });

    const header = document.createElement('div');
    header.textContent = 'Greeting Workshop';
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
    Object.assign(body.style, { display: 'grid', gridTemplateRows: '1fr auto', padding: '0 12px 12px 12px', gap: '10px', height: '60vh' });

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

    closeBtn = mkBtn('X', '#9e2a2a');
    header.append(closeBtn);

    const footer = document.createElement('div');
    Object.assign(footer.style, { display: 'flex', gap: '8px', padding: '10px 12px', borderTop: '1px solid #333', background: '#1f1f1f' });

    regenBtn = mkBtn('Regenerate', '#007acc');
    editBtn = mkBtn('Edit Last', '#8e44ad');
    copyBtn = mkBtn('Copy Last', '#616161');
    acceptBtn = mkBtn('Accept → Replace Start', '#d35400');

    const clearBtn = mkBtn('Clear Memory', '#9e2a2a'); // or theme color

    closeBtn.addEventListener('click', closeWorkshop);

    clearBtn.addEventListener('click', () => {
        callGenericPopup(
          'Clear workshop memory (history & preferred scene)?',
          POPUP_TYPE.CONFIRM,
          'Greeting Workshop',
          () => { clearWorkshopState(); },  // OK
          () => {}                          // Cancel
        );
      });
      
      
    
    footer.append(regenBtn, editBtn, copyBtn, spacer(), acceptBtn, clearBtn);
    

    modal.append(header, settings, body, footer);
    body.append(chatLogEl, composer);
    document.body.append(overlay, modal);

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

    // appendBubble('assistant', 'Describe the opening you want (tone, length, topics, formality, etc.).', { noActions: true });


    sendBtn.addEventListener('click', () => onSendToLLM(false));
    regenBtn.addEventListener('click', onRegenerate);
    editBtn.addEventListener('click', onEditLastAssistant);
    copyBtn.addEventListener('click', onCopyLastAssistant);
    acceptBtn.addEventListener('click', onAccept);
    

    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onSendToLLM(false);
        }
    });

    // hydrate state first
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
    bubble.innerHTML = esc(text);

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
            markPreferred(wrap, bubble, text);
            saveSession();
            starBtn.setAttribute(
                'aria-pressed',
                preferredScene && preferredScene.ts === wrap.dataset.ts ? 'true' : 'false'
            );
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

        bar.appendChild(starBtn);
        bar.appendChild(trashBtn);
        bubble.appendChild(bar);
    }

    chatLogEl.scrollTop = chatLogEl.scrollHeight;
    return wrap;
}



function onCopyLastAssistant() {
    const last = [...miniTurns].reverse().find(t => t.role === 'assistant');
    if (!last) return;
    navigator.clipboard.writeText(last.content);
}

function onEditLastAssistant() {
    const last = [...miniTurns].reverse().find(t => t.role === 'assistant');
    if (!last) return;
    const ta = document.createElement('textarea');
    Object.assign(ta.style, { width: '100%', minHeight: '80px', background: '#222', color: '#eee', border: '1px solid #444', borderRadius: '6px', padding: '8px' });
    ta.value = last.content;
    const editorWrap = document.createElement('div');
    Object.assign(editorWrap.style, { margin: '6px 0' });
    const saveBtn = mkBtn('Save Edit', '#8e44ad');
    saveBtn.style.marginTop = '6px';
    editorWrap.append(ta, saveBtn);
    chatLogEl.append(editorWrap);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
    saveBtn.addEventListener('click', () => {
        last.content = ta.value.trim();
        saveSession();
        appendBubble('assistant', last.content);
        editorWrap.remove();
    });
}

async function onRegenerate() {
    const lastUser = [...miniTurns].reverse().find(t => t.role === 'user');
    if (!lastUser) {
        callGenericPopup('No prior user instruction to regenerate from.', POPUP_TYPE.ALERT, 'Greeting Workshop');
        return;
    }
    inputEl.value = lastUser.content; // keep visible
    await onSendToLLM(true);
}

function buildRecentHistoryBlock(limit = 5) {
    // take last `limit` messages (user/assistant) in chronological order
    const recent = miniTurns.slice(-limit);
    if (!recent.length) return '';

    const lines = recent.map((t, i) => {
        const role = t.role === 'assistant' ? 'assistant' : 'user';
        // Keep it plain; the system prompt already handles formatting rules.
        return `${i + 1}. ${role.toUpperCase()}: ${t.content}`;
    });

    return [
        '<RECENT_HISTORY>',
        ...lines,
        '</RECENT_HISTORY>'
    ].join('\n');
}

async function onSendToLLM(isRegen = false) {
    ensureCtx();
    const prefs = loadPrefs();

    // coerce truthiness to a real boolean (protects against event objects)
    const regen = isRegen === true;

    // normalize input
    const typedRaw = (inputEl.value ?? '').replace(/\s+/g, ' ').trim();
    if (!typedRaw && !regen) return;

    // transform once so the bubble shows exactly what we send
    const charName = (getActiveCharacterFull()?.name || getActiveCharacterFull()?.data?.name || ctx?.name2 || '');
    const typedForSend = typedRaw ? maskUserPlaceholders(replaceCharPlaceholders(typedRaw, charName)) : '';

// Insert user's message into the workshop chat history + UI (tracked history)
if (!regen && typedForSend) {
    const userWrap = appendBubble('user', typedForSend);
    const userTs = userWrap?.dataset?.ts || String(Date.now());
    miniTurns.push({ role: 'user', content: typedForSend, ts: userTs });
    saveSession();

    // clear input and keep focus for fast iteration
    inputEl.value = '';
    inputEl.dispatchEvent(new Event('input'));
    inputEl.focus();
}


    // spinner
    const spinner = document.createElement('div');
    spinner.textContent = 'Thinking…';
    Object.assign(spinner.style, { fontSize: '12px', opacity: .7, margin: '4px 0 0 2px' });
    chatLogEl.append(spinner);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;

    try {
        const systemPrompt = buildSystemPrompt(prefs);

        // Most recent user instruction (already transformed if newly sent)
        const lastUserMsg = [...miniTurns].reverse().find(t => t.role === 'user')?.content || '(no new edits)';

        // Include the last N messages of mini chat history on every call
        const historyLimit = Math.max(0, Math.min(20, Number(prefs.historyCount ?? 5)));
        const historyBlock = buildRecentHistoryBlock(historyLimit);

        // Optional preferred scene block
        const preferredBlock = buildPreferredSceneBlock();

        // Two-block prompt (+ optional third block for preferred scene)
        // Order: HISTORY → (PREFERRED_SCENE if any) → INSTRUCTION
        const rawPrompt = [
            historyBlock, // <RECENT_HISTORY> ... </RECENT_HISTORY>
            preferredBlock ? `\n${preferredBlock}\n` : '',
            'USER_INSTRUCTION:',
            lastUserMsg,
            '',
            'Follow the instruction above using the character data as context. ' +
            'If a preferred scene is provided, keep it almost the same and apply only the requested edits.'
        ].join('\n');

        // Rough sizing: ~90 chars per sentence
        const approxRespLen = Math.ceil(
            (Number(prefs.numParagraphs || 3) * Number(prefs.sentencesPerParagraph || 3) * 90) * 1.15
        );

        const res = await stGenerateRaw(
            String(rawPrompt),
            null,
            true,
            true,
            String(systemPrompt),
            approxRespLen,
            true,
            '',
            null
        );

        const llmResText = String(res || '').trim();
        if (!llmResText) {
            appendBubble('assistant', '(empty response)');
        } else {
            const asstWrap = appendBubble('assistant', llmResText);
            const asstTs = asstWrap?.dataset?.ts || String(Date.now());
            miniTurns.push({ role: 'assistant', content: llmResText, ts: asstTs });
            saveSession();

        }
        
    } catch (e) {
        console.error('[Greeting Workshop] LLM call failed:', e);
        appendBubble('assistant', '⚠️ Error generating text. See console for details.');
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
    if (document.getElementById('stcm-gw-btn')) return;
    const mount = findHeaderMount();
    const btn = document.createElement('button');
    btn.id = 'stcm-gw-btn';
    btn.textContent = '✨ Greeting Workshop';
    Object.assign(btn.style, {
        padding: '4px 10px', margin: '4px 0',
        background: '#333', color: '#fff', border: '1px solid #666', borderRadius: '6px', cursor: 'pointer'
    });
    btn.addEventListener('click', openWorkshop);
    mount.prepend(btn);
}



/* --------------------- lifecycle --------------------- */

export function initCustomGreetingWorkshop() {
    ensureCtx();

    // --- capture chatLoaded to cache the full character object
    const cacheFromEvent = (payload) => {
        try {
            const detail = payload?.detail || payload; // supports both patterns
            if (detail?.character) {
                activeCharCache = detail.character;
                activeCharId = detail.id ?? null;
                // keep ctx.characterId up to date if missing
                if (ctx && (ctx.characterId == null) && activeCharId != null) {
                    ctx.characterId = String(activeCharId);
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

    const tryInject = () => { try { injectWorkshopButton(); } catch { } };
    if (document.readyState !== 'loading') setTimeout(tryInject, 60);
    document.addEventListener('DOMContentLoaded', () => setTimeout(tryInject, 120));

    const root = document.getElementById('chat') || document.body;
    const mo = new MutationObserver(() => tryInject());
    mo.observe(root, { childList: true, subtree: true });
}

export function openGreetingWorkshop() { openWorkshop(); }

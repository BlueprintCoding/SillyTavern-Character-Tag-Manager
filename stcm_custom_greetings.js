// stcm_custom_greetings.js
// SillyTavern Character Manager – Custom Greeting Workshop
// Opens a mini chat with the active LLM to craft the first greeting,
// then replaces the starting message in the main chat on accept.

import { getContext } from "../../../extensions.js";
import { callGenericPopup, POPUP_TYPE } from "../../../popup.js";
import { eventSource, messageFormatting, syncSwipeToMes } from "../../../../script.js";

let ctx = null;
function ensureCtx() {
    if (!ctx) ctx = getContext();
    ctx.extensionSettings ??= {};
    ctx.extensionSettings.stcm ??= {};
}

const PREFS_KEY = 'stcm_greeting_workshop_prefs';

function loadPrefs() {
    try {
        return JSON.parse(localStorage.getItem(PREFS_KEY)) || {
            style: 'friendly, concise, welcoming',
            maxChars: 320,
            allowOneShortQuestion: true,
            useQuietPrompt: false, // if true, single-turn via generateQuietPrompt using full chat context
            language: ''           // empty = auto from ctx.locale
        };
    } catch {
        return { style: 'friendly, concise, welcoming', maxChars: 320, allowOneShortQuestion: true, useQuietPrompt: false, language: '' };
    }
}
function savePrefs(p) { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); }

function esc(s) {
    return (s ?? '').toString()
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// Build a system prompt using current character & prefs.
// This is used for generateRaw() (multi-turn).
function buildSystemPrompt(prefs) {
    ensureCtx();
    const lang = (prefs.language || ctx.locale || 'en').trim();
    const ch = ctx.characters?.[ctx.characterId] || ctx.character || {};
    const who = ch?.name ? `${ch.name}${ch.role ? ` (${ch.role})` : ''}` : 'Assistant';

    // Pull what we can from common ST character fields:
    const lore = ch?.description || ch?.comment || ch?.scenario || ch?.summary || '';
    const tags = Array.isArray(ch?.tags) ? ch.tags.filter(Boolean) : [];
    const starterHint = ch?.first_mes || ch?.greeting || '';

    const rules = [
        `You are ${who}. Your task is to craft a SHORT opening line to begin a brand-new chat.`,
        `Language: ${lang}. Target tone: ${prefs.style}. Max length: ${prefs.maxChars} characters.`,
        prefs.allowOneShortQuestion
            ? `Optionally include ONE brief, relevant icebreaker question.`
            : `Do not include any questions.`,
        `No meta/system talk. No disclaimers. Avoid repetition.`,
        lore ? `Character context:\n${lore}` : '',
        tags.length ? `Tags: ${tags.join(', ')}` : '',
        starterHint ? `If aligned, echo the intended opener's theme: ${starterHint}` : '',
        `Output only the greeting text unless directly asked for analysis.`
    ].filter(Boolean).join('\n\n');

    return rules;
}

// Convert our mini “chat” state to Chat Completion format for generateRaw()
function buildChatPromptFromTurns(turns) {
    // turns: [{role:'user'|'assistant', content:'...'}]
    // return array compatible with Chat Completions
    return turns.map(t => ({ role: t.role, content: t.content }));
}

function normalizeLLMText(res) {
    return (
        res?.text ??
        res?.response ??
        res?.choices?.[0]?.message?.content ??
        res?.choices?.[0]?.text ??
        ''
    );
}

// ------------------------- UI: modal & interactions -------------------------
let modal, overlay;
let chatLogEl, inputEl, sendBtn, regenBtn, acceptBtn, editBtn, copyBtn, closeBtn;
let useQuietToggleEl, styleInputEl, maxInputEl, iceToggleEl, langInputEl;

let miniTurns = []; // mini chat history for generateRaw()

function openWorkshop() {
    ensureCtx();
    if (modal) return; // already open

    const prefs = loadPrefs();

    overlay = document.createElement('div');
    Object.assign(overlay.style, {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10000
    });

    modal = document.createElement('div');
    Object.assign(modal.style, {
        position: 'fixed',
        top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 'min(720px, 92vw)', maxHeight: '85vh', overflow: 'hidden',
        background: '#1b1b1b', color: '#ddd', border: '1px solid #555',
        borderRadius: '10px', boxShadow: '0 8px 30px rgba(0,0,0,.5)', zIndex: 10001,
        display: 'flex', flexDirection: 'column'
    });

    const header = document.createElement('div');
    header.textContent = 'Greeting Workshop';
    Object.assign(header.style, { padding: '10px 12px', borderBottom: '1px solid #444', fontWeight: 600, background: '#222' });

    const settings = document.createElement('div');
    Object.assign(settings.style, { display:'grid', gridTemplateColumns:'1fr 120px 180px 1fr 110px', gap:'8px', padding:'8px 12px', alignItems:'center', borderBottom:'1px solid #333' });
    settings.innerHTML = `
        <label style="display:flex;gap:6px;align-items:center">
            <input type="checkbox" id="gw-use-quiet"> Use chat context (quiet)
        </label>
        <label>Max
            <input id="gw-max" type="number" min="60" max="600" value="${prefs.maxChars}" style="width:80px;margin-left:6px">
        </label>
        <label>Language
            <input id="gw-lang" type="text" placeholder="auto" value="${esc(prefs.language || '')}" style="width:100%;margin-left:6px">
        </label>
        <label>Style
            <input id="gw-style" type="text" value="${esc(prefs.style)}" style="width:100%;margin-left:6px">
        </label>
        <label style="display:flex;gap:6px;align-items:center;justify-self:end">
            <input type="checkbox" id="gw-ice"> One short Q?
        </label>
    `;

    const body = document.createElement('div');
    Object.assign(body.style, { display:'grid', gridTemplateRows:'1fr auto', padding:'0 12px 12px 12px', gap:'10px', height:'60vh' });

    chatLogEl = document.createElement('div');
    Object.assign(chatLogEl.style, { overflowY:'auto', padding:'10px 4px', border:'1px solid #333', borderRadius:'8px', background:'#181818' });

    const composer = document.createElement('div');
    Object.assign(composer.style, { display:'grid', gridTemplateColumns:'1fr auto', gap:'8px' });
    inputEl = document.createElement('textarea');
    inputEl.placeholder = 'Describe the greeting you want (tone, topics, constraints)…';
    Object.assign(inputEl.style, { resize:'vertical', minHeight:'48px', maxHeight:'160px', padding:'8px', background:'#222', color:'#eee', border:'1px solid #444', borderRadius:'6px' });

    sendBtn = document.createElement('button');
    sendBtn.textContent = 'Send to LLM';
    Object.assign(sendBtn.style, btnStyle('#2e7d32'));
    composer.append(inputEl, sendBtn);

    const footer = document.createElement('div');
    Object.assign(footer.style, { display:'flex', gap:'8px', padding:'10px 12px', borderTop:'1px solid #333', background:'#1f1f1f' });

    regenBtn  = mkBtn('Regenerate', '#007acc');
    editBtn   = mkBtn('Edit Last', '#8e44ad');
    copyBtn   = mkBtn('Copy Last', '#616161');
    acceptBtn = mkBtn('Accept → Replace Start', '#d35400');
    closeBtn  = mkBtn('Close', '#444');

    footer.append(regenBtn, editBtn, copyBtn, spacer(), acceptBtn, spacer(), closeBtn);

    modal.append(header, settings, body, footer);
    body.append(chatLogEl, composer);

    document.body.append(overlay, modal);
    makeDraggable(modal, header);

    // wire settings
    useQuietToggleEl = settings.querySelector('#gw-use-quiet');
    styleInputEl     = settings.querySelector('#gw-style');
    maxInputEl       = settings.querySelector('#gw-max');
    langInputEl      = settings.querySelector('#gw-lang');
    iceToggleEl      = settings.querySelector('#gw-ice');

    useQuietToggleEl.checked = !!prefs.useQuietPrompt;
    iceToggleEl.checked      = !!prefs.allowOneShortQuestion;

    settings.addEventListener('change', () => {
        const next = {
            useQuietPrompt: !!useQuietToggleEl.checked,
            style: (styleInputEl.value || 'friendly, concise, welcoming').trim(),
            maxChars: Math.max(60, Math.min(600, Number(maxInputEl.value) || 320)),
            allowOneShortQuestion: !!iceToggleEl.checked,
            language: (langInputEl.value || '').trim()
        };
        savePrefs(next);
    });

    // seed a helper message
    appendBubble('assistant', 'Tell me what kind of opening line you want. You can mention tone, length, topics, formality, emoji policy, etc.');

    // actions
    sendBtn.addEventListener('click', onSendToLLM);
    regenBtn.addEventListener('click', onRegenerate);
    editBtn.addEventListener('click', onEditLastAssistant);
    copyBtn.addEventListener('click', onCopyLastAssistant);
    acceptBtn.addEventListener('click', onAccept);
    closeBtn.addEventListener('click', closeWorkshop);

    inputEl.focus();
}

function closeWorkshop() {
    if (modal) modal.remove();
    if (overlay) overlay.remove();
    modal = overlay = null;
    miniTurns = [];
}

function btnStyle(bg) {
    return {
        padding:'8px 12px', background:bg, color:'#fff',
        border:'1px solid #444', borderRadius:'6px', cursor:'pointer', fontWeight:600
    };
}
function mkBtn(label, bg) { const b = document.createElement('button'); b.textContent = label; Object.assign(b.style, btnStyle(bg)); return b; }
function spacer() { const s = document.createElement('div'); s.style.flex = '1'; return s; }

function appendBubble(role, text) {
    const wrap = document.createElement('div');
    const bubble = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.margin = '6px 0';

    const isUser = role === 'user';
    bubble.innerHTML = esc(text);
    Object.assign(bubble.style, {
        padding:'8px 10px', borderRadius:'8px',
        background: isUser ? '#2b2b2b' : '#242424',
        border: '1px solid #3a3a3a', maxWidth:'90%', whiteSpace:'pre-wrap'
    });
    wrap.style.justifyContent = isUser ? 'flex-end' : 'flex-start';

    wrap.append(bubble);
    chatLogEl.append(wrap);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

function onCopyLastAssistant() {
    const last = [...miniTurns].reverse().find(t => t.role === 'assistant');
    if (!last) return;
    navigator.clipboard.writeText(last.content);
}

function onEditLastAssistant() {
    const last = [...miniTurns].reverse().find(t => t.role === 'assistant');
    if (!last) return;
    // Replace last assistant bubble with textarea for quick edits
    const ta = document.createElement('textarea');
    Object.assign(ta.style, { width:'100%', minHeight:'80px', background:'#222', color:'#eee', border:'1px solid #444', borderRadius:'6px', padding:'8px' });
    ta.value = last.content;
    // Append editor and update on confirm
    const editorWrap = document.createElement('div');
    Object.assign(editorWrap.style, { margin:'6px 0' });
    const saveBtn = mkBtn('Save Edit', '#8e44ad');
    saveBtn.style.marginTop = '6px';
    editorWrap.append(ta, saveBtn);
    chatLogEl.append(editorWrap);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
    saveBtn.addEventListener('click', () => {
        last.content = ta.value.trim();
        appendBubble('assistant', last.content);
        editorWrap.remove();
    });
}

async function onRegenerate() {
    const lastUser = [...miniTurns].reverse().find(t => t.role === 'user');
    if (!lastUser) return callGenericPopup('No prior user instruction to regenerate from.', POPUP_TYPE.ALERT, 'Greeting Workshop');
    inputEl.value = lastUser.content;
    await onSendToLLM(true); // regen flag
}

async function onSendToLLM(isRegen = false) {
    ensureCtx();
    const prefs = loadPrefs();
    const userText = (inputEl.value || '').trim();
    if (!userText && !isRegen) return;

    if (!isRegen) {
        miniTurns.push({ role:'user', content:userText });
        appendBubble('user', userText);
        inputEl.value = '';
    }

    // Visual spinner
    const spinner = document.createElement('div');
    spinner.textContent = 'Thinking…';
    Object.assign(spinner.style, { fontSize:'12px', opacity:.7, margin:'4px 0 0 2px' });
    chatLogEl.append(spinner);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;

    try {
        let llmResText = '';

        if (prefs.useQuietPrompt && typeof ctx.generateQuietPrompt === 'function') {
            // Single-turn: use full chat/character context; send the user's wish as a post-history instruction.
            const quietPrompt = [
                buildSystemPrompt(prefs),
                '',
                'Now craft the greeting based on the following instruction:',
                miniTurns[miniTurns.length - 1]?.role === 'user' ? miniTurns[miniTurns.length - 1].content : '(no new edits)'
            ].join('\n');

            const res = await ctx.generateQuietPrompt({ quietPrompt });
            llmResText = (normalizeLLMText(res) || '').trim();
        } else if (typeof ctx.generateRaw === 'function') {
            // Multi-turn conversation: our own message history + a strong system prompt.
            const systemPrompt = buildSystemPrompt(prefs);
            const prompt = buildChatPromptFromTurns(miniTurns);
            const res = await ctx.generateRaw({ systemPrompt, prompt });
            llmResText = (normalizeLLMText(res) || '').trim();
        } else {
            throw new Error('Neither generateRaw() nor generateQuietPrompt() is available.');
        }

        if (!llmResText) {
            appendBubble('assistant', '(empty response)');
        } else {
            miniTurns.push({ role:'assistant', content: llmResText });
            appendBubble('assistant', llmResText);
        }
    } catch (e) {
        console.error('[Greeting Workshop] LLM call failed:', e);
        appendBubble('assistant', '⚠️ Error generating text. See console for details.');
    } finally {
        spinner.remove();
    }
}

function onAccept() {
    // Find the last assistant message and apply it as the new starting message.
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
        // Create the first message if somehow absent
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

    // Update DOM immediately
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

    // Try to sync with ST swipe machinery (preferred)
    if (typeof syncSwipeToMes === 'function') {
        syncSwipeToMes(0, 0);
    }

    // Fire a lightweight event if others listen
    try { eventSource.emit?.('message_updated', 0); } catch {}
}

// ------------------------- Draggable header (lightweight) -------------------
function makeDraggable(panel, handle) {
    let sx=0, sy=0, px=0, py=0, dragging=false;
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
        panel.style.top  = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, nt)) + 'px';
    };
    const up = () => { dragging = false; document.body.style.userSelect = ''; };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
}

// ------------------------- Header button injection --------------------------
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
        background: '#333', color:'#fff', border:'1px solid #666', borderRadius:'6px', cursor:'pointer'
    });
    btn.addEventListener('click', openWorkshop);
    mount.prepend(btn);
}

// ------------------------- Public API & lifecycle ---------------------------
export function initCustomGreetingWorkshop() {
    ensureCtx();

    // inject button after chat load or whenever message 0 re-renders
    const tryInject = () => { try { injectWorkshopButton(); } catch {} };
    if (document.readyState !== 'loading') setTimeout(tryInject, 60);
    document.addEventListener('DOMContentLoaded', () => setTimeout(tryInject, 120));

    // Hook ST events in a safe shim (preserve original)
    const origEmit = eventSource.emit;
    eventSource.emit = function(event, ...args) {
        if (event === 'chatLoaded' || event === 'message_deleted' || event === 'swipe_change') {
            setTimeout(tryInject, 80);
        }
        return origEmit.apply(this, arguments);
    };

    // As a fallback, observe DOM mutations under #chat
    const root = document.getElementById('chat') || document.body;
    const mo = new MutationObserver(() => tryInject());
    mo.observe(root, { childList: true, subtree: true });
}

// Optional: open programmatically (e.g., from a menu)
export function openGreetingWorkshop() {
    openWorkshop();
}

// stcm_freshness.js
// Background freshness checker for characters with source URLs

import { characters } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { getCharactersWithSources } from './stcm_updates.js';

const CHECK_INTERVAL_MS = 60 * 1000; // 1 minute between checks
const EXTENSION_NAME = 'SillyTavern-Character-Tag-Manager';

let freshnessCheckTimer = null;
let isChecking = false;

/**
 * Get or initialize freshness data storage
 */
function getFreshnessData() {
    if (!extension_settings[EXTENSION_NAME]) {
        extension_settings[EXTENSION_NAME] = {};
    }
    if (!extension_settings[EXTENSION_NAME].freshness) {
        extension_settings[EXTENSION_NAME].freshness = {};
    }
    return extension_settings[EXTENSION_NAME].freshness;
}

/**
 * Get freshness info for a specific character
 * @param {string} avatar - Character avatar (unique identifier)
 * @returns {{lastChecked: number|null, lastSourceUpdate: number|null, status: 'fresh'|'stale'|'unknown'|'error', errorMessage?: string}}
 */
export function getCharacterFreshness(avatar) {
    const data = getFreshnessData();
    return data[avatar] || {
        lastChecked: null,
        lastSourceUpdate: null,
        status: 'unknown',
    };
}

/**
 * Update freshness info for a character
 */
function setCharacterFreshness(avatar, info) {
    const data = getFreshnessData();
    data[avatar] = {
        ...data[avatar],
        ...info,
        lastChecked: Date.now(),
    };
    // Save settings (debounced by ST)
    if (typeof SillyTavern !== 'undefined') {
        SillyTavern.getContext().saveSettingsDebounced();
    }
}

/**
 * Parse a Chub URL to extract creator and character name
 * @param {string} url
 * @returns {{creator: string, name: string}|null}
 */
function parseChubUrl(url) {
    // Handle various Chub URL formats
    // https://chub.ai/characters/creator/charname
    // https://www.chub.ai/characters/creator/charname
    // https://characterhub.org/characters/creator/charname
    const patterns = [
        /(?:chub\.ai|characterhub\.org)\/characters\/([^\/]+)\/([^\/\?#]+)/i,
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
            return { creator: match[1], name: match[2] };
        }
    }
    return null;
}

/**
 * Check freshness for a single character by fetching metadata from source
 * @param {number} charIndex
 * @param {string} sourceUrl
 */
async function checkCharacterFreshness(charIndex, sourceUrl) {
    const char = characters[charIndex];
    if (!char) return;

    const avatar = char.avatar;

    try {
        // Parse the URL to determine the source type
        const chubInfo = parseChubUrl(sourceUrl);

        if (chubInfo) {
            // Call Chub API directly - works with User-Agent: SillyTavern
            const apiUrl = `https://api.chub.ai/api/characters/${chubInfo.creator}/${chubInfo.name}`;
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'SillyTavern',
                },
            });

            if (response.ok) {
                const data = await response.json();
                const metadata = data.node || {};

                // Get the source's last activity time
                const sourceUpdateTime = metadata.lastActivityAt
                    ? new Date(metadata.lastActivityAt).getTime()
                    : null;

                // Get local character's import/create time
                const localUpdateTime = char.create_date
                    ? new Date(char.create_date).getTime()
                    : 0;

                // Determine freshness status
                let status = 'fresh';
                if (sourceUpdateTime && localUpdateTime) {
                    status = sourceUpdateTime > localUpdateTime ? 'stale' : 'fresh';
                } else if (!sourceUpdateTime) {
                    status = 'unknown';
                }

                setCharacterFreshness(avatar, {
                    status,
                    lastSourceUpdate: sourceUpdateTime,
                    sourceCreator: metadata.fullPath?.split('/')[0] || chubInfo.creator,
                    sourceName: metadata.name,
                });

                console.debug(`[STCM] Freshness: ${char.name} is ${status} (source: ${metadata.lastActivityAt}, local: ${char.create_date})`);
            } else {
                console.warn(`[STCM] Chub API returned ${response.status} for ${chubInfo.creator}/${chubInfo.name}`);
                setCharacterFreshness(avatar, {
                    status: 'error',
                    errorMessage: `API returned ${response.status}`,
                });
            }
        } else {
            // For non-Chub sources, we can't easily check freshness
            setCharacterFreshness(avatar, {
                status: 'unknown',
            });
        }
    } catch (err) {
        console.error(`[STCM] Freshness check failed for ${char.name}:`, err);
        setCharacterFreshness(avatar, {
            status: 'error',
            errorMessage: err.message,
        });
    }
}

/**
 * Get the next character to check (oldest lastChecked time)
 * @returns {{index: number, sourceUrl: string, avatar: string}|null}
 */
function getNextCharacterToCheck() {
    const charsWithSources = getCharactersWithSources();
    if (charsWithSources.length === 0) return null;

    const freshnessData = getFreshnessData();

    // Sort by lastChecked (null = never checked = highest priority)
    const sorted = charsWithSources.sort((a, b) => {
        const aTime = freshnessData[a.avatar]?.lastChecked || 0;
        const bTime = freshnessData[b.avatar]?.lastChecked || 0;
        return aTime - bTime;
    });

    return sorted[0];
}

/**
 * Run one freshness check cycle
 */
async function runFreshnessCheck() {
    if (isChecking) return;

    const nextChar = getNextCharacterToCheck();
    if (!nextChar) return;

    isChecking = true;
    try {
        console.debug(`[STCM] Checking freshness for: ${nextChar.name || nextChar.avatar}`);
        await checkCharacterFreshness(nextChar.index, nextChar.sourceUrl);
    } finally {
        isChecking = false;
    }
}

/**
 * Start the background freshness checker
 */
export function startFreshnessChecker() {
    if (freshnessCheckTimer) return; // Already running

    console.log('[STCM] Starting background freshness checker (1 check/minute)');
    freshnessCheckTimer = setInterval(runFreshnessCheck, CHECK_INTERVAL_MS);

    // Run first check after a short delay
    setTimeout(runFreshnessCheck, 5000);
}

/**
 * Stop the background freshness checker
 */
export function stopFreshnessChecker() {
    if (freshnessCheckTimer) {
        clearInterval(freshnessCheckTimer);
        freshnessCheckTimer = null;
        console.log('[STCM] Stopped background freshness checker');
    }
}

/**
 * Get author/creator info for a character
 * @param {number} charIndex
 * @returns {string}
 */
export function getCharacterAuthor(charIndex) {
    const char = characters[charIndex];
    if (!char) return '';

    // Check various places where author might be stored
    return char.data?.creator
        || char.data?.extensions?.chub?.full_path?.split('/')[0]
        || char.creatorcomment?.match(/by\s+(\S+)/i)?.[1]
        || '';
}

/**
 * Get all unique authors from characters
 * @returns {string[]}
 */
export function getAllAuthors() {
    const authors = new Set();

    for (let i = 0; i < characters.length; i++) {
        const author = getCharacterAuthor(i);
        if (author) {
            authors.add(author);
        }
    }

    return [...authors].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

/**
 * Get characters by author
 * @param {string} author
 * @returns {Array<{index: number, name: string, avatar: string}>}
 */
export function getCharactersByAuthor(author) {
    const result = [];
    const authorLower = author.toLowerCase();

    for (let i = 0; i < characters.length; i++) {
        const char = characters[i];
        const charAuthor = getCharacterAuthor(i);

        if (charAuthor.toLowerCase() === authorLower) {
            result.push({
                index: i,
                name: char.name || 'Unknown',
                avatar: char.avatar || '',
            });
        }
    }

    return result;
}

/**
 * Format a timestamp for display
 */
export function formatTimestamp(timestamp) {
    if (!timestamp) return 'Never';

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
}

/**
 * Get freshness status icon
 */
export function getFreshnessIcon(status) {
    switch (status) {
        case 'fresh': return '<i class="fa-solid fa-check-circle" style="color: #4a4" title="Up to date"></i>';
        case 'stale': return '<i class="fa-solid fa-arrow-circle-up" style="color: #fa4" title="Update available"></i>';
        case 'error': return '<i class="fa-solid fa-exclamation-circle" style="color: #a44" title="Check failed"></i>';
        default: return '<i class="fa-solid fa-question-circle" style="color: #888" title="Not checked"></i>';
    }
}

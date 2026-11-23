// stcm_updates.js
// Character update management - check for and apply updates from source URLs

import { characters } from '../../../../script.js';
import {
    getCharacterFreshness,
    getCharacterAuthor,
    getAllAuthors,
    formatTimestamp,
    getFreshnessIcon,
    startFreshnessChecker,
} from './stcm_freshness.js';

// Current author filter
let authorFilter = '';

/**
 * Get the ST context with the new APIs
 */
function getSTContext() {
    return SillyTavern.getContext();
}

/**
 * Get all characters that have a source URL
 * @returns {Array<{index: number, name: string, avatar: string, sourceUrl: string}>}
 */
export function getCharactersWithSources() {
    const result = [];
    const context = getSTContext();

    for (let i = 0; i < characters.length; i++) {
        const char = characters[i];
        if (!char) continue;

        // Use ST's getCharacterSource API
        const sourceUrl = context.getCharacterSource(i);

        if (sourceUrl) {
            result.push({
                index: i,
                name: char.name || 'Unknown',
                avatar: char.avatar || '',
                sourceUrl: sourceUrl
            });
        }
    }

    return result;
}

/**
 * Render the updates list
 */
export function renderUpdatesList() {
    const wrapper = document.getElementById('updatesListWrapper');
    const statusMsg = document.getElementById('updatesStatusMsg');
    if (!wrapper) return;

    let charsWithSources = getCharactersWithSources();

    // Add author info to each character
    charsWithSources = charsWithSources.map(char => ({
        ...char,
        author: getCharacterAuthor(char.index),
        freshness: getCharacterFreshness(char.avatar),
    }));

    // Apply author filter if set
    if (authorFilter) {
        charsWithSources = charsWithSources.filter(
            char => char.author.toLowerCase() === authorFilter.toLowerCase()
        );
    }

    if (charsWithSources.length === 0) {
        wrapper.innerHTML = `
            <div style="padding: 1em; opacity: 0.7; text-align: center;">
                ${authorFilter
                    ? `No characters found for author "${escapeHtml(authorFilter)}".`
                    : 'No characters with source URLs found.<br>Characters imported from Chub or other sources will appear here.'}
            </div>
        `;
        if (statusMsg) statusMsg.textContent = '';
        return;
    }

    // Count stale characters
    const staleCount = charsWithSources.filter(c => c.freshness.status === 'stale').length;
    if (statusMsg) {
        let msg = `${charsWithSources.length} character(s)`;
        if (staleCount > 0) {
            msg += ` (${staleCount} update${staleCount > 1 ? 's' : ''} available)`;
        }
        if (authorFilter) {
            msg += ` by ${authorFilter}`;
        }
        statusMsg.textContent = msg;
    }

    // Build table with new columns
    let html = `
        <table class="stcm_updates_table">
            <thead>
                <tr>
                    <th style="width: 30px;" title="Freshness status"></th>
                    <th style="width: 40px;"></th>
                    <th>Character</th>
                    <th>Author</th>
                    <th>Source</th>
                    <th style="width: 70px;">Checked</th>
                    <th style="width: 180px;">Actions</th>
                </tr>
            </thead>
            <tbody>
    `;

    for (const char of charsWithSources) {
        const avatarUrl = char.avatar
            ? `/characters/${encodeURIComponent(char.avatar)}`
            : '/img/ai4.png';

        // Truncate URL for display
        const displayUrl = char.sourceUrl.length > 40
            ? char.sourceUrl.substring(0, 37) + '...'
            : char.sourceUrl;

        const freshnessIcon = getFreshnessIcon(char.freshness.status);
        const lastChecked = formatTimestamp(char.freshness.lastChecked);

        html += `
            <tr data-char-index="${char.index}" data-source-url="${escapeHtml(char.sourceUrl)}" data-author="${escapeHtml(char.author)}">
                <td class="freshness-cell">${freshnessIcon}</td>
                <td>
                    <img src="${avatarUrl}" alt="" style="width: 36px; height: 36px; border-radius: 4px; object-fit: cover;">
                </td>
                <td>
                    <strong>${escapeHtml(char.name)}</strong>
                </td>
                <td>
                    <a href="#" class="stcm-author-link" data-author="${escapeHtml(char.author)}" title="Filter by this author" style="color: var(--SmartThemeQuoteColor, #8cf);">
                        ${escapeHtml(char.author) || '<em>Unknown</em>'}
                    </a>
                </td>
                <td>
                    <a href="${escapeHtml(char.sourceUrl)}" target="_blank" title="${escapeHtml(char.sourceUrl)}" style="color: var(--SmartThemeQuoteColor, #8cf);">
                        ${escapeHtml(displayUrl)}
                    </a>
                </td>
                <td style="opacity: 0.7; font-size: 0.9em;">${lastChecked}</td>
                <td>
                    <button class="stcm_menu_button small interactable stcm-update-char-btn" title="Update character from source">
                        <i class="fa-solid fa-download"></i> Update
                    </button>
                    <button class="stcm_menu_button small interactable stcm-import-tags-btn" title="Import tags from source">
                        <i class="fa-solid fa-tags"></i> Tags
                    </button>
                </td>
            </tr>
        `;
    }

    html += '</tbody></table>';
    wrapper.innerHTML = html;

    // Wire up author links
    wrapper.querySelectorAll('.stcm-author-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const author = e.target.closest('.stcm-author-link').dataset.author;
            setAuthorFilter(author);
        });
    });

    // Wire up buttons
    wrapper.querySelectorAll('.stcm-update-char-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const row = e.target.closest('tr');
            const charIndex = parseInt(row.dataset.charIndex, 10);
            const sourceUrl = row.dataset.sourceUrl;
            await updateCharacterFromSource(charIndex, sourceUrl, btn);
        });
    });

    wrapper.querySelectorAll('.stcm-import-tags-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const row = e.target.closest('tr');
            const charIndex = parseInt(row.dataset.charIndex, 10);
            await importTagsForCharacter(charIndex, btn);
        });
    });
}

/**
 * Update a character from its source URL
 * Uses ST's importFromExternalUrl API to replace the character with the latest version
 */
async function updateCharacterFromSource(charIndex, sourceUrl, btn) {
    const char = characters[charIndex];
    if (!char) {
        toastr.error('Character not found');
        return;
    }

    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
        const context = getSTContext();
        // Use preserveFileName to replace the existing character instead of creating a new one
        await context.importFromExternalUrl(sourceUrl, { preserveFileName: char.avatar });
        toastr.success(`Updated "${char.name}" from source`);
        // Refresh the list in case anything changed
        renderUpdatesList();
    } catch (err) {
        console.error('Failed to update character:', err);
        toastr.error(`Failed to update "${char.name}": ${err.message || 'Unknown error'}`);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

/**
 * Import tags for a character from its embedded tag data
 * Uses ST's importTags API for proper tag handling
 */
async function importTagsForCharacter(charIndex, btn) {
    const char = characters[charIndex];
    if (!char) {
        toastr.error('Character not found');
        return;
    }

    // Check for embedded tags in character data
    const embeddedTags = char.tags || char.data?.tags || [];

    if (!embeddedTags || embeddedTags.length === 0) {
        toastr.warning(`No embedded tags found for "${char.name}"`);
        return;
    }

    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
        const context = getSTContext();
        // Use ST's importTags API - it handles tag creation, deduplication, and user preferences
        const result = await context.importTags(char);
        if (result) {
            toastr.success(`Imported tags for "${char.name}"`);
        } else {
            toastr.info(`No new tags imported for "${char.name}"`);
        }
    } catch (err) {
        console.error('Failed to import tags:', err);
        toastr.error(`Failed to import tags for "${char.name}": ${err.message || 'Unknown error'}`);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

/**
 * Import embedded tags for all characters using ST's importTags API
 */
export async function importAllTags() {
    const statusMsg = document.getElementById('updatesStatusMsg');
    const context = getSTContext();

    // Get all characters with embedded tags
    const charsWithTags = [];
    for (let i = 0; i < characters.length; i++) {
        const char = characters[i];
        const embeddedTags = char?.tags || char?.data?.tags || [];
        if (embeddedTags.length > 0) {
            charsWithTags.push({ index: i, char: char, name: char.name });
        }
    }

    if (charsWithTags.length === 0) {
        toastr.info('No characters with embedded tags found');
        return;
    }

    let charsUpdated = 0;

    for (let i = 0; i < charsWithTags.length; i++) {
        const charInfo = charsWithTags[i];

        if (statusMsg) {
            statusMsg.textContent = `Importing tags... ${i + 1}/${charsWithTags.length}`;
        }

        try {
            // Use ST's importTags API with ALL setting to import without prompting
            const result = await context.importTags(charInfo.char, { importSetting: 'all' });
            if (result) {
                charsUpdated++;
            }
        } catch (err) {
            console.error(`Failed to import tags for ${charInfo.name}:`, err);
        }
    }

    if (statusMsg) {
        const charsWithSources = getCharactersWithSources();
        statusMsg.textContent = `${charsWithSources.length} character(s) with source URLs`;
    }

    toastr.success(`Imported tags for ${charsUpdated} character(s)`);
}

/**
 * Update all characters from their source URLs
 */
export async function updateAllCharacters() {
    const statusMsg = document.getElementById('updatesStatusMsg');
    const context = getSTContext();
    const charsWithSources = getCharactersWithSources();

    if (charsWithSources.length === 0) {
        toastr.info('No characters with source URLs found');
        return;
    }

    let updated = 0;
    let failed = 0;

    for (let i = 0; i < charsWithSources.length; i++) {
        const charInfo = charsWithSources[i];

        if (statusMsg) {
            statusMsg.textContent = `Updating... ${i + 1}/${charsWithSources.length}: ${charInfo.name}`;
        }

        try {
            await context.importFromExternalUrl(charInfo.sourceUrl, { preserveFileName: charInfo.avatar });
            updated++;
        } catch (err) {
            console.error(`Failed to update ${charInfo.name}:`, err);
            failed++;
        }
    }

    if (statusMsg) {
        statusMsg.textContent = `${charsWithSources.length} character(s) with source URLs`;
    }

    if (failed > 0) {
        toastr.warning(`Updated ${updated} character(s), ${failed} failed`);
    } else {
        toastr.success(`Updated ${updated} character(s)`);
    }

    // Refresh the list
    renderUpdatesList();
}

/**
 * Set the author filter and re-render
 */
export function setAuthorFilter(author) {
    authorFilter = author || '';
    const dropdown = document.getElementById('authorFilterSelect');
    if (dropdown) {
        dropdown.value = authorFilter;
    }
    renderUpdatesList();
}

/**
 * Populate the author filter dropdown
 */
export function populateAuthorDropdown() {
    const dropdown = document.getElementById('authorFilterSelect');
    if (!dropdown) return;

    const authors = getAllAuthors();
    let html = '<option value="">All Authors</option>';

    for (const author of authors) {
        const selected = author === authorFilter ? 'selected' : '';
        html += `<option value="${escapeHtml(author)}" ${selected}>${escapeHtml(author)}</option>`;
    }

    dropdown.innerHTML = html;
}

/**
 * Attach event listeners for the Updates section
 */
export function attachUpdatesSectionListeners() {
    const refreshBtn = document.getElementById('refreshUpdatesListBtn');
    const updateAllBtn = document.getElementById('updateAllCharsBtn');
    const importAllBtn = document.getElementById('importAllTagsBtn');
    const authorDropdown = document.getElementById('authorFilterSelect');

    refreshBtn?.addEventListener('click', () => {
        populateAuthorDropdown();
        renderUpdatesList();
    });

    updateAllBtn?.addEventListener('click', async () => {
        const charsWithSources = getCharactersWithSources();
        const confirmed = await confirmAction(
            'Update All Characters',
            `This will update ${charsWithSources.length} character(s) from their source URLs. This may take a while. Continue?`
        );
        if (confirmed) {
            await updateAllCharacters();
        }
    });

    importAllBtn?.addEventListener('click', async () => {
        const confirmed = await confirmAction(
            'Import All Tags',
            'This will import embedded tags for all characters. Continue?'
        );
        if (confirmed) {
            await importAllTags();
        }
    });

    authorDropdown?.addEventListener('change', (e) => {
        setAuthorFilter(e.target.value);
    });

    // Start the background freshness checker
    startFreshnessChecker();
}

/**
 * Simple confirmation dialog
 */
async function confirmAction(title, message) {
    return new Promise(resolve => {
        const result = confirm(`${title}\n\n${message}`);
        resolve(result);
    });
}

/**
 * Escape HTML entities
 */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

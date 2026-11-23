# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a fork of [BlueprintCoding/SillyTavern-Character-Tag-Manager](https://github.com/BlueprintCoding/SillyTavern-Character-Tag-Manager) for contributing improvements upstream.

SillyTavern Character Tag Manager is a UI extension for SillyTavern that provides bulk tag management, character organization, search/filtering, and AI-assisted tagging for large character collections.

## Development Setup

1. Clone into SillyTavern's extension directory:
   ```
   SillyTavern/data/{user-folder}/extensions/SillyTavern-Character-Tag-Manager/
   ```
2. Restart SillyTavern or reload the page
3. Look for the tag icon in the top bar

No build step required - vanilla JavaScript served directly.

## Architecture

```
index.js              # Main entry point, modal setup, event wiring
manifest.json         # Extension metadata (display_name, version, etc.)
style.css             # All styling (uses ST CSS variables for theming)

stcm_tags_ui.js       # Tag list panel UI and logic
stcm_characters.js    # Character/group list and bulk operations
stcm_char_panel.js    # Individual character panel
stcm_folders.js       # Folder data structures
stcm_folders_ui.js    # Folder UI components
stcm_folders_tree.js  # Folder tree view

stcm_ai_suggest_folder_tags.js  # AI-assisted tag suggestions
stcm_custom_greetings.js        # Greeting Workshop feature

settings-drawer.js    # Extension settings panel
utils.js              # Shared utilities
fa-icon-list.js       # FontAwesome icon data
```

## Key Patterns

**Accessing SillyTavern context:**
```javascript
const context = SillyTavern.getContext();
context.characters;     // All characters array
context.characterId;    // Current character index
context.tags;           // Tag definitions
```

**Data persistence:**
- Notes saved to JSON in `SillyTavern/data/{user}/user/files/`
- Uses debounced saves for performance
- Local caching to minimize file I/O

**UI patterns:**
- Modal-based interface
- Accordion sections for Tag vs Character panels
- Theme-aware using ST CSS variables (e.g., `var(--SmartThemeBodyColor)`)

## Contributing Workflow

This is a fork for sending PRs upstream:

```bash
:# Sync with upstream before starting work
git fetch upstream
git checkout main
git merge upstream/main

:# Create feature branch
git checkout -b feature/my-improvement

:# Make changes, test in SillyTavern, commit
git add .
git commit -m "Description of change"

:# Push to fork
git push origin feature/my-improvement

:# Create PR to upstream via GitHub
```

## Testing

1. Install extension in local SillyTavern instance
2. Test with a variety of character counts (the target user has 1000+ characters)
3. Verify theme compatibility (light/dark modes)
4. Check bulk operations don't cause performance issues

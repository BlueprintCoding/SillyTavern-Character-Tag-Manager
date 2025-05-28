# SillyTavern Character Tag Manager

SillyTavern Character Tag Manager is a SillyTavern UI plugin that provides a centralized interface for managing tags for characters/groups. It features tools to organize, search, assign, and persist metadata such as notes and tag mappings, all through an integrated modal interface.

## Features
### Tag Management
- View and edit all tags with character counts
- Search tags by name or associated characters (C: search syntax)
- Inline tag name editing 
- Merge tags (select one primary and multiple merge targets)
- Delete tags with automatic unassignment
- Add notes to tags using a "Notes" toggle per tag
- 
### Character Management
- View all characters and groups with avatars and descriptions
- Filter, search, and sort by name, tag count, or tag presence
- Assign or remove tags in bulk using multi-select tag filters
- Inline tag display per character with quick remove buttons
- Toggle character-specific notes with save and auto-persist support
- Permanently delete characters with confirmation

### Data Persistence
- Notes (both character and tag) are automatically saved to a JSON file in \SillyTavern\data\default-user\user\files
- Local caching to avoid redundant reads/writes
- Debounced save logic for performance

### UI Integration
- New icon button in the top bar to open the Character / Tag Manager

## Installation
Clone or download this extension into the SillyTavern data/{user folder}/extensions/ folder.

```
/sillytavern/
  └── data/
      └── {your user folder}/
          └── extensions/
```
Make sure the extension is loaded by SillyTavern. You should see a tag icon in the top bar when the app is ready.

## Usage
- Click the tag icon in the top bar to open the Character / Tag Manager modal
- Use the accordion sections to toggle between the Tags and Characters panels
- Assign tags using the multi-select dropdown and bulk checkbox toggles
- Add notes to characters or tags by clicking the "Notes" button — these are saved automatically
- Use the merge feature to consolidate duplicate or related tags


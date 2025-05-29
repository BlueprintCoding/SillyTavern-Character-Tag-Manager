# SillyTavern Character Tag Manager

SillyTavern Character Tag Manager is a SillyTavern UI plugin that provides a centralized interface for managing tags, folders, and metadata for characters and groups. It offers advanced tools to organize, search, assign, and persist notes and tag mappings, all through an integrated and theme-adaptive modal interface.

---

## Features

### Tag Management
- View, search, and sort all tags (A→Z, Z→A, Most/Fewest Characters, Only 0 Characters)
- **Search tags** by name or by associated character (`C:` search mode)
- **Create new tags** with custom background and text color pickers
- **Inline tag name editing** directly in the tag list
- **Merge tags** (toggle merge mode, select one as primary and multiple as merge targets; all assignments move to primary)
- **Delete tags** with confirmation and automatic unassignment from all characters/groups
- **Add notes to tags** via an inline "Notes" toggle button per tag, with persistent storage
- **Edit tag folders**: set folder type (Open, Closed, or None) for visual grouping in other tag views
- **Backup and restore** tags and tag mappings to/from JSON files
- **Export and import notes** (character and tag notes) to/from JSON files

### Character & Group Management
- View all characters and groups with avatars, names, tag count, and description/excerpt
- Filter, search, and sort by name, tag count, tag presence, or notes presence
- **Bulk tag assignment**: use a multi-select combo box to pick tags, then assign to multiple characters/groups using checkboxes
- **Inline display of assigned tags** per character/group, with removable tag "chips"
- **Quick remove tag** per character (click ✕ on tag chip)
- **Toggle and edit character notes** with auto-persist and save status feedback
- **Permanently delete characters or groups** (with confirmation and chat data cleanup)
- **View characters assigned to a tag** by expanding the tag entry

### Data Persistence
- All notes (character and tag) are automatically saved to a JSON file in `\SillyTavern\data\{user folder}\user\files`
- Local caching minimizes redundant reads/writes and speeds up UI
- Debounced save logic optimizes performance during rapid changes

### UI & Integration
- **Dedicated tag icon button** in the top bar opens the Character / Tag Manager modal
- Responsive, theme-aware modal interface styled using SillyTavern system variables
- Accordion navigation between Tag and Character/Group management panels
- Integrated tag manager buttons in both tag views and character list
- All actions include confirmation dialogs where destructive

---

## Installation

Clone or download this extension into your SillyTavern `data/{user folder}/extensions/` directory:


```
/sillytavern/
  └── data/
      └── {your user folder}/
          └── extensions/
```
Or use the built in extension installer with the repo url: https://github.com/BlueprintCoding/SillyTavern-Character-Tag-Manager
![image](https://github.com/user-attachments/assets/d18ca709-b555-4454-9161-3bf62c7b19f0)



Make sure the extension is loaded by SillyTavern. You should see a tag icon in the top bar when the app is ready.

---

## Usage

- Click the **tag icon** in the top bar to open the Character / Tag Manager modal or the green icon in the character panel.
- Use **accordion sections** to toggle between Tag and Character/Group management panels
- **Assign tags**: select one or more tags, then check desired characters/groups and click "Assign Tag(s)"
- **Remove tags**: click the "✕" next to any assigned tag to instantly unassign it from a character or group
- **Edit or merge tags**: use inline edit and the Merge Tags button to consolidate duplicates
- **Add/edit notes**: click the "Notes" button next to tags or characters; notes auto-save to your persistent file
- **Delete tags or characters**: use the Delete buttons, with confirmation, for clean-up
- Use **import/export tools** in the Tags section to backup or migrate tags and notes

---

## Settings Panel

The Character/Tag Manager extension adds a configurable settings panel to SillyTavern's Extensions Settings page. Here you can control how and where the manager is integrated into the UI. The following options are available:

- **Show Character / Tag Manager Icon in Top Bar**  
  Toggle visibility of the dedicated Character/Tag Manager icon in the SillyTavern top bar.

- **Show ST Default Tag Manager**  
  Show or hide the built-in SillyTavern tag manager controls in the character sidebar. If you prefer to use only the custom modal, you can hide the default buttons here.

- **Show Welcome Screen Recent Chats**  
  Control whether recent chats are displayed on SillyTavern's welcome screen.

All settings are saved persistently and applied in real-time. You’ll find the settings panel under the "Extensions" section in SillyTavern’s settings menu.

---

## Contributing

Pull requests and suggestions are welcome! Please open an issue for feature requests or bug reports.

---

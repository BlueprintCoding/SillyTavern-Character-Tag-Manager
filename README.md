# SillyTavern Character Tag Manager

SillyTavern Character Tag Manager is a SillyTavern UI plugin that provides a centralized interface for managing tags, folders, and metadata for characters and groups. It offers advanced tools to organize, search, assign, and persist notes and tag mappings, all through an integrated modal interface.

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

![image](https://github.com/user-attachments/assets/c606c561-9dd2-43c5-85bc-37aa7a52f57b)


### Character & Group Management
- View all characters and groups with avatars, names, tag count, and description/excerpt
- Filter, search, and sort by name, tag count, tag presence, or notes presence
- **Bulk tag assignment**: use a multi-select combo box to pick tags, then assign to multiple characters/groups using checkboxes
- **Inline display of assigned tags** per character/group, with removable tag "chips"
- **Quick remove tag** per character (click ✕ on tag chip)
- **Toggle and edit character notes** with auto-persist and save status feedback
- **Permanently delete characters or groups** (with confirmation and chat data cleanup)
- **View characters assigned to a tag** by expanding the tag entry

![image](https://github.com/user-attachments/assets/00a5fdf4-0ffa-4bca-8dcc-11fcb19f2faf)

### Bulk Delete for Tags and Characters/Groups

* **Bulk Delete Mode:** Enter bulk delete mode in either the tag or character/group section, select as many tags or characters/groups as you want, and delete them in two clicks—confirmation dialogs ensure safety.
* **Automatic Cleanup:** When deleting tags, all associations with characters and groups are automatically removed.

### Private Folders

* **Private Folder Tag Type:** Tags can be set as “Private Folders.” These folders, and their assigned characters, are only visible to you. Private folders can be PIN-protected and are omitted from exports or sharing unless you explicitly include them.
* **PIN Protection:** The PIN (if set) is hashed and saved in your extension notes file. If you forget your PIN, you can remove it by editing the notes JSON file. (PIN protection is meant for basic privacy, not high security.)
* **Visibility Toggle:** Quickly switch between hiding, showing all, or showing only private folders using the new icon in the tag bar.
* **Use Cases:** Split out NSFW characters, archive less-used cards, or create a private workspace.

### Folder Filtering & Tag Folder Types

* **Folder Type Filter:** Instantly filter tags by folder type (No Folder, Open, Closed, Private) using the dropdown in the modal—no more scrolling through unsorted lists.
* **Set Folder Type:** Edit any tag’s folder type directly from the tag manager for better organization and grouping in other tag views.

### Advanced Searching in Character Section of Extension

**Tag Advanced Search Features**

* **OR Search:** Use commas to separate search groups. Results match **any** group (OR logic).
  *Example:* `Elf, Magic` shows the "Elf" tag or the "Magic" tag. (Where before `Elf Magic` or `Elf, Magic` would show nothing.

-----

**Character Advanced Search Features**

* **AND Search:** Type multiple terms separated by spaces to find characters/groups matching **all** criteria.
  *Example:* `T:Elf T:Magic` shows only those with **both** the "Elf" and "Magic" tags.

* **OR Search:** Use commas to separate search groups. Results match **any** group (OR logic).
  *Example:* `T:Elf, T:Magic` shows characters/groups with **either** the "Elf" tag or the "Magic" tag.

* **Field Prefixes:**

  * `T:` to search by tag name (e.g. `T:Elf`)
  * `A:` to search all character fields
  * No prefix searches by character name only

* **Negation:** Add `-` before a term to exclude it.
  *Example:* `T:Elf -T:Dark` finds entries with "Elf" but **not** "Dark".

**Tip:** Combine AND/OR:
`A:John, T:Elf T:Magic` finds entries with "John" in any field, **or** both "Elf" and "Magic" tags together.

-----

**AI Assisted Folder and Tagging for Characters**
Sends a list of your folders and tags, along with the character data (Name, description, personality and scenario fields) to your currently set/active LLM/API for assessment for proper folder or tags. 

<img width="975" height="172" alt="image" src="https://github.com/user-attachments/assets/26df9682-856a-43d7-8433-17302b630ce3" />
<img width="961" height="708" alt="image" src="https://github.com/user-attachments/assets/fc2261dd-f3a7-4131-8042-41a330fe87fd" />
<img width="950" height="511" alt="image" src="https://github.com/user-attachments/assets/67949668-6bf5-4c21-bd37-bd53b621882e" />

---
### Alternative Greeting Easy Change Modal
A Choose Alt Message" button that appears on the first character message (if multiple swipe options exist). Clicking the button opens a modal displaying all alternate swipes in scrollable containers and a search bar to filter options.

**Features:**
- Only appears if there is exactly one message in chat (i.e. startup/scenario phase).
- Modal shows all swipe alternative greetings
- Real-time search filter added to find alt messages quickly.
- Clicking a "Choose Alt Message" button updates the first message with the chosen Alternative Greeting

<img width="453" height="149" alt="image" src="https://github.com/user-attachments/assets/7a3ace00-76d4-4975-bfac-7cfc83a2f198" />

<img width="749" height="709" alt="image" src="https://github.com/user-attachments/assets/7a40b18a-2d72-484f-99d0-8b5ba3b3a8ba" />

---
##  Greeting Workshop (Automatically generate starting messages)

The **Greeting Workshop** to help keep character cards fresh, this feature lets you collaborate with your active LLM to create a personalized first message before starting a SillyTavern chat.  
It opens a separate mini-chat where you can refine the greeting, mark a preferred scene, and then replace the starting message in the main chat with your final choice.
<img width="1045" height="1068" alt="image" src="https://github.com/user-attachments/assets/ed50d5ef-2964-42c1-a75b-f1ec3f7878b9" />

### Features
- Mini chat for crafting and refining the first greeting.
- Save sessions per character to avoid cross-contamination.
- Mark a scene as “Preferred” for future generations.
- Edit, copy, or delete generated responses directly.
- Custom system prompt editor with token variables.
- Automatic enforcement of `{{user}}` in outputs.
- Accept to replace the main chat’s starting message.

1. **Open the Workshop**  
   - The "Greeting Workshop" button will appear above the first chat message when the welcome panel is closed and there’s only one message visible.  
   - Click it to open the workshop modal.
<img width="489" height="192" alt="image" src="https://github.com/user-attachments/assets/e448f8b6-dc7c-4c9c-83a6-4521219490d4" />


2. **Configure Your Output**  
   - Set paragraphs, sentences per paragraph, style, and chat history depth.  
   - (Optional) Open the **System Prompt** editor to customize generation behavior.

3. **Iterate with the LLM**  
   - Type an instruction (tone, topics, length, etc.) and click **Send to LLM**.  
   - Regenerate, edit, copy, or delete responses.  
   - Mark your favorite as **Preferred** to influence future generations.

4. **Accept the Greeting**  
   - When satisfied, click **Accept → Replace Greeting** to insert it into the main chat.

---


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

![image](https://github.com/user-attachments/assets/491b26db-82a9-4fe7-a041-88deb365bbea)

---
**Opt-in Feedback data (Off by default)**

This data helps us understand how many people are actively using the extension, since GitHub doesn’t track installs. It also lets us debug issues across different SillyTavern versions and environments. Finally, knowing tag, character, and folder counts helps us troubleshoot performance and scaling problems for users with large libraries. For confimation that this does what it says: devs can look at the settings-drawer.js, if you aren't here is a [GPT evaulation of the code](https://chatgpt.com/share/689fa2b2-2ab4-8006-ae34-adcaf906ca79)

- Off by default. Nothing is sent unless you switch on “Share Anonymous Feedback Data.”
- You choose what to share. Each item (app version, browser info, folder/tag/character counts) is optional. A random Install ID is always included so they can count installs—no personal details.
- See it first. There’s a Preview button that shows exactly what would be sent.
- Sends over secure HTTPS, with no cookies or referrers.
- Server saves only what you allowed. If you skip a count, it’s stored as not included (a zero placeholder appears in one summary column, but the raw record shows it wasn’t shared).

---

## Contributing

Pull requests and suggestions are welcome! Please open an issue for feature requests or bug reports.

---

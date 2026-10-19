# Draftdrion usage guide

A local web editor for browsing project files, editing code, and chatting with an AI assistant.

[← Back to README](../README.md)

## Get started

Requires Node.js 22 or later and npm. Run these commands in the project folder:

```bash
npm install
npm start
```

Open [127.0.0.1:3000](http://127.0.0.1:3000/), then:

1. Click **Browse Folder** to open your project.
2. Open **Settings**, choose a provider, and enter its API key.
3. Click **Load models** or enter a text chat model ID, then **Save**.
4. Open a file and click **Send to Chat** to attach it before asking a question.

On Windows, you can also use `run.bat` after installing dependencies. Restart the server and refresh the page after backend updates.

## What it does

- Browse files and switch between projects with separate chat history and context.
- Edit code with syntax highlighting, Find/Replace, Go to Line, bracket matching, and per-file undo history.
- Collapse or resize either side panel. Layout settings are remembered, and hiding chat keeps an active AI request running.
- Attach files to chat, including current unsaved edits in open files.
- Open **Changes** to review AI edits in the main workspace. Switch **Inline / Side by side**, select files, then **Apply selected**. **Undo last apply** restores each file individually.

## File and folder management

Explorer's toolbar offers **New file**, **New folder**, **Undo file action**, **Select project root** and **Hidden**. New files use the complete name you enter, including any extension (`index.html`, `app.js`, `.env.example`); there are no forced extensions. New items go inside the selected folder, or the selected file's parent. Select project root to create at the top level. The parent folder must exist.

Use a row's **…** button or right-click for **Rename / move**, **Delete**, **Copy path**, and creation actions. Rename accepts a project-relative path, so moving `src/app.js` to `components/app.js` also works when `components` exists. With a tree row focused, **F2** renames, **Delete** opens deletion confirmation, and arrows/Enter navigate the tree. Tabs, attached context, syntax mode and AI file-Undo paths follow renames. Save or close affected unsaved files first. New names never intentionally overwrite an occupied destination.

**Undo file action** is separate from editor Ctrl+Z and AI Undo. It reverses the latest file-management action for the current project, then allows earlier actions to be undone in order. History survives browser/server restarts in `%LOCALAPPDATA%\GwensCodebench\file-actions.json`. Deletes move full files/folders to `file-trash/` beside that journal, outside your project/Git tree, and Undo restores them. This is Draftdrion recovery storage, not the Windows Recycle Bin. Deleted items remain there until restored; no permanent-delete or automatic purge is included. Back up/protect that folder because deleted contents may be sensitive. File actions do not call the AI or upload content.

Changed files, populated newly created folders, newly occupied restore paths and stale Undo requests are protected. To Undo file actions, first save/close unsaved editor buffers. Restored deleted files return to disk and Explorer; closed tabs/context are not automatically reopened. Interrupted creation recovery keeps any existing item when ownership cannot be confirmed. Pending recovery blocks new actions until resolved. Undo does not merge external edits.

Paths stay inside the selected project; root deletion, Git metadata, symlink/junction targets, special files, reserved names and Draftdrion's own recovery data are blocked. A single managed tree is limited to **5,000 entries / 250 MB** to bound synchronous verification. Cross-drive recovery copies are verified before removing their source. Cross-drive behavior has automated simulation coverage; a physical second drive was not tested. Keep the user-facing server in normal Windows PowerShell or `run.bat`, outside Codex's filesystem sandbox, so selected project folders are writable.

## AI providers

Supports **DeepSeek, OpenAI, Claude, Gemini, OpenUI Gateway**, and **custom OpenAI-compatible APIs**. Choose the provider and model in **AI Settings**. The output limit, manual model ID and backend URL are under **Advanced settings**. Each provider keeps its own model settings.

### OpenUI Gateway

Save your Thesys backend key privately in a `.env` file in this project folder:

```env
THESYS_API_KEY=your_backend_key
PORT=3001
```

Restart `npm start`, open `http://127.0.0.1:3001`, and choose **AI Settings → Provider → OpenUI Gateway**. The key remains on the server and is never returned to the browser. Startup loads `.env` without overwriting existing process environment variables. Port 3001 avoids the separate OpenUI demo's default port 3000; choose another available port if needed.

The model menu starts with promotional free Gemini models. **Refresh models** retrieves the current free-model list. A manually entered paid model ID shows a cost notice. Free models have usage quotas, and their request data, including attached source files, may be used for training. Check [current limits](https://www.openui.com/docs/gateway/pricing-credits) before use with sensitive projects.

OpenUI Gateway assistant replies can display generated cards, tables and other built-in OpenUI views directly in chat. Only messages marked as OpenUI responses use this renderer; other providers keep their existing display. Older plain-text replies remain readable. Refresh the page after updating the app, then send a new message to try it.

Generated views run in a sandboxed frame. **View UI source** keeps the original response available if a view cannot render. Follow-up buttons fill the message box for review; they do not send automatically. File proposals open the main **Changes** workspace. Generated views cannot call backend tools or change files. OpenUI views render after the complete response; progress is visible while generating.

The renderer uses pinned `@openuidev/browser-bundle` and `@openuidev/lang-core` packages. `openui-library.json` is the schema exported by that bundle's `window.__OpenUI.openuiChatLibrary.toSpec()`; regenerate it when upgrading the browser bundle so the model and renderer use matching component signatures.

### Obsidian Memory access (all providers)

In **Settings → AI & context**, choose a provider and set **Obsidian Memory access** to **Off**, **Read only**, or **Read & write**, then **Save settings**. The choice is stored per provider in the laptop profile. Existing OpenUI read-only/on-off choices migrate without enabling writes; other providers start Off. **Test connection** checks capabilities/mapping without reading or changing notes. Keep Obsidian open. Every provider adapter can use Obsidian tools: OpenUI, DeepSeek, OpenAI, Claude, Gemini and custom OpenAI-compatible services. The selected model/service must support tool calling. Unsupported models return their normal provider error; the app does not silently switch providers.

Off prevents new MCP connections/retrieval for that turn. Read only provides search/read. Read & write additionally allows new draft project notes and guarded updates to existing project note sections. Shared instructions/preferences and project AGENTS/CONTEXT-POLICY notes remain read only; no delete, rename, command or generic MCP proxy is exposed. No mapped project means shared read-only access even when Read & write is selected. New notes get unique paths under the mapped project's `ai-notes/`, with internal access and draft/AI-generated frontmatter. Existing note updates require a prior read, a known heading and an unchanged version; metadata is preserved. Truncated notes can be appended to, not replaced. Writes are read back before claiming success.

Replies list actual note reads/changes, and verified write events appear immediately in chat. **Recent note changes · this laptop** in Settings shows local history, including unconfirmed operations. The server keeps the last 100 write-state records in `obsidian-changes.json` beside `state.json` (paths/statuses only, no note content or credentials). History remains available after an interrupted reply. Stop cannot undo completed writes; an operation already in flight may finish. If a write is unconfirmed, inspect the note before retrying. Saved mode changes apply to new messages; earlier retrieved excerpts remain in conversation history.

Configure these values privately in the server's ignored `.env`, then restart:

```env
OBSIDIAN_MCP_URL=http://127.0.0.1:27123/mcp/
OBSIDIAN_MCP_AUTHORIZATION='Bearer YOUR_OBSIDIAN_MCP_CREDENTIAL'
OBSIDIAN_PROJECTS='{"C:/xampp/htdocs/ai-copilot":"02 - Projects/Active/AI Copilot"}'
```

Use the endpoint and Authorization value from your existing Obsidian MCP configuration. This connector supports local Streamable HTTP MCP endpoints; redirects and remote MCP endpoints are blocked. Never put the credential in browser Settings, Markdown notes or Git. `OBSIDIAN_PROJECTS` maps exact local project roots to their vault project folders. Add explicit mappings there for other projects; an unmapped root can use only the shared instruction/preference notes.

The backend exposes `obsidian_search` and `obsidian_read`, backed by MCP `search_query`/`vault_read`. Only an opted-in, mapped read-write session receives `obsidian_create`/`obsidian_update`, backed by MCP `vault_write`/`vault_patch` and revision maps. All vault operations use the configured MCP integration; there is no vault filesystem fallback. It permits the shared bootstrap/policy/UI/architecture notes and the selected mapped project's Markdown notes. Restricted or missing `ai_access`, unrelated projects, traversal paths, hidden files, logs, archives, attachments and credential/secret paths are blocked. Only `public` or `internal` notes pass classification checks. Searches filter scope/classification before content matching; reads and updates recheck access. New note paths are server-generated, so a model cannot overwrite an existing note through create.

Each enabled memory turn loads the four bootstrap notes, then lets the model retrieve relevant notes. Excerpts are limited to 6,000 characters per note and 24,000 total per turn; long notes may be truncated. At most 12 model tool calls and 5 inference rounds are permitted. Memory adds model requests/tokens—this is not a token-saving feature. Usage totals include all inference rounds. Retrieved excerpts go to the selected provider/model under its service terms. MCP credentials remain local. An unavailable connection is shown explicitly; bootstrap failure stops that answer rather than inventing memory access. Claude uses native tool-use/result messages and buffered responses; compatible providers retain streaming. Only OpenUI renders generated OpenUI components.

Obsidian modes govern the connector, independently of reviewed code proposals and editor file operations. Generated UI widgets still have no MCP access. Memory endpoints reject nonlocal Host/Origin headers for every provider and mode. Prior chat history still follows its normal sharing rules when memory is off.

Custom providers need an API base URL, such as `https://example.com/v1`. Local compatible servers can run without an API key.

The AI sees the files you attach, not your entire project folder. Attached code is sent to the selected provider. OpenUI's key stays in the server environment; other saved provider keys stay in a separate server-side file on this laptop. API access and billing depend on your provider account.

## Workspace and local storage

The compact header and side rail retain Explorer, Quick Open, chat, Changes, activity, Settings and feedback mute. The header menu contains the remaining editor/history commands. Settings are grouped into **Workspace**, **Editor & review**, **AI & context**, and **Feedback**. New installations start with OpenUI; existing provider choices are preserved. Focus mode and browser fullscreen have separate controls.

Settings, provider/model selection, panel layout, project conversations, attached context, editor drafts, composer drafts and the last ten AI file applies are saved by the local server in `%LOCALAPPDATA%\GwensCodebench\state.json` on Windows. On this laptop that is `C:\Users\gwenb\AppData\Local\GwensCodebench`. `CODEBENCH_DATA_DIR` overrides the directory for testing or a deliberate move. This is file storage, not browser-session storage; another browser connected to the same server can recover it. The footer confirms **Saved on laptop**. Saves debounce for 250 ms; wait for confirmation before closing. Unsaved editor drafts are recovery copies, not writes to the original project files.

On the first launch with an empty laptop profile, existing app data from that browser is imported once. Provider credentials migrate separately to `credentials.json`; imported app keys are removed from browser storage only after confirmed disk saves. Existing laptop data takes precedence, and legacy data in other browsers is preserved. Open the updated app in your original browser first if you want its previous conversations imported. There is no cloud settings synchronization. Back up this folder yourself; protect `credentials.json`, which is a plain-text local file protected by your Windows account permissions, not encrypted storage. THESYS_API_KEY and Obsidian MCP credentials remain in the ignored `.env`. Never commit or share either credential file.

Original project files are checked again at Apply/Undo to prevent overwriting changes made since review. Use **Reload original** if a file changed on disk. Save or close an unsaved editor buffer before applying AI edits to it. Selected files apply one at a time; if one fails, earlier successful files remain applied and individually undoable. Interrupted or output-limited responses cannot be applied.

**AI activity** and the chat progress strip show actual request/tool events. Compatible providers stream visible text; OpenUI shows generation activity without exposing raw UI language. Claude currently returns its text after completion. **Stop** cancels the request; **Retry** resends the failed/stopped turn. Completion/error feedback has mute, volume and sound-mode controls; motion respects the system preference and the app setting. Editor and icon assets are bundled locally and need no CDN.

## Chat scrolling

Scrollbars are thin and dark throughout the editor, conversation and message box. **Settings → AI & context → Follow the latest response** follows streamed text and completed OpenUI views. Scrolling up pauses following; **Jump to latest** or returning to the bottom resumes it. With the setting off, Jump scrolls once without turning following on. The preference is saved on the laptop with the other settings.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+P` | Quick Open |
| `Ctrl+B` | Toggle Explorer |
| `Ctrl+Shift+F` | Editor focus mode |
| `Ctrl+Alt+B` | Toggle AI chat |
| `Ctrl+S` | Save file |
| `Ctrl+F` / `Ctrl+H` | Find / Replace |
| `Ctrl+G` | Go to Line |
| `Ctrl+/` | Toggle comment |

## Development

```bash
npm run dev
npm test
```

The server listens on `127.0.0.1` by default. Files are limited to 2 MB each, and the explorer lists up to 10,000 entries.

# Mi Notes Desktop

Mi Notes is a Windows desktop notes app built with React, TypeScript, Vite, and Tauri 2.

It combines notes, tasks, folders, an Excalidraw note canvas, and a PDF reader in one local-first app.

## Features

- Notes with folders, search, pinning, trash, and light/dark themes.
- Excalidraw is the primary note editor, with native fonts, text, pen, shapes, arrows, images, and undo/redo.
- Independent scenes and image files autosave per note in IndexedDB. Native fonts are bundled for offline desktop use.
- Use the native Text tool (`T`) and click anywhere on the canvas. On finishing text editing (Escape, Ctrl/Cmd+Enter, or clicking away), `# `, `## `, and `### ` become H1/H2/H3 text with the prefix removed. `- ` or `* ` becomes a bullet. Enter continues bullets and numbered lists inside the native text editor; Enter on an empty item exits. Native Tab/Shift+Tab indentation is preserved. No separate text input or editing panel is used.
- Each native text block remains an Excalidraw element, including multiline lists. Numbering continues while typing; moving or deleting elements later does not automatically renumber the canvas. A heading applies to its whole native text block.
- `Ctrl/Cmd+S` saves locally; `Ctrl/Cmd+N` creates a note. Excalidraw's menu provides scene import/export. Canvas tables, tasks, and sticky notes are deferred.
- PDF library with folder imports, thumbnails, page navigation, annotations, favourites, To Read, and PDF export.
- Imported folder synchronization: new or changed PDFs are detected without modifying the original files. The app stores private copies and keeps app annotations separate.
- Windows pinch/zoom hotkeys enabled through Tauri.
- Fresh installations start empty; existing local data is preserved during updates.

## Requirements

- Windows 10 or later.
- Node.js 22 or later for development.
- Rust toolchain and Tauri prerequisites for local Tauri builds.
- WebView2 on Windows. It is included with current Windows versions and can be installed separately if missing.

## Development

Install dependencies:

```powershell
npm ci
```

Start the browser development server:

```powershell
npm run dev
```

Start the Tauri desktop app:

```powershell
npm run tauri dev
```

Run the production frontend build:

```powershell
npm run build
```

Run tests:

```powershell
npm test
```

## Windows installers

Build the Windows application and both installer formats locally:

```powershell
npm run tauri build
```

The installers are generated at:

```text
src-tauri/target/release/bundle/nsis/Mi Notes_0.1.0_x64-setup.exe
src-tauri/target/release/bundle/msi/Mi Notes_0.1.0_x64_en-US.msi
```

The NSIS `.exe` installer is the easiest option for most users. Installing a newer build over an existing installation does not intentionally remove Mi Notes data.

## GitHub releases

The workflow at `.github/workflows/release.yml` builds Windows installers when a version tag is pushed:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

Before tagging, commit the workflow and application changes, and make sure the versions in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` agree. The tag must be `v` followed by the application version.

The workflow checks out the exact tag, validates the application version, installs Node and Rust, runs drawing/geometry checks, and builds Windows x64 NSIS and MSI installers using the Rust lockfile. It publishes both installers and `SHA256SUMS.txt` to the GitHub Release and saves a separate Actions artifact. Tags containing a hyphen (such as `v0.1.0-beta.1`) create prereleases.

To rerun an existing tag, open **Actions → Release Mi Notes → Run workflow** and enter the tag. The workflow uses GitHub's automatic `GITHUB_TOKEN`; no personal access token is needed. Repository policies must allow the workflow to write release contents.

The installers are currently **unsigned**, and the release description states this. GitHub's token authorizes uploading files; it is not a Windows code-signing certificate. Windows certificate signing must be configured separately once a signing provider is available.

## Data and privacy

Notes, tasks, settings, PDF metadata, annotations, and imported PDF copies are stored locally. Folder synchronization reads source folders and never writes changes back to the original files. Removing the app does not necessarily remove browser/WebView local data; manage that separately if a full reset is required.

## Google Drive folders

Connect directly to Google Drive from the browser or Windows app under **Read ? Add ? Google Drive**. See [Google Drive setup](GOOGLE_DRIVE_SETUP.md) for the one-time OAuth configuration, refresh behavior, and development requirements.

## Canvas storage and migration

Note metadata remains in `minotes-v1` localStorage. Excalidraw elements, durable view/tool settings, and binary image data are stored atomically by note ID in the `minotes-scenes` IndexedDB database (`notes` object store). Selection and editing state are not restored. Pending saves finish before navigating back or closing the desktop window; save errors are shown in the editor.

Existing note text and embedded data-URL images are imported on first open. Old drawing previews become movable images. Original HTML and drawing fields remain intact in metadata; complex legacy blocks are not converted into editable equivalents. The redundant old note editor and drawing-screen components have been removed.

The integration uses the [official Excalidraw React API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/integration). Run `npx playwright test tests/canvas-editor.spec.ts tests/fresh-install.spec.ts` for native T-tool headings, list continuation, indentation, dark/light inline-editor contrast, images, movement/undo, and reload coverage.

### Native text integration (Excalidraw 0.18.1)

The public `onChange` API and `appState.editingTextElement` identify the end of native text editing. Heading and bullet transformations use `newElementWith` and `updateScene` after Excalidraw captures its own submit history. IDs, coordinates, selected font/color, group bindings, and element identity remain intact. Undoing formatting does not immediately reapply it.

Version 0.18.1 has no public character-input or Enter callback. A small, canvas-scoped Enter handler operates only on the existing `.excalidraw-wysiwyg` textarea to insert list markers, then dispatches the normal input event so Excalidraw owns text updates and measurement. It skips IME composition, modified Enter, and selected ranges. Native Tab/Shift+Tab remains untouched. This version-specific bridge is covered by browser tests and should be rechecked when upgrading Excalidraw; it never creates or replaces an editor.

MINOTE colors, surfaces, spacing, and radii are mapped through Excalidraw CSS variables. A narrowly scoped WYSIWYG reset removes leaked global form borders, padding, background, and backdrop blur; it intentionally preserves Excalidraw's inline stroke color and dark-mode rendering filter.

### Canvas title and note previews

The title grows with its text between 120px and 360px (constrained on small windows), stays centered in the window, and finishes editing on Enter. Excalidraw 0.18.1 has no public Library visibility setting, so a canvas-scoped rule hides its trigger wrapper without modifying scene support or essential tools.

Note cards show the actual canvas, title and modified date. Native `exportToBlob` renders content bounds with padding and embedded image files, capped at 600px. Preview generation is debounced after saves and flushed when leaving. Light and dark PNG blobs are cached separately in the `minotes-previews` IndexedDB database; they never replace editable scenes. Opening the grid only reads cached previews. Empty notes and uncached scenes use themed placeholders until the next normal editor save.

Run `npx playwright test tests/canvas-editor.spec.ts tests/canvas-previews.spec.ts tests/fresh-install.spec.ts` to verify native editing, theme contrast, compact title, cached previews, responsive cards and scene persistence.

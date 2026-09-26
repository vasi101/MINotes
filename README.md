# Mi Notes Desktop

Mi Notes is a Windows desktop notes app built with React, TypeScript, Vite, and Tauri 2.

It combines notes, tasks, folders, a rich text editor, drawing tools, and a PDF reader in one local-first app.

## Features

- Notes with folders, search, pinning, trash, and light/dark themes.
- Rich text editing with headings, bold, italic, underline, lists, quotes, images, and PDF page inserts.
- Word-style editor shortcuts:
  - `Ctrl/Cmd+B` bold
  - `Ctrl/Cmd+I` italic
  - `Ctrl/Cmd+U` underline
  - `Ctrl/Cmd+Z` undo
  - `Ctrl/Cmd+Y` or `Ctrl/Cmd+Shift+Z` redo
  - `Ctrl/Cmd+Shift+7` numbered list
  - `Ctrl/Cmd+Shift+8` bullet list
  - `Ctrl/Cmd+Alt+1/2/3` headings
  - `Ctrl/Cmd+S` save
  - `Ctrl/Cmd+N` new note
- Drawing canvases with pencil, brush, marker, fountain pen, eraser, image import, image transforms, resizable previews, and cropped exports.
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

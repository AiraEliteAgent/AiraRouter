# AiraRouter Electron Desktop App

This directory contains the Electron desktop application wrapper for AiraRouter.

## Architecture (v1.6.4)

```
electron/
├── main.js          # Main process — window, tray, server lifecycle, CSP, IPC
├── preload.js       # Preload script — secure IPC bridge with disposer pattern
├── package.json     # Electron-specific dependencies & electron-builder config
├── types.d.ts       # TypeScript definitions (AppInfo, ServerStatus, ElectronAPI)
└── assets/          # Application icons and resources

src/shared/hooks/
└── useElectron.ts   # React hooks — useSyncExternalStore, zero re-renders
```

## Key Design Decisions

| Decision                      | Rationale                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `waitForServer()` polling     | Prevents blank screen on cold start — polls `http://localhost:PORT` before loading               |
| `stdio: 'pipe'`               | Captures server stdout/stderr for logging + readiness detection (not `inherit`)                  |
| Disposer pattern              | `onServerStatus()` returns `() => void` for precise listener cleanup (no `removeAllListeners`)   |
| `useSyncExternalStore`        | Zero re-renders for `useIsElectron()` — no `useState` + `useEffect` cycle                        |
| CSP via session headers       | `Content-Security-Policy` restricts `script-src`, `connect-src` etc. per Electron best practices |
| Platform-conditional titlebar | `titleBarStyle: 'hiddenInset'` only on macOS; `default` on Windows/Linux                         |

## Development

### Prerequisites

1. Build the Next.js app first:

```bash
npm run build
```

2. Install Electron dependencies:

```bash
cd electron
npm install
```

### Running in Development

1. Start the Next.js development server:

```bash
npm run dev
```

2. In another terminal, start Electron:

```bash
cd electron
npm run dev
```

### Running in Production Mode

1. Build Next.js in standalone mode:

```bash
npm run build
```

2. Start Electron:

```bash
cd electron
npm start
```

## Building

### Build for Current Platform

```bash
cd electron
npm run build
```

### Build for Specific Platforms

```bash
# Windows
npm run build:win

# macOS (x64 + arm64)
npm run build:mac

# Linux
npm run build:linux
```

## Output

Built applications are placed in `dist-electron/`:

- Windows: `.exe` installer (NSIS) + portable `.exe`
- macOS: `.dmg` installer (Intel + Apple Silicon)
- Linux: `.AppImage`

## Installation

### macOS

1. Download the latest `.dmg` from the [Releases](https://github.com/diegosouzapw/AiraRouter/releases) page.
2. Open the `.dmg` file.
3. Drag `AiraRouter.app` to the Applications folder.
4. Launch from Applications.

> ⚠️ **Note:** The app is not signed with an Apple Developer certificate yet. If macOS blocks the app, run:
>
> ```bash
> xattr -cr /Applications/AiraRouter.app
> ```
>
> Or right-click the app → Open → Open (to bypass Gatekeeper on first launch).

### Windows

**Installer (Recommended):**

1. Download `AiraRouter.Setup.*.exe` from [Releases](https://github.com/diegosouzapw/AiraRouter/releases).
2. Run the installer.
3. Launch from Start Menu or Desktop shortcut.

**Portable (No Installation):**

1. Download `AiraRouter.exe` from [Releases](https://github.com/diegosouzapw/AiraRouter/releases).
2. Run directly from any folder.

### Linux

1. Download the `.AppImage` from [Releases](https://github.com/diegosouzapw/AiraRouter/releases).
2. Make it executable:
   ```bash
   chmod +x AiraRouter-*.AppImage
   ```
3. Run:
   ```bash
   ./AiraRouter-*.AppImage
   ```

## Features

- **Server Readiness** — Waits for health check before showing window
- **System Tray** — Minimize to tray with quick actions (open, port change, quit)
- **Port Management** — Change port from tray menu (server restarts automatically)
- **Window Controls** — Custom minimize, maximize, close via IPC
- **Content Security Policy** — Restrictive CSP via session headers
- **Offline Support** — Bundled Next.js standalone server
- **Single Instance** — Only one app instance can run at a time

## Configuration

### Environment Variables

| Variable              | Default      | Description                       |
| --------------------- | ------------ | --------------------------------- |
| `OMNIROUTE_PORT`      | `20128`      | Server port                       |
| `OMNIROUTE_MEMORY_MB` | `512`        | Node.js heap limit (64–16384 MB)  |
| `NODE_ENV`            | `production` | Set to `development` for dev mode |

### Custom Icon

Place your icons in `assets/`:

- `icon.ico` — Windows icon (256×256)
- `icon.icns` — macOS icon bundle
- `icon.png` — Linux/general use (512×512)
- `tray-icon.png` — System tray icon (16×16 or 32×32)

## IPC Channels

### Invoke (Renderer → Main, async)

| Channel          | Returns       | Description                                   |
| ---------------- | ------------- | --------------------------------------------- |
| `get-app-info`   | `AppInfo`     | App name, version, platform, isDev, port      |
| `open-external`  | `void`        | Open URL in default browser (http/https only) |
| `get-data-dir`   | `string`      | Get userData directory path                   |
| `restart-server` | `{ success }` | Stop + restart server (5s timeout + SIGKILL)  |

### Send (Renderer → Main, fire-and-forget)

| Channel           | Description                     |
| ----------------- | ------------------------------- |
| `window-minimize` | Minimize window                 |
| `window-maximize` | Toggle maximize/restore         |
| `window-close`    | Close window (minimize to tray) |

### Receive (Main → Renderer, events)

| Channel         | Payload        | Emitted When                              |
| --------------- | -------------- | ----------------------------------------- |
| `server-status` | `ServerStatus` | Server starts, stops, errors, or restarts |
| `port-changed`  | `number`       | Port change via tray menu                 |

> **Note**: Listeners return disposer functions for precise cleanup. See `useServerStatus` and `usePortChanged` hooks.

## Security

| Feature           | Implementation                                                                  |
| ----------------- | ------------------------------------------------------------------------------- |
| Context Isolation | `contextIsolation: true` — renderer cannot access Node.js                       |
| Node Integration  | `nodeIntegration: false` — no `require()` in renderer                           |
| IPC Whitelist     | Channel names validated in preload via `safeInvoke`/`safeSend`/`safeOn`         |
| URL Validation    | `shell.openExternal()` only allows `http:` / `https:` protocols                 |
| CSP               | `Content-Security-Policy` header set via `session.webRequest.onHeadersReceived` |
| Web Security      | `webSecurity: true` — same-origin policy enforced                               |

## React Hooks

| Hook                   | Returns                         | Description                                      |
| ---------------------- | ------------------------------- | ------------------------------------------------ |
| `useIsElectron()`      | `boolean`                       | Zero-render detection via `useSyncExternalStore` |
| `useElectronAppInfo()` | `{ appInfo, loading, error }`   | App info from main process                       |
| `useDataDir()`         | `{ dataDir, loading, error }`   | User data directory                              |
| `useWindowControls()`  | `{ minimize, maximize, close }` | Window control actions                           |
| `useOpenExternal()`    | `{ openExternal }`              | Open URLs in browser                             |
| `useServerControls()`  | `{ restart, restarting }`       | Server restart control                           |
| `useServerStatus(cb)`  | Disposer                        | Listen for server status events                  |
| `usePortChanged(cb)`   | Disposer                        | Listen for port change events                    |

## Troubleshooting

### App Won't Start

1. Check if port 20128 is available: `lsof -i :20128`
2. Check console logs for `[Electron]` prefix
3. Verify the build output exists in `.next/standalone`

### White Screen

1. Verify Next.js build exists — server readiness waits 30s max
2. Check `[Server]` and `[Server:err]` log output
3. Look for CSP violations in developer console

### Build Fails

Ensure you have build tools installed:

- Windows: Visual Studio Build Tools
- macOS: Xcode Command Line Tools
- Linux: `build-essential`, `libsecret-1-dev`

## License

MIT

# @skieadmin/scratch-ai-desktop

The desktop build of the AI-assisted Scratch editor: one application that runs the
editor and the MCP bridge together, so the assistant works the moment you open it.

This is a modified version of the Scratch editor. It is not affiliated with, endorsed
by, or sponsored by the Scratch Foundation.

## Why a desktop build

In a browser, the assistant needs two things the page cannot provide for itself:

- **Somewhere to keep API keys.** A key typed into a web page is readable by anything
  running on that page. DeepSeek and OpenRouter keys therefore live in a separate
  process, which the browser build expects you to start by hand.
- **An MCP server.** A browser page cannot listen on a port, so it cannot be an MCP
  server. It can only dial out to one.

The desktop build runs that process itself, inside Electron's main process. Nothing to
start, nothing to paste, and an external MCP client such as Claude Desktop can attach to
the same bridge and drive the editor you have open.

## Running it

```sh
npm ci                    # from the repo root
npm run desktop           # builds the editor, compiles the shell, packages installers
```

Output lands in `release/`:

| File                                  | What it is                                                      |
| ------------------------------------- | --------------------------------------------------------------- |
| `SkieAIEditor-<version>-x64.exe`      | Windows installer (NSIS), per-user, choosable install directory |
| `SkieAIEditor-<version>-portable.exe` | Windows portable build, no installation                         |
| `SkieAIEditor-<version>.AppImage`     | Linux                                                           |
| `SkieAIEditor-<version>.dmg`          | macOS                                                           |

electron-builder only produces installers for the platform it runs on unless you
configure cross-compilation, so run it on the platform you are targeting.

To iterate without packaging:

```sh
npm run build --workspace @skieadmin/scratch-ai-desktop   # editor + shell, no installer
npx electron packages/scratch-ai-desktop                  # launch what you just built
```

## How it fits together

```text
Electron main process
├── MCP bridge          127.0.0.1:<random>   tool calls in, WebSocket to the window
│   └── MCP over Streamable HTTP at /mcp     for Claude Desktop and friends
└── static server       127.0.0.1:<random>   serves the built editor
        │
        └── BrowserWindow ── preload.cjs ── window.scratchAiDesktop.bridgeUrl
                    │
                    └── the editor, which dials the bridge and runs its tools
```

The editor is served over loopback HTTP rather than loaded from `file://`. A `file://`
page has the opaque origin `null`, which local model servers such as Ollama and LM Studio
reject and which no CORS setting can allow. A real `http://127.0.0.1` origin can be
allowed — see the provider notes in
[`@skieadmin/scratch-ai-bridge`](../scratch-ai-bridge/README.md).

## Security

- Both servers bind to `127.0.0.1`, never `0.0.0.0`.
- Both take an OS-assigned port, so two copies of the app cannot collide, and neither
  port is predictable.
- The bridge generates a fresh token each launch and only accepts the window's own
  origin, so another page on your machine cannot drive your editor.
- The window runs with `contextIsolation: true`, `nodeIntegration: false` and
  `sandbox: true`. The page gets the bridge URL through a preload script and has no
  other access to Node.
- Navigation away from the editor is blocked; `https://` links open in your real browser.

## Provider API keys

Set them in the environment the app is launched from, or in the bridge's config file:

```sh
DEEPSEEK_API_KEY=sk-…
OPENROUTER_API_KEY=sk-or-…
```

Ollama and LM Studio need no key.

## Licence

AGPL-3.0-only, the same as the editor it is built from. See [LICENSE](./LICENSE), and
[TRADEMARK](./TRADEMARK) for the Scratch Foundation's marks.

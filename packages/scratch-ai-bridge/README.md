# @skieadmin/scratch-ai-bridge

A small local Node process that sits between the Scratch editor and AI tooling, maintained by SkieAdmin.
This is an independent modification, not affiliated with or endorsed by the Scratch Foundation.
The fork's AI packages use the `@skieadmin` scope. It is three things in one:

1. **An MCP server.** It exposes the Scratch editor's tools over the Model Context Protocol, so a client such as
   Claude Desktop or Claude Code can create sprites, add blocks and run a project.
2. **An editor hub.** The editor connects out to it over a WebSocket and announces what it can do. Tool calls from
   the MCP client are forwarded to the editor and the answers come back the same way.
3. **A provider proxy.** Chat completions for DeepSeek, OpenRouter, LM Studio and Ollama run here, so API keys stay
   in this process.

## Why a separate process

`scratch-gui` is a browser application, not an Electron app. A browser page cannot listen on a port, cannot speak
MCP over stdio, and cannot keep a secret from the other pages in the same browser. So the bridge listens and the
editor dials out, and every API key lives here rather than in `localStorage`.

## Running it

From the repository root (Node.js 22 or newer):

```sh
npm ci
npm run build --workspace=packages/scratch-ai-bridge
npm run start:ai
```

These commands use the local checkout and do not require an npm release. Use
`npx -y @skieadmin/scratch-ai-bridge` only after that package has been published by its owner.

It prints a banner to **stderr** — stdout is reserved for MCP's JSON-RPC stream — including the URL to paste into
the editor:

```
scratch-ai-bridge: listening on 127.0.0.1:8610
scratch-ai-bridge: MCP over stdio: on
scratch-ai-bridge: MCP over Streamable HTTP: off
scratch-ai-bridge: API keys loaded for: deepseek

scratch-ai-bridge: Paste this into the editor's AI settings as the bridge URL:
scratch-ai-bridge:   ws://127.0.0.1:8610/editor?token=6f1c…
```

### Flags

| Flag                      | Default     | Meaning                                                             |
| ------------------------- | ----------- | ------------------------------------------------------------------- |
| `--port <number>`         | `8610`      | Port to listen on                                                   |
| `--host <address>`        | `127.0.0.1` | Address to bind. `0.0.0.0` exposes the bridge to your whole network |
| `--token <secret>`        | generated   | Shared secret the editor must present                               |
| `--allow-origin <origin>` | localhost   | Exact browser origin allowed to connect; repeatable                 |
| `--mcp-http`              | off         | Also serve MCP over Streamable HTTP at `/mcp`                       |
| `--mcp-token <secret>`    | none        | Bearer token MCP clients must send to `/mcp`                        |
| `--no-mcp-stdio`          | stdio on    | Do not serve MCP over stdio                                         |
| `--config <path>`         | —           | JSON config file                                                    |
| `-h`, `--help`            | —           | Show usage                                                          |

### Config file

```json
{
  "port": 8610,
  "token": "paste-a-long-random-string-here",
  "allowOrigin": ["http://localhost:8601"],
  "mcpHttp": true,
  "mcpToken": "another-long-random-string",
  "providers": {
    "deepseek": { "apiKey": "sk-…" },
    "openrouter": { "apiKey": "sk-or-…" },
    "ollama": { "baseUrl": "http://127.0.0.1:11434" }
  },
  "openRouter": { "referer": "https://github.com/SkieAdmin", "title": "Skie AI Editor" }
}
```

`DEEPSEEK_API_KEY` and `OPENROUTER_API_KEY` in the environment take precedence over the file, so you can keep keys
out of it entirely.

## Pointing Claude Desktop at it

Add this to `claude_desktop_config.json`. On macOS it lives at
`~/Library/Application Support/Claude/claude_desktop_config.json`, on Windows at
`%APPDATA%\Claude\claude_desktop_config.json`.

```json
{
  "mcpServers": {
    "scratch": {
      "command": "node",
      "args": [
        "C:/path/to/Scratch AI Editor/packages/scratch-ai-bridge/bin/scratch-ai-bridge.mjs",
        "--token",
        "paste-a-long-random-string-here"
      ],
      "env": {
        "DEEPSEEK_API_KEY": "sk-…"
      }
    }
  }
}
```

Build the bridge first using the commands above, and replace the script path with your checkout's absolute path.
If Node is not on Claude Desktop's PATH, use the absolute path to `node.exe` for `command`.

Claude Desktop spawns the bridge and talks to it over stdio. Pass `--token` explicitly here: a token generated at
startup is printed to stderr, where Claude Desktop hides it, and you need it to configure the editor.

Then open the Scratch editor, open the AI assistant's settings, and set the bridge URL to
`ws://127.0.0.1:8610/editor?token=paste-a-long-random-string-here`.

## Pointing Claude Code at it

Claude Code, and any other client that attaches to a URL rather than spawning a process, talks to the bridge over
Streamable HTTP. Start the bridge with `--mcp-http`, then register it once:

```sh
claude mcp add --transport http scratch http://127.0.0.1:8610/mcp
```

If you started the bridge with `--mcp-token`, send the token too:

```sh
claude mcp add --transport http scratch http://127.0.0.1:8610/mcp --header "Authorization: Bearer <token>"
```

Any number of clients can be connected at once. Each `initialize` opens its own session, and later requests are
routed to it by their `Mcp-Session-Id` header. A client that restarts simply opens a new session. A session ends when
its client sends `DELETE`, or after 30 minutes with no open request; a request naming a session that has ended gets
HTTP 404, which tells the client to start a new one. Every session hears `notifications/tools/list_changed` when the
editor announces a different set of tools.

The desktop app serves the same endpoint on port 8610 without any of this setup; see
[`@skieadmin/scratch-ai-desktop`](../scratch-ai-desktop/README.md).

## Pointing the editor at it

The editor is the WebSocket _client_. It connects to `ws://<host>:<port>/editor?token=<token>`, announces its tool
catalogue in a `hello`, and from then on answers `invoke` envelopes and sends its own `chat` and `models` requests.
It reconnects on its own with exponential backoff, so the bridge and the editor can be started in either order.

Only one editor may be attached at a time. A second connection is closed immediately with code `4001`, because a
tool call names no editor and two attached editors would make "run this in Scratch" ambiguous.

## Tools

The editor announces its tools in its `hello`, and the bridge offers exactly those to MCP clients. Their schemas and
descriptions live in
[`scratch-gui/src/lib/ai/scratch-tools/definitions.js`](../scratch-gui/src/lib/ai/scratch-tools/definitions.js),
shared with the editor's own assistant panel. Tools that take a `targetId` accept a sprite name, a target id or
`"stage"`, and default to the sprite being edited.

### Reading the project

| Tool                  | What it does                                                                          |
| --------------------- | ------------------------------------------------------------------------------------- |
| `get_project_summary` | Sprites, variables, backdrop and costume counts, and the shape of every script        |
| `get_target`          | One sprite or the stage in full, every script block by block                          |
| `list_sprites`        | Sprite ids, names and positions                                                       |
| `list_costumes`       | A target's costumes, in costume-tab order                                             |
| `list_sounds`         | A target's sounds, in sound-tab order                                                 |
| `list_variables`      | The variables and lists a target can see                                              |
| `get_block_catalog`   | The opcodes available, with their inputs and fields; filter by `category` or `search` |
| `search_library`      | Names in the sprite, costume, backdrop or sound library                               |

### Changing the project

| Tool                        | What it does                                                     |
| --------------------------- | ---------------------------------------------------------------- |
| `add_sprite_from_library`   | Add a library sprite, optionally renamed and placed              |
| `delete_sprite`             | Delete a sprite and its clones                                   |
| `rename_sprite`             | Rename a sprite                                                  |
| `set_sprite_properties`     | Move, turn, resize, show or hide a sprite, or switch its costume |
| `add_costume_from_library`  | Add a library costume to a sprite or the stage                   |
| `add_backdrop_from_library` | Add a library backdrop and switch to it                          |
| `add_sound_from_library`    | Add a library sound                                              |
| `set_variable`              | Set a variable or list, creating it if needed                    |
| `create_script`             | Build a stack of blocks; see below                               |
| `delete_script`             | Delete a script by its top block's id                            |
| `add_extension`             | Switch on `text2speech`, `music`, `pen` or `translate`           |
| `set_editing_target`        | Show a sprite or the stage in the editor                         |

`create_script` takes the blocks top to bottom, each as `{"opcode", "inputs", "fields"}`. An input is a number or
string, a nested block spec for a reporter, an array of block specs for a C-block branch, or
`{"shadow": "<opcode>", "value": ...}` to name the slot type. Menus work the way the dropdowns do: a plain string in a
menu input picks that item, so `{"opcode": "looks_switchbackdropto", "inputs": {"BACKDROP": "Jungle"}}` builds the
real _switch backdrop to [Jungle v]_ block. A menu can also be named outright, as
`{"shadow": "looks_backdrops", "value": "Jungle"}`; its field is filled in for you. Every core menu is recognised, and
an extension's menus (`pen_menu_colorParam` and so on) once the extension is loaded, which `create_script` does by
itself.

### Running and testing the project

These let a client check what it built by running it, the way a person would: start it, click and type, answer its
questions, and look.

| Tool                | What it does                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `green_flag`        | Start the project                                                                                        |
| `stop_all`          | Stop every script, as the stop sign does                                                                 |
| `get_runtime_state` | Running or not, the backdrop, each sprite's position, costume, layer and bubble, the question, variables |
| `wait`              | Let the project run for up to 15 seconds, then return `get_runtime_state`                                |
| `click_sprite`      | Start a sprite's "when this sprite clicked" scripts, or the stage's "when stage clicked"                 |
| `press_key`         | Press and release a key (`"space"`, `"left arrow"`, `"a"`, ...), holding it for `holdMs`                 |
| `answer_question`   | Answer the waiting "ask and wait" question, as typing it and pressing enter would                        |
| `set_backdrop`      | Switch to a backdrop by name or index, starting its "when backdrop switches to" scripts                  |
| `set_costume`       | Switch a sprite's costume by name or index                                                               |
| `capture_stage`     | A PNG of the stage as it is now, speech bubbles included                                                 |
| `capture_editor`    | A PNG of the whole editor window; desktop app only                                                       |

`capture_stage` and `capture_editor` return an MCP `image` content block, followed by a `text` block with the picture's
size; the editor shapes such a result as MCP content and the bridge passes it through. Every other result arrives as one
`text` block of JSON. The editor's own chat panel is not offered the two capture tools, because it gives tool results to
its model as text.

## Security model

Any page in the user's browser can open a WebSocket to `127.0.0.1`. Without a check, a hostile site could quietly
drive the editor and spend the user's API credits. Three things prevent that:

- **Origin allowlist.** The `Origin` header is checked during the WebSocket upgrade. By default only
  `http(s)://localhost`, `http(s)://127.0.0.1` and `http(s)://[::1]`, on any port, are allowed. `--allow-origin`
  replaces that default with exact origins you name; `--allow-origin '*'` switches the check off.
- **Shared token.** Every connection must present `?token=<secret>`. Supply it with `--token` or let the bridge
  generate one and print it. The comparison hashes both sides and uses `timingSafeEqual`, so neither the token nor
  its length leaks through response timing. Non-browser clients send no `Origin` at all, so the token is what holds
  them back.
- **Loopback binding.** The bridge binds `127.0.0.1` unless you override `--host`. It is never reachable from the
  network by default.

The MCP endpoint at `/mcp` has checks of its own, made before the request body is read:

- **Host allowlist.** A DNS rebinding attack points a hostile name at `127.0.0.1`, but the browser still sends that
  name as `Host`. Only `127.0.0.1:<port>`, `localhost:<port>` and, when `--host` names one specific address, that
  address are accepted; anything else gets HTTP 403. This is why the endpoint is reached by those names only.
- **Origin check.** A request carrying an `Origin` must pass the same allowlist as the editor endpoint, so a web page
  other than the editor gets HTTP 403. Claude Code and other non-browser clients send no `Origin`.
- **Optional bearer token.** With `--mcp-token` (or `mcpToken` in the config file), every request must carry
  `Authorization: Bearer <token>`, compared the same timing-safe way as the editor token; otherwise HTTP 401. Without
  a token, any program on this machine can use the endpoint, which is no more than it could already do as you.

Anyone who holds the token can drive your editor and spend your API credits. Treat it like a password.

## Protocol

JSON envelopes in both directions over the editor WebSocket.

| Type            | Direction       | Payload                                                             |
| --------------- | --------------- | ------------------------------------------------------------------- |
| `hello`         | editor → bridge | `{protocolVersion, tools}`                                          |
| `invoke`        | bridge → editor | `{id, name, args}`                                                  |
| `result`        | editor → bridge | `{id, ok, result?, error?, durationMs}`                             |
| `event`         | editor → bridge | `{event, payload}`                                                  |
| `chat`          | editor → bridge | `{id, provider, model, messages, tools?, temperature?, maxTokens?}` |
| `chat-cancel`   | editor → bridge | `{id}`                                                              |
| `chat-delta`    | bridge → editor | `{id, delta}`                                                       |
| `chat-done`     | bridge → editor | `{id, ok, result?, error?}`                                         |
| `models`        | editor → bridge | `{id, provider}`                                                    |
| `models-done`   | bridge → editor | `{id, ok, models?, error?}`                                         |
| `ping` / `pong` | both            | heartbeat; the socket is dropped after two unanswered pings         |

`provider` is one of `deepseek`, `openrouter`, `lmstudio`, `ollama`. `messages` and `tools` are in OpenAI
chat-completions form.

A `chat-delta` carries `delta` as an object, `{content?, reasoning?, toolCalls?}`: `content` is answer text,
`reasoning` is the model's chain of thought, kept apart so the editor can style it differently, and `toolCalls` are
fragments of a call still being assembled.

A successful `chat-done` carries `result` as `{content, reasoning, toolCalls, finishReason}`, where each tool call
is `{id, name, args, rawArguments}`. `args` is the parsed arguments and `rawArguments` is the JSON text the model
produced; the editor echoes that text back verbatim in the assistant message of its next `chat`.

`chat-cancel` abandons an in-flight `chat`: the bridge aborts the provider request and sends nothing further for
that id. Cancelling an id that has already finished does nothing.

Tool invocations time out after 30 seconds and reject with a message naming the tool.

## Providers

All four speak an OpenAI-compatible `/chat/completions`, so one SSE streaming parser and one tool-call accumulator
serve them all. The differences:

| Provider   | Chat                         | Models            | Notes                                                                                                                     |
| ---------- | ---------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| DeepSeek   | `<base>/chat/completions`    | `<base>/models`   | `deepseek-reasoner` streams its chain of thought in `reasoning_content`, surfaced separately from `content`               |
| OpenRouter | `<base>/chat/completions`    | `<base>/models`   | Sends `HTTP-Referer` and `X-Title`                                                                                        |
| LM Studio  | `<base>/chat/completions`    | `<base>/models`   | Base URL already includes `/v1`; no key                                                                                   |
| Ollama     | `<base>/v1/chat/completions` | `<base>/api/tags` | Chat uses the OpenAI-compatible path; models come from the native endpoint, which reliably reports what is pulled locally |

Tool calling is supported everywhere. Tool calls arrive as indexed fragments spread over many SSE chunks — the
`index` field says which call each fragment belongs to, and `function.arguments` is a JSON string delivered a few
characters at a time — and the accumulator reassembles them per index.

## Development

```sh
npm run build   # type-check and bundle to dist/
npm test        # lint, then run the unit tests with coverage
npm run format  # prettier + eslint --fix
```

## License

AGPL-3.0-only. See [LICENSE](LICENSE) and [TRADEMARK](TRADEMARK).

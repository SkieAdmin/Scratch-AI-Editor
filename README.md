# scratch-editor: The Scratch Editor Monorepo

If you'd like to use Scratch, please visit the [Scratch website](https://scratch.mit.edu/). You can build your own
Scratch project by pressing "Create" on that website or by visiting <https://scratch.mit.edu/projects/editor/>.

This is a source code repository for the packages that make up the Scratch editor and a few additional support
packages. Use this if you'd like to learn about how the Scratch editor works or to contribute to its development.

## What's in this repository?

The `packages` directory in this repository contains:

- `scratch-ai-desktop` packages the editor and the bridge into one desktop application.
- `scratch-ai-bridge` runs the local MCP server that lets an AI assistant read and edit the project you have open,
  and proxies AI provider requests so API keys stay out of the browser.
- `scratch-ai-desktop` packages Skie AI Editor for desktop use, with the bridge built in.
- `scratch-gui` provides the buttons, menus, and other elements that you interact with when creating and editing a
  project. It's also the "glue" that brings most of the other modules together at runtime.
- `scratch-media-lib-scripts` builds (or rebuilds) media libraries for the editor.
- `scratch-paint` provides a way to draw vector (SVG) or bitmap (PNG) images for costumes and backdrops.
- `scratch-render` draws backdrops, sprites, and clones on the stage.
- `scratch-storage` helps load project assets like images and sounds. It also provides `ScratchFetch`, a customized
  wrapper around `fetch`.
- `scratch-svg-renderer` processes SVG (vector) images for use with Scratch projects.
- `scratch-vm` is the virtual machine that runs Scratch projects.
- `task-herder` manages queues of tasks with throttling and concurrency limits.

_Please add to this list as more packages are migrated to the monorepo._

Each package has its own `README.md` file with more information about that package.

## AI assistant

This fork adds an AI assistant to the editor: a chat panel on the right-hand side that can inspect and build the
open project through the same operations the editor itself uses.

```sh
npm run desktop     # build the desktop app; installers land in packages/scratch-ai-desktop/release/
```

The desktop build runs the editor and the bridge together, so the assistant works as soon as it opens. To work on
the editor in a browser instead:

```sh
npm start           # the editor, at http://localhost:8601
npm run start:ai    # the MCP bridge, in a second terminal
```

In the browser the bridge is optional. Local providers (Ollama, LM Studio) work without it; DeepSeek and
OpenRouter need it, because that is where their API keys are kept. See
[`packages/scratch-ai-bridge/README.md`](packages/scratch-ai-bridge/README.md) for the security model and for
pointing an external MCP client such as Claude Desktop at your editor.

This is a modified version of the Scratch editor. It is not affiliated with or endorsed by the Scratch Foundation.

The fork's AI packages use the `@skieadmin` npm scope. Local builds do not require publishing to npm.

## Windows desktop build

With Node.js 22 or newer installed, run from the repository root:

```sh
npm ci
npm run build:desktop
```

The build produces `SkieAIEditor-15.1.1-x64.exe` (installer) and
`SkieAIEditor-15.1.1-portable.exe` in `packages/scratch-ai-desktop/release/`.
The app includes the editor and local AI bridge. See the
[desktop README](packages/scratch-ai-desktop/README.md) for testing and development.

## Monorepo migration

### What's going on?

We're migrating the Scratch editor packages into this monorepo. This will allow us to manage all the packages that
make up the Scratch editor in one place, making  it easier to manage dependencies and make changes that affect
multiple packages.

### Why are there only a few packages in this repo?

We're migrating packages in stages. The current plan, which is subject to change, has us migrating repositories in
four batches. We plan to complete the migration within 2025.

### What will happen to the existing repositories?

The existing repositories will be archived and made read-only. Those repositories contain valuable work and
information, including but not limited to issues and pull requests. We plan to keep that information available for
reference, and to selectively migrate it to this new repository.

## Thank you

Scratch would not be what it is today without help from the global community of Scratchers and open-source
contributors. Thank you for your contributions and support. _[Scratch on!](https://scratch.mit.edu/projects/65347738/fullscreen/)_

## Donate

We provide [Scratch](https://scratch.mit.edu) free of charge, and want to keep it that way! Please consider making a
[donation](https://www.scratchfoundation.org/donate) to support our continued engineering, design, community, and
resource development efforts. Donations of any size are appreciated. Thank you!

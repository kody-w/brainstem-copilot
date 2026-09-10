# Brainstem for the GitHub Copilot app

**Your Brainstem and Brain Surgeon are native Copilot agents. No Brainstem
server required.**

Keep the Brainstem way of working: a soul, explicit memory, useful capabilities,
and a visible **Learn -> Teach -> Keep** loop. GitHub Copilot supplies the
agents, model conversation, tools, permissions, and chat. You do not need
RAPP, Python, Flask, or VS Code to use the native experience.

The separate RAPP Brainstem engine is an **optional Frontier mode**, off by
default. Installing or opening this plugin does not install, start, or contact
that engine.

## Install in the app

1. Open **Customize -> Plugins** in the GitHub Copilot app.
2. Open marketplace settings and add
   **`kody-w/rapp-brainstem-copilot-app`**.
3. Install **Brainstem** from the **brainstem** marketplace.
4. Start a new session, choose the **Brainstem** agent, and say:

   > Give me my Brainstem.

Brainstem handles everyday work. Choose **Brain Surgeon**, or ask to teach a
capability, when you want to turn a useful procedure into a reusable skill.
The app's normal approvals still apply. Organization policy may restrict
custom plugins or extensions.

This repository is its own custom marketplace. Installation does not depend
on placement in GitHub's featured or editor-curated catalog.

## The same shape, native building blocks

| Familiar word | What it means here |
|---|---|
| **Brainstem** | Your everyday native Copilot agent |
| **Brain Surgeon** | The native Copilot agent that teaches or improves a capability |
| **Soul** | Your editable working instructions |
| **Memory** | Explicitly approved local notes, separate from Copilot's own Memory |
| **Capability** | An ordinary Copilot skill, custom agent, or tool |
| **Learn -> Teach -> Keep** | Do real work, capture the learning, retain portable source |
| **Frontier** | Opt into a separate RAPP Brainstem engine when you need it |

```text
Soul + approved notes + relevant capabilities
                    |
             Native Copilot agent
                    |
             Native Copilot tools
                    |
          Visible actions and results
```

There is no hidden second model loop. Canvas buttons send user intent back
into the current Copilot session rather than executing native tasks in a
separate backend.

## What the workbench shows

- **Capabilities and source:** ordinary `SKILL.md` files from this plugin,
  the current project's `.github/skills`, and your `~/.copilot/skills`.
- **Soul and memory:** inspect your working instructions and approved notes;
  request changes in chat through the native tool approval flow.
- **Visible work:** native tool-event names, status, and timing. Copilot chat
  remains the authoritative record of prompts, approvals, output, and results.
- **Frontier:** an explicit optional switch for connecting an external engine.

Source discovery does not prove a skill has been exercised or loaded into
every already-open session. The Brain Surgeon workflow exercises newly taught
capabilities and explains their actual scope.

The Canvas is a view, not a requirement for native agent work. If the client
does not support Canvas extensions, use the bundled agents and skills in chat.

## Teach something you keep

Tell Brain Surgeon:

> Help me solve this task. Then teach my Brainstem the repeatable part and keep
> it as a Copilot skill in this project.

The default artifact is:

```text
.github/skills/<capability-name>/SKILL.md
```

It is a standard Copilot skill, not a Brainstem-only file format. Scripts and
resources can accompany it when necessary. The user can inspect, version,
share, or reuse it without this plugin. User-wide installation requires an
explicit scope decision.

## Optional Frontier engine

Choose **Enable Frontier** in the workbench, or explicitly ask for the
`brainstem-frontier` skill. Then connect your existing RAPP Brainstem, normally
at `http://127.0.0.1:7071`.

Frontier preserves the existing engine contract:

- `GET /health` reports the engine's actual state.
- `GET /agents` and `GET /agents/export/<filename>` inspect agent source.
- `POST /chat` runs an engine request with `user_input`,
  `conversation_history`, and `session_id`.

Only loopback origins are accepted; redirects are not followed. The plugin
does not read or copy engine credentials. Sign in through the engine's own UI.
If installation or startup is needed, the Frontier skill guides the ordinary
Copilot command/approval flow using the
[published RAPP installer](https://github.com/kody-w/rapp-installer).

Returning to native mode does not terminate a server the user owns. Stopping
waiting for a request cannot undo an action already sent to the engine.
Timeouts are not automatically retried.

## Local data and permissions

The plugin keeps its own files outside your project and its installation:

```text
~/.copilot/brainstem-app/
  profile/
    soul.md          # created only by an explicit edit
    memory.json      # created only by an explicit note change
  sessions/
    <session-hash>.json
```

Native activity stores bounded tool-event metadata, not copies of tool
arguments or output. Frontier stores a separate bounded conversation history
when used. Reopening a workbench defaults to native mode; it does not silently
restore or probe Frontier.

Profile notes are not encrypted. Files are created with owner-only modes on
POSIX systems; Windows uses the local user's inherited ACLs. Do not save
secrets, sensitive personal information, or third-party confidential content
in the soul, notes, or a skill you intend to publish.

This is not a sandbox or a replacement for Copilot permissions. Native tools
retain their normal approval flow. Installed skills and Frontier Python
agents must be trusted before executing their instructions or code.

## Develop

Node.js 22 or newer is needed for development, not an extra user-facing
Brainstem service. There are no production npm dependencies.

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
```

The tests cover the native default, explicit Frontier boundary, source and
profile handling, real loopback HTTP transport against fixtures, and browser
interactions.

```sh
npm run preview
```

The preview opens at `http://127.0.0.1:4173`. It is clearly labeled **sample
data** and does not contact an engine, use an account, or execute agent actions.
It exercises the packaged view and message interface; it is not a replacement
for the Copilot app host.

## Platform references

- [Customizing the GitHub Copilot app](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app)
- [Working with Canvas extensions](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions)
- [About agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)

MIT licensed. This is an independent integration, not an official GitHub
product or a change to the RAPP Grail kernel.

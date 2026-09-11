# Brainstem Copilot

**One Copilot chat. Talk to Brainstem or Brain Surgeon by name, with the same
conversation, soul, memory, and capabilities. No agent-picker switching or
Brainstem server required.**

Keep the Brainstem way of working: a soul, explicit memory, useful capabilities,
and a visible **Learn -> Teach -> Keep** loop. GitHub Copilot supplies the
agents, model conversation, tools, permissions, and chat. You do not need
RAPP, Python, Flask, or VS Code to use the native experience.

The separate RAPP Brainstem engine is an **optional Frontier mode**, off by
default. Installing or opening this plugin does not install, start, or contact
that engine.

## Install in the app

**In the "Install plugin" dialog, paste this exact identifier:**

```text
brainstem-copilot@brainstem-copilot
```

The app has two different inputs. Do not paste the repository path into the
plugin installation field:

| Dialog | Value to enter |
|---|---|
| **Add marketplace** (GitHub repository or Git URL) | `kody-w/brainstem-copilot` |
| **Install plugin** (`plugin@marketplace`) | `brainstem-copilot@brainstem-copilot` |

If the marketplace has not been added yet, add it before installing the plugin:

1. Open **Customize -> Plugins** in the GitHub Copilot app.
2. Open **marketplace settings** using the gear beside the marketplace
   selector, choose **Add marketplace**, and enter **`kody-w/brainstem-copilot`**.
   This is not the **Install plugin** dialog.
3. Open **Install plugin**, enter **`brainstem-copilot@brainstem-copilot`**,
   and click **Install**. Alternatively, browse the **brainstem-copilot**
   marketplace and click **Install** on its plugin.
4. Open a chat with the single **Brainstem Copilot** agent entry and say:

   > Brain Surgeon, give me my Brainstem.

**Install button disabled?** If the dialog says "Type a plugin name as
plugin@marketplace", replace `kody-w/brainstem-copilot` with
`brainstem-copilot@brainstem-copilot`. If it reports an unknown marketplace
afterward, complete the separate **Add marketplace** step above.

### Talk to either role without leaving the chat

> Brainstem, summarize these notes and suggest the next action.

> Brain Surgeon, turn what we just did into a reusable capability.

> Brainstem, use that capability on this next example.

These are successive messages in **the same conversation**. Both roles see
the earlier messages, soul, approved memory, and skill sources. Explicitly
name the role you want; unaddressed follow-ups keep the most recently requested
role. You can ask both to contribute in one response, too.

Brain Surgeon leads the teaching loop; Brainstem uses the capabilities.
They are two directly addressable roles, not two chats or two picker profiles.
The Canvas has **Brainstem on the left** and **Brain Surgeon on the right**.
Each pane has its own message box, but both send into this same native
Copilot conversation. They do not select another agent or start another
session. An explicit role name in a message overrides the box you typed in.
The matching native skills can also be invoked in an
ordinary Copilot chat without requiring the Canvas.

The app's normal approvals still apply. Organization policy may restrict
custom plugins or extensions.

**Upgrading from 0.1:** update the plugin once. The separate Brainstem and
Brain Surgeon picker entries have been replaced by **Brainstem Copilot**.
If an already-open session retains the old plugin definitions, load the
updated plugin in a fresh session once; you do not create a new session for
each role change. Your saved soul, notes, and capabilities are not rewritten.

This repository is its own custom marketplace. Installation does not depend
on placement in GitHub's featured or editor-curated catalog.

### CLI installation uses a different input format

The CLI accepts a repository path directly. This command is for a terminal,
not text to paste into the app's **Install plugin** field:

```sh
copilot plugin install kody-w/brainstem-copilot
```

The CLI currently gates extension tools behind experimental features. To use
the profile/workbench tools there, start with:

```sh
copilot --experimental --agent brainstem-copilot:brainstem-copilot
```

The app's agent picker handles the qualified agent ID for you. The bundled
agents and skills remain usable in chat when extension tools are unavailable.

## The same shape, native building blocks

| Familiar word | What it means here |
|---|---|
| **Brainstem** | The same-chat role using your learned capabilities |
| **Brain Surgeon** | The same-chat role leading learning and improving your Brainstem |
| **Soul** | Your editable working instructions |
| **Memory** | Explicitly approved local notes, separate from Copilot's own Memory |
| **Capability** | An ordinary Copilot skill, custom agent, or tool |
| **Learn -> Teach -> Keep** | Do real work, capture the learning, retain portable source |
| **Frontier** | Opt into a separate RAPP Brainstem engine when you need it |

```text
One native Copilot conversation
  Brainstem <-> Brain Surgeon
  shared soul + notes + capabilities
                 |
        Native Copilot tools
                 |
     Visible actions and results
```

There is no separate model service or external orchestration loop. Canvas buttons send user intent back
into the current Copilot session rather than executing native tasks in a
separate backend.

## What the workbench shows

- **Split chat:** compact headers, a Brainstem welcome tour and starter prompts,
  two scrollable message panes, and message boxes anchored at the bottom.
  Actual user messages and streaming/final Copilot replies appear in the
  appropriate pane. The model label reflects the native conversation; model
  selection stays with the Copilot app.
- **Capabilities and source drawer:** ordinary `SKILL.md` files from this plugin,
  the current project's `.github/skills`, and your `~/.copilot/skills`.
- **Soul and memory drawer:** inspect your working instructions and approved notes;
  request changes in chat through the native tool approval flow.
- **Visible work drawer:** native tool-event names, status, and timing. Copilot chat
  remains the authoritative record of prompts, approvals, output, and results.
- **Frontier settings:** an explicit optional switch for connecting an external
  engine in the left pane. Brain Surgeon remains in native Copilot.

Import, export, help, and the guided tour continue through the same native
chat and its normal approvals. **Clear view** only hides displayed Brainstem
messages; it does not delete the shared conversation or memory. Hiding and
reopening the Surgeon pane likewise preserves its conversation.

After updating an already-loaded plugin, ask Copilot in your current chat:

> Reload extensions and open the Brainstem Canvas.

This loads the updated view and restores its recent messages from the same
native conversation; it does not require switching roles into separate chats.

Source discovery does not prove a skill has been exercised or loaded into
every already-open session. The Brain Surgeon workflow exercises newly taught
capabilities and explains their actual scope.

The Canvas is a view, not a requirement for native agent work. If the client
does not support Canvas extensions, use the bundled agents and skills in chat.

The app's Canvas API is experimental and renders a URL. While a panel is open,
the extension supplies its HTML through a short-lived, authenticated loopback
view, following the app's supported Canvas pattern. The app owns the extension
process; closing the panel closes its view. This is display/session plumbing,
not a Brainstem agent server, installer, background daemon, or second model
loop. Chat-only use starts no HTTP listener and requires no port configuration.

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

Open the workbench settings drawer and choose **Frontier -> Enable Frontier**,
or explicitly ask for the
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
arguments or output. The most recently addressed role is saved with that
session's metadata; older activity files remain supported. Frontier stores a separate bounded conversation history
when used. Reopening a workbench defaults to native mode; it does not silently
restore or probe Frontier.

The split chat reads a bounded recent history page from the current native
session and observes its live user/assistant events. This display projection
is kept in memory, not saved as another transcript. Hidden skill injections,
subagent messages, reasoning fields, transformed prompts, and attachment
payloads are not projected into the panes. Long replies and older history are
visibly marked when shortened; the full conversation stays in Copilot chat.
Queued requests are correlated to their originating role rather than being
assigned to whichever box was used most recently.

Profile notes are not encrypted. Files are created with owner-only modes on
POSIX systems; Windows uses the local user's inherited ACLs. Do not save
secrets, sensitive personal information, or third-party confidential content
in the soul, notes, or a skill you intend to publish.

`COPILOT_HOME` is respected when the host uses a non-default configuration
directory. Canvas connection keys are ephemeral and are never included in
the published source or the saved profile.

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

To exercise the package through an authenticated Copilot host without
installing it globally or starting a Brainstem engine:

```sh
copilot --experimental --plugin-dir . \
  --agent brainstem-copilot:brainstem-copilot \
  --allow-tool 'custom-tool(brainstem_context)' \
  -p 'Use brainstem_context once. Report the native mode and available skill sources. Do not enable Frontier or change any files.'
```

Native extension permissions use the `custom-tool(name)` pattern. A bare
`--allow-tool brainstem_context` is not equivalent and can leave a headless
session waiting for approval. Do not replace narrow grants with blanket
permission bypasses.

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
- [Copilot extension authoring](https://github.com/github/copilot-sdk/blob/main/nodejs/docs/extensions.md)
- [Plugin manifest reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)

MIT licensed. Brainstem Copilot is an independent integration, not an official GitHub
product or a change to the RAPP Grail kernel.

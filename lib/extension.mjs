import { AppWorkbench } from "./app-workbench.mjs";
import { dispatchAction } from "./actions.mjs";
import { createCanvasView } from "./canvas-view.mjs";
import { FrontierWorkbench } from "./frontier-workbench.mjs";
import { NativeProfile } from "./native-profile.mjs";
import { PrivateStore } from "./private-store.mjs";
import { validateChatInput } from "./brainstem-client.mjs";
import { roleForPrompt } from "./roles.mjs";
import { CHAT_EVENTS, Conversation, visibleChatEvent } from "./conversation.mjs";

function schema(properties = {}, required = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

const text = (description, maxLength) => ({ type: "string", description, ...(maxLength ? { maxLength } : {}) });

export async function startExtension(sdk, {
  profileFactory = (project) => new NativeProfile({ project }),
  storeFactory = (key) => new PrivateStore(key),
  viewFactory = createCanvasView,
} = {}) {
  let session;
  let boardPromise;
  let requestedRole = null;
  let workingDirectory = process.cwd();
  let closing = false;
  const panels = new Map();
  const toolNames = new Map();
  const unsubscribers = [];
  let eventQueue = Promise.resolve();
  let conversation = new Conversation();
  let liveChatEvents = [];
  let liveChatChars = 0;
  let historyPromise = null;
  let chatPaintTimer = null;

  async function board() {
    if (!boardPromise) {
      boardPromise = (async () => {
        const result = new AppWorkbench({
          conversation,
          profile: profileFactory(workingDirectory),
          store: storeFactory(`native:${session.sessionId}`),
          frontierFactory: () => new FrontierWorkbench({
            store: storeFactory(`frontier:${session.sessionId}`),
          }),
        });
        await result.load();
        return result;
      })();
    }
    const app = await boardPromise;
    if (requestedRole && app.role !== requestedRole) await app.setRole(requestedRole);
    return app;
  }

  async function loadConversation(app) {
    if (historyPromise) return historyPromise;
    historyPromise = (async () => {
      try {
        const page = await session.rpc.eventLog.read({
          direction: "backward", max: 500, agentScope: "primary",
          includeEphemeral: false, types: CHAT_EVENTS.filter((type) => type !== "assistant.message_delta"),
        });
        if (!Array.isArray(page.events)) throw new Error("The host returned an invalid history page.");
        await eventQueue;
        const events = [...page.events, ...liveChatEvents].map(visibleChatEvent).filter(Boolean);
        events.sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
        const rebuilt = new Conversation();
        for (const event of events) rebuilt.consume(event);
        rebuilt.truncated ||= Boolean(page.hasMore);
        conversation = rebuilt;
        app.conversation = rebuilt;
        app.historyError = null;
      } catch (error) {
        app.historyError = `Earlier messages could not be loaded: ${error.message}. Live messages still appear; the full conversation remains in Copilot chat.`;
      } finally {
        app.emit();
      }
    })();
    try {
      return await historyPromise;
    } finally {
      historyPromise = null;
    }
  }

  async function useWorkingDirectory(value) {
    if (value === undefined || value === workingDirectory) return;
    if (typeof value !== "string" || !value) throw new Error("Copilot supplied an invalid working directory.");
    workingDirectory = value;
    if (boardPromise) {
      const app = await boardPromise;
      app.profile = profileFactory(value);
      app.source = null;
      await app.refresh();
    }
  }

  async function approve(message) {
    if (!session.capabilities.ui?.elicitation) {
      throw new sdk.CanvasError("approval_unavailable", "This host cannot show native confirmation. Continue in Copilot chat; no change or engine action was made.");
    }
    if (!await session.ui.confirm(message)) {
      throw new sdk.CanvasError("declined", "Declined or cancelled. No change or engine action was made.");
    }
  }

  const host = {
    sendPrompt: async (prompt) => {
      const messageId = await session.send({ prompt, mode: "enqueue" });
      const role = roleForPrompt(prompt);
      if (role) requestedRole = role;
      return messageId;
    },
    openUrl: (url) => session.send({
      prompt: `Open my explicitly selected Frontier Brainstem at ${url} in the browser so I can use its own sign-in UI. Use normal native browser tools and permissions. Do not read or copy credentials.`,
      mode: "enqueue",
    }),
  };

  async function runFrontier(args) {
    const app = await board();
    const frontier = app.requireFrontier();
    if (args.action === "connect") return frontier.connect(args.baseUrl);
    if (args.action === "source") return frontier.readSource(args.filename);
    if (args.action !== "run") throw new Error("Choose connect, source, or run.");
    const input = validateChatInput({
      user_input: args.prompt,
      conversation_history: frontier.saved.history,
      session_id: frontier.saved.sessionId,
    });
    const target = frontier.saved.baseUrl;
    const before = JSON.stringify(input);
    await approve(`Run this request in your optional Frontier engine?\n\n${target}\n\n${input.user_input}\n\nInstalled Python agents may act on local files or connected accounts and make an additional model request.`);
    if (app.requireFrontier() !== frontier || frontier.saved.baseUrl !== target ||
        before !== JSON.stringify({
          user_input: input.user_input,
          conversation_history: frontier.saved.history,
          session_id: frontier.saved.sessionId,
        })) {
      throw new Error("The Frontier conversation changed while approval was open. Review the request again.");
    }
    return frontier.run(input.user_input);
  }

  async function viewAction(action, args) {
    const app = await board();
    if (action === "refresh") await loadConversation(app);
    // Effectful optional-engine actions use the native permission pipeline, not a browser approval flag.
    if (action === "mode") return executeNative("brainstem_mode", args);
    if (action === "frontier_run") return executeNative("brainstem_frontier", { action: "run", prompt: args?.prompt });
    return dispatchAction(app, host, action, args);
  }

  async function executeNative(name, args) {
    const result = await session.rpc.tools.execute({ name, arguments: args });
    if (typeof result === "string") return JSON.parse(result);
    if (result.resultType !== "success") {
      throw new Error(result.error || result.textResultForLlm || `Copilot did not allow ${name}.`);
    }
    return JSON.parse(result.textResultForLlm);
  }

  function tool(name, description, parameters, handler) {
    return {
      name, description, parameters, skipPermission: false, defer: "never",
      handler: async (args) => JSON.stringify(await handler(args)),
    };
  }

  const tools = [
    tool("brainstem_context", "Read native Brainstem soul, approved notes, and discovered Copilot skill sources. Does not start or contact a Brainstem server.", schema(), async () => {
      const app = await board();
      const state = await app.refresh();
      return { mode: state.mode, role: state.role, ...state.context, capabilities: state.capabilities, notices: state.warnings };
    }),
    tool("brainstem_open", "Open the shared Brainstem Canvas in the Copilot app. Native agents do not depend on the Canvas or a RAPP server.", schema(), async () => {
      await board();
      await session.rpc.canvas.open({ canvasId: "brainstem", instanceId: "brainstem-workbench" });
      const app = await board();
      const nativeMessagesShown = { brainstem: 0, "brain-surgeon": 0 };
      const nativeRepliesShown = { brainstem: 0, "brain-surgeon": 0 };
      for (const message of app.conversation.messages) {
        nativeMessagesShown[message.role]++;
        if (message.author === "assistant" && !message.streaming && !message.incomplete) nativeRepliesShown[message.role]++;
      }
      return { opened: true, title: "Brainstem Copilot", mode: app.mode, historyLoaded: !app.historyError, nativeMessagesShown, nativeRepliesShown };
    }),
    tool("brainstem_refresh", "Refresh native skill source and profile views after teaching a capability.", schema(), async () => {
      const state = await (await board()).refresh();
      return { mode: state.mode, capabilities: state.capabilities, notices: state.warnings };
    }),
    tool("brainstem_source", "Read a discovered native Copilot skill's source by its ID.", schema({ id: text("A discovered capability ID.") }, ["id"]), async ({ id }) =>
      (await board()).readSource(id)),
    tool("brainstem_memory", "Remember or forget an explicitly approved cross-project working note. Never store secrets, sensitive personal information, or confidential third-party data. Requires native confirmation.", schema({
      action: { type: "string", enum: ["remember", "forget"] },
      text: text("The exact approved working note.", 2_000),
      id: text("The existing note ID to forget."),
    }, ["action"]), async (args) => {
      const app = await board();
      let result;
      if (args.action === "remember") {
        if (typeof args.text !== "string" || !args.text.trim() || args.text.length > 2_000) throw new Error("Provide a working note of 1 to 2000 characters.");
        await approve(`Remember this exact Brainstem working note across projects?\n\n${args.text}\n\nThis is a local, unencrypted note, separate from Copilot Memory.`);
        result = await app.profile.remember(args.text);
      } else if (args.action === "forget") {
        const note = (await app.profile.context()).notes.find((item) => item.id === args.id);
        if (!note) throw new Error("That note does not exist.");
        await approve(`Forget this Brainstem note?\n\n${note.text}`);
        await app.profile.forget(args.id);
        result = { forgotten: args.id };
      } else {
        throw new Error("Choose remember or forget.");
      }
      await app.refresh();
      return result;
    }),
    tool("brainstem_soul", "Replace the user's Brainstem working instructions only after an explicit request and native confirmation. The soul cannot override host or repository rules.", schema({
      text: text("The complete proposed soul text.", 24_000),
    }, ["text"]), async ({ text: soul }) => {
      if (typeof soul !== "string" || !soul.trim() || Buffer.byteLength(soul) > 24_000) throw new Error("Provide 1 to 24000 bytes of soul text.");
      const app = await board();
      await approve(`Replace your Brainstem soul across projects with this exact text?\n\n${soul}`);
      await app.profile.setSoul(soul);
      await app.refresh();
      return { updated: true };
    }),
    tool("brainstem_mode", "Choose native Copilot (default) or explicitly enable the optional Frontier RAPP engine. Never enables or boots an engine during normal onboarding.", schema({
      mode: { type: "string", enum: ["copilot", "frontier"] },
    }, ["mode"]), async ({ mode }) => {
      if (mode === "frontier") await approve("Enable optional Frontier mode for this session? It can connect a separate RAPP Brainstem engine. Nothing is installed, started, or contacted merely by enabling it.");
      const state = await (await board()).setMode(mode);
      return { mode: state.mode };
    }),
    tool("brainstem_frontier", "Explicit Frontier mode only: connect an existing loopback RAPP engine, inspect source, or run an approved /chat request. Native Brainstem work does not use this tool.", schema({
      action: { type: "string", enum: ["connect", "source", "run"] },
      baseUrl: text("Loopback origin, such as http://127.0.0.1:7071."),
      filename: text("Python filename returned by the Frontier file list."),
      prompt: text("Exact user request for the external engine.", 32_000),
    }, ["action"]), runFrontier),
  ];

  const canvas = sdk.createCanvas({
    id: "brainstem",
    displayName: "Brainstem Copilot",
    description: "Split chat workspace: Brainstem on the left, Brain Surgeon on the right, both showing the same native Copilot conversation. Shared source, soul, memory, and optional Frontier controls.",
    actions: [{
      name: "get_state",
      description: "Read the shared Brainstem workbench state.",
      inputSchema: schema(),
      handler: async () => (await board()).snapshot(),
    }, {
      name: "refresh",
      description: "Refresh native Copilot skill sources and the profile.",
      inputSchema: schema(),
      handler: async () => (await board()).refresh(),
    }],
    open: async (ctx) => {
      if (closing) throw new Error("This extension is closing.");
      await useWorkingDirectory(ctx.session?.workingDirectory);
      const app = await board();
      await loadConversation(app);
      if (!panels.has(ctx.instanceId)) panels.set(ctx.instanceId, viewFactory(app, viewAction));
      let panel;
      try {
        panel = await panels.get(ctx.instanceId);
      } catch (error) {
        panels.delete(ctx.instanceId);
        throw error;
      }
      if (closing) {
        await panel.close();
        throw new Error("This extension is closing.");
      }
      return { url: panel.url, title: "Brainstem Copilot", status: app.mode === "copilot" ? "Native Copilot" : "Optional Frontier" };
    },
    onClose: async (ctx) => {
      const pending = panels.get(ctx.instanceId);
      panels.delete(ctx.instanceId);
      const panel = await pending;
      await panel?.close();
    },
  });

  session = await sdk.joinSession({ tools, canvases: [canvas] });

  function observe(action) {
    if (!boardPromise || closing) return;
    eventQueue = eventQueue.then(action).catch(async (error) => {
      await session.log(`Brainstem activity could not be recorded: ${error.message}`, { level: "warning" });
    });
  }
  for (const type of CHAT_EVENTS) {
    unsubscribers.push(session.on(type, (event) => {
      if (event.agentId || closing) return;
      if (type === "user.message" && !event.data.isAutopilotContinuation &&
          !/^(skill|agent)(-|$)/.test(event.data.source || "")) {
        const role = roleForPrompt(event.data.content);
        if (role) requestedRole = role;
      }
      const clean = visibleChatEvent(event);
      if (!clean) return;
      const changed = conversation.consume(clean);
      if (!changed && type === "assistant.message_delta") return;
      liveChatEvents.push(clean);
      liveChatChars += JSON.stringify(clean).length;
      while (liveChatEvents.length > 2_000 || liveChatChars > 8 * 1024 * 1024) {
        liveChatChars -= JSON.stringify(liveChatEvents.shift()).length;
      }
      if (!boardPromise) return;
      if (type !== "assistant.message_delta") {
        observe(async () => { (await board()).emit(); });
      } else if (!chatPaintTimer) {
        chatPaintTimer = setTimeout(() => {
          chatPaintTimer = null;
          observe(async () => { (await board()).emit(); });
        }, 40);
      }
    }));
  }
  unsubscribers.push(session.on("session.context_changed", (event) => {
    if (event.agentId || closing) return;
    if (!boardPromise) {
      workingDirectory = event.data.cwd;
      return;
    }
    // Read-only context events avoid prompt hooks and nested session RPC from a running tool.
    observe(() => useWorkingDirectory(event.data.cwd));
  }));
  unsubscribers.push(session.on("tool.execution_start", (event) => {
    if (!boardPromise || event.data.toolName.startsWith("brainstem_")) return;
    toolNames.set(event.data.toolCallId, event.data.toolName);
    observe(async () => (await board()).toolStarted({
      id: event.data.toolCallId, name: event.data.toolName, timestamp: event.timestamp,
    }));
  }));
  unsubscribers.push(session.on("tool.execution_complete", (event) => {
    const name = toolNames.get(event.data.toolCallId);
    toolNames.delete(event.data.toolCallId);
    // A completion without a start can predate activation; do not invent its tool identity.
    if (!name) return;
    observe(async () => (await board()).toolFinished({
      id: event.data.toolCallId, name, isError: !event.data.success, timestamp: event.timestamp,
    }));
  }));

  return {
    session,
    async idle() { await eventQueue; },
    async close() {
      closing = true;
      if (chatPaintTimer) clearTimeout(chatPaintTimer);
      for (const off of unsubscribers) off();
      for (const pending of panels.values()) await (await pending).close();
      panels.clear();
      await eventQueue;
    },
  };
}

import assert from "node:assert/strict";
import test from "node:test";
import { Conversation, MAX_CHAT_MESSAGES, MAX_CHAT_CHARS, MAX_MESSAGE_CHARS, visibleChatEvent } from "../lib/conversation.mjs";
import { AppWorkbench } from "../lib/app-workbench.mjs";
import { dispatchAction } from "../lib/actions.mjs";

let sequence = 0;
function event(type, data, extra = {}) {
  return { id: `event-${++sequence}`, type, timestamp: new Date(1_780_000_000_000 + sequence).toISOString(), data, ...extra };
}

test("only visible primary-agent chat text enters the projection", () => {
  const chat = new Conversation();
  chat.consume(event("user.message", { messageId: "u", content: "Brainstem, hello", transformedContent: "PRIVATE_WRAPPER" }));
  chat.consume(event("assistant.message", {
    messageId: "a", content: "**Brainstem:** Hello", reasoningText: "PRIVATE_REASONING", encryptedContent: "PRIVATE_ENCRYPTED",
  }));
  for (const hidden of [
    event("assistant.reasoning", { content: "HIDDEN_REASONING" }),
    event("assistant.message", { messageId: "thinking", content: "HIDDEN_PHASE", phase: "analysis" }),
    event("user.message", { content: "HIDDEN_SKILL", source: "skill-example" }),
    event("user.message", { content: "HIDDEN_AGENT", source: "agent-worker" }),
    event("user.message", { content: "HIDDEN_WAKE", isAutopilotContinuation: true }),
    event("assistant.message", { messageId: "child", content: "HIDDEN_CHILD" }, { agentId: "child" }),
    event("assistant.message", { messageId: "legacy", content: "HIDDEN_LEGACY", parentToolCallId: "task" }),
  ]) {
    const clean = visibleChatEvent(hidden);
    if (clean) assert.deepEqual(clean.data, { messageId: "thinking", hidden: true });
    chat.consume(hidden);
  }
  const serialized = JSON.stringify(chat.snapshot());
  assert(!serialized.includes("PRIVATE"));
  assert(!serialized.includes("HIDDEN"));
  assert.equal(chat.snapshot().messages.length, 2);
});

test("queued requests keep each assistant response with its original recipient", () => {
  const chat = new Conversation();
  chat.consume(event("user.message", { messageId: "u1", content: "Brainstem, first task", interactionId: "first" }));
  chat.consume(event("assistant.turn_start", { turnId: "0", interactionId: "first", model: "native-model" }));
  chat.consume(event("user.message", { messageId: "u2", content: "Brain Surgeon, next task", interactionId: "second" }));
  chat.consume(event("assistant.message", { messageId: "a1", content: "First answer", interactionId: "first" }));
  chat.consume(event("assistant.turn_start", { turnId: "0", interactionId: "second" }));
  chat.consume(event("assistant.message", { messageId: "a2", content: "Second answer", interactionId: "second" }));
  assert.deepEqual(chat.snapshot().messages.map((message) => message.role), ["brainstem", "brain-surgeon", "brainstem", "brain-surgeon"]);
  assert.equal(chat.snapshot().model, "native-model");
});

test("streamed and final messages reconcile once, including repeated native events", () => {
  const chat = new Conversation();
  const input = event("user.message", { messageId: "u", content: "Brain Surgeon, teach this", interactionId: "turn" });
  chat.consume(input);
  chat.consume(input);
  chat.consume(event("assistant.turn_start", { turnId: "0", interactionId: "turn" }));
  chat.consume(event("assistant.message_start", { messageId: "a", phase: "final" }));
  chat.consume(event("assistant.message_delta", { messageId: "a", deltaContent: "First " }));
  chat.consume(event("assistant.message_delta", { messageId: "a", deltaContent: "part" }));
  assert.equal(chat.snapshot().messages[1].content, "First part");
  chat.consume(event("assistant.message", { messageId: "a", content: "Final answer", interactionId: "turn" }));
  chat.consume(event("assistant.message_delta", { messageId: "a", deltaContent: "late duplicate" }));
  assert.equal(chat.snapshot().messages.length, 2);
  assert.equal(chat.snapshot().messages[1].content, "Final answer");
  assert.equal(chat.snapshot().messages[1].streaming, false);
});

test("empty tool-call messages do not create phantom chat replies", () => {
  const chat = new Conversation();
  chat.consume(event("assistant.message", { messageId: "tools-only", content: "" }));
  assert.deepEqual(chat.snapshot().messages, []);
  chat.consume(event("assistant.message_start", { messageId: "partial" }));
  chat.consume(event("assistant.message_delta", { messageId: "partial", deltaContent: "Partial" }));
  chat.consume(event("session.idle", {}));
  assert.equal(chat.snapshot().messages[0].incomplete, true);
  chat.consume(event("assistant.message", { messageId: "partial", content: "Complete" }));
  assert.equal(chat.snapshot().messages[0].incomplete, false);
});

test("hidden or unclassified streaming phases never appear before the final response", () => {
  const chat = new Conversation();
  chat.consume(event("assistant.message_start", { messageId: "thinking", phase: "analysis" }));
  chat.consume(event("assistant.message_delta", { messageId: "thinking", deltaContent: "PRIVATE_THOUGHT" }));
  chat.consume(event("assistant.message_delta", { messageId: "unknown", deltaContent: "UNKNOWN_PHASE" }));
  assert.deepEqual(chat.snapshot().messages, []);
  chat.consume(event("assistant.message", { messageId: "thinking", phase: "analysis", content: "PRIVATE_THOUGHT" }));
  assert.deepEqual(chat.snapshot().messages, []);
  chat.consume(event("assistant.message_start", { messageId: "answer", phase: "final_answer" }));
  chat.consume(event("assistant.message_delta", { messageId: "answer", deltaContent: "Visible reply" }));
  assert.equal(chat.snapshot().messages[0].content, "Visible reply");
  chat.consume(event("assistant.message", { messageId: "unknown", phase: "final_answer", content: "Safe final reply" }));
  assert.equal(chat.snapshot().messages[1].content, "Safe final reply");
  assert(!JSON.stringify(chat.snapshot()).includes("PRIVATE_THOUGHT"));
});

test("visible history is bounded and long messages disclose shortening", () => {
  const chat = new Conversation();
  for (let i = 0; i < MAX_CHAT_MESSAGES + 20; i++) {
    chat.consume(event("user.message", { messageId: `u${i}`, content: `Brainstem, message ${i}` }));
  }
  assert.equal(chat.snapshot().messages.length, MAX_CHAT_MESSAGES);
  assert.equal(chat.snapshot().truncated, true);
  const clean = visibleChatEvent(event("assistant.message", { messageId: "large", content: "x".repeat(MAX_MESSAGE_CHARS + 10) }));
  chat.consume(clean);
  const last = chat.snapshot().messages.at(-1);
  assert.equal(last.content.length, MAX_MESSAGE_CHARS);
  assert.equal(last.truncated, true);
  for (let i = 0; i < 15; i++) chat.consume(event("assistant.message", { messageId: `big${i}`, content: "x".repeat(MAX_MESSAGE_CHARS) }));
  assert(chat.snapshot().messages.reduce((sum, message) => sum + message.content.length, 0) <= MAX_CHAT_CHARS);
});

test("chat text is never copied into the plugin's persisted activity file", async () => {
  let saved;
  const board = new AppWorkbench({ store: { save: async (state) => { saved = structuredClone(state); } } });
  board.receiveChatEvent(event("user.message", { messageId: "u", content: "DISPLAY_ONLY_PRIVATE_TEXT" }));
  await board.toolStarted({ id: "tool", name: "read_file" });
  assert(!JSON.stringify(saved).includes("DISPLAY_ONLY_PRIVATE_TEXT"));
  assert.equal(board.snapshot().conversation.messages[0].content, "DISPLAY_ONLY_PRIVATE_TEXT");
});

test("both composers enqueue into one native chat and honor explicit cross-pane addressing", async () => {
  const board = new AppWorkbench();
  const sent = [];
  const host = { sendPrompt: async (prompt) => { sent.push(prompt); } };
  await dispatchAction(board, host, "native_chat", { role: "brainstem", prompt: "Do this task" });
  await dispatchAction(board, host, "native_chat", { role: "brain-surgeon", prompt: "Improve the same task" });
  await dispatchAction(board, host, "native_chat", { role: "brainstem", prompt: "Brain Surgeon, explain that" });
  assert.deepEqual(sent, ["Brainstem, Do this task", "Brain Surgeon, Improve the same task", "Brain Surgeon, explain that"]);
  assert.equal(board.snapshot().frontier, null);
  await assert.rejects(dispatchAction(board, host, "native_chat", { role: "another-agent", prompt: "Do this" }), /Choose/);
});

import { DEFAULT_ROLE, roleForPrompt } from "./roles.mjs";

export const CHAT_EVENTS = Object.freeze([
  "user.message", "assistant.turn_start", "assistant.message_start", "assistant.message_delta",
  "assistant.message", "assistant.turn_end", "session.idle", "session.error",
]);
export const MAX_CHAT_MESSAGES = 100;
export const MAX_MESSAGE_CHARS = 65_536;
export const MAX_CHAT_CHARS = 512_000;
const VISIBLE_PHASES = new Set(["final_answer", "final", "commentary", "response", "answer", "summary"]);

export function visibleChatEvent(event) {
  if (!event || !CHAT_EVENTS.includes(event.type) || event.agentId || event.data?.parentToolCallId) return null;
  const data = event.data;
  if (!data || typeof data !== "object") throw new Error("Native chat event is missing its data.");
  if (event.type === "user.message" &&
      (data.isAutopilotContinuation || /^(skill|agent)(-|$)/.test(data.source || ""))) return null;
  const clean = { type: event.type, id: event.id, timestamp: event.timestamp, data: {} };
  if (data.hidden === true || (data.phase && !VISIBLE_PHASES.has(data.phase))) {
    if (["assistant.message_start", "assistant.message"].includes(event.type)) {
      clean.data = { messageId: data.messageId, hidden: true };
      return clean;
    }
    return null;
  }
  if (data.truncated === true) clean.data.truncated = true;
  // Only human-visible fields cross into the Canvas; never copy transformed prompts or reasoning.
  for (const field of ["messageId", "turnId", "interactionId", "model", "phase"]) {
    if (typeof data[field] === "string") clean.data[field] = data[field];
  }
  for (const field of ["content", "deltaContent", "message"]) {
    if (typeof data[field] === "string") {
      clean.data[field] = data[field].slice(0, MAX_MESSAGE_CHARS);
      if (data[field].length > MAX_MESSAGE_CHARS) clean.data.truncated = true;
    }
  }
  return clean;
}

function answerRole(content) {
  const match = /^\s*(?:\*\*)?(Brainstem|Brain[\s-]*Surgeon)(?::\*\*|\*\*:|:)/i.exec(content);
  return match ? roleForPrompt(`${match[1]},`) : null;
}

export class Conversation {
  constructor({ role = DEFAULT_ROLE } = {}) {
    this.messages = [];
    this.byId = new Map();
    this.seen = new Set();
    this.interactions = new Map();
    this.streamVisibility = new Map();
    this.lastRole = role;
    this.activeRole = role;
    this.activeInteraction = null;
    this.busy = false;
    this.model = null;
    this.error = null;
    this.truncated = false;
  }

  consume(input) {
    const event = visibleChatEvent(input);
    if (!event) return false;
    if (event.id && this.seen.has(event.id)) return false;
    if (event.id) {
      this.seen.add(event.id);
      if (this.seen.size > 2_000) this.seen.delete(this.seen.values().next().value);
    }
    const d = event.data;
    if (d.model) this.model = d.model;
    if (d.hidden) {
      this.setVisibility(d.messageId, "hidden");
      const key = `assistant:${d.messageId}`;
      this.messages = this.messages.filter((message) => message.id !== key);
      this.byId.delete(key);
      return true;
    }
    if (event.type === "user.message") {
      if (typeof d.content !== "string") throw new Error("Native user message has no visible text.");
      if (!d.content.trim()) return false;
      const key = `user:${d.messageId || event.id}`;
      if (!d.messageId && !event.id) throw new Error("Native user message has no stable identity.");
      const previous = this.byId.get(key);
      const role = roleForPrompt(d.content) || previous?.role || this.lastRole;
      this.lastRole = role;
      if (d.interactionId) {
        this.interactions.set(d.interactionId, role);
        if (this.interactions.size > 200) this.interactions.delete(this.interactions.keys().next().value);
      }
      if (!this.busy || d.interactionId === this.activeInteraction) this.activeRole = role;
      this.upsert(key, {
        author: "user", role, content: d.content, timestamp: event.timestamp,
        streaming: false, truncated: Boolean(d.truncated),
      });
      this.error = null;
    } else if (event.type === "assistant.turn_start") {
      this.activeInteraction = d.interactionId || this.activeInteraction;
      this.activeRole = this.interactions.get(d.interactionId) || (this.busy ? this.activeRole : this.lastRole);
      this.busy = true;
      this.error = null;
    } else if (event.type === "assistant.message_start") {
      if (!d.messageId) throw new Error("Native message start has no stable identity.");
      this.setVisibility(d.messageId, "visible");
    } else if (event.type === "assistant.message" || event.type === "assistant.message_delta") {
      if (!d.messageId) throw new Error("Native assistant message has no stable identity.");
      const key = `assistant:${d.messageId}`;
      const previous = this.byId.get(key);
      const delta = event.type === "assistant.message_delta";
      // Wait for visible message-start metadata; unknown/hidden phases must not leak as tokens arrive.
      if (delta && this.streamVisibility.get(d.messageId) !== "visible") return false;
      if (delta && previous && !previous.streaming) return false;
      if (!delta) this.setVisibility(d.messageId, "final");
      const text = delta ? d.deltaContent : d.content;
      if (typeof text !== "string") throw new Error("Native assistant message has no visible text.");
      const content = delta ? (previous?.content || "") + text : text;
      if (!content.trim() && !previous) return false;
      const role = answerRole(content) || previous?.role ||
        this.interactions.get(d.interactionId) || this.activeRole;
      this.upsert(key, {
        author: "assistant", role, content: content.slice(0, MAX_MESSAGE_CHARS),
        timestamp: previous?.timestamp || event.timestamp, streaming: delta,
        incomplete: false,
        truncated: Boolean(d.truncated) || content.length > MAX_MESSAGE_CHARS || (delta && Boolean(previous?.truncated)),
      });
    } else if (event.type === "session.idle") {
      this.busy = false;
      for (const message of this.messages) {
        if (message.streaming) { message.streaming = false; message.incomplete = true; }
      }
    } else if (event.type === "session.error") {
      this.busy = false;
      this.error = d.message || "Copilot reported a session error. See the native chat for details.";
    }
    return true;
  }

  setVisibility(id, visibility) {
    if (typeof id !== "string" || !id) throw new Error("Native message visibility has no stable identity.");
    this.streamVisibility.set(id, visibility);
    if (this.streamVisibility.size > 200) this.streamVisibility.delete(this.streamVisibility.keys().next().value);
  }

  upsert(id, values) {
    const previous = this.byId.get(id);
    if (previous) Object.assign(previous, values);
    else {
      const message = { id, ...values };
      this.messages.push(message);
      this.byId.set(id, message);
    }
    let size = this.messages.reduce((total, message) => total + message.content.length, 0);
    while (this.messages.length > MAX_CHAT_MESSAGES || size > MAX_CHAT_CHARS) {
      const removed = this.messages.shift();
      size -= removed.content.length;
      this.byId.delete(removed.id);
      this.truncated = true;
    }
  }

  snapshot() {
    return {
      messages: this.messages.map((message) => ({ ...message })),
      busy: this.busy, activeRole: this.activeRole, model: this.model,
      error: this.error, truncated: this.truncated,
    };
  }
}

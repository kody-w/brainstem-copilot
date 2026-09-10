function nativeBridge() {
  const key = window.location.hash.slice(1);
  const listeners = new Set();
  let latest = null;
  const controller = new AbortController();
  const headers = { "X-Brainstem-Canvas-Key": key };
  function publish(state) {
    latest = state;
    for (const listener of listeners) listener(state);
  }
  function disconnected(error) {
    if (controller.signal.aborted) return;
    if (latest) publish({ ...latest, error: `Canvas connection: ${error.message}. Reopen the workbench; native Copilot chat is unaffected.` });
  }
  async function decode(response) {
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || `Canvas returned HTTP ${response.status}.`);
    return data;
  }
  window.brainstemHost = {
    mode: "native",
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async request(action, args = {}) {
      if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Missing Canvas connection key. Reopen Brainstem from Copilot.");
      if (action === "state") {
        const state = await decode(await fetch("/api/state", { headers, signal: controller.signal, cache: "no-store" }));
        latest = state;
        return state;
      }
      return decode(await fetch("/api/action", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ action, args }),
        signal: controller.signal,
      }));
    },
  };
  async function events() {
    if (!/^[a-f0-9]{64}$/.test(key)) return;
    const response = await fetch("/api/events", { headers, signal: controller.signal, cache: "no-store" });
    if (!response.ok || !response.body) throw new Error(`Event stream returned HTTP ${response.status}.`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) throw new Error("The app closed this view's event stream");
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const event = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (event.startsWith("data: ")) publish(JSON.parse(event.slice(6)));
        }
        if (buffer.length > 8 * 1024 * 1024) throw new Error("Canvas state exceeded its display limit");
      }
    } finally {
      reader.releaseLock();
    }
  }
  window.addEventListener("pagehide", () => controller.abort(), { once: true });
  events().catch(disconnected);
}

export const nativeBridgeScript = `(${nativeBridge.toString()})();`;

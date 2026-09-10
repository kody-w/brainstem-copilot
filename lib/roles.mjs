export const DEFAULT_ROLE = "brain-surgeon";
export const ROLES = Object.freeze(["brainstem", "brain-surgeon"]);

export function roleForPrompt(prompt) {
  if (typeof prompt !== "string") return null;
  const match = /^\s*[/@]?(brain[\s-]*surgeon|surgeon|brainstem)(?=$|[\s,:.!?])/i.exec(prompt);
  if (!match) return null;
  if (match[1].toLowerCase() === "brainstem") {
    if (/^\s+copilot\b/i.test(prompt.slice(match[0].length))) return null;
    return "brainstem";
  }
  return "brain-surgeon";
}

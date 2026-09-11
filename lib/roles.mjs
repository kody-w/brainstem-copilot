export const DEFAULT_ROLE = "brain-surgeon";
export const ROLES = Object.freeze(["brainstem", "brain-surgeon"]);

export function addressedPrompt(role, prompt) {
  if (!ROLES.includes(role)) throw new Error("Choose the Brainstem or Brain Surgeon composer.");
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 31_960) {
    throw new Error("Enter a message between 1 and 31960 characters.");
  }
  const trimmed = prompt.trim();
  if (roleForPrompt(trimmed)) return trimmed;
  return `${role === "brainstem" ? "Brainstem" : "Brain Surgeon"}, ${trimmed}`;
}

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

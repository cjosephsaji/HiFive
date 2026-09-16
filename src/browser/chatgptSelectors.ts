// Keep ChatGPT UI assumptions here; verify these against a real logged-in profile.
export const selectors = {
  usageButtons: [/settings/i, /usage/i],
  loginSignals: [/log in/i, /sign in/i],
  workButtons: [/^work$/i, /work mode/i],
  workActiveText: [/work mode/i, /^work$/i],
  composers: ["#prompt-textarea", "[data-testid='prompt-textarea']", "textarea[placeholder*='Message']", "[contenteditable='true'][data-placeholder*='Message']"],
  sendButtons: [/^send$/i, /send message/i],
  userMessages: ["[data-message-author-role='user']", "[data-testid='conversation-turn-user']"],
  conversationLinks: "a[href*='/c/']"
};

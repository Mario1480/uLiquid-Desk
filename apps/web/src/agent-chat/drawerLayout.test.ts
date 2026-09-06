import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Agent Chat disables the shell transform animation that traps fixed drawers", () => {
  const css = readFileSync(new URL("../../app/styles/desk.css", import.meta.url), "utf8");
  assert.match(css, /\.appMain:has\(\.agentChatPage\)\s*\{\s*animation:\s*none;/);
});

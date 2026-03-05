import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultNotificationPluginSettings,
  parseStoredNotificationPluginSettings
} from "./notificationSettings.js";

test("defaultNotificationPluginSettings enables telegram", () => {
  const defaults = defaultNotificationPluginSettings();
  assert.deepEqual(defaults.enabled, ["core.notification.telegram"]);
  assert.deepEqual(defaults.order, ["core.notification.telegram"]);
});

test("parseStoredNotificationPluginSettings normalizes and deduplicates", () => {
  const parsed = parseStoredNotificationPluginSettings({
    enabled: [" core.notification.telegram ", "custom.plugin", "custom.plugin"],
    disabled: ["core.notification.telegram", ""],
    order: ["custom.plugin", "core.notification.telegram"]
  });

  assert.deepEqual(parsed.enabled, ["custom.plugin"]);
  assert.deepEqual(parsed.disabled, ["core.notification.telegram"]);
  assert.deepEqual(parsed.order, ["custom.plugin"]);
});

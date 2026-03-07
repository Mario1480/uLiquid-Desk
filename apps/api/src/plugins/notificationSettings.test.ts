import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultNotificationDestinationsSettings,
  defaultNotificationPluginSettings,
  parseStoredNotificationDestinationsSettings,
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

test("defaultNotificationDestinationsSettings initializes webhook destination", () => {
  const defaults = defaultNotificationDestinationsSettings();
  assert.equal(defaults.webhook.url, null);
  assert.deepEqual(defaults.webhook.headers, {});
});

test("parseStoredNotificationDestinationsSettings normalizes webhook config", () => {
  const parsed = parseStoredNotificationDestinationsSettings({
    webhook: {
      url: " https://example.com/webhook ",
      headers: {
        "X-Api-Key": " test ",
        "": "ignored"
      }
    }
  });

  assert.equal(parsed.webhook.url, "https://example.com/webhook");
  assert.deepEqual(parsed.webhook.headers, {
    "X-Api-Key": "test"
  });
});

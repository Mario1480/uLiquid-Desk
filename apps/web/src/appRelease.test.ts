import assert from "node:assert/strict";
import test from "node:test";
import { formatAppReleaseVersion } from "./appRelease";

test("formats app release tags for sidebar display", () => {
  assert.equal(formatAppReleaseVersion("Beta-v1.0.0"), "v1.0.0");
  assert.equal(formatAppReleaseVersion("1.2.3"), "v1.2.3");
  assert.equal(formatAppReleaseVersion("v2.0.0-beta.1"), "v2.0.0-beta.1");
  assert.equal(formatAppReleaseVersion(""), "v1.0.0");
});

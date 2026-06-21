import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { locateGrokCli, extensionWasUpgraded } from "../src/cli/locator";

const IS_WIN = process.platform === "win32";
const PATH_SEP = IS_WIN ? ";" : ":";
const FAKE_BIN_NAME = IS_WIN ? "grok.cmd" : "grok";

describe("locateGrokCli", () => {
  let tmpDir: string;
  let fakeBin: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-locate-"));
    fakeBin = path.join(tmpDir, FAKE_BIN_NAME);
    if (IS_WIN) {
      fs.writeFileSync(fakeBin, "@echo mock\r\n");
    } else {
      fs.writeFileSync(fakeBin, "#!/bin/sh\necho mock\n");
      fs.chmodSync(fakeBin, 0o755);
    }
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  it("returns the configured path when it exists", () => {
    expect(locateGrokCli(fakeBin)).toBe(fakeBin);
  });
  it("returns undefined when configured path is missing", () => {
    expect(locateGrokCli(path.join(tmpDir, "missing"))).toBeUndefined();
  });
  it("falls back to PATH when no config and no ~/.grok/bin/grok", () => {
    const originalPath = process.env.PATH;
    process.env.PATH = tmpDir + PATH_SEP + (originalPath ?? "");
    try {
      const result = locateGrokCli("");
      const found = result?.toLowerCase();
      expect(found === fakeBin.toLowerCase() || !!found?.includes("grok")).toBe(true);
    } finally {
      process.env.PATH = originalPath;
    }
  });
  it("returns undefined when nothing found", () => {
    const originalPath = process.env.PATH;
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.PATH = "";
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;
    try {
      expect(locateGrokCli("")).toBeUndefined();
    } finally {
      process.env.PATH = originalPath;
      if (originalHome) process.env.HOME = originalHome;
      if (originalUserProfile) process.env.USERPROFILE = originalUserProfile;
    }
  });
});

describe("extensionWasUpgraded", () => {
  it("is false on a fresh install (no prior version recorded)", () => {
    expect(extensionWasUpgraded(undefined, "1.4.0")).toBe(false);
    expect(extensionWasUpgraded("", "1.4.0")).toBe(false);
  });
  it("is false when the version is unchanged (plain restart)", () => {
    expect(extensionWasUpgraded("1.4.0", "1.4.0")).toBe(false);
  });
  it("is true when the extension version changed (an upgrade)", () => {
    expect(extensionWasUpgraded("1.3.2", "1.4.0")).toBe(true);
  });
  it("is true even on a downgrade (any version mismatch re-syncs the CLI)", () => {
    expect(extensionWasUpgraded("1.4.0", "1.3.2")).toBe(true);
  });
  it("is false defensively when the current version is empty", () => {
    expect(extensionWasUpgraded("1.4.0", "")).toBe(false);
  });
});

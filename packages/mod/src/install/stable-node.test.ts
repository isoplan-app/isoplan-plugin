import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { stableNode } from "./stable-node.js";

/** A Node version's folder with its node binary at `bin` inside it. */
function version(root: string, name: string, bin: string) {
  const dir = path.join(root, "versions", name);
  fs.mkdirSync(path.dirname(path.join(dir, bin)), { recursive: true });
  fs.writeFileSync(path.join(dir, bin), "");
  return { dir, node: fs.realpathSync(path.join(dir, bin)) };
}
// A junction on Windows needs no admin rights; elsewhere the type is ignored.
const link = (target: string, at: string) => {
  fs.mkdirSync(path.dirname(at), { recursive: true });
  fs.symlinkSync(target, at, "junction");
};

test("a version manager's or Homebrew's path is chosen when it leads to the same node: nvm-windows, fnm, Homebrew", async () => {
  const root = tempRoot();
  const v = version(root, "v22", "node.exe");
  link(v.dir, path.join(root, "nodejs"));
  expect(await stableNode(v.node, { NVM_SYMLINK: path.join(root, "nodejs") }, "win32")).toBe(path.win32.join(root, "nodejs", "node.exe"));

  link(v.dir, path.join(root, "fnm", "aliases", "default"));
  expect(await stableNode(v.node, { FNM_DIR: path.join(root, "fnm") }, "win32")).toBe(path.win32.join(root, "fnm", "aliases", "default", "node.exe"));

  const brew = version(root, "brew-22", path.join("bin", "node"));
  link(brew.dir, path.join(root, "homebrew"));
  expect(await stableNode(brew.node, { HOMEBREW_PREFIX: path.join(root, "homebrew") }, "darwin")).toBe(path.posix.join(path.join(root, "homebrew"), "bin", "node"));
});

test("with no such path, or one leading to another version, the node's real path is chosen", async () => {
  const root = tempRoot();
  const v22 = version(root, "v22", "node.exe");
  const v20 = version(root, "v20", "node.exe");
  link(v20.dir, path.join(root, "nodejs"));
  expect(await stableNode(v22.node, { NVM_SYMLINK: path.join(root, "nodejs") }, "win32")).toBe(v22.node);
  // fnm's per-shell link is followed to the version it names.
  link(v22.dir, path.join(root, "multishell"));
  expect(await stableNode(path.join(root, "multishell", "node.exe"), {}, "win32")).toBe(v22.node);
});

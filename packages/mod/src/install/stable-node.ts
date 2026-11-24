// The node path that the link handler (link-handler.ts) and the login item (login-item.ts) register.
// The node running install is often in a folder for one Node version (nvm-windows, fnm, and
// Homebrew's Cellar, where libuv already resolves process.execPath), which an upgrade may remove,
// leaving the registration naming a node that is gone. So where a version manager or Homebrew keeps
// a path that leads to the same binary today and follows it to the next version, that path is
// registered instead:
//
// - nvm-windows: %NVM_SYMLINK%\node.exe, the link `nvm use` moves.
// - fnm: $FNM_DIR/aliases/default, the default version, which `fnm env` sets FNM_DIR for.
// - Homebrew: bin/node under $HOMEBREW_PREFIX, /opt/homebrew or /usr/local.
//
// Otherwise it is the node's real path: fnm's per-shell multishell link goes with the shell.

import fs from "node:fs/promises";
import path from "node:path";

/** The paths that follow the current Node version, for this platform and environment. */
export function stableNodeCandidates(env: Record<string, string | undefined>, platform: NodeJS.Platform): string[] {
  if (platform === "win32") {
    const join = path.win32.join;
    return [...(env.NVM_SYMLINK ? [join(env.NVM_SYMLINK, "node.exe")] : []), ...(env.FNM_DIR ? [join(env.FNM_DIR, "aliases", "default", "node.exe")] : [])];
  }
  const join = path.posix.join;
  const brew = [...new Set([env.HOMEBREW_PREFIX, "/opt/homebrew", "/usr/local"].filter((p): p is string => !!p))];
  return [...(env.FNM_DIR ? [join(env.FNM_DIR, "aliases", "default", "bin", "node")] : []), ...brew.map((p) => join(p, "bin", "node"))];
}

/** The path to register for `node`: the first candidate that leads to the same binary, else its real path. */
export async function stableNode(node: string, env: Record<string, string | undefined>, platform: NodeJS.Platform): Promise<string> {
  const real = await fs.realpath(node).catch(() => node);
  for (const candidate of stableNodeCandidates(env, platform)) {
    if ((await fs.realpath(candidate).catch(() => null)) === real) return candidate;
  }
  return real;
}

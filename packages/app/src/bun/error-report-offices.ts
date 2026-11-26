// The offices the app's error reports go to (error-reports.ts): every office in config.json, read as
// the runner reads it (its copy's config.json, then the person's), except one at a plain ws://
// address to another computer, each with this computer's pairing token for it. The token is the
// one /isoplan:repos uses (packages/mod/src/repos/repos.ts commandPairing): the kept one while it is
// current, else one renewed with the credential and kept for every process. It never pairs the
// computer nor drops a credential; an office it holds no credential for gets no report.

import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, officesOf } from "../../../mod/src/data-layer/config.js";
import { accountOf } from "../../../mod/src/data-layer/identity.js";
import { nodeIo } from "../../../mod/src/data-layer/io.js";
import { pairingPath, pairingWriteLockPath } from "../../../mod/src/data-layer/pairing.js";
import { commandPairing } from "../../../mod/src/repos/repos.js";
import type { ReportOffice } from "./error-reports.ts";

export interface ReportOfficesOptions {
  claudeDir: string;
  /** Claude Code's .claude.json, which names the login pairing.json keeps the computer's entries under. */
  claudeJson: string;
  /** The runner copy's folder, which holds the plugin's config.json. */
  appDir: string;
  log: (text: string) => void;
}

export async function reportOffices({ claudeDir, claudeJson, appDir, log }: ReportOfficesOptions): Promise<ReportOffice[]> {
  const config = await loadConfig(nodeIo(), path.join(appDir, "config.json"), path.join(claudeDir, "isoplan", "config.json"));
  // Only the login's id is needed, so git isn't asked for a name.
  const account = await accountOf({ readText: (p) => fs.readFile(p, "utf8").catch(() => null), run: null }, claudeJson, claudeDir);
  return officesOf(config)
    .filter((office) => !office.plainRefused)
    .map((office) => {
      const pairing = commandPairing({ file: pairingPath(claudeDir), writeLock: pairingWriteLockPath(claudeDir), server: office.server, account: account.id, legacy: !!office.legacy }, log);
      return { server: office.server, token: () => pairing.token() };
    });
}

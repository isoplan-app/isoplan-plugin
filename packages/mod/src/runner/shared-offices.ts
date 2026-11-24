// Each office's pairing and list of repos (src/data-layer/approved.ts), one of each for the
// machine: the runner answers only for sessions in a repo the office takes, and the sessions it
// reports share them, so a machine not paired yet is paired once per office. Each is made the first
// time it is asked for, with config.json as the asker read it: an office added to config.json while
// the runner runs gets one for the machine too, not one for each session it reports (#106).

import os from "node:os";
import { approvedPath, createApproved, type Approved } from "../data-layer/approved.js";
import type { Config, Office } from "../data-layer/config.js";
import { createPairing, pairingLockPath, pairingPath, pairingWriteLockPath, type Pairing, type PairingOptions } from "../data-layer/pairing.js";

export interface Shared {
  pairing: Pairing;
  approved: Approved;
}

export interface SharedOfficesOptions {
  claudeDir: string;
  account: PairingOptions["account"];
  /** Where the office's pairing says what it has to (a link to pair the machine, say). */
  emitFor: (office: Office) => PairingOptions["emit"];
  /** Told the email of the person the office's pairing belongs to (PairingOptions onEmail). */
  onEmail: (server: string, email: string | undefined) => void;
  log: (text: string) => void;
  machine?: string;
}

/** The office's pairing and list, made with `config` the first time the office is asked for. */
export function createSharedOffices({ claudeDir, account, emitFor, onEmail, log, machine = os.hostname() }: SharedOfficesOptions): (office: Office, config: Config) => Shared {
  const shared = new Map<string, Shared>();
  return (office, config) => {
    const { server } = office;
    let one = shared.get(server);
    if (one) return one;
    const pairing = createPairing({
      file: pairingPath(claudeDir),
      lock: pairingLockPath(claudeDir, office),
      writeLock: pairingWriteLockPath(claudeDir),
      server,
      account,
      machine,
      emit: emitFor(office),
      allowPlainWs: config.allowPlainWs,
      legacy: !!office.legacy,
      onEmail: (email) => onEmail(server, email),
    });
    const approved = createApproved({ server, file: approvedPath(claudeDir, server), pairing, refreshMs: config.approvedRefreshMinutes * 60000, maxAgeMs: config.approvedMaxAgeMinutes * 60000, log });
    one = { pairing, approved };
    shared.set(server, one);
    return one;
  };
}

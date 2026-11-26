// Adding to an expert's trunk (isoplan-app#366): one addition turn at a time per trunk, in the order
// asked, and what each holds while it waits or runs (`beingAdded`), so a fork that starts meanwhile,
// reading the trunk as it was before (D18, expert-claude.ts `expertForkArgs`), can carry those things
// in its question instead. The turn itself is the expert's (expert.ts).

export interface TrunkAdditions<T> {
  /** Runs `turn` once the trunk's turns asked before it ended; `things` count as being added until it ends. */
  add(trunk: string, things: readonly T[], turn: () => Promise<boolean>): Promise<boolean>;
  /** What the trunk's additions waiting or running hold, in the order asked. */
  beingAdded(trunk: string): T[];
}

export function createTrunkAdditions<T>(log: (text: string) => void): TrunkAdditions<T> {
  const last = new Map<string, Promise<unknown>>();
  const inFlight = new Map<string, (readonly T[])[]>();
  return {
    add(trunk, things, turn) {
      const list = inFlight.get(trunk) ?? [];
      list.push(things);
      inFlight.set(trunk, list);
      const run = (last.get(trunk) ?? Promise.resolve()).then(turn).finally(() => {
        const left = (inFlight.get(trunk) ?? []).filter((x) => x !== things);
        if (left.length) inFlight.set(trunk, left);
        else inFlight.delete(trunk);
      });
      last.set(trunk, run.catch(() => false));
      return run.catch((err: Error) => (log(`couldn't add to its trunk: ${err.message}`), false));
    },
    beingAdded: (trunk) => (inFlight.get(trunk) ?? []).flat(),
  };
}

// The read checkout's lock, and the fork gate.
//
// Forks, groundings and proofs hold the checkout `shared`: many at once, all reading the same
// commit. Moving the checkout, resetting it, and promotion's switch of roles hold it `exclusive`,
// once every shared hold has let go. The lock prefers writers: once an exclusive hold waits, new
// shared holds wait behind it, so a move isn't held back for ever by a stream of questions; when it
// lets go, every shared hold waiting then goes first, then the next exclusive one.
//
// The gate is closed while something is added to the junior's trunk. A fork that can't read the trunk
// as it was before the addition (expert-claude.ts, `--resume-session-at`) waits for it to open, so it
// starts from the trunk with the addition in it. Forks already running carry on.

export interface CheckoutLock {
  shared<T>(run: () => Promise<T>): Promise<T>;
  exclusive<T>(run: () => Promise<T>): Promise<T>;
}

export function createCheckoutLock(): CheckoutLock {
  let readers = 0;
  let writing = false;
  const waitingReaders: (() => void)[] = [];
  const waitingWriters: (() => void)[] = [];

  const readersGo = () => {
    for (const go of waitingReaders.splice(0)) {
      readers++;
      go();
    }
  };
  const writerGoes = () => {
    if (readers > 0 || !waitingWriters.length) return;
    writing = true;
    waitingWriters.shift()!();
  };

  return {
    async shared(run) {
      if (!writing && !waitingWriters.length) readers++;
      else await new Promise<void>((go) => waitingReaders.push(go));
      try {
        return await run();
      } finally {
        readers--;
        writerGoes();
      }
    },
    async exclusive(run) {
      if (!writing && readers === 0 && !waitingWriters.length) writing = true;
      else await new Promise<void>((go) => waitingWriters.push(go));
      try {
        return await run();
      } finally {
        writing = false;
        if (waitingReaders.length) readersGo();
        else writerGoes();
      }
    },
  };
}

export interface Gate {
  /** Settles once the gate is open: at once when it is. */
  opened(): Promise<void>;
  /** Runs `run` with the gate closed. */
  closed<T>(run: () => Promise<T>): Promise<T>;
}

export function createGate(): Gate {
  let closing = 0;
  let waiting: (() => void)[] = [];
  return {
    async opened() {
      if (closing > 0) await new Promise<void>((go) => waiting.push(go));
    },
    async closed(run) {
      closing++;
      try {
        return await run();
      } finally {
        if (--closing === 0) {
          const go = waiting;
          waiting = [];
          go.forEach((g) => g());
        }
      }
    },
  };
}

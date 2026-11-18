// An expert's health log, ~/.claude/isoplan/logs/expert-<name>.log: one line per event of its
// life (a grounding, a proof, a question, a promotion, a cap, a file that doesn't parse), for its
// owner to read and for the smoke test to grep. Each line is the time, the event and its fields as
// key=value; a value with spaces, quotes or an equals sign in it is JSON-quoted, so a line stays one
// line. It never leaves the machine. Like runner.log, it starts over once it passes its cap.

import fs from "node:fs/promises";
import path from "node:path";

const LOG_CAP_BYTES = 1024 * 1024;

export type HealthFields = Record<string, string | number | boolean>;

export interface HealthLog {
  /** Appends one line: `<ISO time> <event> k=v ...`. Writes are queued, in order. */
  say(event: string, fields: HealthFields): void;
  /** Settles once every line said so far is written. */
  flushed(): Promise<void>;
}

/** One field's value as the log writes it. */
export const fieldText = (value: string | number | boolean) => {
  const text = String(value);
  return text === "" || /[\s"=]/.test(text) ? JSON.stringify(text) : text;
};

/** The line `say` writes, without its time. */
export const healthLine = (event: string, fields: HealthFields) => [event, ...Object.entries(fields).map(([key, value]) => `${key}=${fieldText(value)}`)].join(" ");

export function createHealthLog(file: string, now: () => number = Date.now): HealthLog {
  let writing = Promise.resolve();
  return {
    say(event, fields) {
      const line = `${new Date(now()).toISOString()} ${healthLine(event, fields)}\n`;
      writing = writing
        .then(async () => {
          const size = (await fs.stat(file).catch(() => null))?.size ?? 0;
          await fs.mkdir(path.dirname(file), { recursive: true });
          if (size > LOG_CAP_BYTES) await fs.writeFile(file, line);
          else await fs.appendFile(file, line);
        })
        .catch(() => {});
    },
    flushed: () => writing,
  };
}

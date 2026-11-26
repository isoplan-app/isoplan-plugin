// What an error says, for its report to the offices (bun/error-reports.ts): its name and message,
// and its stack as the runtime gives it. Shared by the app's main process and its windows, which
// pass theirs over their RPC, where the main process reads what arrives with passedError. Whatever
// was thrown or rejected, it never throws.

/** An error as it was thrown, before error-report-scrub.ts takes anything out of it. */
export interface RawError {
  message: string;
  stack?: string;
}

export function errorOf(value: unknown): RawError {
  try {
    if (value && typeof value === "object" && typeof (value as Error).message === "string") {
      const { name, message, stack } = value as Error;
      return { message: `${typeof name === "string" && name ? name : "Error"}: ${message}`, ...(typeof stack === "string" && { stack }) };
    }
    return { message: String(value) };
  } catch {
    return { message: "(an error whose text can't be read)" };
  }
}

/** What a window passed over its RPC, as an error: null unless its message is a string, and its stack is kept only if it is one. */
export function passedError(payload: unknown): RawError | null {
  const { message, stack } = (payload ?? {}) as Partial<Record<keyof RawError, unknown>>;
  if (typeof message !== "string") return null;
  return { message, ...(typeof stack === "string" && { stack }) };
}

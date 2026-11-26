// What of an error may leave this computer in its report to the offices (error-reports.ts,
// isoplan-app#375, ADR 0004): its message and its stack's frames, never the source lines a runtime
// may print around them, with the person and their files taken out. The office server scrubs again
// whatever arrives, by the same rules:
//
// - the home folder becomes ~, and the user name (the home folder's last segment) <user>, wherever they are;
// - an absolute path (C:\…, \\server\…, /Users/…, ~/…, file://…) becomes its last segment, so
//   take.ts:120:5 stays readable;
// - an email address becomes <email>; a URL keeps its origin and path, and loses its query and fragment;
// - a run of 32 or more base64 or hex characters, with a letter and a digit in it, becomes <redacted>.
//
// It is pure; the plugin's secret scan runs on what it leaves before anything is sent.

/** The person whose home folder and name are taken out. */
export interface Who {
  home: string;
  user: string;
}

/** What an error's report holds once scrubbed. */
export interface ScrubbedError {
  message: string;
  stack?: string;
}

/** The longest message and stack an office keeps; longer ones are cut there. */
export const MESSAGE_MAX = 500;
export const STACK_MAX = 4000;
/** Text past this is never looked at, so a huge error can't make the scrub slow. */
const RAW_MAX = 20000;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const lastSegment = (path: string) => path.split(/[\\/]+/).filter(Boolean).pop() ?? path;

/** The person of the home folder `home` (os.homedir()). */
export function whoOf(home: string): Who {
  return { home, user: lastSegment(home) === home ? "" : lastSegment(home) };
}

const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
const URLS = /\b([a-z][a-z0-9+.-]*):\/\/([^\s/?#"'()<>]*)([^\s?#"'()<>]*)(\?[^\s#"'()<>]*)?(#[^\s"'()<>]*)?/gi;
// Not part of a file name: `name.js:1:2` from a reduced path is never read as an address.
const EMAILS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-]|\.\w|:\d)/g;
// A folder, which may hold spaces, with its separator; then the last segment, which keeps :line:col.
const DIR = String.raw`[^\\/\s"'()<>|,;:*?]+(?: [^\\/\s"'()<>|,;:*?]+)*[\\/]`;
const LAST = String.raw`[^\\/\s"'()<>|,;*?]*`;
const PATHS = new RegExp(
  [
    String.raw`(?<!\w)[A-Za-z]:[\\/](?:${DIR})*${LAST}`,
    String.raw`(?<![\w\\])\\\\(?:${DIR})+${LAST}`,
    String.raw`(?<![\w.~:/\\%@-])\/(?:${DIR})+${LAST}`,
    String.raw`(?<!\w)~[\\/](?:${DIR})*${LAST}`,
  ].join("|"),
  "g",
);
const TOKENS = /[A-Za-z0-9+/=_-]{32,}/g;
// A stack frame: V8's and Bun's `at …`, and WebKit's `name@url:line:col`.
const FRAME = /^at\s|@\[native code\]$|:\d+(?::\d+)?\)?$/;

/** The home folder as it may be written: either separator, Git Bash's /c/… for a drive, and %20 for a space in a URL. */
function homePattern(home: string): RegExp | null {
  const parts = home.split(/[\\/]+/).filter(Boolean);
  const drive = parts[0] && /^[A-Za-z]:$/.test(parts[0]) ? parts[0] : null;
  const rest = (drive ? parts.slice(1) : parts).map((p) => escape(p).replace(/ /g, "(?: |%20)"));
  if (!rest.length) return null;
  const sep = String.raw`[\\/]+`;
  const start = drive ? `(?:${escape(drive)}|/${escape(drive[0]!)})` : "";
  return new RegExp(`${start}${sep}${rest.join(sep)}(?![\\w.-])`, "gi");
}

/** `text` with the person, their files, addresses and anything like a token taken out. */
export function scrubText(text: string, who: Who): string {
  let out = text.slice(0, RAW_MAX).replace(CONTROL, "");
  out = out.replace(URLS, (_m, scheme: string, authority: string, path: string, query = "", fragment = "") => {
    // A frame's :line:col after a query (`app.js?v=2:3:14`) is kept.
    const tail = /:\d+(?::\d+)?$/.exec(query + fragment)?.[0] ?? "";
    if (scheme.toLowerCase() === "file") {
      let decoded = authority + path;
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        // Kept as it is.
      }
      return lastSegment(decoded) + tail;
    }
    return `${scheme}://${authority.replace(/^[^@]*@/, "")}${path}${tail}`;
  });
  out = out.replace(EMAILS, "<email>");
  const home = homePattern(who.home);
  if (home) out = out.replace(home, "~");
  out = out.replace(PATHS, (m) => lastSegment(m));
  if (who.user) out = out.replace(new RegExp(`(?<![A-Za-z0-9])${escape(who.user)}(?![A-Za-z0-9])`, "gi"), "<user>");
  return out.replace(TOKENS, (m) => (/\d/.test(m) && /[A-Za-z]/.test(m) ? "<redacted>" : m));
}

/** The frames of `stack`, without its first line naming the error, or any line that isn't a frame (a runtime's source excerpt, say). */
export function framesOf(stack: string, message: string): string[] {
  const body = stack.startsWith(message) ? stack.slice(message.length) : stack;
  return body
    .slice(0, RAW_MAX)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => FRAME.test(line));
}

/** What of `error` may leave the computer, before the secret scan. */
export function scrubError(error: { message: string; stack?: string }, who: Who): ScrubbedError {
  const message = scrubText(error.message, who).trim() || "(no message)";
  const frames = error.stack ? framesOf(error.stack, error.message).map((frame) => scrubText(frame, who)) : [];
  const stack = frames.join("\n");
  return { message, ...(stack && { stack }) };
}

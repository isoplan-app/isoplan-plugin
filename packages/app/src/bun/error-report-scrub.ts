// What of an error may leave this computer in its report to the offices (error-reports.ts,
// isoplan-app#375, ADR 0004): its message and its stack's frames, never the source lines a runtime
// may print around them, with the person and their files taken out. The office server scrubs again
// whatever arrives, by the same rules:
//
// - the home folder becomes ~ wherever a path could start, and the user name (the home folder's last
//   segment, when it is longer than one character) <user> wherever it is;
// - an absolute path (C:\…, \\server\…, file://…, ~/…, or under a root of POSIX_ROOTS such as /Users/…,
//   /home/…, /var/… or /etc/…) becomes its last segment, so take.ts:120:5 stays readable; a folder's
//   name may hold spaces;
// - an email address becomes <email>; a URL keeps its origin and path, and loses its query, fragment
//   and user name;
// - a run of 32 or more base64 or hex characters with a digit in it becomes <redacted>: a run of
//   letters alone is a long name, not a token. A URL's path is checked a segment at a time, so a
//   long path isn't read as one run.
//
// The office's copy is isoplan-app's packages/rules/src/error-scrub.ts, and both give the same text
// for the same text, except that this one also drops control characters, reads no more than
// RAW_MAX, finds the home folder as Git Bash and URLs write it, reads a URL of any scheme (views://
// too), and decodes a file URL's last segment.
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
// What a path segment can't hold, and a folder's name, which may have any number of words.
const NOT_IN_SEGMENT = "\\s\\\\/:*?\"'<>|()\\[\\]{},;`";
const SEGMENT = `[^${NOT_IN_SEGMENT}]+`;
const DIRECTORY = `${SEGMENT}(?: ${SEGMENT})*`;
const SEPARATOR = "[\\\\/]+";
/** After a path's root: its folders, each closed by a separator, then its last segment. */
const BELOW = `(?:${DIRECTORY}${SEPARATOR})*${SEGMENT}`;
const POSIX_ROOTS = "Users|home|var|tmp|private|opt|root|srv|mnt|media|Volumes|usr|app|data|workspace|workspaces|Applications|Library|System|etc|run|nix|snap|proc|sys|dev|lib|bin|sbin|boot";
/** What a path, or the home folder, follows: a line's start, a space, a bracket, a quote or the like, never a word or a URL's path. */
const BEFORE = "^|[\\s(\\[{\"'`=,<>\\\\]";
// Bounded, so reading past a long run of what an address's name may hold costs little.
const EMAIL = "[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\\.){1,8}[A-Za-z]{2,24}";

const PATTERN = new RegExp(
  [
    `(?<fileUrl>[Ff][Ii][Ll][Ee]:\\/\\/[^\\s"'<>()\\[\\]{}\`]+)`,
    `(?<url>\\b[A-Za-z][A-Za-z0-9+.-]*:\\/\\/[^\\s"'<>()\\[\\]{}\`\\\\]+)`,
    `(?<email>${EMAIL})`,
    // A UNC root takes 2 to 4 backslashes (4 escaped once, as JSON writes it), never a whole run of
    // them, so a long run costs little to pass over.
    `(?<before>${BEFORE})(?<path>[A-Za-z]:${SEPARATOR}${BELOW}|\\\\{2,4}${BELOW}|\\/+(?:${POSIX_ROOTS})${SEPARATOR}${BELOW}|~${SEPARATOR}${BELOW})`,
    `(?<token>[A-Za-z0-9+/_-]{32,}={0,2})`,
  ].join("|"),
  "gm",
);

const redactTokens = (text: string) => text.replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, (run) => (/\d/.test(run) ? "<redacted>" : run));
const keptSegment = (path: string) => redactTokens(path.split(/[\\/]/).filter(Boolean).pop() ?? "");

/** A URL without its query and fragment, but with the line and column a stack frame gives after them. */
function withoutQuery(url: string): string {
  const cut = url.split(/[?#]/)[0]!;
  const position = cut === url ? "" : (/(?::\d+){1,2}$/.exec(url)?.[0] ?? "");
  return cut + position;
}

/** A URL's origin and path, with no user name; each segment of the path is checked for a token on its own, so a long path isn't read as one. */
function keptUrl(url: string): string {
  const [, scheme, rest] = /^([a-z][a-z0-9+.-]*:\/\/)(.*)$/i.exec(withoutQuery(url))!;
  const slash = rest!.indexOf("/");
  const host = (slash < 0 ? rest! : rest!.slice(0, slash)).replace(/^[^@]*@/, "");
  const path = slash < 0 ? "" : rest!.slice(slash);
  return scheme + host + path.replace(new RegExp(EMAIL, "g"), "<email>").split("/").map(redactTokens).join("/");
}

/** A file URL's last segment, decoded, so a space in a file's name reads as one. */
function keptFileUrl(url: string): string {
  let path = withoutQuery(url);
  try {
    path = decodeURIComponent(path);
  } catch {
    // Kept as it is.
  }
  return keptSegment(path);
}

function scrubOne(match: string, ...args: unknown[]): string {
  const groups = args.at(-1) as Record<string, string | undefined>;
  if (groups.fileUrl !== undefined) return keptFileUrl(groups.fileUrl);
  if (groups.url !== undefined) return keptUrl(groups.url);
  if (groups.email !== undefined) return "<email>";
  if (groups.path !== undefined) return (groups.before ?? "") + keptSegment(groups.path);
  if (groups.token !== undefined) return /\d/.test(groups.token) ? "<redacted>" : groups.token;
  return match;
}

/**
 * The home folder as it may be written: either separator, Git Bash's /c/… for a drive, and %20 for a
 * space. Only where a path could start, so a short home such as /app leaves a URL's /app/ alone; and
 * one separator for its root, so a run of them costs little to pass over.
 */
function homePattern(home: string): RegExp | null {
  const parts = home.split(/[\\/]+/).filter(Boolean);
  const drive = parts[0] && /^[A-Za-z]:$/.test(parts[0]) ? parts[0] : null;
  const rest = (drive ? parts.slice(1) : parts).map((p) => escape(p).replace(/ /g, "(?: |%20)"));
  if (!rest.length) return null;
  const root = drive ? `(?:${escape(drive)}|/${escape(drive[0]!)})${SEPARATOR}` : "[\\\\/]";
  return new RegExp(`(${BEFORE})${root}${rest.join(SEPARATOR)}(?![^${NOT_IN_SEGMENT}])`, "gim");
}

/** `text` with the person, their files, addresses and anything like a token taken out. */
export function scrubText(text: string, who: Who): string {
  let out = text.slice(0, RAW_MAX).replace(CONTROL, "");
  const home = homePattern(who.home);
  if (home) out = out.replace(home, "$1~");
  out = out.replace(PATTERN, scrubOne);
  if (who.user.length > 1) out = out.replace(new RegExp(`\\b${escape(who.user)}\\b`, "gi"), "<user>");
  return out;
}

// A stack frame: V8's and Bun's `at …`, and WebKit's `name@url:line:col`.
const FRAME = /^at\s|@\[native code\]$|:\d+(?::\d+)?\)?$/;

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

import { expect, test } from "vitest";
import { errorOf } from "../shared/error-of.ts";
import { scrubError, scrubText, whoOf } from "./error-report-scrub.ts";

const windows = whoOf("C:\\Users\\adamr");
const mac = whoOf("/Users/adam");

test("an absolute path becomes its last segment, keeping where in the file", () => {
  expect(scrubText("at load (C:\\Users\\adamr\\AppData\\Local\\Isoplan\\bin\\take.ts:120:5)", windows)).toBe("at load (take.ts:120:5)");
  expect(scrubText("at D:/work/isoplan/packages/mod/src/take.ts:120:5", windows)).toBe("at take.ts:120:5");
  expect(scrubText("at C:\\Program Files\\Isoplan\\bin\\main.js:3:9", windows)).toBe("at main.js:3:9");
  expect(scrubText("open \\\\fileserver\\share\\team\\notes.txt", windows)).toBe("open notes.txt");
  expect(scrubText("at /home/dev/w/app/index.js:1:2 and /var/folders/xy/T/run.json", mac)).toBe("at index.js:1:2 and run.json");
  expect(scrubText("at file:///Users/adam/w/app/take.ts:120:5", mac)).toBe("at take.ts:120:5");
  expect(scrubText("at C:\\Users\\sam\\Client Projects For Acme Corp Ltd 2026\\app\\take.ts:1:2", mac)).toBe("at take.ts:1:2");
  expect(scrubText("EACCES /etc/isoplan/server.json, /nix/store/x1-node/bin/node and /run/user/1000/bus", mac)).toBe("EACCES server.json, node and bus");
  // Escaped once, as JSON writes it, a UNC root too.
  expect(scrubText('{"file":"C:\\\\Users\\\\sam\\\\take.ts","share":"\\\\\\\\fileserver\\\\team\\\\notes.txt"}', mac)).toBe('{"file":"take.ts","share":"notes.txt"}');
  // A route and a relative path name nothing of the person's, so they stay.
  expect(scrubText("POST /data-layer/errors failed: see src/bun/index.ts", mac)).toBe("POST /data-layer/errors failed: see src/bun/index.ts");
});

test("the home folder goes wherever a path could start, and the user name wherever it is, a home with a space in it too", () => {
  const spaced = whoOf("C:\\Users\\Adam Linscott");
  expect(scrubText("ENOENT: no such file or directory, open 'C:\\Users\\Adam Linscott\\.claude\\isoplan\\config.json'", spaced)).toBe(
    "ENOENT: no such file or directory, open 'config.json'",
  );
  expect(scrubText("EPERM: /c/Users/adamr/.claude/isoplan/pairing.json", windows)).toBe("EPERM: pairing.json");
  expect(scrubText("the folder C:/Users/ADAMR is locked", windows)).toBe("the folder ~ is locked");
  expect(scrubText("no access for adamr, AdamR or adamr2", windows)).toBe("no access for <user>, <user> or adamr2");
  // A short home is no URL's path, nor a relative path's.
  expect(scrubText("GET https://team.isoplan.app/app/x from src/app/y.ts failed at /app/dist/server.js:1:2", { home: "/app", user: "" })).toBe(
    "GET https://team.isoplan.app/app/x from src/app/y.ts failed at server.js:1:2",
  );
  // A one-letter user name would take every word it is.
  expect(scrubText("a file in a folder", whoOf("/home/a"))).toBe("a file in a folder");
});

test("an email goes, and a URL keeps its origin and path only", () => {
  expect(scrubText("approved by adam.l+x@example.co.uk.", mac)).toBe("approved by <email>.");
  expect(scrubText("GET https://me:pw@office.example.com/data-layer/repos?token=abc#top failed", mac)).toBe("GET https://office.example.com/data-layer/repos failed");
  expect(scrubText("at load (views://view-assets/index-Bc1x.js?v=2:3:14)", mac)).toBe("at load (views://view-assets/index-Bc1x.js:3:14)");
  // WebKit's frame names its function before an @, and a file name is never read as an address.
  expect(scrubText("load@file:///Users/adam/app/index.vue.js:3:14", mac)).toBe("load@index.vue.js:3:14");
});

test("a long run like a token is redacted; a long word isn't", () => {
  expect(scrubText("Bearer 3q2+7wAbCdEfGhIjKlMnOpQrStUvWxYz0123456789", mac)).toBe("Bearer <redacted>");
  expect(scrubText("commit 9fceb02d0ae598e95dc970b74767f19372d61af8", mac)).toBe("commit <redacted>");
  expect(scrubText("card 12345678901234567890123456789012", mac)).toBe("card <redacted>");
  expect(scrubText("in expert-creation-suggestion-model-calls", mac)).toBe("in expert-creation-suggestion-model-calls");
  // A URL's path is checked a segment at a time.
  expect(scrubText("GET https://office.example.com/data-layer/weekly/2026-11-26/errors/v2 failed", mac)).toBe("GET https://office.example.com/data-layer/weekly/2026-11-26/errors/v2 failed");
  expect(scrubText("GET https://office.example.com/s/9fceb02d0ae598e95dc970b74767f19372d61af8/x failed", mac)).toBe("GET https://office.example.com/s/<redacted>/x failed");
});

test("only the message and the stack's frames are kept, never source lines", () => {
  const error = errorOf(Object.assign(new TypeError("x is undefined at C:\\Users\\adamr\\w\\a.ts"), {
    stack: "TypeError: x is undefined at C:\\Users\\adamr\\w\\a.ts\n1 | const key = 'sk-live-abc';\n    ^\n    at run (C:\\Users\\adamr\\w\\take.ts:120:5)\n    at async Promise.all (index 0)\nrender@views://view-assets/index.js:3:14",
  }));
  expect(scrubError(error, windows)).toEqual({
    message: "TypeError: x is undefined at a.ts",
    stack: "at run (take.ts:120:5)\nat async Promise.all (index 0)\nrender@views://view-assets/index.js:3:14",
  });
  expect(scrubError({ message: "nothing\u0000 odd\r" }, windows)).toEqual({ message: "nothing odd" });
});

test("a long run of backslashes or slashes is passed over at once, so no report holds the app up", () => {
  const started = performance.now();
  for (const run of [String.fromCharCode(92).repeat(32_000), `at ${"/".repeat(32_000)}`]) {
    scrubText(run, whoOf("/home/sam"));
    scrubError({ message: run, stack: run }, whoOf("/home/sam"));
  }
  expect(performance.now() - started).toBeLessThan(200);
});

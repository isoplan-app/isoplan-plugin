import path from "node:path";
import { expect, test } from "vitest";
import { modDir } from "../data-layer/fixture.js";
import { CUT, cut, loadPatterns, scan } from "./scan.js";

const patterns = (await loadPatterns(path.join(modDir, "secret-patterns.json"), path.join(modDir, "missing.json"), () => {}))!;

// Each shipped pattern: text it must withhold, and ordinary text near it that it must not.
const cases: Record<string, { hits: string[]; misses: string[] }> = {
  "private key": { hits: ["-----BEGIN RSA PRIVATE KEY-----\nMIIE...", "-----BEGIN OPENSSH PRIVATE KEY-----"], misses: ["-----BEGIN PUBLIC KEY-----", "the private key lives in the vault"] },
  "AWS access key id": { hits: ["aws_access_key_id = AKIAIOSFODNN7EXAMPLE", "ASIA" + "ABCDEFGHIJKLMNOP"], misses: ["AKIA is the prefix of an access key id", "AKIAIOSFODNN7"] },
  "GitHub token": { hits: ["ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8", "github_pat_" + "11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ"], misses: ["ghp_short", "the gh_pages branch"] },
  "Anthropic API key": { hits: ["ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuv"], misses: ["keys start with sk-ant-", "sk-ant-short"] },
  "OpenAI API key": { hits: ["sk-proj-abcdefghijklmnopqrstuvwxyz0123456789", "sk-abcdefghijklmnopqrstuvwxyz012345"], misses: ["scikit is sk-learn", "sk-12345"] },
  "Stripe live key": { hits: ["sk_live_" + "51HabcdefghijklmnopqrstuVWXYZ", "rk_live_" + "abcdefghijklmnopqrst0123"], misses: ["sk_test_" + "51Habcdefghijklmnopqrstu", "use sk_live_ keys only in production"] },
  "Slack token": { hits: ["xoxb-123456789012-abcdefghijkl"], misses: ["xoxb-", "the xox prefix"] },
  "Google API key": { hits: ["AIza" + "SyA-abcdefghijklmnopqrstuvwxyz12345"], misses: ["AIza is a Google key's prefix", "AIzaShort123"] },
  "JSON web token": { hits: ["Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"], misses: ["a JWT starts with eyJ", "eyJhbGciOiJIUzI1NiJ9"] },
  "password in a URL": { hits: ["postgres://admin:s3cretpw@db.internal:5432/app", "https://bob:hunter22@example.com"], misses: ["http://localhost:3000@example", "git@github.com:org/repo.git", "https://user:${PASSWORD}@host", "https://example.com/a:b@c"] },
  "assigned secret": {
    hits: ['password: "hunter2hunter2"', "DB_PASSWORD='Xk9#pL2mQ7vR'", 'api_key = "a8f5f167f44f4964e6c998dee827110c"', "CLIENT_SECRET=4f9c2b7e1d3a8f6c5b0e9d2a7c4f1b8e"],
    misses: ["apiKey: config.apiKey", "secret = process.env.FOO", 'password: "${PASSWORD}"', 'apiKey: "YOUR_API_KEY_HERE"', "const token = getAccessToken(user2)", "passwordHash = hashOf(input)", "api_key=os.environ['API_KEY']", "the password is in 1Password"],
  },
};

test("secret patterns: every shipped pattern has cases here", () => {
  expect(patterns.map((p) => p.name).sort()).toEqual(Object.keys(cases).sort());
});

for (const [name, { hits, misses }] of Object.entries(cases)) {
  test(`secret patterns: ${name}`, () => {
    const regex = patterns.find((p) => p.name === name)!.regex;
    for (const text of hits) expect(regex.test(text), `should withhold ${JSON.stringify(text)}`).toBe(true);
    for (const text of misses) expect(regex.test(text), `should pass ${JSON.stringify(text)}`).toBe(false);
  });
}

test("secret patterns: ordinary prose and code pass the whole scan", () => {
  for (const text of ["Coverage was 79.16% against an 80% floor, on handover-polish.", "Set `apiKey: config.apiKey` in client.ts and read `process.env.STRIPE_SECRET`.", "Run git push origin isoplan/handoff/h-1."]) {
    expect(scan(text, patterns)).toBe(null);
  }
});

test("secret patterns: cut takes every match out of a command and leaves the rest; with unreadable patterns there is nothing to show", () => {
  const key = "sk-ant-api03-abcdefghijklmnopqrstuv";
  expect(cut(`node run.js --key ${key} --again ${key} postgres://admin:s3cretpw@db:5432/app`, patterns)).toBe(`node run.js --key ${CUT} --again ${CUT} ${CUT}db:5432/app`);
  expect(cut("pnpm test", patterns)).toBe("pnpm test");
  expect(cut("pnpm test", null)).toBeNull();
});

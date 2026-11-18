import { PROTOCOL_VERSION, type ExpertsMessage, type HostingMessage } from "@isoplan/protocol";
import { expect, test } from "vitest";
import { hostExperts } from "./expert-link.js";
import type { HostedExpert } from "./experts.js";
import { UNREADABLE } from "./scan.js";

const hosting = (listed: string[] = []): HostingMessage => ({ type: "hosting", v: PROTOCOL_VERSION, listed });
const expert = (name: string, state: HostedExpert["state"] = "ready"): HostedExpert => ({ name, repo: `/work/${name}`, subject: `The ${name} rules.`, state });

// A link that is up, a list that takes every repo, and experts whose hosted() is set by hand.
function setUp(o: { repos?: ReadonlySet<string> | null; send?: () => boolean; scan?: () => Promise<string | null> } = {}) {
  let hosted: HostedExpert[] = [expert("adr")];
  const listeners: (() => void)[] = [];
  const refreshed: (boolean | undefined)[] = [];
  const listed: string[][] = [];
  const sent: ExpertsMessage[] = [];
  const logs: string[] = [];
  let repos = o.repos === undefined ? new Set(["github.com/acme/app"]) : o.repos;
  const host = hostExperts({
    experts: { hosted: () => hosted, onChange: (l) => void listeners.push(l), listed: (_server, names) => void listed.push([...names]) },
    approved: { refresh: async (force) => void refreshed.push(force), repos: () => repos },
    home: async (folder) => ({ id: "github.com/acme/app", name: folder.split("/").at(-1)! }),
    scan: async () => (o.scan ? o.scan() : null),
    log: (t) => void logs.push(t),
    send: (m) => (sent.push(m), o.send ? o.send() : true),
    server: "wss://office.example",
    checkMs: 3600000,
  });
  host.onOpen();
  return {
    host,
    sent,
    logs,
    refreshed,
    listed,
    set: (h: HostedExpert[]) => (hosted = h),
    setRepos: (r: ReadonlySet<string> | null) => (repos = r),
    change: () => listeners.forEach((l) => l()),
  };
}

const names = (m: ExpertsMessage) => m.experts.map((e) => `${e.name}:${e.state}`);
const settle = () => new Promise((r) => setTimeout(r, 20));

test("the first hosting on a connection sends the listing, after refreshing the list at once", async () => {
  const t = setUp();
  t.change(); // before any hosting: nothing
  await settle();
  expect(t.sent).toEqual([]);
  t.host.onHosting(hosting());
  await settle();
  expect(t.listed).toEqual([[]]);
  expect(t.refreshed).toEqual([true]);
  expect(t.sent).toEqual([{ type: "experts", v: PROTOCOL_VERSION, experts: [{ name: "adr", project: { id: "github.com/acme/app", name: "adr" }, subject: "The adr rules.", state: "ready" }] }]);
  t.host.stop();
});

test("a hosting with nothing changed sends nothing; a change of the experts sends the new listing", async () => {
  const t = setUp();
  t.host.onHosting(hosting());
  await settle();
  t.host.onHosting(hosting(["adr"]));
  await settle();
  expect(t.sent).toHaveLength(1);
  t.set([expert("adr", "starting")]);
  t.change();
  await settle();
  expect(t.sent.map(names)).toEqual([["adr:ready"], ["adr:starting"]]);
  t.host.stop();
});

test("with no approved list nothing is sent, and the server keeps what it has", async () => {
  const t = setUp({ repos: null });
  t.host.onHosting(hosting());
  await settle();
  t.change();
  await settle();
  expect(t.sent).toEqual([]);
  expect(t.logs).toEqual(["no approved list from wss://office.example, so the experts aren't listed there yet"]);
  t.setRepos(new Set(["github.com/acme/app"]));
  t.change();
  await settle();
  expect(t.sent).toHaveLength(1);
  t.host.stop();
});

test("while the secret patterns can't be read nothing more is sent, so the server keeps the listing it has", async () => {
  let patterns: string | null = null;
  const t = setUp({ scan: async () => patterns });
  t.host.onHosting(hosting());
  await settle();
  patterns = UNREADABLE;
  t.change();
  await settle();
  t.change();
  await settle();
  expect(t.sent.map(names)).toEqual([["adr:ready"]]);
  expect(t.logs).toEqual(["the secret patterns can't be read, so the experts listing for wss://office.example isn't changed"]);
  t.host.stop();
});

test("two changes close together send in order, the last one's experts last", async () => {
  const t = setUp();
  t.host.onHosting(hosting());
  await settle();
  t.set([expert("adr", "starting")]);
  t.change();
  t.set([expert("adr", "starting"), expert("billing")]);
  t.change();
  await settle();
  expect(t.sent.map(names)).toEqual([["adr:ready"], ["adr:starting", "billing:ready"]]);
  t.host.stop();
});

test("a reconnect sends the listing again after its first hosting; one the link couldn't send goes next time", async () => {
  let up = true;
  const t = setUp({ send: () => up });
  t.host.onHosting(hosting());
  await settle();
  t.host.onClose();
  t.host.onOpen();
  t.host.onHosting(hosting(["adr"]));
  await settle();
  expect(t.sent).toHaveLength(2);
  up = false;
  t.set([expert("adr", "failed")]);
  t.change();
  await settle();
  up = true;
  t.change();
  await settle();
  expect(t.sent.map(names)).toEqual([["adr:ready"], ["adr:ready"], ["adr:failed"], ["adr:failed"]]);
  t.host.stop();
});

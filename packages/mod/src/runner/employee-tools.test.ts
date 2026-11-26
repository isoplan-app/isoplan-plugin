import { afterEach, expect, test } from "vitest";
import { createEmployeeTools, type EmployeeTools } from "./employee-tools.js";

let tools: EmployeeTools | null = null;
afterEach(async () => void (await tools?.stop()));

const post = async (url: string, token: string, body: unknown) => {
  const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });
  return { status: res.status, text: await res.text() };
};

test("the endpoint's initialize and tools/list are the same bytes for the same job; ask_expert gives the runner's words; another process's token, a process that ended, and GET are refused", async () => {
  tools = createEmployeeTools({ log: () => {} });
  await tools.start();
  const handlers = { askExpert: async (expert: string, question: string) => `${expert} says: ${question.length} letters`, leaveDraft: async () => "Left draft 1 of 10." };
  const first = tools.open("adams-outreach", ["lead-generation", "adams-writing"], handlers);
  const second = tools.open("adams-outreach", ["adams-writing", "lead-generation"], { ...handlers, askExpert: async () => "another run" });
  const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1.400" } } };
  const list = { jsonrpc: "2.0", id: 2, method: "tools/list" };
  for (const m of [init, list]) expect((await post(first.url, first.token, m)).text).toBe((await post(second.url, second.token, m)).text);
  expect(JSON.parse((await post(first.url, first.token, list)).text).result.tools.map((t: { name: string }) => t.name)).toEqual(["ask_expert", "leave_draft"]);
  expect((await post(first.url, first.token, { jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);

  const asked = await post(first.url, first.token, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "ask_expert", arguments: { expert: "adams-writing", question: "Which tone?" } } });
  expect(JSON.parse(asked.text).result.content).toEqual([{ type: "text", text: "adams-writing says: 11 letters" }]);
  const unknown = await post(first.url, first.token, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "ask_expert", arguments: { expert: "someone", question: "?" } } });
  expect(JSON.parse(unknown.text).result.isError).toBe(true);

  expect((await post(first.url, second.token, list)).status).toBe(401);
  expect((await fetch(first.url, { headers: { authorization: `Bearer ${first.token}` } })).status).toBe(405);
  first.close();
  expect((await post(first.url, first.token, list)).status).toBe(404);
});

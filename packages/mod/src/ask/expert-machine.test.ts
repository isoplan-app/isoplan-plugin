// Asking an expert from the runner (expert-machine.ts), before anything reaches an office server: a
// question that holds a secret is held before any config is read, and an office that isn't in
// config.json is told as the runner's way to the office failing. Each in a throwaway config folder.

import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import { askExpertFromMachine, type MachineExpertAsk } from "./expert-machine.js";

afterEach(() => void vi.unstubAllEnvs());

const ask = (more: Partial<MachineExpertAsk>): MachineExpertAsk => ({
  session: "s1",
  cwd: "C:/w/repo",
  servers: ["wss://office.example/data-layer"],
  expert: "reporting",
  question: "How are sessions reported?",
  blocking: true,
  key: "k1",
  appDir: modDir,
  scan: async () => null,
  ...more,
});

test("expert from machine: a question that matches a secret pattern is held, with no config read and no office named", async () => {
  vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(tempRoot(), "claude"));
  const scanned: string[] = [];
  const a = ask({
    question: "  Why does AKIAIOSFODNN7EXAMPLE fail?  ",
    appDir: tempRoot(),
    scan: async (text) => (scanned.push(text), "aws-key"),
  });
  Object.defineProperty(a, "servers", {
    get() {
      throw new Error("the office servers were looked at");
    },
  });
  expect(await askExpertFromMachine(a)).toEqual({ text: expect.stringContaining("the secret pattern aws-key"), failed: true, code: "EXPERT_QUESTION_HELD" });
  expect(scanned).toEqual(["Why does AKIAIOSFODNN7EXAMPLE fail?"]);
});

test("expert from machine: an office that isn't one of config.json's servers is the runner's way to the office failing", async () => {
  vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(tempRoot(), "claude"));
  expect(await askExpertFromMachine(ask({ servers: ["wss://elsewhere.example/data-layer"] }))).toEqual({
    text: expect.stringContaining("wss://elsewhere.example/data-layer isn't one of the office servers in config.json"),
    failed: true,
    code: "EXPERT_RUNNER_UNREACHABLE",
  });
});

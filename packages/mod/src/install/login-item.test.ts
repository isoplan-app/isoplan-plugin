import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import type { Exec } from "../connect/dialog.js";
import { tempRoot } from "../data-layer/fixture.js";
import { hiddenLauncher, launcherPaths, wscriptPath } from "./hidden-launch.js";
import { installWake, uninstall, wakeScriptPath } from "./install.js";
import { autostartEntry, autostartPath, launchAgentLabel, launchAgentPath, launchAgentPlist, loginLauncherPath, registerLoginItem, runValueName, unregisterLoginItem, windowsLoginCommand } from "./login-item.js";

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

/** A stand-in for the operating system's commands: what was run, and what `answer` says to each. */
function fakeOs(answer: (file: string, args: string[]) => { code: number | null; stdout?: string } = () => ({ code: 0 })) {
  const calls: string[][] = [];
  const run: Exec = async (file, args) => {
    calls.push([path.basename(file), ...args]);
    const a = answer(file, args);
    return { code: a.code, stdout: a.stdout ?? "" };
  };
  return { calls, run };
}

/** A node and a wake.mjs that exist, in a temp folder. */
function realFiles() {
  const root = tempRoot();
  const node = path.join(root, "node.exe");
  const script = path.join(root, "wake.mjs");
  fs.writeFileSync(node, "");
  fs.writeFileSync(script, "");
  return { node: fs.realpathSync(node), script };
}

/** A Windows registry holding Run values, and Script Host on unless `state.off`. */
function registry(off = false) {
  const values = new Map<string, string>();
  const state = { off };
  return {
    values,
    state,
    ...fakeOs((_, args) => {
      const [verb, key, , name] = args;
      if (key !== RUN_KEY) return verb === "query" && state.off ? { code: 0, stdout: "    Enabled    REG_SZ    0\r\n" } : { code: 1 };
      if (verb === "add") values.set(name!, args[5]!);
      if (verb === "delete") return { code: values.delete(name!) ? 0 : 1 };
      if (verb === "query") return values.has(name!) ? { code: 0, stdout: `\r\n${RUN_KEY}\r\n    ${name}    REG_SZ    ${values.get(name!)}\r\n\r\n` } : { code: 1 };
      return { code: 0 };
    }),
  };
}

test("Windows: a Run value of the config folder's own starts wake.mjs --login through a launcher, hidden, once; one naming a node that has gone is redone", async () => {
  const claudeDir = path.join(tempRoot(), ".claude");
  const reg = registry();
  const h = { platform: "win32" as const, claudeDir, home: "C:\\Users\\ada", ...realFiles(), run: reg.run };
  const launcher = loginLauncherPath(claudeDir);
  expect(await registerLoginItem(h)).toEqual([`set the runner to start at login, through ${launcher}`]);
  const name = runValueName(claudeDir);
  expect(name).toMatch(/^Isoplan runner [0-9a-f]{8}$/);
  // wscript has no console window, and the launcher starts node with window style 0.
  expect(reg.values.get(name)).toBe(`"${wscriptPath()}" //B //NoLogo //E:JScript "${launcher}"`);
  const text = fs.readFileSync(launcher, "utf8");
  expect(text).toBe(hiddenLauncher(h.node, h.script, { args: "--login" }));
  expect(text).toContain(`shell.Run(${JSON.stringify(`"${h.node}" "${h.script}" --login`)}, 0, false);`);
  expect(launcherPaths(text)).toEqual({ node: h.node, script: h.script });
  // Another config folder gets its own value.
  expect(runValueName(path.join(tempRoot(), ".claude"))).not.toBe(name);

  // Script Host's two settings, then the Run value.
  const before = reg.calls.length;
  expect(await registerLoginItem(h)).toEqual([]);
  expect(reg.calls.length).toBe(before + 3);
  // Windows reads the path in any letter case: %SystemRoot% may be C:\WINDOWS or C:\Windows.
  const adds = () => reg.calls.filter((c) => c[1] === "add").length;
  const added = adds();
  reg.values.set(name, reg.values.get(name)!.replace(wscriptPath(), wscriptPath().toUpperCase()));
  expect(reg.values.get(name)).not.toBe(windowsLoginCommand(claudeDir));
  expect(await registerLoginItem(h)).toEqual([]);
  expect(adds()).toBe(added);
  fs.rmSync(h.node);
  expect(await registerLoginItem({ ...h, ...realFiles() })).toHaveLength(1);

  expect(await unregisterLoginItem(h)).toEqual([`took out the runner's start at login (${RUN_KEY}\\${name})`]);
  expect(reg.values.size).toBe(0);
  expect(fs.existsSync(launcher)).toBe(false);
  expect(await unregisterLoginItem(h)).toEqual([]);
});

test("Windows: with Script Host turned off nothing is registered, and it says why; an item registered before is taken out", async () => {
  const claudeDir = path.join(tempRoot(), ".claude");
  const reg = registry(true);
  const h = { platform: "win32" as const, claudeDir, home: "C:\\Users\\ada", ...realFiles(), run: reg.run };
  await expect(registerLoginItem(h)).rejects.toThrow("Windows Script Host is turned off");
  expect(reg.values.size).toBe(0);
  expect(fs.existsSync(loginLauncherPath(claudeDir))).toBe(false);
  // Turned off after the item was added: wscript would show its message at every login.
  reg.state.off = false;
  expect(await registerLoginItem(h)).toHaveLength(1);
  reg.state.off = true;
  expect(await registerLoginItem(h)).toEqual([
    `took out the runner's start at login (${RUN_KEY}\\${runValueName(claudeDir)}): Windows Script Host is turned off on this computer, and without it the runner can't start with no window`,
  ]);
  expect(reg.values.size).toBe(0);
  expect(fs.existsSync(loginLauncherPath(claudeDir))).toBe(false);
});

test("macOS: a LaunchAgent that runs at load and never again, loaded into this person's GUI domain; uninstall boots it out and removes it", async () => {
  const root = tempRoot();
  const claudeDir = path.join(root, ".claude");
  const file = launchAgentPath(root, claudeDir);
  // Whether the plist was there at each bootout.
  const bootouts: boolean[] = [];
  const os = fakeOs((_, args) => {
    if (args[0] === "bootout") bootouts.push(fs.existsSync(file));
    return { code: 0 };
  });
  const h = { platform: "darwin" as const, claudeDir, home: root, uid: 501, ...realFiles(), run: os.run };
  const label = launchAgentLabel(claudeDir);
  expect(await registerLoginItem(h)).toEqual([`set the runner to start at login, through ${file}`]);
  expect(file).toBe(path.join(root, "Library", "LaunchAgents", `${label}.plist`));
  expect(label).toMatch(/^dev\.isoplan\.runner\.[0-9a-f]{8}$/);
  const plist = fs.readFileSync(file, "utf8");
  expect(plist).toBe(launchAgentPlist(label, h.node, h.script));
  expect(plist).toContain(`<key>ProgramArguments</key>\n\t<array>\n\t\t<string>${h.node}</string>\n\t\t<string>${h.script}</string>\n\t\t<string>--login</string>\n\t</array>`);
  expect(plist).toContain("<key>RunAtLoad</key>\n\t<true/>");
  expect(plist).toContain("<key>AbandonProcessGroup</key>\n\t<true/>");
  expect(plist).not.toContain("KeepAlive");
  expect(launchAgentPlist("x", "/a&b/node", "/c<d>/wake.mjs")).toContain("<string>/a&amp;b/node</string>\n\t\t<string>/c&lt;d&gt;/wake.mjs</string>");
  expect(os.calls).toEqual([
    ["launchctl", "bootout", `gui/501/${label}`],
    ["launchctl", "bootstrap", "gui/501", file],
  ]);
  expect(await registerLoginItem(h)).toEqual([]);
  expect(os.calls).toHaveLength(2);

  expect(await unregisterLoginItem(h)).toEqual([`took out the runner's start at login (${file})`]);
  expect(os.calls.at(-1)).toEqual(["launchctl", "bootout", `gui/501/${label}`]);
  expect(fs.existsSync(file)).toBe(false);
  // At login the agent's own job takes it out, and bootout may end that job, so the file is gone first.
  expect(bootouts).toEqual([false, false]);
});

test("Linux: an XDG autostart entry with no terminal; uninstall removes it", async () => {
  const root = tempRoot();
  const h = { platform: "linux" as const, claudeDir: path.join(root, ".claude"), home: root, ...realFiles(), run: fakeOs().run };
  const file = autostartPath(h);
  expect(file).toMatch(/[\\/]\.config[\\/]autostart[\\/]isoplan-runner-[0-9a-f]{8}\.desktop$/);
  expect(await registerLoginItem(h)).toHaveLength(1);
  expect(fs.readFileSync(file, "utf8")).toBe(autostartEntry(h.node, h.script));
  expect(autostartEntry("/usr/bin/node", "/x/wake.mjs")).toContain('Exec="/usr/bin/node" "/x/wake.mjs" --login\nTerminal=false\nNoDisplay=true\n');
  expect(autostartPath({ ...h, configHome: path.join(root, "cfg") })).toBe(path.join(root, "cfg", "autostart", path.basename(file)));
  expect(await registerLoginItem(h)).toEqual([]);
  expect(await unregisterLoginItem(h)).toHaveLength(1);
  expect(fs.existsSync(file)).toBe(false);
});

test("install adds the login item by default and takes it out while runner.json's startAtLogin is off; uninstall takes it out", async () => {
  const root = tempRoot();
  const claudeDir = path.join(root, ".claude");
  const plugin = path.join(root, "plugin");
  for (const file of ["config.json", "secret-patterns.json", "prompts/instructions.md", "prompts/question.md", "prompts/brief.md", "prompts/spin-off.md", "prompts/naming.md", "dist/connect.js", "dist/runner.js", "dist/wake.js", "dist/data-layer.js"]) {
    fs.mkdirSync(path.dirname(path.join(plugin, file)), { recursive: true });
    fs.writeFileSync(path.join(plugin, file), "");
  }
  fs.copyFileSync(path.join(import.meta.dirname, "..", "..", "runner.json"), path.join(plugin, "runner.json"));
  const paths = { claudeDir, settings: path.join(claudeDir, "settings.json"), plugins: path.join(claudeDir, "plugins"), managed: path.join(root, "managed") };
  const os = fakeOs();
  const loginItem = { platform: "darwin" as const, home: root, uid: 501, node: realFiles().node, run: os.run };
  const install = () => installWake(paths, path.join(plugin, "dist", "data-layer.js"), path.join(plugin, "dist", "wake.js"), { runnerFrom: plugin, loginItem });
  const file = launchAgentPath(root, claudeDir);

  expect(await install()).toContainEqual(`set the runner to start at login, through ${file}`);
  // It runs this config folder's wake.mjs, which install has just put in place.
  expect(fs.readFileSync(file, "utf8")).toContain(`<string>${wakeScriptPath(claudeDir)}</string>`);
  expect(await install()).toEqual([]);

  fs.writeFileSync(path.join(claudeDir, "isoplan", "runner.json"), JSON.stringify({ startAtLogin: false }));
  expect(await install()).toEqual([`took out the runner's start at login (${file})`]);
  expect(fs.existsSync(file)).toBe(false);
  expect(await install()).toEqual([]);

  fs.rmSync(path.join(claudeDir, "isoplan", "runner.json"));
  await install();
  expect(fs.existsSync(file)).toBe(true);
  const { changes } = await uninstall(paths, { loginItem });
  expect(changes).toContain(`took out the runner's start at login (${file})`);
  expect(fs.existsSync(file)).toBe(false);
  expect(fs.existsSync(path.join(claudeDir, "isoplan"))).toBe(false);
});

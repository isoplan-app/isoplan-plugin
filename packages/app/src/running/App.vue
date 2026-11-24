<script setup lang="ts">
// The window of what's running on this computer (#137): by folder, its sessions and their processes,
// then the processes there that belong to no session. It asks the app again only while it is open.
// End asks the app to end a process, or every one in a folder, only once a person confirms here, and
// the confirmation says whether Isoplan started it (#144). The app checks again before it ends any.
import { Electroview } from "electrobun/view";
import { onMounted, onUnmounted, ref } from "vue";
import type { FolderLine, ProcessLine, RunningView } from "../bun/running.ts";
import { askAgainMs } from "../shared/ask-again.ts";
import type { RunningRPC } from "../shared/running-rpc.ts";

// How long the app may take to answer (listing the processes can take a few seconds), and how long the
// window waits before asking again until an answer gives its own pace.
const REQUEST_MS = 15000;
const rpc = Electroview.defineRPC<RunningRPC>({ maxRequestTime: REQUEST_MS, handlers: { requests: {}, messages: {} } });
new Electroview({ rpc });

const view = ref<RunningView | null>(null);
// Whether the last ask went unanswered, so what shows is from before.
const stale = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
let closed = false;
// Asked again at the pace the last answer gave (processRefreshSeconds).
const load = async () => {
	clearTimeout(timer);
	try {
		view.value = await rpc.request.view({});
		stale.value = false;
	} catch {
		stale.value = true;
	}
	if (!closed) timer = setTimeout(load, askAgainMs(view.value?.refreshMs, REQUEST_MS));
};
onMounted(() => void load());
onUnmounted(() => {
	closed = true;
	clearTimeout(timer);
});

const memory = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`);
const started = (iso: string) => {
	const d = new Date(iso);
	const today = d.toDateString() === new Date().toDateString();
	return today ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};
// The End a person asked for, waiting for them to confirm it, and what the last one did.
const asking = ref<{ folder: string; pid?: number; started?: string; text: string } | null>(null);
const ending = ref(false);
const result = ref("");
const who = (p: ProcessLine) => (p.isoplan ? "Isoplan started it" : p.isoplan === false ? "Isoplan didn't start it: you or another app did" : "Isoplan can't tell whether it started it");
const endable = (folder: FolderLine) => [...folder.sessions.flatMap((s) => s.processes), ...folder.strays].filter((p) => p.endable);
const askOne = (folder: FolderLine, p: ProcessLine) => {
	result.value = "";
	asking.value = { folder: folder.folder, pid: p.pid, started: p.started, text: `End ${p.name} (${p.pid})? ${who(p)}.` };
};
const askAll = (folder: FolderLine) => {
	const all = endable(folder);
	const started = all.filter((p) => p.isoplan).length;
	const unknown = all.filter((p) => p.isoplan === null).length;
	const inSessions = all.filter((p) => p.session !== null).length;
	result.value = "";
	asking.value = {
		folder: folder.folder,
		text:
			`End ${all.length === 1 ? "the 1 process" : `all ${all.length} processes`} in this folder? Isoplan started ${started} of them` +
			(unknown ? `, and can't tell for ${unknown}` : "") +
			"." +
			(inSessions ? ` ${count(inSessions, "is a session's", "are sessions'")}, which end too.` : ""),
	};
};
const confirmEnd = async () => {
	const asked = asking.value;
	if (!asked || ending.value) return;
	ending.value = true;
	try {
		const { ended, failed } = await rpc.request.end({ folder: asked.folder, ...(asked.pid !== undefined && { pid: asked.pid, started: asked.started }) });
		result.value = !ended && !failed ? "Nothing was ended: it had ended already, or changed." : `Ended ${count(ended, "process", "processes")}.` + (failed ? ` ${count(failed, "process", "processes")} couldn't be ended.` : "");
	} catch {
		result.value = "Couldn't ask the app to end it just now.";
	}
	ending.value = false;
	asking.value = null;
	void load();
};
const parent = (p: ProcessLine) => (p.parent.name ? `${p.parent.name} (${p.parent.pid})` : `${p.parent.pid}, not running or not shown`);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
// A folder's sessions, then its processes that belong to no session, shown alike.
const groups = (folder: FolderLine) => [
	...folder.sessions.map((s) => ({ key: s.key, name: s.name, detail: s.how + (s.state ? `, ${s.state}` : ""), lost: !s.found, strays: false, processes: s.processes })),
	...(folder.strays.length ? [{ key: ":no session", name: "Belonging to no session", detail: count(folder.strays.length, "process", "processes"), lost: false, strays: true, processes: folder.strays }] : []),
];
</script>

<template>
	<main>
		<header>
			<h1>What's running</h1>
			<p v-if="view" class="quiet">{{ memory(view.memory) }} in all</p>
		</header>
		<p v-if="!view" class="quiet">Looking…</p>
		<template v-else>
			<p v-if="result" class="quiet small">{{ result }}</p>
			<p v-if="stale" class="quiet small">Couldn't refresh just now; this is from before.</p>
			<p v-if="!view.processesListed" class="note">This computer's processes couldn't be listed just now. Trying again…</p>
			<p v-if="!view.sessionsListed" class="note">Isoplan's runner isn't listing sessions with their folders right now (it isn't running, or it needs updating), so every process shows as belonging to no session.</p>
			<p v-if="view.processesListed && !view.folders.length" class="quiet">Nothing is running in a work tree or checkout on this computer.</p>
			<section v-for="folder in view.folders" :key="folder.folder" class="folder">
				<div class="folder-head">
					<h2 :title="folder.folder"><bdi>{{ folder.folder }}</bdi></h2>
					<span class="quiet nowrap">{{ memory(folder.memory) }} <button v-if="endable(folder).length" @click="askAll(folder)">End all</button></span>
				</div>
				<div v-if="asking && asking.folder === folder.folder" class="confirm">
					<span>{{ asking.text }}</span>
					<button class="danger" :disabled="ending" @click="confirmEnd">End</button>
					<button :disabled="ending" @click="asking = null">Cancel</button>
				</div>
				<div v-for="group in groups(folder)" :key="group.key" class="session" :class="{ strays: group.strays }">
					<div class="session-head">
						<span class="name">{{ group.name }}</span>
						<span class="quiet">{{ group.detail }}</span>
					</div>
					<p v-if="group.lost" class="quiet small">Its process wasn't found, so its processes can't be told apart from the others here.</p>
					<table v-if="group.processes.length">
						<tbody>
							<tr v-for="p in group.processes" :key="p.pid">
								<td class="proc">{{ p.name }} <span class="quiet">{{ p.pid }}</span></td>
								<td class="command" :title="p.command ?? ''">{{ p.command ?? "Hidden: the secret patterns can't be read" }}</td>
								<td class="quiet nowrap">started {{ started(p.started) }}</td>
								<td class="quiet nowrap">{{ memory(p.memory) }}</td>
								<td class="quiet">started by {{ parent(p) }}</td>
								<td class="quiet nowrap">{{ p.session ?? "no session" }}</td>
								<td class="act"><button v-if="p.endable" @click="askOne(folder, p)">End</button></td>
							</tr>
						</tbody>
					</table>
				</div>
			</section>
		</template>
	</main>
</template>

<style>
body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; background: #f6f8fc; color: #0b0d10; }
main { padding: 20px 24px; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
h1 { font-size: 20px; margin: 0; }
h2 { font-size: 14px; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
p { line-height: 1.45; margin: 0 0 12px; }
.note { background: #fff6e0; border: 1px solid #f0d58a; border-radius: 8px; padding: 8px 12px; }
.folder { background: white; border: 1px solid #dfe5f0; border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; }
.folder-head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.session { border-top: 1px solid #eef1f6; padding: 8px 0; }
.session-head { display: flex; gap: 10px; align-items: baseline; margin-bottom: 4px; }
.name { font-weight: 600; }
.strays .name { color: #9a5b00; }
.strays { background: #fffaf0; margin: 0 -14px -12px; padding: 8px 14px 12px; border-radius: 0 0 10px 10px; }
table { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed; }
td { padding: 3px 6px 3px 0; vertical-align: top; }
td.proc { width: 16%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
td.command { width: 38%; font-family: ui-monospace, "Cascadia Mono", Menlo, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nowrap { white-space: nowrap; }
.quiet { color: #5a6578; font-size: 13px; }
td.quiet { font-size: 12px; }
.small { font-size: 12px; }
button { font: inherit; font-size: 12px; padding: 2px 10px; border: 1px solid #c9d2e0; border-radius: 6px; background: white; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
button.danger { background: #b42318; border-color: #b42318; color: white; }
td.act { width: 52px; text-align: right; }
.confirm { display: flex; gap: 8px; align-items: center; background: #fff1f0; border: 1px solid #f3b8b2; border-radius: 8px; padding: 6px 10px; margin-bottom: 8px; font-size: 13px; }
.confirm span { flex: 1; }
</style>

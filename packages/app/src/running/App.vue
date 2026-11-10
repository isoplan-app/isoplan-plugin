<script setup lang="ts">
// The window of what's running on this computer (#137): by folder, its sessions and their processes,
// then the processes there that belong to no session. It asks the app again only while it is open.
// Read-only: nothing here ends a process.
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
			<p v-if="stale" class="quiet small">Couldn't refresh just now; this is from before.</p>
			<p v-if="!view.processesListed" class="note">This computer's processes couldn't be listed just now. Trying again…</p>
			<p v-if="!view.sessionsListed" class="note">Isoplan's runner isn't listing sessions with their folders right now (it isn't running, or it needs updating), so every process shows as belonging to no session.</p>
			<p v-if="view.processesListed && !view.folders.length" class="quiet">Nothing is running in a work tree or checkout on this computer.</p>
			<section v-for="folder in view.folders" :key="folder.folder" class="folder">
				<div class="folder-head">
					<h2 :title="folder.folder"><bdi>{{ folder.folder }}</bdi></h2>
					<span class="quiet">{{ memory(folder.memory) }}</span>
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
</style>

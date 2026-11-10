<script setup lang="ts">
// The window of what's running on this computer (#137): by folder, its sessions and their processes,
// then the processes there that belong to no session. It asks the app again only while it is open.
// Read-only: nothing here ends a process.
import { Electroview } from "electrobun/view";
import { onMounted, onUnmounted, ref } from "vue";
import type { ProcessLine, RunningView } from "../bun/running.ts";
import type { RunningRPC } from "../shared/running-rpc.ts";

// How long the app may take to answer (listing the processes can take a few seconds); unanswered, it is asked again after as long.
const REQUEST_MS = 15000;
const rpc = Electroview.defineRPC<RunningRPC>({ maxRequestTime: REQUEST_MS, handlers: { requests: {}, messages: {} } });
new Electroview({ rpc });

const view = ref<RunningView | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let closed = false;
// Asked again at the pace the app gives (processRefreshSeconds).
const load = async () => {
	view.value = await rpc.request.view({}).catch(() => view.value);
	if (!closed) timer = setTimeout(load, view.value?.refreshMs ?? REQUEST_MS);
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
const parent = (p: ProcessLine) => (p.parent.name ? `${p.parent.name} (${p.parent.pid})` : `${p.parent.pid}, no longer running`);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
</script>

<template>
	<main>
		<header>
			<h1>What's running</h1>
			<p v-if="view" class="quiet">{{ memory(view.memory) }} in all</p>
		</header>
		<p v-if="!view" class="quiet">Looking…</p>
		<template v-else>
			<p v-if="!view.processesListed" class="note">This computer's processes couldn't be listed just now. Trying again…</p>
			<p v-if="!view.sessionsListed" class="note">Isoplan's runner isn't listing sessions with their folders right now (it isn't running, or it needs updating), so every process shows as belonging to no session.</p>
			<p v-if="view.processesListed && !view.folders.length" class="quiet">Nothing is running in a work tree or checkout on this computer.</p>
			<section v-for="folder in view.folders" :key="folder.folder" class="folder">
				<div class="folder-head">
					<h2 :title="folder.folder">{{ folder.folder }}</h2>
					<span class="quiet">{{ memory(folder.memory) }}</span>
				</div>
				<div v-for="session in folder.sessions" :key="session.name + session.how" class="session">
					<div class="session-head">
						<span class="name">{{ session.name }}</span>
						<span class="quiet">{{ session.how }}<template v-if="session.state">, {{ session.state }}</template></span>
					</div>
					<p v-if="!session.found" class="quiet small">Its process wasn't found, so its processes can't be told apart from the others here.</p>
					<table v-if="session.processes.length">
						<tbody>
							<tr v-for="p in session.processes" :key="p.pid">
								<td class="proc">{{ p.name }} <span class="quiet">{{ p.pid }}</span></td>
								<td class="command" :title="p.command ?? ''">{{ p.command ?? "Hidden: the secret patterns can't be read" }}</td>
								<td class="quiet nowrap">started {{ started(p.started) }}</td>
								<td class="quiet nowrap">{{ memory(p.memory) }}</td>
								<td class="quiet">started by {{ parent(p) }}</td>
								<td class="quiet nowrap">{{ p.session }}</td>
							</tr>
						</tbody>
					</table>
				</div>
				<div v-if="folder.strays.length" class="session strays">
					<div class="session-head">
						<span class="name">Belonging to no session</span>
						<span class="quiet">{{ count(folder.strays.length, "process", "processes") }}</span>
					</div>
					<table>
						<tbody>
							<tr v-for="p in folder.strays" :key="p.pid">
								<td class="proc">{{ p.name }} <span class="quiet">{{ p.pid }}</span></td>
								<td class="command" :title="p.command ?? ''">{{ p.command ?? "Hidden: the secret patterns can't be read" }}</td>
								<td class="quiet nowrap">started {{ started(p.started) }}</td>
								<td class="quiet nowrap">{{ memory(p.memory) }}</td>
								<td class="quiet">started by {{ parent(p) }}</td>
								<td class="quiet nowrap">no session</td>
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

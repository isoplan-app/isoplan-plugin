<script setup lang="ts">
// The pairing window: the links the runner made to pair this computer with each office waiting for
// it. A link opens in the browser only when it is clicked.
import { Electroview } from "electrobun/view";
import { onMounted, onUnmounted, ref } from "vue";
import type { PairingView } from "../bun/menu.ts";
import type { PairingRPC } from "../shared/pairing-rpc.ts";

// How long the app may take to answer; unanswered, it is asked again after as long.
const REQUEST_MS = 5000;
const rpc = Electroview.defineRPC<PairingRPC>({ maxRequestTime: REQUEST_MS, handlers: { requests: {}, messages: {} } });
new Electroview({ rpc });

const view = ref<PairingView | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let closed = false;
// Asked again at the pace the app gives (trayRefreshSeconds).
const load = async () => {
	view.value = await rpc.request.view({}).catch(() => view.value);
	if (!closed) timer = setTimeout(load, view.value?.refreshMs ?? REQUEST_MS);
};
onMounted(() => void load());
onUnmounted(() => {
	closed = true;
	clearTimeout(timer);
});

const open = (url: string) => rpc.send.open({ url });
const until = (expires: string) => new Date(expires).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
</script>

<template>
	<main>
		<h1>Pair this computer</h1>
		<p v-if="!view" class="quiet">Looking…</p>
		<p v-else-if="!view.running" class="quiet">Isoplan isn't running on this computer, so there's nothing to pair. Resume it from the menu.</p>
		<template v-else>
			<section v-if="view.waiting.length">
				<p>Open the link, sign in to your office and approve this computer.</p>
				<ul>
					<li v-for="pair in view.waiting" :key="pair.url">
						<span class="office">{{ pair.office }}</span>
						<button @click="open(pair.url)">Open in browser</button>
						<span class="quiet">works until {{ until(pair.expires) }}</span>
					</li>
				</ul>
			</section>
			<p v-else class="quiet">No office is waiting to pair with this computer.</p>
			<p v-if="view.connected.length" class="quiet">Connected to {{ view.connected.join(", ") }}.</p>
		</template>
	</main>
</template>

<style>
body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; background: #f6f8fc; color: #0b0d10; }
main { padding: 24px 28px; }
h1 { font-size: 20px; margin: 0 0 12px; }
p { line-height: 1.45; margin: 0 0 12px; }
ul { list-style: none; padding: 0; margin: 0 0 16px; }
li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 12px 0; border-top: 1px solid #dfe5f0; }
.office { font-weight: 600; flex: 1 1 100%; }
.quiet { color: #5a6578; font-size: 13px; }
button { padding: 7px 14px; border-radius: 8px; border: 1px solid #2e64c8; background: #2e64c8; color: white; font: inherit; cursor: pointer; }
button:hover { background: #1c3f80; }
</style>

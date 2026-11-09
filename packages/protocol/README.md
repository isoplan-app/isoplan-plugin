# @isoplan/protocol

The wire protocol between [Isoplan](https://github.com/isoplan-app/isoplan-plugin)'s Claude Code plugin and an office server: the facts a session reports, the messages each side sends, and [zod](https://zod.dev) schemas that check them.

```
npm install @isoplan/protocol
```

ES module only, with TypeScript types. Depends on zod 4.

## What is in it

- **Facts** (`FactsSchema` and its parts: `SessionFactSchema`, `AgentFactSchema`, `FileFactSchema`, `WaitFactSchema`, `ReportFactSchema`, `QuestionFactSchema`, `WorkflowFactSchema`): what one session reports, the shape a data layer sends and a server stores. A Claude Code workflow run is a `WorkflowFact`, and each of its agents an `AgentFact` whose `workflow` names the run, its phase and its label; their text is bounded by exported `MAX_WORKFLOW_*` constants.
- **Messages**: `DataLayerMessageSchema` for what a data layer or runner sends (hellos, full facts, changes, replies, refusals, and the hand-over, take and taken steps of a handoff, and ask-room, ask-check and asked-ack for asking a handed-over room a question), and `OfficeServerMessageSchema` for what a server sends back (repair, conflict, error, request, release, handoff, asked, where a question stands, and ask-rights, whether a session may ask). Each message type has its own schema and type as well, such as `HelloMessage` or `RequestMessage`.
- **Driven sessions** (0.5.0): a session the runner runs on its person's machine, which they drive from the floor. The server sends `drive` (start, instruct, stop, hand-back, output, answer a permission prompt, release withheld text), each naming who acts, and `drive-policy`, where skipping permission prompts is allowed. The runner sends `driven` (started, turn-started, tool, reply, turn-ended, error, output, prompt, prompt-ended, held, released, handed-back, refused, holding, its sessions, once per connection, and folders, where a new session can start for each repo the office takes, with that and whenever it changes), only while its link is up, and only once the connection's first `drive-policy` has come, so a server from before driven sessions, which sends none, is never sent one. A start names a room, or a folder from the runner's last `folders` and no room, for a fresh session in a room of its own (`room:<session>`). From 0.9.0 a runner lists each repo once, by its main checkout, with `branches`, the branches on its remote (absent from an older runner, or one that couldn't reach the remote), and sends `folders` unasked every few minutes when they changed; a start in a folder may name one of those as `branch`, which opens in a git worktree of it beside the checkout unless the checkout is on it already. From 0.10.0 such a start may say where it opens, `mode`, as a take does (`terminal`, `headless`, `orca`, `desktop`, or `driven`, the default), with its first instruction; a runner says the places it can open in its hello's `starts`, and is sent a `mode` only then, and answers a start that opened elsewhere `opened`. A runner that drives sessions says `drive` in its hello, and can take a handoff as one (mode `driven`). Their text, ids, rooms, tool names, a start's room sessions, the `holding` list and the folders listed are bounded by exported `MAX_*` constants, which a runner keeps its messages within; the acting person (`by`) and project ids aren't bounded, as they aren't anywhere else in the protocol.
- **Claude Code on the machine** (0.7.0): a runner's hello says `claude`, whether Claude Code for the terminal is there and signed in (`ready`, `signed-out`, `missing`), and `driven` `claude` says it again whenever it changes. The server can send such a runner `install-claude`, which runs Anthropic's native installer with no window, and `sign-in-claude`, which runs `claude auth login`; the runner answers each with `claude` messages under the request's id, with the installer's progress, the sign-in link, or why it failed.
- **Spin-offs** (0.10.0): a handoff may carry a `task` of its own, at most `MAX_TASK_LENGTH` characters, which makes it a spin-off: the brief is written for that task, and the new session starts on it. The task rides in the handoff (`hand-over` and `handoff`), in `hand-over-check`, and in the floor's `write-brief` request; a `write-brief` reply doesn't repeat it. An older side ignores it.
- **Questions as Claude Code asks them** (0.11.0): a question's options may carry a `preview`, and the floor's `owner-answer` request may carry `annotations`, keyed by question text: the owner's `notes` on each answer and the `preview` of the option chosen. A question fact may say `asMessage`: the hooks module didn't see it asked, so the plugin answers it by stopping the turn and submitting the answers as the owner's own message. A session fact says `hooks` when Isoplan's hooks module runs inside it. An older side ignores them. From 0.11.1 an `owner-answer` may say `chat` instead: the owner chose "Chat about this", and `answers` is empty.
- **`PROTOCOL_VERSION`**: the version both sides speak. A message's `v` must match it.
- **`projectId(remoteUrl, { machine, root })`**: a repository's project id, `host/owner/repo` from its git remote whatever form the remote is written in, or `local:<machine>/<root>` without one.

## Parse a message

```ts
import { parseDataLayerMessage } from "@isoplan/protocol";

const result = parseDataLayerMessage(JSON.parse(text));
if (result.ok) handle(result.message);
else if (result.kind === "unsupported-version") reply(result.error); // a peer on another protocol version
else drop(result.error);
```

`parseOfficeServerMessage` does the same for the other direction. Neither throws.

## Licence

MIT. Source: [`packages/protocol`](https://github.com/isoplan-app/isoplan-plugin/tree/main/packages/protocol).

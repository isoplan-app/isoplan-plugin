// /isoplan:expert's script, dist/expert-offer.js (commands/expert.md): opens the review of this
// session's open expert offer in the default browser (open.ts says how it finds it).

import os from "node:os";
import { claudePaths } from "../data-layer/claude-paths.js";
import { expertOffer, openUrl } from "./open.js";

const { dir: claudeDir } = claudePaths(process.env, os.homedir());
process.stdout.write((await expertOffer({ claudeDir, session: process.env.CLAUDE_CODE_SESSION_ID, open: (url) => openUrl(process.platform, url) })) + "\n");

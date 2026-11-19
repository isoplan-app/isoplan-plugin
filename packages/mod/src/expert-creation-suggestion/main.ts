// /isoplan:review-expert-suggestion's script, dist/review-expert-creation-suggestion.js (commands/review-expert-suggestion.md): opens the review of this
// session's open expert creation suggestion in the default browser (open.ts says how it finds it).

import os from "node:os";
import { claudePaths } from "../data-layer/claude-paths.js";
import { openReviewOfNewestExpertCreationSuggestion, openUrl } from "./open.js";

const { dir: claudeDir } = claudePaths(process.env, os.homedir());
process.stdout.write((await openReviewOfNewestExpertCreationSuggestion({ claudeDir, session: process.env.CLAUDE_CODE_SESSION_ID, open: (url) => openUrl(process.platform, url) })) + "\n");

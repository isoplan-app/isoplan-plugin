// Where an expert of a project runs on this computer (isoplan-app#340, D11): this computer's own
// checkout of the project, found as New session finds folders (repo-folders.ts); with none, Isoplan's
// own hidden clone of it (isoplan-clone.ts, as a hidden start makes it, never in the person's
// folders), from https and then ssh, git asking nothing. A project with no remote, or one both
// clones were refused for, fails with git's reasons. Make expert (expert-creation-suggestions.ts) and
// an instance's set-up from its expert record (expert-instance.ts) take this one route.

import type { Project } from "@isoplan/protocol";

/** The addresses Isoplan's own clone of a project is made from where this computer has no checkout, in order: https from its id, then ssh; none for a repo with no remote. */
export function cloneUrls(project: string): string[] {
  if (project.startsWith("local:")) return [];
  const [host, ...rest] = project.split("/");
  return rest.length ? [`https://${project}.git`, `git@${host}:${rest.join("/")}.git`] : [`https://${project}.git`];
}

export interface ProjectCheckoutForExpertOptions {
  project: Project;
  /** This computer's checkout of the project; null when it has none. */
  checkoutOf: (project: Project) => Promise<string | null>;
  /** Isoplan's own hidden clone of the project (an id), made from `url` or fetched: its folder, or why there is none, with git's own words when git failed. */
  clone: (url: string, project: string) => Promise<string | { problem: string; reason?: string }>;
  /** Told once a clone begins: there was no checkout. */
  onCloning?: () => void;
}

/** The folder the expert runs in, or why there is none. */
export async function findOrCloneProjectCheckoutForExpert(o: ProjectCheckoutForExpertOptions): Promise<{ folder: string } | { failed: string }> {
  const checkout = await o.checkoutOf(o.project).catch(() => null);
  if (checkout) return { folder: checkout };
  const urls = cloneUrls(o.project.id);
  if (!urls.length) return { failed: `this computer has no checkout of ${o.project.name}, and its repo has no remote to clone it from` };
  o.onCloning?.();
  const reasons: string[] = [];
  for (const url of urls) {
    const clone = await o.clone(url, o.project.id);
    if (typeof clone === "string") return { folder: clone };
    reasons.push(`from ${url}, ${clone.reason ?? clone.problem}`);
  }
  return { failed: `this computer has no checkout of ${o.project.name}, and Isoplan's own copy of it couldn't be made: ${reasons.join("; ")}` };
}

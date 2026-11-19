import type { OfferDismissal } from "./messages.js";

/**
 * Whether `list` holds a dismissal of `folder` (relative to the repo's root) of `project` at `now`
 * (ms since the epoch): one for the same project, its folder that folder or one it is in (`.` every
 * folder), and for good or `until` a time later than now. Letter case is ignored, as in `areaCovers`.
 */
export function isDismissed(list: readonly OfferDismissal[], project: string, folder: string, now: number): boolean {
  const target = folder.toLowerCase();
  return list.some((d) => {
    const base = d.folder.toLowerCase();
    return (
      d.project.toLowerCase() === project.toLowerCase() &&
      (base === "." || target === base || target.startsWith(base + "/")) &&
      (d.forever === true || Date.parse(d.until ?? "") > now)
    );
  });
}

/**
 * Whether an expert's `areas` (AreaPathSchema: folders and globs) cover `folder`, relative to the
 * same repo's root: one area's part before its first wildcard part (one with any of `* ? [ ] { }`)
 * is the folder or a folder it is in. `.`, or an area that starts with a wildcard, covers every
 * folder. Letter case is ignored, as Windows and macOS ignore it.
 */
export function areaCovers(areas: readonly string[], folder: string): boolean {
  const target = folder.toLowerCase();
  return areas.some((area) => {
    const parts = area.toLowerCase().split("/");
    const wild = parts.findIndex((part) => /[*?[\]{}]/.test(part));
    const base = (wild < 0 ? parts : parts.slice(0, wild)).join("/") || ".";
    return base === "." || target === base || target.startsWith(base + "/");
  });
}

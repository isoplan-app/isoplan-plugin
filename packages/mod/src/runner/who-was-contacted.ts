// The file of who was contacted (isoplan-app#341): which prospects an office's employees claimed,
// contacted or skipped, kept in the employee's own project, by default `who-was-contacted.csv` at
// its root, so every job of a project shares one file. Pure: the CSV (RFC 4180) and the changes
// applied to its rows; who-was-contacted-writer.ts reads and pushes it.
//
// - Its header is `prospect,state,sender,employee,since,name,organisation`, one row per prospect and
//   sender: `prospect` the address in lower case; `state` `claimed`, `contacted` or `skipped`;
//   `sender` the employee's owner as the office knows them; `employee` its key; `since` when.
//   Columns a person added are kept, and rows keep their order, new ones at the end.
// - A `skipped` row stops only its own sender's employee: to everyone else it is no row.
// - The changes: `claim` (a run's end, per draft with a recipient), `contacted` (approved), `skip`
//   (skipped), `release` (expired, a rejected recipient a run didn't draft again, or the employee
//   deleted: its claims only, never a contacted row), and `keep` (rejected: the row stays claimed,
//   `since` moved on). A claim that another sender's claimed or contacted row now covers is dropped,
//   and said so (`someoneElseHad`); a contacted change that finds one is still made, and said too
//   (`contactedTwice`), since its person sends it themselves.

export const HEADER = ["prospect", "state", "sender", "employee", "since", "name", "organisation"] as const;

export type ProspectState = "claimed" | "contacted" | "skipped";

export interface Row {
  prospect: string;
  state: ProspectState;
  sender: string;
  employee: string;
  since: string;
  name: string;
  organisation: string;
  /** A person's own columns, by their header. */
  more: Record<string, string>;
}

export interface Table {
  /** Every column, HEADER's first, then the person's own, in the file's order. */
  columns: string[];
  rows: Row[];
}

export interface WhoWasContactedChange {
  op: "claim" | "contacted" | "release" | "keep" | "skip";
  prospect: string;
  name?: string;
  organisation?: string;
  /** The draft it is for. */
  draft: string;
  at: string;
}

export interface Sender {
  sender: string;
  employee: string;
}

export const emptyTable = (): Table => ({ columns: [...HEADER], rows: [] });

/** An address as the file keys it. */
export const prospectOf = (address: string) => address.trim().toLowerCase();

/** The fields of a CSV text, row by row (RFC 4180: quotes, commas and new lines in quoted fields). */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const end = () => (row.push(field), (field = ""));
  while (i < text.length) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), (i += 2);
      else if (c === '"') (quoted = false), i++;
      else (field += c), i++;
      continue;
    }
    if (c === '"') (quoted = true), i++;
    else if (c === ",") end(), i++;
    else if (c === "\r" || c === "\n") {
      end();
      rows.push(row);
      row = [];
      i += c === "\r" && text[i + 1] === "\n" ? 2 : 1;
    } else (field += c), i++;
  }
  if (field !== "" || row.length) (end(), rows.push(row));
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

const quote = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The file's rows; a missing or empty file is the header alone. A row with no prospect, or a state it doesn't know, is kept as a person wrote it, as a column it doesn't know is. */
export function parseTable(text: string | null): Table {
  const rows = csvRows(text ?? "");
  if (!rows.length) return emptyTable();
  const header = rows[0]!.map((h) => h.trim());
  const columns = [...HEADER, ...header.filter((h) => h && !(HEADER as readonly string[]).includes(h))];
  const table: Table = { columns, rows: [] };
  for (const r of rows.slice(1)) {
    const cell = Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""]));
    const state = cell.state as ProspectState;
    table.rows.push({
      prospect: prospectOf(cell.prospect ?? ""),
      state: ["claimed", "contacted", "skipped"].includes(state) ? state : (cell.state as ProspectState),
      sender: cell.sender ?? "",
      employee: cell.employee ?? "",
      since: cell.since ?? "",
      name: cell.name ?? "",
      organisation: cell.organisation ?? "",
      more: Object.fromEntries(columns.slice(HEADER.length).map((h) => [h, cell[h] ?? ""])),
    });
  }
  return table;
}

/** The file's text: its header, then each row, with CRLF between them, as RFC 4180 writes it. */
export function tableText(t: Table): string {
  const line = (cells: string[]) => cells.map(quote).join(",");
  const rows = t.rows.map((r) => line(t.columns.map((c) => ((HEADER as readonly string[]).includes(c) ? String(r[c as (typeof HEADER)[number]] ?? "") : (r.more[c] ?? "")))));
  return [line(t.columns), ...rows].join("\r\n") + "\r\n";
}

/** What the file says of a prospect: this sender's row, and the claimed or contacted rows of every other sender. */
export function lookUp(t: Table, address: string, me: Pick<Sender, "sender">): { mine: Row | null; others: Row[] } {
  const prospect = prospectOf(address);
  const rows = t.rows.filter((r) => r.prospect === prospect);
  return { mine: rows.find((r) => r.sender === me.sender) ?? null, others: rows.filter((r) => r.sender !== me.sender && (r.state === "claimed" || r.state === "contacted")) };
}

export interface Applied {
  table: Table;
  /** The drafts whose claim another sender's row covered, so it wasn't made. */
  someoneElseHad: string[];
  /** The drafts approved whose prospect another sender had contacted or claimed, with that row. */
  contactedTwice: { draft: string; other: Row }[];
  counts: { claimed: number; contacted: number; released: number; skipped: number; kept: number };
}

/** `changes`, in order, applied to a copy of `t` for `me`; a claim for a draft in `alreadySent` is made even where another sender's row now covers it, since its draft went to the floor already. */
export function applyChanges(t: Table, changes: readonly WhoWasContactedChange[], me: Sender, alreadySent: ReadonlySet<string> = new Set()): Applied {
  const table: Table = { columns: [...t.columns], rows: t.rows.map((r) => ({ ...r, more: { ...r.more } })) };
  const out: Applied = { table, someoneElseHad: [], contactedTwice: [], counts: { claimed: 0, contacted: 0, released: 0, skipped: 0, kept: 0 } };
  for (const c of changes) {
    const prospect = prospectOf(c.prospect);
    const at = (r: Row) => r.prospect === prospect && r.sender === me.sender;
    const mine = table.rows.find(at);
    const others = table.rows.filter((r) => r.prospect === prospect && r.sender !== me.sender && (r.state === "claimed" || r.state === "contacted"));
    const put = (state: ProspectState) => {
      const fields = { state, employee: me.employee, since: c.at, ...(c.name && { name: c.name }), ...(c.organisation && { organisation: c.organisation }) };
      if (mine) Object.assign(mine, fields);
      else table.rows.push({ prospect, sender: me.sender, name: "", organisation: "", more: Object.fromEntries(table.columns.slice(HEADER.length).map((h) => [h, ""])), ...fields });
    };
    switch (c.op) {
      case "claim":
        if (others.length && !alreadySent.has(c.draft)) {
          out.someoneElseHad.push(c.draft);
          continue;
        }
        if (mine?.state === "contacted" || mine?.state === "skipped") continue;
        put("claimed");
        out.counts.claimed++;
        continue;
      case "contacted":
        if (others.length) out.contactedTwice.push({ draft: c.draft, other: others[0]! });
        put("contacted");
        out.counts.contacted++;
        continue;
      case "keep":
        if (mine?.state === "contacted" || mine?.state === "skipped") continue;
        put("claimed");
        out.counts.kept++;
        continue;
      case "skip":
        if (mine?.state === "contacted") continue;
        put("skipped");
        out.counts.skipped++;
        continue;
      case "release":
        if (mine?.state !== "claimed") continue;
        table.rows.splice(table.rows.indexOf(mine), 1);
        out.counts.released++;
        continue;
    }
  }
  return out;
}

/** A commit message naming counts only, never a prospect. */
export function commitMessage(sender: string, employeeName: string, n: Applied["counts"]): string {
  const said = [n.claimed && `claimed ${n.claimed}`, n.contacted && `marked ${n.contacted} contacted`, n.skipped && `skipped ${n.skipped}`, n.kept && `kept ${n.kept} claimed`, n.released && `released ${n.released}`].filter(Boolean);
  return `Isoplan: ${sender}'s ${employeeName} ${said.length ? said.join(", ") : "updated who was contacted"}`;
}

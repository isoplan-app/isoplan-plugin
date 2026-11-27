import { expect, test } from "vitest";
import { applyChanges, lookUp, parseTable, tableText } from "./who-was-contacted.js";

const at = "2026-11-26T09:00:00.000Z";
const ADAM = { sender: "Adam", employee: "adams-outreach" };
const VALENTINA = { sender: "Valentina", employee: "valentinas-outreach" };

test("the file round-trips with quotes, commas and new lines, keeps a person's own column, and each change applies to its own sender's row", () => {
  const text = 'prospect,state,sender,employee,since,name,organisation,comments\r\nana@studio.example,contacted,Valentina,valentinas-outreach,2026-11-24T10:00:00.000Z,"Ana ""Bea"" Ruiz","Studio, Ltd","met at\nthe fair"\r\n';
  const t = parseTable(text);
  expect(t.columns.at(-1)).toBe("comments");
  expect(tableText(t)).toBe(text);

  // Another sender's contacted row: a claim on it is dropped; approving it anyway adds a row and says so.
  const claim = applyChanges(t, [{ op: "claim", prospect: "Ana@Studio.example", draft: "d1", at }], ADAM);
  expect(claim.someoneElseHad).toEqual(["d1"]);
  expect(lookUp(t, "ana@studio.example", ADAM).others[0]).toMatchObject({ sender: "Valentina", state: "contacted" });
  const twice = applyChanges(t, [{ op: "contacted", prospect: "ana@studio.example", draft: "d1", at }], ADAM);
  expect(twice.contactedTwice).toEqual([{ draft: "d1", other: expect.objectContaining({ sender: "Valentina" }) }]);

  // Claim, keep, contacted, skip and release on one's own rows; the person's column stays, empty for new rows.
  let next = applyChanges(t, [{ op: "claim", prospect: "bo@agency.example", name: "Bo", organisation: "Agency", draft: "d2", at }], ADAM).table;
  expect(lookUp(next, "bo@agency.example", ADAM).mine).toMatchObject({ state: "claimed", name: "Bo", more: { comments: "" } });
  next = applyChanges(next, [{ op: "keep", prospect: "bo@agency.example", draft: "d2", at: "2026-11-27T09:00:00.000Z" }], ADAM).table;
  expect(lookUp(next, "bo@agency.example", ADAM).mine?.since).toBe("2026-11-27T09:00:00.000Z");
  expect(applyChanges(next, [{ op: "release", prospect: "bo@agency.example", draft: "d2", at }], ADAM).table.rows).toHaveLength(1);
  const skipped = applyChanges(next, [{ op: "skip", prospect: "bo@agency.example", draft: "d2", at }], ADAM).table;
  // A skipped row stops its own sender only: to Valentina it is no row, and her claim is made.
  expect(lookUp(skipped, "bo@agency.example", VALENTINA).others).toEqual([]);
  expect(applyChanges(skipped, [{ op: "claim", prospect: "bo@agency.example", draft: "d3", at }], VALENTINA).someoneElseHad).toEqual([]);
  // A release never takes a contacted row.
  const contacted = applyChanges(next, [{ op: "contacted", prospect: "bo@agency.example", draft: "d2", at }], ADAM).table;
  expect(applyChanges(contacted, [{ op: "release", prospect: "bo@agency.example", draft: "d2", at }], ADAM).table.rows).toHaveLength(2);
});

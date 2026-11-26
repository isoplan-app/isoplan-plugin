// What this computer's employees learn, on each office's what-was-learned link (#366's
// what-was-learned-link.ts, isoplan-app#341), as main.ts and the test stack put it together: an
// employee's record is tied there as an instance's is, and a key resolves to the employee's when it is
// one here, since keys can't clash on one computer; and each employee's record of what it learned is
// bound to its ties and to those links, as an expert's is.

import type { Employees } from "./employees.js";
import type { EmployeeTies } from "./employee-ties.js";
import type { WhatWasLearnedLink, WhatWasLearnedLinkOptions } from "./what-was-learned-link.js";

/** The instances, records of what was learned and health logs an office's what-was-learned link reads: the experts' and the employees'. */
export function whatWasLearnedOfExpertsAndEmployees(o: {
  instances: WhatWasLearnedLinkOptions["instances"];
  experts: { whatWasLearned: WhatWasLearnedLinkOptions["whatWasLearned"]; health: WhatWasLearnedLinkOptions["health"] };
  employees: Pick<Employees, "get" | "whatWasLearned" | "health">;
  employeeTies: Pick<EmployeeTies, "tiedRecords">;
}): Pick<WhatWasLearnedLinkOptions, "instances" | "whatWasLearned" | "health"> {
  return {
    instances: { tiedRecords: (server) => [...o.instances.tiedRecords(server), ...o.employeeTies.tiedRecords(server)] },
    whatWasLearned: (key) => (o.employees.get(key) ? o.employees.whatWasLearned(key) : o.experts.whatWasLearned(key)),
    health: (key) => (o.employees.get(key) ? o.employees.health(key) : o.experts.health(key)),
  };
}

/** Each employee's record of what it learned, bound to its ties, told when they change, and to the offices' what-was-learned links. */
export function bindWhatEmployeesLearned(employees: Pick<Employees, "bindWhatWasLearned" | "tiesMayHaveChanged">, ties: Pick<EmployeeTies, "tiedRecordsOf" | "heldOn" | "onChange">, servers: readonly string[], links: ReadonlyMap<string, WhatWasLearnedLink>): void {
  employees.bindWhatWasLearned((key) => ({
    tied: () => ties.tiedRecordsOf(key),
    held: (server) => ties.heldOn(server, key),
    servers,
    catchUp: (server, expertRecordId) => links.get(server)?.catchUp(expertRecordId) ?? "cannot",
    waiting: () => links.forEach((l) => l.sendWaiting()),
  }));
  ties.onChange(() => employees.tiesMayHaveChanged());
}

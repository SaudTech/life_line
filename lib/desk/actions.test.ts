import { describe, expect, it } from "vitest";
import { DESK_ACTIONS, deskActionsFor, type DeskAction } from "./actions";

// The desk catalogue is the ONE source of truth for the counter home's tiles, and
// its `roles` mirror each target route's real server gate (§1b of the plan). Two
// things must hold: the per-role visibility is exactly what the acceptance target
// (§2b/§5) says, and the declared gates never silently drift from the routes -
// the mirror guard forces a route gate change to update the catalogue too.

const keysFor = (role: string): string[] =>
  deskActionsFor({ role }).map((a) => a.key);

describe("deskActionsFor - per-role visibility", () => {
  it("op_desk sees procedures + procedure history + my day (no OPD/IPD)", () => {
    expect(keysFor("op_desk").sort()).toEqual(["my_day", "proc_hist", "proc_new"].sort());
  });

  const FULL_COUNTER = [
    "opd_new",
    "proc_new",
    "ipd_admit",
    "ipd_ward",
    "opd_hist",
    "proc_hist",
    "my_day",
  ];

  it("op_ip_desk sees everything except patient records", () => {
    expect(keysFor("op_ip_desk").sort()).toEqual([...FULL_COUNTER].sort());
  });

  it("supervisor works the full counter too (op_ip_desk parity, minus patients)", () => {
    // Supervisors bill OP + IP and admit, on top of inline PIN approval - so the
    // desk shows the same tiles as op_ip_desk, not just My day.
    expect(keysFor("supervisor").sort()).toEqual([...FULL_COUNTER].sort());
  });

  it("admin sees every action in the catalogue", () => {
    expect(keysFor("admin").sort()).toEqual(DESK_ACTIONS.map((a) => a.key).sort());
  });

  it("an unknown role sees only ungated actions (my day)", () => {
    expect(keysFor("intruder")).toEqual(["my_day"]);
  });
});

describe("mirror guard - declared roles match the routes' real gates (§1b)", () => {
  // Hard-coded expectation keyed to the corrected gate table. `undefined` means the
  // action is ungated (any signed-in user). Changing a route's requireRole(...)
  // MUST update the matching entry here (and vice-versa), or this test fails.
  const EXPECTED: Record<string, readonly string[] | undefined> = {
    opd_new: ["admin", "op_ip_desk", "supervisor"],
    proc_new: ["op_desk", "op_ip_desk", "supervisor", "admin"],
    ipd_admit: ["admin", "op_ip_desk", "supervisor"],
    ipd_ward: ["admin", "op_ip_desk", "supervisor"],
    opd_hist: ["admin", "op_ip_desk", "supervisor"],
    proc_hist: ["op_desk", "op_ip_desk", "supervisor", "admin"],
    patients: ["admin"],
    my_day: undefined,
  };

  it("every catalogue action has a mirror expectation and vice-versa", () => {
    expect(DESK_ACTIONS.map((a) => a.key).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("each action's declared roles equal the expected gate", () => {
    const byKey = new Map<string, DeskAction>(DESK_ACTIONS.map((a) => [a.key, a]));
    for (const [key, roles] of Object.entries(EXPECTED)) {
      const action = byKey.get(key)!;
      if (roles === undefined) {
        expect(action.roles, `${key} should be ungated`).toBeUndefined();
      } else {
        expect([...action.roles!].sort(), `${key} gate drifted`).toEqual([...roles].sort());
      }
    }
  });
});

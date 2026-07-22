import { describe, expect, it } from "vitest";
import {
  NAV_BY_ROLE,
  initials,
  isActive,
  navItemsForRole,
  roleKicker,
  roleTitle,
} from "./nav";

describe("navItemsForRole", () => {
  it("gives the admin every management link, each pointing at a real route", () => {
    const items = navItemsForRole("admin");
    expect(items.map((i) => i.label)).toEqual([
      "Dashboard",
      "Staff",
      "Doctors",
      "Services",
      "Patients",
      "OPD",
      "Procedures",
      "IPD",
      "Reports",
      "Receipt Templates",
    ]);
    expect(items.find((i) => i.label === "Staff")).toEqual({
      href: "/admin/users",
      label: "Staff",
    });
    expect(items.find((i) => i.label === "Doctors")).toEqual({
      href: "/admin/doctors",
      label: "Doctors",
    });
    expect(items.find((i) => i.label === "Services")).toEqual({
      href: "/admin/services",
      label: "Services",
    });
    expect(items.find((i) => i.label === "Patients")).toEqual({
      href: "/patients",
      label: "Patients",
    });
    expect(items.find((i) => i.label === "OPD")).toEqual({
      href: "/consultations",
      label: "OPD",
    });
    expect(items.find((i) => i.label === "Procedures")).toEqual({
      href: "/procedures",
      label: "Procedures",
    });
    expect(items.find((i) => i.label === "Receipt Templates")).toEqual({
      href: "/admin/receipts",
      label: "Receipt Templates",
    });
    // Every item is a shipped route - the bar never links to a 404.
    expect(items.every((i) => i.href.startsWith("/"))).toBe(true);
  });

  it("gives the OP-only desk the Counter, Procedures, and My Day links", () => {
    expect(navItemsForRole("op_desk")).toEqual([
      { href: "/desk", label: "Counter" },
      { href: "/procedures", label: "Procedures" },
      { href: "/reports", label: "My Day" },
    ]);
  });

  it("gives the OP+IN desk the Counter, OPD, Procedures, IPD, and My Day links", () => {
    expect(navItemsForRole("op_ip_desk")).toEqual([
      { href: "/desk", label: "Counter" },
      { href: "/consultations", label: "OPD" },
      { href: "/procedures", label: "Procedures" },
      { href: "/admissions", label: "IPD" },
      { href: "/reports", label: "My Day" },
    ]);
  });

  it("gives the supervisor the counter links (OPD, Procedures, IPD) plus Dashboard and My Day", () => {
    expect(navItemsForRole("supervisor")).toEqual([
      { href: "/supervisor", label: "Dashboard" },
      { href: "/consultations", label: "OPD" },
      { href: "/procedures", label: "Procedures" },
      { href: "/admissions", label: "IPD" },
      { href: "/reports", label: "My Day" },
    ]);
  });

  it("returns [] for an unknown or empty role", () => {
    expect(navItemsForRole("hacker")).toEqual([]);
    expect(navItemsForRole("")).toEqual([]);
  });
});

describe("isActive (deepest match wins)", () => {
  const admin = NAV_BY_ROLE.admin;

  it("Dashboard is active on /admin exactly, not on /admin/users", () => {
    expect(isActive("/admin", "/admin", admin)).toBe(true);
    expect(isActive("/admin/users", "/admin", admin)).toBe(false);
  });

  it("Users wins on /admin/users and its descendants", () => {
    expect(isActive("/admin/users", "/admin/users", admin)).toBe(true);
    expect(isActive("/admin/users/anything", "/admin/users", admin)).toBe(true);
    expect(isActive("/admin/users/anything", "/admin", admin)).toBe(false);
  });

  it("a non-route href ('#') is never active", () => {
    expect(isActive("/admin", "#", admin)).toBe(false);
    expect(isActive("#", "#", admin)).toBe(false);
  });

  it("respects segment boundaries", () => {
    expect(isActive("/administration", "/admin", admin)).toBe(false);
  });
});

describe("role labels", () => {
  it("maps known roles, falls back for unknown", () => {
    expect(roleTitle("admin")).toBe("Administrator");
    expect(roleKicker("admin")).toBe("Admin");
    expect(roleTitle("nope")).toBe("Staff");
    expect(roleKicker("nope")).toBe("Staff");
  });
});

describe("initials", () => {
  it("takes first + last initial", () => {
    expect(initials("Meera Ann")).toBe("MA");
    expect(initials("Dr. Anita Priya Rao")).toBe("DR");
  });
  it("handles a single name and blank", () => {
    expect(initials("Meera")).toBe("M");
    expect(initials("   ")).toBe("?");
  });
});

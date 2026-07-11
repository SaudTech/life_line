import { describe, expect, it } from "vitest";
import { ACTIVITY, activityMeta, type Tone } from "./actions";

const TONES: Tone[] = ["accent", "success", "warning", "danger"];

describe("ACTIVITY registry", () => {
  it("every entry has a non-empty label and a valid tone", () => {
    for (const [action, meta] of Object.entries(ACTIVITY)) {
      expect(meta.label, `${action} label`).toBeTruthy();
      expect(TONES, `${action} tone`).toContain(meta.tone);
    }
  });
});

describe("activityMeta", () => {
  it("returns the registry entry for a known tag", () => {
    expect(activityMeta("user.create")).toEqual({
      label: "New staff created",
      tone: "success",
    });
    expect(activityMeta("bill.void").tone).toBe("danger");
    expect(activityMeta("auth.sign_in").tone).toBe("accent");
    expect(activityMeta("discount.pin_failed")).toEqual({
      label: "Failed discount PIN attempt",
      tone: "danger",
    });
  });

  it("falls back to a readable form (dots/underscores → spaces, accent tone) for an unknown tag", () => {
    expect(activityMeta("some.brand_new_tag")).toEqual({
      label: "some brand new tag",
      tone: "accent",
    });
  });

  it("maps the user's example phrases to the expected tags", () => {
    // "user sign in", "patient created", "new staff created", "staff updated",
    // "password reset" - each must resolve to a defined, non-fallback tag.
    const examples: Record<string, string> = {
      "auth.sign_in": "Signed in",
      "patient.create": "Patient registered",
      "user.create": "New staff created",
      "user.update": "Staff account updated",
      "user.password_reset": "Password reset",
    };
    for (const [action, label] of Object.entries(examples)) {
      expect(action in ACTIVITY, `${action} is a defined tag`).toBe(true);
      expect(activityMeta(action).label).toBe(label);
    }
  });
});

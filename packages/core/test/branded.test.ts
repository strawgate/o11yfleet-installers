import { describe, it, expect } from "vitest";
import {
  parseInstanceUID,
  randomInstanceUID,
  requireInstanceUID,
  parseGeoLatitude,
  parseGeoLongitude,
  parseBase64Url,
  makeExpiration,
  isExpired,
} from "../src/branded.js";

describe("InstanceUID", () => {
  it("accepts valid 32-char lowercase hex", () => {
    expect(parseInstanceUID("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6")).toBe(
      "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    );
  });

  it("normalizes uppercase to lowercase", () => {
    expect(parseInstanceUID("A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6")).toBe(
      "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    );
  });

  it("rejects dashed UUIDs", () => {
    expect(parseInstanceUID("a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6")).toBeNull();
  });

  it("rejects too-short strings", () => {
    expect(parseInstanceUID("a1b2c3")).toBeNull();
  });

  it("rejects too-long strings", () => {
    expect(parseInstanceUID("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d600")).toBeNull();
  });

  it("rejects non-hex characters", () => {
    expect(parseInstanceUID("g1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(parseInstanceUID("")).toBeNull();
  });

  it("randomInstanceUID produces valid UIDs", () => {
    const uid = randomInstanceUID();
    expect(uid).toMatch(/^[0-9a-f]{32}$/);
    expect(parseInstanceUID(uid)).toBe(uid);
  });

  it("randomInstanceUID produces unique values", () => {
    const uids = new Set(Array.from({ length: 100 }, () => randomInstanceUID()));
    expect(uids.size).toBe(100);
  });

  it("requireInstanceUID throws on invalid input", () => {
    expect(() => requireInstanceUID("bad")).toThrow(TypeError);
    expect(() => requireInstanceUID("bad", "test context")).toThrow("test context");
  });

  it("requireInstanceUID returns branded value for valid input", () => {
    const uid = requireInstanceUID("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
    expect(uid).toBe("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
  });
});

describe("GeoLatitude", () => {
  it("accepts valid latitudes", () => {
    expect(parseGeoLatitude(0)).toBe(0);
    expect(parseGeoLatitude(90)).toBe(90);
    expect(parseGeoLatitude(-90)).toBe(-90);
    expect(parseGeoLatitude(47.6062)).toBe(47.6062);
  });

  it("accepts string numbers", () => {
    expect(parseGeoLatitude("47.6062")).toBe(47.6062);
  });

  it("rejects NaN", () => {
    expect(parseGeoLatitude(NaN)).toBeNull();
    expect(parseGeoLatitude("not-a-number")).toBeNull();
  });

  it("rejects Infinity", () => {
    expect(parseGeoLatitude(Infinity)).toBeNull();
    expect(parseGeoLatitude(-Infinity)).toBeNull();
  });

  it("rejects out-of-range", () => {
    expect(parseGeoLatitude(91)).toBeNull();
    expect(parseGeoLatitude(-91)).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(parseGeoLatitude(null)).toBeNull();
    expect(parseGeoLatitude(undefined)).toBeNull();
  });
});

describe("GeoLongitude", () => {
  it("accepts valid longitudes", () => {
    expect(parseGeoLongitude(0)).toBe(0);
    expect(parseGeoLongitude(180)).toBe(180);
    expect(parseGeoLongitude(-180)).toBe(-180);
    expect(parseGeoLongitude(-122.3321)).toBe(-122.3321);
  });

  it("rejects NaN", () => {
    expect(parseGeoLongitude(NaN)).toBeNull();
    expect(parseGeoLongitude("not-a-number")).toBeNull();
  });

  it("rejects out-of-range", () => {
    expect(parseGeoLongitude(181)).toBeNull();
    expect(parseGeoLongitude(-181)).toBeNull();
  });
});

describe("Base64Url", () => {
  it("accepts valid base64url", () => {
    expect(parseBase64Url("SGVsbG8")).toBe("SGVsbG8");
    expect(parseBase64Url("abc-def_ghi")).toBe("abc-def_ghi");
    expect(parseBase64Url("")).toBe(""); // empty is valid
  });

  it("rejects standard base64 characters", () => {
    expect(parseBase64Url("abc+def")).toBeNull(); // + not allowed
    expect(parseBase64Url("abc/def")).toBeNull(); // / not allowed
    expect(parseBase64Url("abc=")).toBeNull(); // padding not allowed
  });
});

describe("ExpirationSec", () => {
  it("makeExpiration(0) returns 0 (no expiry)", () => {
    expect(makeExpiration(0)).toBe(0);
  });

  it("makeExpiration() returns 0 (no expiry)", () => {
    expect(makeExpiration()).toBe(0);
  });

  it("makeExpiration with positive seconds returns future timestamp", () => {
    const now = Math.floor(Date.now() / 1000);
    const exp = makeExpiration(3600);
    expect(exp).toBeGreaterThanOrEqual(now + 3599);
    expect(exp).toBeLessThanOrEqual(now + 3601);
  });

  it("isExpired returns false for 0 (no expiry)", () => {
    expect(isExpired(0)).toBe(false);
  });

  it("isExpired returns true for past timestamps", () => {
    expect(isExpired(1000000000)).toBe(true); // 2001
  });

  it("isExpired returns false for future timestamps", () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    expect(isExpired(future)).toBe(false);
  });

  it("makeExpiration with negative seconds returns 0", () => {
    expect(makeExpiration(-100)).toBe(0);
  });
});

// Differential testing — round-trip every opamp-go fixture through our codec.
//
// `tests/oracle/fixtures/*.bin` are protobuf wire bytes produced by the
// canonical opamp-go reference implementation. The existing oracle.test.ts
// asserts that *decoding* each fixture produces the expected fields. This
// file adds the complementary direction:
//
//   1. Decode the Go-produced bytes with our decoder → internal repr A.
//   2. Re-encode A with our encoder → bytes B.
//   3. Decode B with our decoder → internal repr C.
//   4. Assert A ≡ C (deep semantic equality).
//
// This catches a class of bugs the original oracle test can't:
//   - Fields that decode but get lost on re-encode.
//   - Fields that encode-only, where the absent decoder would surface as
//     A.f = X but C.f = undefined (the connection_settings bug shape).
//   - Type-coercion drift between encoder and decoder for the same field.
//
// We don't expect bytes(A) === bytes(input) — proto3 leaves room for the
// encoder to emit fields in different orders or skip default values, so
// byte-equality is too strong. Round-tripping the *internal* shape is the
// right invariant.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  decodeAgentToServerProto,
  encodeAgentToServerProto,
  isProtobufFrame,
} from "../src/codec/protobuf.js";
import type { AgentToServer } from "../src/codec/types.js";

const FIXTURE_DIR = resolve(__dirname, "../../../tests/oracle/fixtures");

function loadBinaryFixtures(): Array<{ name: string; bytes: ArrayBuffer }> {
  if (!existsSync(FIXTURE_DIR)) return [];
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".bin"))
    .map((f) => {
      const buf = readFileSync(join(FIXTURE_DIR, f));
      return {
        name: f.replace(/\.bin$/, ""),
        bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      };
    });
}

describe("Differential: opamp-go fixtures round-trip through our codec", () => {
  const fixtures = loadBinaryFixtures();

  // If fixtures aren't present (Go toolchain not installed and `go run`
  // hasn't generated them), skip rather than fail. The existing
  // oracle.test.ts has the `beforeAll` that triggers regeneration when Go
  // is available.
  if (fixtures.length === 0) {
    it.skip("no opamp-go fixtures present — skipping (run `cd tests/oracle && go run .`)", () => {
      // intentionally empty
    });
    return;
  }

  it("every fixture is recognized as a protobuf frame", () => {
    for (const fx of fixtures) {
      expect(isProtobufFrame(fx.bytes), `fixture ${fx.name}`).toBe(true);
    }
  });

  it("decode → re-encode → decode preserves the internal representation", () => {
    for (const fx of fixtures) {
      const a = decodeAgentToServerProto(fx.bytes);
      const reEncoded = encodeAgentToServerProto(a);
      const c = decodeAgentToServerProto(reEncoded);
      // semanticEqual handles Uint8Array fields (which deep-equal can be picky about).
      expect(semanticEqual(a, c), `fixture ${fx.name}: round-trip diverged`).toBe(true);
    }
  });

  it("re-encoded bytes also decode to the same shape (idempotent re-encode)", () => {
    for (const fx of fixtures) {
      const a = decodeAgentToServerProto(fx.bytes);
      const b1 = encodeAgentToServerProto(a);
      const b2 = encodeAgentToServerProto(decodeAgentToServerProto(b1));
      const a1 = new Uint8Array(b1);
      const a2 = new Uint8Array(b2);
      expect(a1.length, `fixture ${fx.name}: re-encode size diverged`).toBe(a2.length);
      for (let i = 0; i < a1.length; i += 1) {
        if (a1[i] !== a2[i]) {
          throw new Error(`fixture ${fx.name}: re-encode bytes diverged at index ${i}`);
        }
      }
    }
  });
});

// ─── deep equality, with explicit Uint8Array handling ──────────────────
//
// We use a custom canonicalizer + JSON.stringify rather than `expect.toEqual`
// because:
//   - Uint8Array equality via `toEqual` is finicky across vitest versions
//   - bigint isn't JSON-serializable; we tag-and-stringify it
//   - we want undefined and null to compare as DIFFERENT (proto3 absent vs
//     explicit null carry different intent in our internal types)
//
// Non-trivial cases canonicalize handles:
//   - Uint8Array → tagged array of bytes
//   - bigint     → tagged decimal string
//   - undefined  → distinct sentinel from null
//   - Map / Set  → not used by AgentToServer, but explicitly rejected so
//                  silent corruption can't slip in if the type evolves.

function semanticEqual(a: AgentToServer, b: AgentToServer): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

function canonicalize(value: unknown): unknown {
  if (value === undefined) return { __undefined: true };
  if (value === null) return null;
  if (value instanceof Uint8Array) return { __u8: Array.from(value) };
  if (typeof value === "bigint") return { __bigint: value.toString() };
  if (value instanceof Map || value instanceof Set || value instanceof Date) {
    throw new Error(`canonicalize: unsupported type ${value.constructor.name} — extend the helper`);
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonicalize((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

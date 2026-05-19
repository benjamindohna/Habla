import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  describeLevelForPrompt,
  describeLevelScaleCompact,
  getLevelRange,
} from "../lib/levels";
import type { TargetLanguageSpec } from "../lib/targetLanguage";

const SPANISH: TargetLanguageSpec = { language: "Spanish", location: "castellano", style: "everyday" };
const FRENCH: TargetLanguageSpec = { language: "French", location: null, style: "everyday" };
const UNKNOWN: TargetLanguageSpec = { language: "Klingon", location: null, style: "everyday" };

// ── getLevelRange — boundaries ────────────────────────────────────────────

describe("getLevelRange — boundaries", () => {
  it("level 1 returns the first range (Pre-A1)", () => {
    const r = getLevelRange(1, SPANISH);
    assert.equal(r.min, 1);
    assert.equal(r.max, 5);
    assert.equal(r.cefr, "Pre-A1");
  });

  it("level 5 still in the first range", () => {
    const r = getLevelRange(5, SPANISH);
    assert.equal(r.cefr, "Pre-A1");
  });

  it("level 6 crosses into A1 early", () => {
    const r = getLevelRange(6, SPANISH);
    assert.equal(r.cefr, "A1 early");
  });

  it("level 100 returns the last range", () => {
    const r = getLevelRange(100, SPANISH);
    assert.equal(r.min, 96);
    assert.equal(r.max, 100);
  });

  it("level 0 clamps to the first range", () => {
    const r = getLevelRange(0, SPANISH);
    assert.equal(r.cefr, "Pre-A1");
  });

  it("negative level clamps to the first range", () => {
    const r = getLevelRange(-50, SPANISH);
    assert.equal(r.cefr, "Pre-A1");
  });

  it("level above 100 clamps to the last range", () => {
    const r = getLevelRange(150, SPANISH);
    assert.equal(r.min, 96);
  });
});

// ── per-language selection ────────────────────────────────────────────────

describe("getLevelRange — per-language", () => {
  it("Spanish ranges include Spanish examples", () => {
    const r = getLevelRange(1, SPANISH);
    // Pre-A1 examples should include greetings + name introduction in Spanish.
    assert.ok(r.examples.some((e) => /hola|gracias|me llamo/i.test(e)),
      `expected Spanish examples, got: ${r.examples.join(", ")}`);
  });

  it("French ranges include French examples", () => {
    const r = getLevelRange(1, FRENCH);
    assert.ok(r.examples.some((e) => /bonjour|merci|je m'appelle/i.test(e)),
      `expected French examples, got: ${r.examples.join(", ")}`);
  });

  it("Spanish and French ranges have the same min/max boundaries (parallel scale)", () => {
    for (let level = 1; level <= 100; level += 10) {
      const sp = getLevelRange(level, SPANISH);
      const fr = getLevelRange(level, FRENCH);
      assert.equal(sp.min, fr.min, `level ${level} min mismatch`);
      assert.equal(sp.max, fr.max, `level ${level} max mismatch`);
      assert.equal(sp.cefr, fr.cefr, `level ${level} cefr mismatch`);
    }
  });

  it("French passé composé replaces Spanish pretérito at A1 late", () => {
    const fr = getLevelRange(13, FRENCH);
    assert.ok(/passé composé/.test(fr.description),
      `expected 'passé composé' in description, got: ${fr.description}`);
    const sp = getLevelRange(13, SPANISH);
    assert.ok(/pretérito/.test(sp.description),
      `expected 'pretérito' in Spanish description, got: ${sp.description}`);
  });

  it("French subjonctif replaces Spanish subjuntivo at B1 mid", () => {
    const fr = getLevelRange(33, FRENCH);
    assert.ok(/subjonctif/i.test(fr.description));
    const sp = getLevelRange(33, SPANISH);
    assert.ok(/subjuntivo/i.test(sp.description));
  });

  it("falls back to Spanish for unknown languages", () => {
    const u = getLevelRange(1, UNKNOWN);
    const sp = getLevelRange(1, SPANISH);
    assert.deepEqual(u.examples, sp.examples);
  });
});

// ── describeLevelForPrompt ────────────────────────────────────────────────

describe("describeLevelForPrompt", () => {
  it("includes level number, range, CEFR anchor, examples", () => {
    const out = describeLevelForPrompt(12, SPANISH);
    assert.match(out, /Learner level: 12\/100/);
    assert.match(out, /Range 11-15/);
    assert.match(out, /CEFR A1 late/);
    assert.match(out, /Examples at this level:/);
  });

  it("uses Spanish examples for Spanish target", () => {
    const out = describeLevelForPrompt(1, SPANISH);
    assert.match(out, /hola|gracias|me llamo/i);
  });

  it("uses French examples for French target", () => {
    const out = describeLevelForPrompt(1, FRENCH);
    assert.match(out, /bonjour|merci|je m'appelle/i);
  });

  it("emits the STRICT style guidance band for level ≤ 15", () => {
    const out = describeLevelForPrompt(5, SPANISH);
    assert.match(out, /STYLE GUIDANCE/);
    assert.match(out, /early stages of learning the language/);
  });

  it("emits the consolidating-basics band for 16-30", () => {
    const out = describeLevelForPrompt(22, SPANISH);
    assert.match(out, /still consolidating basics/);
  });

  it("emits the relaxed band for 51+", () => {
    const out = describeLevelForPrompt(70, SPANISH);
    assert.match(out, /Length as the moment calls for/);
  });

  it("includes the 'aim slightly above' instruction with the right ceiling", () => {
    const out = describeLevelForPrompt(12, SPANISH);
    // Range 11-15, max+5 = 20
    assert.match(out, /Stay within ~20 on the 100-point scale/);
  });
});

// ── describeLevelScaleCompact ─────────────────────────────────────────────

describe("describeLevelScaleCompact", () => {
  it("renders 20 lines for the scale", () => {
    const out = describeLevelScaleCompact(SPANISH);
    assert.equal(out.split("\n").length, 20);
  });

  it("differs between Spanish and French (grammar references)", () => {
    const sp = describeLevelScaleCompact(SPANISH);
    const fr = describeLevelScaleCompact(FRENCH);
    assert.notEqual(sp, fr, "Spanish and French scale compacts should differ");
  });
});

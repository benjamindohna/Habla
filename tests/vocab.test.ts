import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import {
  canonicalizeVocab,
  normalizeVocab,
  type CasingClassifier,
  type CasingDecision,
} from "../lib/vocab";

// ── normalizeVocab ────────────────────────────────────────────────────────

describe("normalizeVocab", () => {
  it("trims surrounding whitespace", () => {
    assert.equal(normalizeVocab("  hola  "), "hola");
  });

  it("collapses internal whitespace", () => {
    assert.equal(normalizeVocab("buenos    dias"), "buenos dias");
  });

  it("strips leading and trailing punctuation (Unicode-aware)", () => {
    assert.equal(normalizeVocab("¿hola?"), "hola");
    assert.equal(normalizeVocab("¡adiós!"), "adiós");
    assert.equal(normalizeVocab("«palabra»"), "palabra");
    assert.equal(normalizeVocab("hola,"), "hola");
  });

  it("applies NFC composition (combining marks become single code-points)", () => {
    // "e" + U+0301 (combining acute) → "é"
    const decomposed = "é";
    const composed = normalizeVocab(decomposed, true);
    assert.equal(composed, "é");
    assert.equal(composed.length, 1);
  });

  it("preserves diacritics — sí and si stay distinct", () => {
    assert.equal(normalizeVocab("sí"), "sí");
    assert.equal(normalizeVocab("si"), "si");
    assert.notEqual(normalizeVocab("sí"), normalizeVocab("si"));
  });

  it("does NOT lemmatise — comió stays comió", () => {
    assert.equal(normalizeVocab("comió"), "comió");
  });

  it("respects caseSensitive flag", () => {
    assert.equal(normalizeVocab("Hola", true), "Hola");
    assert.equal(normalizeVocab("Hola", false), "hola");
  });

  it("default is caseSensitive=false (lowercases)", () => {
    assert.equal(normalizeVocab("HOLA"), "hola");
  });
});

// ── canonicalizeVocab — the 6 worked examples from ROADMAP §1 ────────────

/**
 * Stub classifier that returns hard-coded answers per call. Tests pre-load
 * the responses and assert that the pipeline asks for exactly the
 * expected ones (no Phase A call when both sides are lowercase, no
 * Phase B call when only one side is "always").
 */
function stubClassifier(setup: {
  casing?: Record<string, CasingDecision>;
  properNoun?: Record<string, boolean>;
}): CasingClassifier & {
  casingCalls: number;
  properNounCalls: number;
} {
  const casingCalls = mock.fn(async (args: { word: string }): Promise<CasingDecision> => {
    const decision = setup.casing?.[args.word];
    if (!decision) throw new Error(`unexpected casing call for word="${args.word}"`);
    return decision;
  });
  const properNounCalls = mock.fn(async (args: { target: string; native: string }) => {
    const key = `${args.target}|${args.native}`;
    const v = setup.properNoun?.[key];
    if (v === undefined) throw new Error(`unexpected isProperNoun call for "${key}"`);
    return v;
  });
  return {
    classifyCasing: casingCalls as unknown as CasingClassifier["classifyCasing"],
    isProperNoun: properNounCalls as unknown as CasingClassifier["isProperNoun"],
    get casingCalls() {
      return casingCalls.mock.callCount();
    },
    get properNounCalls() {
      return properNounCalls.mock.callCount();
    },
  };
}

describe("canonicalizeVocab — Phase 0 fast path", () => {
  it("both lowercase → save lowercased, no LLM calls", async () => {
    const c = stubClassifier({});
    const result = await canonicalizeVocab("comer", "essen", c);
    assert.deepEqual(result, { kind: "save", target: "comer", native: "essen" });
    assert.equal(c.casingCalls, 0);
    assert.equal(c.properNounCalls, 0);
  });
});

describe("canonicalizeVocab — Phase A only (one side uppercase)", () => {
  it("'Comer (sentence-start)' / 'essen' → save lowercased, no Phase B", async () => {
    const c = stubClassifier({ casing: { Comer: "incidental" } });
    const result = await canonicalizeVocab("Comer", "essen", c);
    assert.deepEqual(result, { kind: "save", target: "comer", native: "essen" });
    assert.equal(c.casingCalls, 1);
    assert.equal(c.properNounCalls, 0);
  });

  it("'comer' / 'Essen (sentence-start)' → save lowercased, no Phase B", async () => {
    const c = stubClassifier({ casing: { Essen: "incidental" } });
    const result = await canonicalizeVocab("comer", "Essen", c);
    assert.deepEqual(result, { kind: "save", target: "comer", native: "essen" });
    assert.equal(c.casingCalls, 1);
    assert.equal(c.properNounCalls, 0);
  });

  it("'lluvia' / 'Regen' (German noun, always uppercase) → keep native case, no Phase B", async () => {
    const c = stubClassifier({ casing: { Regen: "always" } });
    const result = await canonicalizeVocab("lluvia", "Regen", c);
    assert.deepEqual(result, { kind: "save", target: "lluvia", native: "Regen" });
    assert.equal(c.casingCalls, 1);
    assert.equal(c.properNounCalls, 0);
  });
});

describe("canonicalizeVocab — Phase B (both sides always uppercase)", () => {
  it("'Madrid' / 'Madrid' (proper noun, same form) → SKIP", async () => {
    const c = stubClassifier({
      casing: { Madrid: "always" },
      properNoun: { "Madrid|Madrid": true },
    });
    const result = await canonicalizeVocab("Madrid", "Madrid", c);
    assert.deepEqual(result, { kind: "skip", reason: "same-form-proper-noun" });
    assert.equal(c.casingCalls, 2);
    assert.equal(c.properNounCalls, 1);
  });

  it("'Roma' / 'Rom' (proper noun, different forms) → save with original case", async () => {
    const c = stubClassifier({
      casing: { Roma: "always", Rom: "always" },
      properNoun: { "Roma|Rom": true },
    });
    const result = await canonicalizeVocab("Roma", "Rom", c);
    assert.deepEqual(result, { kind: "save", target: "Roma", native: "Rom" });
    assert.equal(c.casingCalls, 2);
    assert.equal(c.properNounCalls, 1);
  });

  it("both 'always' but NOT a proper noun (e.g. two German nouns aligned) → save with original case", async () => {
    // Hypothetical: both sides happen to start uppercase due to language
    // rules but the LLM determines this is not a proper noun. ROADMAP says
    // we save with the Phase A casings.
    const c = stubClassifier({
      casing: { Haus: "always", Casa: "always" },
      properNoun: { "Haus|Casa": false },
    });
    const result = await canonicalizeVocab("Haus", "Casa", c);
    assert.deepEqual(result, { kind: "save", target: "Haus", native: "Casa" });
    assert.equal(c.casingCalls, 2);
    assert.equal(c.properNounCalls, 1);
  });
});

describe("canonicalizeVocab — input is normalised before classification", () => {
  it("'  ¿Madrid? ' / 'Madrid' is normalised to 'Madrid' before LLM call", async () => {
    const c = stubClassifier({
      casing: { Madrid: "always" },
      properNoun: { "Madrid|Madrid": true },
    });
    const result = await canonicalizeVocab("  ¿Madrid? ", "Madrid", c);
    assert.deepEqual(result, { kind: "skip", reason: "same-form-proper-noun" });
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  INITIAL_TARGET_SEED,
  describeTargetLanguage,
  parseTargetLanguageSpec,
  type TargetLanguageSpec,
} from "../lib/targetLanguage";

// ── parseTargetLanguageSpec ───────────────────────────────────────────────

describe("parseTargetLanguageSpec", () => {
  it("returns INITIAL_TARGET_SEED for null", () => {
    assert.deepEqual(parseTargetLanguageSpec(null), INITIAL_TARGET_SEED);
  });

  it("returns INITIAL_TARGET_SEED for undefined", () => {
    assert.deepEqual(parseTargetLanguageSpec(undefined), INITIAL_TARGET_SEED);
  });

  it("returns INITIAL_TARGET_SEED for empty string", () => {
    assert.deepEqual(parseTargetLanguageSpec(""), INITIAL_TARGET_SEED);
  });

  it("returns INITIAL_TARGET_SEED for malformed JSON", () => {
    assert.deepEqual(parseTargetLanguageSpec("{not valid json}"), INITIAL_TARGET_SEED);
    assert.deepEqual(parseTargetLanguageSpec("[]"), INITIAL_TARGET_SEED); // array, not object
  });

  it("parses a valid Spanish Castellano spec", () => {
    const raw = JSON.stringify({ language: "Spanish", location: "castellano", style: "everyday" });
    assert.deepEqual(parseTargetLanguageSpec(raw), {
      language: "Spanish",
      location: "castellano",
      style: "everyday",
    });
  });

  it("parses a valid French spec with null location", () => {
    const raw = JSON.stringify({ language: "French", location: null, style: "everyday" });
    assert.deepEqual(parseTargetLanguageSpec(raw), {
      language: "French",
      location: null,
      style: "everyday",
    });
  });

  it("falls back when language field is missing", () => {
    const raw = JSON.stringify({ location: "castellano", style: "everyday" });
    assert.deepEqual(parseTargetLanguageSpec(raw), INITIAL_TARGET_SEED);
  });

  it("falls back when style is not in the enum", () => {
    const raw = JSON.stringify({ language: "Spanish", location: "castellano", style: "formal" });
    assert.deepEqual(parseTargetLanguageSpec(raw), INITIAL_TARGET_SEED);
  });

  it("falls back when language is not a string", () => {
    const raw = JSON.stringify({ language: 42, location: null, style: "everyday" });
    assert.deepEqual(parseTargetLanguageSpec(raw), INITIAL_TARGET_SEED);
  });

  it("treats undefined location as null", () => {
    const raw = JSON.stringify({ language: "French", style: "everyday" });
    const parsed = parseTargetLanguageSpec(raw);
    assert.equal(parsed.language, "French");
    assert.equal(parsed.location, null);
    assert.equal(parsed.style, "everyday");
  });

  it("preserves the street style", () => {
    const raw = JSON.stringify({ language: "Spanish", location: "latino", style: "street" });
    const parsed = parseTargetLanguageSpec(raw);
    assert.equal(parsed.style, "street");
  });

  it("preserves the office style", () => {
    const raw = JSON.stringify({ language: "French", location: null, style: "office" });
    const parsed = parseTargetLanguageSpec(raw);
    assert.equal(parsed.style, "office");
  });
});

// ── describeTargetLanguage ───────────────────────────────────────────────

describe("describeTargetLanguage", () => {
  it("renders Spanish Castellano with everyday style", () => {
    const spec: TargetLanguageSpec = { language: "Spanish", location: "castellano", style: "everyday" };
    assert.equal(describeTargetLanguage(spec), "everyday Castellano Spanish");
  });

  it("renders Spanish neutral", () => {
    const spec: TargetLanguageSpec = { language: "Spanish", location: "neutral", style: "everyday" };
    assert.equal(describeTargetLanguage(spec), "everyday neutral pan-regional Spanish");
  });

  it("renders Spanish Latin American", () => {
    const spec: TargetLanguageSpec = { language: "Spanish", location: "latino", style: "everyday" };
    assert.equal(describeTargetLanguage(spec), "everyday Latin American Spanish");
  });

  it("renders French without location", () => {
    const spec: TargetLanguageSpec = { language: "French", location: null, style: "everyday" };
    assert.equal(describeTargetLanguage(spec), "everyday French");
  });

  it("renders French metropolitan", () => {
    const spec: TargetLanguageSpec = { language: "French", location: "metropolitan", style: "everyday" };
    assert.equal(describeTargetLanguage(spec), "everyday metropolitan French");
  });

  it("renders Québécois", () => {
    const spec: TargetLanguageSpec = { language: "French", location: "canadian", style: "everyday" };
    assert.equal(describeTargetLanguage(spec), "everyday Québécois French");
  });

  it("renders street style", () => {
    const spec: TargetLanguageSpec = { language: "Spanish", location: "castellano", style: "street" };
    assert.equal(describeTargetLanguage(spec), "casual / youth Castellano Spanish");
  });

  it("renders office style", () => {
    const spec: TargetLanguageSpec = { language: "French", location: null, style: "office" };
    assert.equal(describeTargetLanguage(spec), "professional / office French");
  });

  it("falls back to the raw location key when the language has no table", () => {
    const spec: TargetLanguageSpec = { language: "Italian", location: "tuscan", style: "everyday" };
    assert.equal(describeTargetLanguage(spec), "everyday tuscan Italian");
  });

  it("omits location when null", () => {
    const spec: TargetLanguageSpec = { language: "Italian", location: null, style: "everyday" };
    assert.equal(describeTargetLanguage(spec), "everyday Italian");
  });
});

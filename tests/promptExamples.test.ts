import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getPromptExamples } from "../lib/promptExamples";
import type { TargetLanguageSpec } from "../lib/targetLanguage";

const SPANISH: TargetLanguageSpec = { language: "Spanish", location: "castellano", style: "everyday" };
const FRENCH: TargetLanguageSpec = { language: "French", location: null, style: "everyday" };
const UNKNOWN: TargetLanguageSpec = { language: "Klingon", location: null, style: "everyday" };

describe("getPromptExamples — Spanish", () => {
  const ex = getPromptExamples(SPANISH);

  it("includes the core greeting verbs", () => {
    assert.ok(ex.greetingVerbs.includes("hablar"));
    assert.ok(ex.greetingVerbs.includes("charlar"));
    assert.ok(ex.greetingVerbs.includes("conversar"));
  });

  it("greetingFrame renders the expected Spanish sentence", () => {
    assert.equal(ex.greetingFrame("charlar"), "Hola, ¿de qué quieres charlar hoy?");
  });

  it("articles enumerate Spanish definite + indefinite", () => {
    assert.deepEqual(ex.articles, ["el", "la", "los", "las", "un", "una", "unos", "unas"]);
  });
});

describe("getPromptExamples — French", () => {
  const ex = getPromptExamples(FRENCH);

  it("includes core French greeting verbs", () => {
    assert.ok(ex.greetingVerbs.includes("parler"));
    assert.ok(ex.greetingVerbs.includes("bavarder"));
    assert.ok(ex.greetingVerbs.includes("discuter"));
  });

  it("greetingFrame renders the expected French sentence", () => {
    assert.equal(ex.greetingFrame("papoter"), "Salut, de quoi veux-tu papoter aujourd'hui ?");
  });

  it("articles enumerate French determiners including elided l'", () => {
    assert.ok(ex.articles.includes("le"));
    assert.ok(ex.articles.includes("la"));
    assert.ok(ex.articles.includes("les"));
    assert.ok(ex.articles.includes("l'"));
    assert.ok(ex.articles.includes("un"));
    assert.ok(ex.articles.includes("une"));
    assert.ok(ex.articles.includes("des"));
  });
});

describe("getPromptExamples — unknown language", () => {
  it("falls back to Spanish examples", () => {
    const ex = getPromptExamples(UNKNOWN);
    const sp = getPromptExamples(SPANISH);
    assert.deepEqual(ex.greetingVerbs, sp.greetingVerbs);
    assert.deepEqual(ex.articles, sp.articles);
  });
});

describe("greetingVerb lists are non-overlapping registers", () => {
  it("Spanish list does not include French verbs", () => {
    const sp = getPromptExamples(SPANISH);
    assert.ok(!sp.greetingVerbs.includes("parler"));
    assert.ok(!sp.greetingVerbs.includes("bavarder"));
  });

  it("French list does not include Spanish verbs", () => {
    const fr = getPromptExamples(FRENCH);
    assert.ok(!fr.greetingVerbs.includes("hablar"));
    assert.ok(!fr.greetingVerbs.includes("charlar"));
  });
});

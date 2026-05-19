import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Install a fake window.localStorage before importing the module under
// test — the module reads window lazily inside its functions, so this
// works as long as the global is set by the time the function runs.
const fakeStorage: Record<string, string> = {};
(globalThis as unknown as { window?: unknown }).window = {
  localStorage: {
    getItem: (k: string) => (k in fakeStorage ? fakeStorage[k] : null),
    setItem: (k: string, v: string) => {
      fakeStorage[k] = v;
    },
  },
};

import { pickGreeting, pickGreetingVerb } from "../lib/greetingVerb";
import { getPromptExamples } from "../lib/promptExamples";
import type { TargetLanguageSpec } from "../lib/targetLanguage";

const SPANISH: TargetLanguageSpec = { language: "Spanish", location: "castellano", style: "everyday" };
const FRENCH: TargetLanguageSpec = { language: "French", location: null, style: "everyday" };

function clearStorage() {
  for (const k of Object.keys(fakeStorage)) delete fakeStorage[k];
}

describe("pickGreetingVerb — last-3 exclusion", () => {
  beforeEach(() => clearStorage());

  it("returns a verb from the Spanish pool", () => {
    const v = pickGreetingVerb(SPANISH);
    assert.ok(getPromptExamples(SPANISH).greetingVerbs.includes(v));
  });

  it("any 4-pick sliding window contains 4 unique verbs", () => {
    const seq: string[] = [];
    for (let i = 0; i < 20; i++) seq.push(pickGreetingVerb(SPANISH));
    for (let i = 0; i <= seq.length - 4; i++) {
      const window = seq.slice(i, i + 4);
      const unique = new Set(window).size;
      assert.equal(unique, 4, `collision in window starting at ${i}: ${window.join(", ")}`);
    }
  });

  it("persists state across calls (the next call sees prior picks as recent)", () => {
    const a = pickGreetingVerb(SPANISH);
    const b = pickGreetingVerb(SPANISH);
    const c = pickGreetingVerb(SPANISH);
    // a, b, c are now all in the "recent" window. Next pick must exclude them.
    const d = pickGreetingVerb(SPANISH);
    assert.notEqual(d, a);
    assert.notEqual(d, b);
    assert.notEqual(d, c);
  });
});

describe("pickGreetingVerb — per-language isolation", () => {
  beforeEach(() => clearStorage());

  it("French picks are stored under a separate localStorage key", () => {
    pickGreetingVerb(SPANISH);
    pickGreetingVerb(SPANISH);
    pickGreetingVerb(SPANISH);
    // Spanish key is populated; French should be untouched.
    assert.ok(fakeStorage["greetingVerbRecent:Spanish"] !== undefined);
    assert.equal(fakeStorage["greetingVerbRecent:French"], undefined);

    pickGreetingVerb(FRENCH);
    assert.ok(fakeStorage["greetingVerbRecent:French"] !== undefined);
  });

  it("returns French verbs only when called with French spec", () => {
    for (let i = 0; i < 5; i++) {
      const v = pickGreetingVerb(FRENCH);
      assert.ok(getPromptExamples(FRENCH).greetingVerbs.includes(v),
        `expected French verb, got ${v}`);
      assert.ok(!getPromptExamples(SPANISH).greetingVerbs.includes(v),
        `Spanish verb leaked into French pick: ${v}`);
    }
  });
});

describe("pickGreeting — full sentence", () => {
  beforeEach(() => clearStorage());

  it("Spanish renders the expected frame", () => {
    const { verb, sentence } = pickGreeting(SPANISH);
    assert.equal(sentence, `Hola, ¿de qué quieres ${verb} hoy?`);
  });

  it("French renders the expected frame", () => {
    const { verb, sentence } = pickGreeting(FRENCH);
    assert.equal(sentence, `Salut, de quoi veux-tu ${verb} aujourd'hui ?`);
  });
});

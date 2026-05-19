// In-memory DB test. Sets DATABASE_PATH before any DB module loads so
// every helper picks up the temp DB. node:test runs each file in a
// fresh process, so the env mutation does not leak to other tests.

process.env.DATABASE_PATH = ":memory:";

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { getDb } from "../lib/db";
import { upsertUser, type User } from "../lib/users";
import {
  appendMessage,
  createConversation,
  deleteConversationIfEmpty,
  getConversation,
  getRecentConversations,
  updateConversationTopic,
} from "../lib/conversations";

let user: User;

before(() => {
  // Force migrations to run on the fresh :memory: DB.
  getDb();
  user = upsertUser({
    email: "test@habla.app",
    passwordHash: "x",
    nativeLanguage: "German",
  });
});

beforeEach(() => {
  // Wipe conversations + messages between tests for isolation.
  const db = getDb();
  db.exec("DELETE FROM messages");
  db.exec("DELETE FROM conversations");
});

// ── createConversation + retrieval round-trip ─────────────────────────────

describe("createConversation", () => {
  it("returns an id that getConversation can resolve", () => {
    const id = createConversation(user.id, "Test Topic");
    const row = getConversation(id);
    assert.ok(row);
    assert.equal(row?.user_id, user.id);
    assert.equal(row?.topic, "Test Topic");
  });

  it("accepts empty topic (empty-chat path)", () => {
    const id = createConversation(user.id, "");
    const row = getConversation(id);
    assert.equal(row?.topic, "");
  });
});

// ── updateConversationTopic ───────────────────────────────────────────────

describe("updateConversationTopic", () => {
  it("overwrites the topic", () => {
    const id = createConversation(user.id, "");
    updateConversationTopic(id, "Resolved Topic");
    assert.equal(getConversation(id)?.topic, "Resolved Topic");
  });
});

// ── deleteConversationIfEmpty ─────────────────────────────────────────────

describe("deleteConversationIfEmpty", () => {
  it("deletes when conversation has zero messages", () => {
    const id = createConversation(user.id, "");
    const deleted = deleteConversationIfEmpty(user.id, id);
    assert.equal(deleted, true);
    assert.equal(getConversation(id), null);
  });

  it("refuses to delete when at least one message exists", () => {
    const id = createConversation(user.id, "");
    appendMessage({ conversationId: id, role: "ai", textTarget: "Hola, ¿de qué hablamos?" });
    const deleted = deleteConversationIfEmpty(user.id, id);
    assert.equal(deleted, false);
    assert.ok(getConversation(id), "conversation should still exist");
  });

  it("refuses to delete a conversation that belongs to another user", () => {
    const other = upsertUser({ email: "other@habla.app", passwordHash: "x", nativeLanguage: "German" });
    const id = createConversation(other.id, "");
    const deleted = deleteConversationIfEmpty(user.id, id);
    assert.equal(deleted, false);
    assert.ok(getConversation(id));
  });

  it("returns false for non-existent id", () => {
    assert.equal(deleteConversationIfEmpty(user.id, 99999), false);
  });
});

// ── getRecentConversations ────────────────────────────────────────────────

describe("getRecentConversations", () => {
  it("returns nothing when only empty conversations exist", () => {
    createConversation(user.id, "Empty 1");
    createConversation(user.id, "Empty 2");
    const recents = getRecentConversations(user.id, 10);
    assert.equal(recents.length, 0);
  });

  it("filters out conversations with zero messages", () => {
    const idEmpty = createConversation(user.id, "Empty");
    const idFull = createConversation(user.id, "Full");
    appendMessage({ conversationId: idFull, role: "ai", textTarget: "Hola." });

    const recents = getRecentConversations(user.id, 10);
    assert.equal(recents.length, 1);
    assert.equal(recents[0].id, idFull);
    // Defensive: the empty one really did exist (so the filter is the reason it's gone).
    assert.ok(getConversation(idEmpty));
  });

  it("orders by most recent message timestamp", async () => {
    const idA = createConversation(user.id, "A");
    const idB = createConversation(user.id, "B");
    // Append a message to A first, then B — B should sort before A.
    appendMessage({ conversationId: idA, role: "ai", textTarget: "first" });
    await new Promise((r) => setTimeout(r, 1100)); // SQLite created_at is whole-second; force gap
    appendMessage({ conversationId: idB, role: "ai", textTarget: "second" });

    const recents = getRecentConversations(user.id, 10);
    assert.equal(recents.length, 2);
    assert.equal(recents[0].id, idB);
    assert.equal(recents[1].id, idA);
  });

  it("respects the limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      const id = createConversation(user.id, `Topic ${i}`);
      appendMessage({ conversationId: id, role: "ai", textTarget: `msg ${i}` });
    }
    const recents = getRecentConversations(user.id, 3);
    assert.equal(recents.length, 3);
  });

  it("scopes to userId", () => {
    const other = upsertUser({ email: "other2@habla.app", passwordHash: "x", nativeLanguage: "German" });
    const idMine = createConversation(user.id, "Mine");
    const idTheirs = createConversation(other.id, "Theirs");
    appendMessage({ conversationId: idMine, role: "ai", textTarget: "x" });
    appendMessage({ conversationId: idTheirs, role: "ai", textTarget: "x" });

    const mine = getRecentConversations(user.id, 10);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].id, idMine);
  });

  it("reports message count", () => {
    const id = createConversation(user.id, "Counted");
    appendMessage({ conversationId: id, role: "ai", textTarget: "1" });
    appendMessage({ conversationId: id, role: "user", textTarget: "2" });
    appendMessage({ conversationId: id, role: "ai", textTarget: "3" });

    const recents = getRecentConversations(user.id, 10);
    assert.equal(recents[0].messageCount, 3);
  });
});

// ── targetLanguage round-trip via DB ──────────────────────────────────────

describe("user targetLanguage round-trip", () => {
  it("survives DB write/read with full spec", () => {
    const fr = upsertUser({
      email: "fr@habla.app",
      passwordHash: "x",
      nativeLanguage: "German",
      targetLanguage: { language: "French", location: null, style: "everyday" },
    });
    assert.equal(fr.targetLanguage.language, "French");
    assert.equal(fr.targetLanguage.location, null);
    assert.equal(fr.targetLanguage.style, "everyday");
  });

  it("falls back to the seed when no spec provided", () => {
    const spDefault = upsertUser({
      email: "spdefault@habla.app",
      passwordHash: "x",
      nativeLanguage: "German",
    });
    assert.equal(spDefault.targetLanguage.language, "Spanish");
    assert.equal(spDefault.targetLanguage.location, "castellano");
    assert.equal(spDefault.targetLanguage.style, "everyday");
  });
});

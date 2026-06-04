// Shared word-tokeniser regex. Lives in its own file (rather than as a
// re-export from aiBubblePipeline.ts) because both client components
// (AIBubble.tsx, playground/on-tap) and server-side helpers (vocab.ts,
// aiBubblePipeline.ts) need it. Hosting it in aiBubblePipeline forces
// the client bundle to evaluate that whole module, which transitively
// pulls lib/llm.ts → lib/db.ts → postgres, none of which is bundle-able
// for the browser. This file has zero dependencies and is safe from
// anywhere.

// Unicode-letter "word" — letters + combining marks + apostrophe/hyphen.
export const WORD_REGEX = /[\p{L}][\p{L}\p{M}'-]*/gu;

# Cost & Self-Hosting Analysis

Snapshot of current per-call cost and the realistic options to replace each LLM/audio touchpoint with a self-hosted or device-local alternative. Not for immediate implementation — recorded so we can come back to it once usage scales.

---

## Current cost ranking (per call)

| # | Call | Model | ~$/call | When it fires |
|---|---|---|---|---|
| 1 | **TTS** (per bubble) | gpt-4o-mini-tts | **$0.0015** | every AI + user bubble (Auto-Read on: all preloaded) |
| 2 | **Whisper** | whisper-1 | **$0.0010** | every user recording |
| 3 | **Localize** | gpt-4o | **$0.0009** | every user turn |
| 4 | Segment V2 | gpt-4o-mini | $0.00034 | every user turn |
| 5 | Vocab-Ranking (bulk-sort) | gpt-4o-mini | $0.00026 | every save during ≤15-word bulk phase |
| 6 | Translate-word-in-context | gpt-4o-mini | $0.00026 | every first tap on a word in an AI bubble |
| 7 | Converse (start / turn) | gpt-4o-mini | $0.00024 | every AI message generation |
| 8 | Topic-Generation | gpt-4o-mini | $0.00021 | per re-roll or background preload |
| 9 | Interest-Extraction | gpt-4o-mini | $0.00021 | when user clicks Back on a chat |
| 10 | Explain V2 | gpt-4o-mini | $0.00012 | per tap on a mismatch segment |
| 11 | Interpret | gpt-4o-mini | $0.00009 | every user turn |
| 12 | Vocab-Description | gpt-4o-mini | $0.000044 | every save |
| 13 | Vocab-Comparator | gpt-4o-mini | $0.000032 | save collision (rare) |
| 14 | Vocab-Binary-Insert | gpt-4o-mini | $0.000033 × 3-5 | save during binary-phase >15 |
| 15 | Vocab-Judge (planned) | gpt-4o-mini | $0.000018 | per vocab review answer |

## Per-typical-turn breakdown

A user turn is: 1 audio recording → AI reply → ~3 word taps → ~1 explain → 1 done.

| Share | Component | Per-turn $ |
|---|---|---|
| ~41% | TTS (AI + user preload) | $0.003 |
| ~14% | Whisper | $0.001 |
| ~12% | Localize (gpt-4o) | $0.0009 |
| ~11% | Translate-word (3 taps) | $0.00078 |
| ~11% | Vocab-Ranking (3 saves) | $0.00078 |
| ~12% | Everything else | $0.00086 |
| **Total** | | **~$0.0073** |

Per active user (10 turns/day): **~$2.20/month**.
Per heavy user (30 turns/day): **~$6.50/month**.

TTS is today's dominant line item — and also the easiest to replace.

---

## Self-host feasibility per touchpoint

Open-source / self-host alternatives at three levels:

- **Server-self-host** = run your own model on a GPU server. Zero per-call cost, ~$50-200/month server.
- **Browser-device-local** = the model runs on the user's machine via WebGPU / WASM. Zero infra cost, but model download (~75-200MB) and slower on weak devices.
- **Native-device** = iOS / macOS / Android built-in APIs.

| Touchpoint | Self-host quality | Device-local? | Notes |
|---|---|---|---|
| **Whisper** | ✅ excellent (whisper.cpp / faster-whisper) | ✅ whisper.wasm in browser, native iOS/macOS speech APIs | Mature ecosystem, no quality compromise |
| **TTS** | ✅ Piper / Coqui XTTS on server | ✅ Web Speech API (browser, free), AVSpeechSynthesizer (iOS), `say` (macOS) | Quality drop noticeable but acceptable for learning |
| **Vocab-Comparator** | ✅ trivial — even a 3B model handles it | ✅ feasible | Pure semantic comparison, single-token output |
| **Vocab-Judge** | ✅ trivial | ✅ feasible | Same |
| **Vocab-Description** | ✅ doable, 7B+ | ⚠️ feasible but consistency-property loosens | "Same sense → identical description" property is harder for smaller models |
| **Vocab-Ranking** | ✅ doable, 7B+ multilingual | ⚠️ feasible | Needs Spanish-frequency knowledge |
| **Topic-Generation** | ✅ doable, 7B+ | ⚠️ feasible but quality drop on creativity | |
| **Interest-Extraction** | ✅ doable, 7B+ | ⚠️ feasible | JSON-output reliability matters |
| **Explain V2** | ✅ doable, 7B+ multilingual | ⚠️ feasible | Pure prose generation in native lang |
| **Translate-word-in-context** | ⚠️ doable with quality drop | ⚠️ feasible with notable drop | Compound-tense reasoning is tricky for smaller models |
| **Converse (start / turn)** | ⚠️ doable with quality drop | ⚠️ feasible with notable drop | Chat quality, register matching, level-adjustment all suffer |
| **Interpret** | ⚠️ doable with quality drop | ⚠️ feasible | Coverage guarantees in JSON output less reliable |
| **Segment V2** | ⚠️ doable with quality drop | ⚠️ feasible with notable drop | Counterintuitively mini already does this well; smaller open-source models likely don't |
| **Localize** | ❌ hard without 70B+ | ❌ no | Subtle Castellano correctness (subjunctive triggers, gender, register) — exactly why we kept it on gpt-4o |

## Three break-even thresholds

**For server-self-host** (a single GPU VPS, ~$100/month):
- Per-user OpenAI bill is $1-7/month
- Self-host break-even: ~15-100 active users depending on usage tier
- Below that, OpenAI's API is just convenience-pricing

**For device-local (browser via WebGPU)**:
- Zero server cost, but 75-200MB model download per first visit
- Latency on weak devices (old phones, low-RAM laptops) can be 2-5× slower
- Break-even isn't financial — it's UX vs. ongoing API cost

**For native-OS APIs (Web Speech API / AVSpeechSynthesizer)**:
- Zero cost, no download, no infra
- Quality drop accepted as part of free
- Best for TTS specifically; STT is a coin flip on quality

---

## Realistic phased migration path (when scale demands it)

The order I'd actually do this in, if cost ever becomes the constraint:

### Phase 1 — quick wins on free / native APIs

1. **TTS → Web Speech API** (browser-native). 0 cost, immediate ~40% per-turn savings. Quality drop noticeable but acceptable. Could keep gpt-4o-mini-tts as a "premium voice" toggle for users who prefer it.
2. **Skip TTS preload when Auto-Read is off**. Generate on click only. Eliminates wasted preloads for ~50% of users.

### Phase 2 — server-self-host for cheap LLM tasks (around 50-100 active users)

3. **Vocab pipeline** (Comparator, Judge, Description, Ranking) → small open-source model (Qwen 7B or Phi-4 14B). Quality essentially unchanged for these structured tasks, ~$50/month VPS instead of $0.50/user/month.
4. **Topic-Generation, Interest-Extraction, Explain V2** → same server. Modest quality drop.
5. **Whisper** → whisper.cpp on the same server. Free per call, lightweight CPU-bound.

### Phase 3 — heavier LLM tasks (around 500+ active users, GPU server justified)

6. **Converse, Interpret, Translate-word-in-context, Segment** → 14B+ open-source model on a GPU server (~$200/month). Quality drop manageable; cost amortises.

### Phase 4 — never (or only at extreme scale)

7. **Localize** stays on gpt-4o. The subtle correctness premium is what makes the app feel polished; substituting with a 70B-on-GPU solution is more expensive than the API for any realistic scale.

---

## Open questions / things to decide later

- **Localize-on-mini revisit**: we kept it on gpt-4o because earlier tests showed subtle differences. With the V2 prompts (already in place for segment + explain) and a worked-example pass through Localize specifically, mini might actually suffice. Worth one more A/B round on the playground.
- **TTS-Modell-Vergleich**: `tts-1` ($15/1M chars) vs `gpt-4o-mini-tts` (different metering). For our use case (short clips, no streaming), tts-1 might be cheaper. Quick check on OpenAI's pricing page would resolve.
- **Hybrid approach**: native Web Speech API as default, gpt-4o-mini-tts as opt-in "premium" — gives best of both. Implementable now.

## Appendix: per-call token counts (from server logs)

Sample log lines used to estimate the costs above:
```
[llm] interpret           model=gpt-4o-mini  prompt=290   completion=80
[llm] localize/chat_precise model=gpt-4o      prompt=181   completion=43
[llm] segment/chat_light/v2 model=gpt-4o-mini prompt=1437  completion=210
[llm] explain/chat_light/v2 model=gpt-4o-mini prompt=400   completion=100
[llm] converse/start      model=gpt-4o-mini  prompt=438   completion=292
[llm] vocab/describe      model=gpt-4o-mini  prompt=250   completion=10
[llm] vocab/compare       model=gpt-4o-mini  prompt=200   completion=3
[llm] vocab/bulkSort      model=gpt-4o-mini  prompt=750   completion=250
[llm] vocab/binaryInsert  model=gpt-4o-mini  prompt=200   completion=5
[llm] playground/translateWord model=gpt-4o-mini prompt=1500 completion=50
[llm] transcribe          model=gpt-4o-transcribe  inputBytes=272011  outputChars=88
[llm] tts                 model=gpt-4o-mini-tts    inputChars=87      outputBytes=120192
```

Pricing (OpenAI, current rates — confirm at platform.openai.com/docs/pricing):
- gpt-4o:       $2.50/1M input,  $10.00/1M output
- gpt-4o-mini:  $0.15/1M input,   $0.60/1M output
- whisper-1:    $0.006/minute
- gpt-4o-mini-tts: ~$0.015/1k characters input (rough; verify before scaling)

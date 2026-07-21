# Hermes tool-calling gate — results

Tool-calling fidelity for the models that back Hermes kanban-card work, scored on
10 cases shaped like real agent turns: valid tool-call emission, correct tool
selection from a 4-tool registry, multi-turn tool-result incorporation,
refusal-to-hallucinate-a-tool, and exact output-contract adherence.

Suite: `evals/tool-calling-gate/`. Reproduce with `evals/tool-calling-gate/run.sh`.

## Safety topology (why only two models)

The jevans-ms `llama-swap` config puts models in two groups:

- **`mlx-models`** — `persistent: true`, `swap: false`. Holds the resident set:
  `Qwen3-Next-80B-A3B-Instruct-4bit` (the Hermes brain, serving 24/7) and
  `Qwen3-Coder-30B-A3B-Instruct-4bit`, co-resident (~58 GB of 128 GB).
- **`mlx-swap-models`** — `swap: true`, `persistent: false`, ttl 900s. Holds
  `Qwen3-Next-80B-A3B-Thinking-4bit`, `Qwen3.6-35B-A3B-4bit`,
  `Qwen3.6-35B-A3B-OptiQ-4bit`, `gpt-oss-120b-MXFP4-Q8`.

Only the two **resident** models were benchmarked. They are already loaded, so
sending requests adds request load but triggers **no model swap** — the brain is
undisturbed. Every `mlx-swap-models` member was **skipped**: loading one adds
20–63 GB and active GPU contention on top of the resident 58 GB, which could
disturb or (for the 120B / Thinking-80B) memory-pressure the brain. Requests were
serialized (`-j 1`, 400 ms spacing) so Hermes' own traffic interleaves cleanly.

> Note on OptiQ (`Qwen3.6-35B-A3B-OptiQ-4bit`): beyond the safety exclusion, its
> current nix-ai serve config is missing its defining flags (`--enable-mtp` +
> `--kv-cache-quantization*`) and the pinned `mtp.safetensors` rev — so it serves
> crippled and any bench of it would misrepresent the model. Do not benchmark it
> until serve-config parity lands (nix-ai issue pending).

## Ranked results

| rank | model | valid_call | correct_selection | refusal | incorporation | output_contract | overall |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | brain-80b-instruct | 100% (5/5) | 100% (5/5) | 100% (2/2) | 100% (2/2) | 100% (3/3) | 100% (10/10) |
| 2 | coder-30b | 100% (5/5) | 80% (4/5) | 100% (2/2) | 50% (1/2) | 100% (3/3) | 80% (8/10) |

_Ranked by correct_selection, then valid_call. 20 requests total (10/model),
serialized, 31s, 13.4k tokens, all local — $0 metered._

Metrics: **valid_call** = emitted a well-formed tool call; **correct_selection** =
called the right tool with all required args; **refusal** = declined to fabricate
a call when none fit or a required arg was missing; **incorporation** = used a
prior tool result instead of re-calling; **output_contract** = obeyed an exact
output-format instruction.

## Where coder-30b falls short

Both models emit valid JSON calls, refuse cleanly, and honor output contracts.
The 80B brain is perfect. Coder-30B fails two cases — both meaningful for agent
work, not test artifacts:

- **Selection (pos-05):** "Card 91 passed review — close it out." The brain calls
  `update_card_status(card_id, status)`; Coder-30B does not select it correctly.
- **Incorporation (multi-01):** given a prior `get_card` result naming blocker
  `LIN-42`, Coder-30B answers correctly in text **and then also fires a redundant
  `search_docs("LIN-42 DNS cutover")` call** — a spurious follow-up. The brain
  answers text-only. This is the failure the `incorporation` metric is designed
  to catch.

**Takeaway:** the 80B brain is the right model for multi-step, tool-driven kanban
work. Coder-30B is fine for single-shot valid emission but leaks spurious calls
and mis-selects on paraphrased intents — use it only where a wrong/extra call is
cheap.

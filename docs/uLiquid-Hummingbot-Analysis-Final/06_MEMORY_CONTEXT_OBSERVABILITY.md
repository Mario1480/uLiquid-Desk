# 06 – Memory, Context & AI Observability

## Status
**Analysis status:** FINAL
**Project:** uLiquid Desk × Hummingbot
**Date:** 2026-09-03

### Implementation status — 2026-09-05

- `IMPLEMENTED`: redacted Decision Log projection from existing Agent Run, Tool Call, Message and Trace records, including recommendation, evidence, versions, quality and permission state.
- `IMPLEMENTED`: Decision Log presentation in the existing right-side Activity panel with recent-run selection and mobile behavior.
- `NOT STARTED`: durable agent memory, replay/evaluation platform, learning promotion and a new observability persistence model.
- `COMPLETE`: Mario confirmed Phase 1 verification and formal acceptance on 2026-09-05.
- `IN PROGRESS`: Phase 2 has local run pinning, persisted feature values/references and Decision Log snapshot manifests. Their sidebar presentation and authenticated acceptance remain open in the [Phase 2 plan](implementation/PHASE_2_IMPLEMENTATION_PLAN.md).

## Executive Summary

Condor provides a strong reference for agent memory and observability. It separates per-session journals, cross-session learnings, full tick snapshots, deterministic risk/portfolio state, and persistent assistant memory/skills.

For uLiquid the recommended hierarchy is:

```text
LIVE TRUTH
Exchange / Market / Portfolio
        ↓
DETERMINISTIC DERIVED STATE
Analytics / Routines
        ↓
SESSION CONTEXT
Current task/conversation
        ↓
DURABLE MEMORY
Approved preferences/learnings
        ↓
SKILLS
Versioned playbooks
```

Core rule: **memory is never a source of truth for live trading state.** Prices, balances, positions, orders, funding, bot status and vault state always come from fresh deterministic services.

uLiquid should provide two complementary observability surfaces:

1. **User-facing Decision Log** — evidence, metrics, risks, recommendations and action status.
2. **Internal Audit/Replay Layer** — agent/version metadata, context references, skills, routines, tool calls, permission/risk decisions, latency, tokens, costs and execution links.

Raw hidden chain-of-thought should not be exposed.

---

## 1. Condor Reference Model

Condor Trading Agents currently distinguish:

- `journal.md`: current-session summary, decisions, ticks, executors and P&L.
- `learnings.md`: durable cross-session insights.
- tick snapshots: prompt/context, agent response, tool calls, portfolio, market data, executors and risk state.

Condor limits active learnings to prevent context bloat. This selective-memory principle is worth adopting.

---

## 2. uLiquid Memory Layers

### Layer 1 — Live Truth

Authoritative data:

```text
price
orderbook
funding
open interest
balances
positions
orders
fills
bot state
vault state
```

Sources: Exchange Gateway, Market Data, Portfolio, Bot and Hyperliquid/Vault services.

### Layer 2 — Deterministic Derived State

```text
RSI / StochRSI
ATR / EMA
market structure
orderbook imbalance
portfolio exposure
liquidation distance
cross-market net edge
```

Source: shared Routine Registry / Analytics Layer.

### Layer 3 — Session Context

Short-lived current-task information:

```text
current question
selected exchange
selected position
selected timeframe
workflow state
recent relevant turns
```

### Layer 4 — Durable User Preferences

```text
preferred timeframe
preferred assets
risk preference
preferred exchanges
analysis depth
strategy preferences
```

These should be visible and editable.

### Layer 5 — Agent-Specific Memory

Every access is explicitly scoped by:

```text
tenantId
userId
agentId
```

### Layer 6 — Skills

Versioned playbooks. Skills are not memory.

---

## 3. Never Store as Durable Agent Memory

```text
API keys / secrets
wallet private keys
temporary tokens
current prices
current balances
current positions
current liquidation prices
current bot state
unverified market claims
raw prompt-injection content
```

Live values become stale and can create unsafe decisions.

---

## 4. Memory Write Policy

Not every statement becomes memory.

```text
Candidate Memory
      ↓
Memory Policy
      ├─ durable?
      ├─ safe?
      ├─ useful later?
      ├─ user-specific?
      ├─ already known?
      └─ expiry?
      ↓
Store / Reject
```

Suggested types:

```text
USER_PREFERENCE
AGENT_PREFERENCE
STRATEGY_PREFERENCE
WORKFLOW_STATE
LEARNING
USER_NOTE
```

Suggested record:

```text
AgentMemory
id
tenantId
userId
agentId
type
key
value
source
confidence
createdAt
updatedAt
expiresAt
status
```

Statuses: `ACTIVE`, `SUPERSEDED`, `EXPIRED`, `DELETED`.

---

## 5. Context Builder

```text
User Request
     ↓
Context Builder
     ├─ Agent Definition
     ├─ Relevant Skills
     ├─ Relevant Memory
     ├─ Fresh Tool State
     ├─ Routine Outputs
     └─ Recent Session Summary
             ↓
            LLM
```

Use the **least-context principle**. A BTC analysis request should not automatically expose all balances, bots, vaults and historical conversations.

Use references instead of duplicating large state:

```text
marketSnapshotId
portfolioSnapshotId
positionSnapshotId
analyticsSnapshotId
```

---

## 6. Session & Turn Model

```text
AgentSession
id
tenantId
userId
agentId
agentVersion
modelPolicyVersion
mode
startedAt
lastActivityAt
endedAt
status
tokenInput
tokenOutput
estimatedCost
```

Modes:

```text
CHAT
ANALYSIS
BOT_DESIGN
DRY_RUN
PAPER
LIVE
```

Turn:

```text
AgentTurn
id
sessionId
sequenceNumber
timestamp
userInputRef
contextSnapshotRef
skillsUsed
routinesUsed
toolsRequested
toolsExecuted
structuredOutputRef
latencyMs
inputTokens
outputTokens
estimatedCost
status
errorCode
```

`sequenceNumber` supports web/mobile concurrency.

---

## 7. Decision & Execution Traceability

For material outputs:

```text
AgentDecision
id
turnId
type
confidence
facts
metrics
interpretation
riskFlags
recommendation
proposedActions
marketSnapshotRef
portfolioSnapshotRef
```

End-to-end linkage:

```text
AgentDecision
      ↓
ActionProposal
      ↓
User Approval
      ↓
ExecutionIntent
      ↓
Order / Bot / Executor
```

This allows Desk to answer exactly which recommendation caused a later action.

---

## 8. User-Facing Decision Log

Do not show raw hidden reasoning. Show structured evidence.

Example:

```text
Market Analyst · BTC/USDT

Market State      Bullish
Confidence        78%

Evidence
4H structure      Bullish
1H BOS            Confirmed
Funding           Neutral
Open Interest     Rising
Orderbook         Buy imbalance

Risk Flags
Short-term extension

Recommendation
Bullish continuation remains favored,
but current entry offers poor risk/reward.

Skills Used
Market Structure
Funding Analysis
Orderbook Analysis

Execution
No trading action permitted
```

Position Copilot can similarly show current position metrics, liquidation distance, portfolio concentration, risk flags and a proposed action.

Bot Architect can show the BotSpec, capability/risk validation, simulation state and whether deployment is authorized.

---

## 9. Internal Audit Layer

Record internally:

```text
tool name
tool argument reference
tool result reference
routine version
skill version
agent version
model policy
permission decision
risk decision
execution intent
provider result
```

Never persist secrets.

Central redaction must remove:

```text
API keys
secrets
private keys
authorization headers
session tokens
provider credentials
```

Condor has itself hardened HTTP logging to avoid Telegram token leakage, illustrating why observability needs centralized secret-redaction rules.

---

## 10. Three Observability Classes

### Product Analytics
Feature adoption, latency, errors, cost. Minimized/aggregated.

### Security & Audit
Who requested what, permission decisions and execution attribution. Restricted access.

### Agent Debug & Replay
Reproduce behavior and inspect tool/routine inputs. Highly restricted.

Do not mix these into one unrestricted log stream.

---

## 11. Telemetry Allowlist

Condor's optional telemetry uses a declared schema and excludes secrets and monetary details from external telemetry. uLiquid should adopt the same allowlist philosophy.

Safe product telemetry:

```text
agentType
skillId
toolId
success
latencyBucket
errorClass
```

Do not put full prompts, balances, order amounts or credentials into ordinary telemetry.

---

## 12. Replay & Shadow Mode

### Exact Replay

Historical state + historical versions to reproduce a decision.

### Counterfactual Replay

Same state with another model, agent or skill version:

> Would Market Analyst v1.5 make the same recommendation?

### Shadow Mode

```text
Production Agent
       ├─ user-visible result
       └─ same snapshot → Shadow Agent → stored only
```

Ideal for model, prompt, skill and routine upgrades.

---

## 13. Evaluation Framework

Build evaluation sets from historical snapshots:

```text
100 market situations
100 risky positions
50 exchange outages
50 stale/missing-data cases
50 prompt-injection cases
50 bot-design cases
```

Measure:

```text
schema validity
tool correctness
risk detection
unsupported claims
permission compliance
consistency
```

---

## 14. AI Cost Observability

Track:

```text
inputTokens
outputTokens
cachedTokens
reasoningClass
toolCalls
routineCalls
latency
estimatedModelCost
```

Aggregate by user, agent, feature, plan, day and month.

This should feed uLiquid AI-credit economics.

Cost guards:

```text
maxTokensPerTurn
maxToolCalls
maxAgentTurns
maxSessionCost
timeout
```

Future autonomous agents additionally need hourly/daily AI-cost limits.

---

## 15. Context Compression

Do not resend full histories indefinitely.

Use:

```text
Recent Turns
+
Session Summary
+
Relevant Decisions
+
Relevant Memory
```

Structured session summary:

```text
goal
selectedAssets
selectedConnections
currentTask
importantDecisions
openQuestions
activeDrafts
```

Condor follows a similar principle by injecting summary and recent decisions into its tick loop.

---

## 16. Freshness & Monetary Actions

Every context item should carry timestamp/source/freshness class.

Example:

```text
market price       VERY_SHORT
position           SHORT
balance            SHORT
user preference    LONG
skill              VERSIONED
```

Before any monetary action, even after user confirmation, freshly re-read:

```text
position
price
balance
exchange status
risk limits
```

Never execute from the old analysis snapshot.

---

## 17. User Memory vs Agent Learning

### User Memory
Preferences such as `prefers 4H analysis`.

### Agent Learning
Potential strategy insights such as `signal performs poorly in low volume`.

Condor supports cross-session learnings, but uLiquid should avoid uncontrolled self-modification for live trading.

Recommended:

```text
Candidate Learning
      ↓
Evaluation
      ↓
Approval
      ↓
New Agent/Skill Version
```

Learning record:

```text
AgentLearning
id
agentId
sourceSessionId
statement
evidenceRefs
status
createdAt
reviewedAt
```

Statuses: `CANDIDATE`, `APPROVED`, `REJECTED`, `SUPERSEDED`.

---

## 18. Scope Isolation

A current Condor issue shows that some serverless calls can lose their intended agent slug and target the wrong memory/skill store.

uLiquid therefore must never depend on an implicit "current agent". Every memory/skill operation carries:

```text
tenantId
userId
agentId
```

This is a hard multi-tenant rule.

---

## 19. Multi-Device Continuity

Condor supports session continuity across Telegram, CLI and web.

uLiquid should support one server-side AgentSession across:

```text
Web Desk
iOS
future Android
```

For concurrent turns use sequencing/optimistic locking.

Future session branching can support:

```text
Try another strategy from here
```

using `parentSessionId` and `parentTurnId`.

---

## 20. Memory Privacy Controls

Future user controls:

```text
View remembered preferences
Edit
Delete
Disable agent memory
Export
```

Memory retrieval should be relevance-based:

```text
Current Task
    ↓
Memory Search
    ↓
Agent Scope
    ↓
Relevance
    ↓
Validity
    ↓
Top Memories
```

Do not dump the entire user profile into every prompt.

---

## 21. Observability Dashboards

### AI Operations

```text
Requests/min
Agent latency
Tool latency
Tool error rate
Schema failures
Permission denials
Risk denials
Token consumption
AI cost
Model distribution
Skill usage
Routine usage
```

### AI Trading Safety

```text
Actions proposed
Actions approved
Actions executed
Actions blocked
Risk blocks
Permission blocks
Stale-state blocks
Agent-linked PnL
Execution failures
Reconciliation failures
Emergency stops
```

Alerts should cover tool-error spikes, model latency, schema failures, cost anomalies, scope errors, permission-bypass attempts and reconciliation failures.

---

## 22. Version Comparison

Example:

```text
Market Analyst v1.4 vs v1.5

Schema Validity   99.8% → 99.9%
Tool Accuracy     98.2% → 99.1%
Risk Flag Recall  91%   → 94%
Average Tokens    4200  → 3500
Latency           3.2s  → 2.8s
```

Upgrades become evidence-based rather than subjective.

---

## 23. Recommended Architecture

```text
                         uLIQUID AI PLATFORM
                                  │
                         Agent Orchestrator
                                  │
                         Context Builder
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
         Live Truth          Relevant Memory      Skills
              │                   │                   │
              ▼                   ▼                   ▼
       Market/Portfolio       Memory Store       Skill Registry
              │
              ▼
      Deterministic Analytics
              │
              └──────────────┬───────────────────────┘
                             ▼
                            LLM
                             │
                             ▼
                    Structured Agent Result
                             │
            ┌────────────────┼────────────────┐
            ▼                ▼                ▼
      Decision Log     Tool Requests    Action Proposal
                                              │
                                              ▼
                                      Permission / Risk
                                              │
                                              ▼
                                      Execution Gateway

All stages → Observability Event Bus
             ├─ Product Analytics
             ├─ Security/Audit
             ├─ AI Cost
             └─ Debug/Replay
```

---

## 24. Implementation Phases

These are area-specific observability stages. In the consolidated roadmap, existing Agent records and user-facing Decision Logs are consolidated in Phase 1, Context/feature integration supports Phase 2, and replay, durable memory or governed learning are added only when required by later product and automation gates.

### Phase A — Session & Decision Foundation
Build AgentSession, AgentTurn, AgentDecision, structured summaries and execution links.

### Phase B — Context Builder
Fresh-state retrieval, memory retrieval, skill selection, token budgeting and freshness validation.

### Phase C — Decision Logs
User-facing logs for Market Analyst and Position Copilot.

### Phase D — Cost & Operations
Token/cost attribution, latency/error metrics and AI Operations dashboard.

### Phase E — Replay & Evaluations
Exact/counterfactual replay, shadow mode and regression datasets.

### Phase F — Durable Memory
User-controlled preferences, strict scope and expiry/supersession.

### Phase G — Governed Learning
Candidate learnings, evaluation and versioned promotion.

---

## 25. Adoption Matrix

| Condor Concept | uLiquid Decision |
|---|---|
| Session journals | **ADAPT** |
| Cross-session learnings | **ADAPT CAREFULLY** |
| Full tick snapshots | **ADOPT CONCEPT** |
| Tool-call capture | **ADOPT** |
| Session continuity | **ADOPT** |
| Assistant-scoped memory | **ADAPT with stronger tenant scope** |
| Persistent skills | **ADOPT via Area 5 registry** |
| Risk state in context | **ADOPT** |
| Raw prompt/reasoning inspection | **INTERNAL ONLY** |
| Telemetry allowlist/privacy | **ADOPT CONCEPT** |
| Unlimited self-learning | **REJECT** |
| Memory as live state | **REJECT** |

---

## 26. Final Decisions

### ADOPT

- strict live-truth hierarchy
- Context Builder
- structured AgentSession/Turn/Decision
- Decision Logs
- snapshot references
- tool/routine/skill observability
- execution attribution
- token/cost accounting
- exact and counterfactual replay
- shadow mode
- centralized redaction
- telemetry allowlists
- multi-device server-side sessions
- freshness checks

### ADAPT

- Condor journal model
- cross-session learnings
- assistant memory
- snapshot architecture
- session continuity

### RETAIN uLIQUID-NATIVE

- tenancy
- privacy controls
- retention policy
- execution authority
- risk authority
- credit accounting
- user-facing explainability
- memory governance

### REJECT

- memory containing live trading truth
- secrets in memory/logs
- raw chain-of-thought as user-facing explainability
- uncontrolled self-learning
- implicit/global memory scope
- executing monetary actions from stale snapshots
- unbounded chat/context accumulation

---

## 27. Area 6 Verdict

**Overall relevance:** EXTREMELY HIGH

**Highest-value Hummingbot/Condor concept:** full observability around each agent tick.

**Most important uLiquid improvement:** turn Condor's file-based journals/snapshots into a structured multi-tenant Decision/Audit/Replay platform.

**Recommended product feature:** a polished **AI Decision Log** shared by Market Analyst, Position Copilot and later Bot Architect.

**Recommended engineering priority:** build the Session/Decision/Context foundation before granting agents any meaningful execution authority.

---

## Sources

- Condor Sessions
  https://condor.hummingbot.org/trading-agents/sessions

- Condor Trading Agent Architecture
  https://condor.hummingbot.org/trading-agents/architecture

- Condor Session Management
  https://condor.hummingbot.org/getting-started/sessions

- Introducing Condor
  https://hummingbot.org/blog/introducing-condor-the-open-source-harness-for-trading-agents/

- Hummingbot v2.16.0 – Agent Memory & Skills
  https://hummingbot.org/release-notes/2.16.0/

- Condor Privacy / Telemetry
  https://github.com/hummingbot/condor/blob/main/PRIVACY.md

- Condor issue #152 – memory/skill scope
  https://github.com/hummingbot/condor/issues/152

---

**Area 6 status: FINAL**

# uLiquid Desk AI Agent Chat Implementation Packet

Status date: 2026-08-02

This packet defines the implementation path for an AI Agent Chat that can inspect portfolio and market state across supported exchanges while keeping trading execution outside the unrestricted AI tool loop.

## Product boundary

- The agent may read normalized account, position, order, funding, prediction, and market context when the user and workspace permissions allow it.
- The agent must expose data freshness, source, venue, and degraded-state information instead of presenting uncertain reads as current truth.
- Trading execution is out of scope for the free-form tool loop. A later phase may produce reviewable trade drafts, but execution must remain deterministic and explicitly confirmed.
- Secrets, exchange credentials, wallet keys, internal prompts, and cross-tenant data must never enter model context.

## Repository baseline

The packet builds on existing modules rather than introducing a parallel platform:

- `apps/api/src/ai` for provider, policy, prompt, and tool controls.
- `apps/api/src/exchange-accounts` and exchange services for permissioned account reads.
- `packages/futures-exchange` for normalized multi-exchange data.
- `apps/api/src/predictions` and `packages/strategies` for prediction context.
- `apps/web` for the authenticated chat and Position Copilot experience.
- Prisma models for conversations, runs, tool calls, audit state, and user settings.

## Packet contents

- `00-repository-assessment.md` — verified baseline and gaps.
- `01-foundation-and-feature-gates.md` — rollout foundation and feature flags.
- `02-multi-exchange-read-skills.md` — permissioned, normalized read capabilities.
- `03-agent-chat-runtime-and-conversations.md` — runtime and persistence.
- `04-agent-profiles-skills-permissions.md` — profiles, skills, and authorization.
- `05-agent-chat-ui-ux.md` — web experience.
- `06-position-copilot-integration.md` — read-only position analysis.
- `07-activity-audit-observability.md` — audit and operations.
- `08-security-hardening.md` — prompt, output, secret, and tenant boundaries.
- `09-testing-and-rollout.md` — tests and staged release.
- `10-trade-drafts-and-approvals-future.md` — future confirmed-draft boundary.
- `11-api-and-data-contracts.md` — API and persistence contracts.
- `12-codex-agent-workstreams.md` — implementation workstreams.
- `13-definition-of-done.md` — acceptance and release gates.
- `CODEX-MASTER-PROMPT.md` — execution prompt for the packet.

## Working rules

1. Read `AGENTS.md`, affected modules, and nearby tests first.
2. Run `git status --short --branch` before editing and preserve unrelated changes.
3. Keep each implementation step small, feature-gated, and reversible.
4. Add server-side authorization and tenant isolation before exposing a tool to the model.
5. Treat `read`, `analyze`, `draft`, and `execute` as separate capability classes.
6. Record freshness and degraded-state metadata for every capital-relevant read.
7. Run the checks defined in the relevant workstream before marking it complete.

This packet remains active until its rollout, security, and acceptance gates are complete.

---
description: User documentation and knowledge base for uLiquid Desk.
icon: book-open
---

# uLiquid Desk Knowledge Base

Welcome to the uLiquid Desk documentation. This knowledge base explains the core workflows for the dashboard, exchange accounts, manual trading, predictions, bots, grid bots, wallet, funding, vaults, admin operations, and support.

{% hint style="warning" %}
uLiquid Desk is a trading and automation tool. Always review every order, funding action, and bot configuration yourself. This documentation is not financial advice.
{% endhint %}

## Quick Start

1. Create an account or sign in.
2. Check your workspace and role.
3. Connect an exchange account or wallet.
4. Test first in paper or demo mode.
5. Move to small live canaries only after the test flow is clear.

## Main Areas

<table data-view="cards">
  <thead>
    <tr>
      <th>Area</th>
      <th>What it is for</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="getting-started/quickstart.md">Getting Started</a></td>
      <td>Setup order, login, roles, and security basics.</td>
    </tr>
    <tr>
      <td><a href="user-guide/dashboard-and-accounts.md">Dashboard & Accounts</a></td>
      <td>Account status, open positions, price alerts, journal, daily metrics, notes, and exchange accounts.</td>
    </tr>
    <tr>
      <td><a href="user-guide/trading-desk-and-risk.md">Trading Desk & Risk</a></td>
      <td>Manual orders, positions, guardrails, and emergency behavior.</td>
    </tr>
    <tr>
      <td><a href="user-guide/signals-and-automation.md">Signals & Automation</a></td>
      <td>Predictions, strategies, standard bots, and grid bots.</td>
    </tr>
    <tr>
      <td><a href="user-guide/market-intelligence.md">Market Intelligence & AI</a></td>
      <td>Source-backed market context, saved analyses, Agent Chat, and Position Copilot boundaries.</td>
    </tr>
    <tr>
      <td><a href="user-guide/wallet-funding-and-vaults.md">Wallet, Funding & Vaults</a></td>
      <td>Connect wallets, move assets, fund vaults, and run BotVault flows.</td>
    </tr>
    <tr>
      <td><a href="support/troubleshooting-and-faq.md">Support & FAQ</a></td>
      <td>Common issues, diagnostics, and frequent questions.</td>
    </tr>
  </tbody>
</table>

## Plans and Feature Access

Feature access depends on your plan, workspace role, and the current environment. See [Plans and Feature Access](getting-started/plans-and-feature-access.md) for the current in-product source of truth and safe upgrade guidance.

## Good Operating Habits

- Use paper or canary flows for every new setup.
- Change only one critical setting at a time.
- Keep screenshots, timestamps, workspace names, account labels, and bot or grid IDs for support cases.
- Start live bots only when account data, margin, funding, and permissions are clearly shown as ready.
- Do not grant withdrawal permissions to exchange API keys used by uLiquid Desk.

## GitBook and GitHub

This documentation is prepared for GitBook Git Sync. GitBook uses `docs/README.md` as the homepage, `docs/SUMMARY.md` as the navigation, and `.gitbook.yaml` in the repository root as the sync configuration.

## Engineering and Operations

- [Admin payments overview implementation and acceptance](plans/active/billing/admin-payments-overview.md)
- [Beta access applications, invitations and activation gates](auth/beta-access.md)
- [ULIQ Mainnet locking rollout](../packages/contracts/ULIQ_MAINNET_LOCKING_ROLLOUT.md)
- [ULIQ Mainnet locker deployment evidence](archive/tasks/2026-09-08-uliq-mainnet-locker-deployment.md)
- [ULIQ Mainnet locking application rollout](archive/tasks/2026-09-08-uliq-mainnet-locking-app-rollout.md)
- [ULIQ locking RPC query adaptation](archive/tasks/2026-09-08-uliq-locking-rpc-chunks.md)
- [ULIQ locking frontend activation](archive/tasks/2026-09-08-uliq-locking-frontend-activation.md)
- [Ein UI integration and acceptance](ui/einui-integration.md)
- [Ein UI route migration inventory](ui/einui-route-inventory.md)
- [Ein UI validation, screenshots and release gates](ui/einui-validation.md)
- [Phase 2 — Shared Data and Existing AI Upgrade — COMPLETE](plans/active/hummingbot-integration/implementation/PHASE_2_IMPLEMENTATION_PLAN.md) — owner acceptance, 2026-09-07
- [Phase 2 owner acceptance record](archive/tasks/2026-09-07-phase2-owner-acceptance.md)
- [Phase 3 — Cross-Market Arbitrage and XEMM Scanners — COMPLETE](plans/active/hummingbot-integration/implementation/PHASE_3_IMPLEMENTATION_PLAN.md) — production acceptance completed 2026-09-09
- [Phase 3 production acceptance record](archive/tasks/2026-09-09-phase3-production-acceptance.md)
- [Phase 4 — Exchange Gateway and isolated Bitget POC — COMPLETE/PARTIAL](plans/active/hummingbot-integration/implementation/PHASE_4_IMPLEMENTATION_PLAN.md) — Decision Gate closed 2026-09-08; Phase 5 remains gated
- [Phase 4 Hummingbot Bitget decision record](archive/tasks/2026-09-08-phase4-hummingbot-bitget-decision.md)
- [Phase 4 private Bitget certification deferral](archive/tasks/2026-09-10-phase4-private-certification-deferred.md) — demo certification deferred; live account excluded from Hummingbot execution tests
- [Phase 5 preparation plan](plans/active/hummingbot-integration/implementation/PHASE_5_PREPARATION_PLAN.md) — architecture and certification preparation complete; implementation remains gated
- [Active and backlog plans](plans/README.md)
- [Active program closeout register](status/active-program-closeout.md)
- [Current status and readiness](status/README.md)
- [Architecture and technical design](architecture/README.md)
- [Runbooks and operations](runbooks/README.md)
- [Quality, security, and acceptance](quality/README.md)
- [Go-live master plan](status/go-live-master-plan.md)
- [Go-live readiness follow-ups](status/go-live-readiness-followups.md)
- [Release evidence matrix](status/release-evidence-matrix.md)
- [Go-live and smoke tests](ops/go-live-and-smoke-tests.md)
- [Runtime and deployment reference](reference/runtime-and-deployment.md)
- [Internal documentation index](reference/internal-docs-index.md)

## Archive

Completed dated work records, superseded plans, point-in-time reports, and historical package snapshots live under [`archive`](archive/README.md). Archived evidence is retained for traceability and is not a statement of current runtime, deployment, or go-live status.

- [Trading and dashboard UI fixes, 2026-09-08](archive/tasks/2026-09-08-trading-ui-fixes.md)

Implementation plans remain in their feature area while any rollout, migration, deployment, legal, security, or production gate is open. They move to the archive only after the plan's completion status has been verified and its active conclusions have been transferred to the relevant reference or status document.

## Documentation maintenance policy

- Write repository documentation and READMEs in English.
- Keep active operational truth in the relevant status, runbook, ADR, or reference document.
- Use `docs/archive/tasks/YYYY-MM-DD-*.md` for completed task evidence and the dedicated archive subdirectories for plans, reports, and package snapshots.
- Update inbound links and this index whenever documentation moves.
- Preserve exact commands, identifiers, output, and quoted UI text in historical evidence.
- Treat code/test, deployment/runtime, browser, transaction/finality, indexer, and reconciliation evidence as separate layers.

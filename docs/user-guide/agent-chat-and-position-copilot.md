---
description: Use AI market and position analysis with explicit read-only boundaries.
icon: users
---

# Agent Chat and Position Copilot

Agent Chat provides guided market analysis. Its built-in Market Analyst profile focuses on market context, while the Position Copilot profile provides risk-oriented analysis for a selected position or account context.

{% hint style="danger" %}
Agent Chat and Position Copilot do not place, amend, cancel, close, fund, withdraw, or otherwise execute trades. They do not replace your own risk decision or the Trading Desk confirmation flow.
{% endhint %}

## Start an Analysis

1. Open **Agent Chat**.
2. Select a profile, venue, market type, symbol, and—when requested—an exchange account you own.
3. Review the enabled skills and context before sending a question.
4. Ask a specific question and inspect the answer, source references, and activity details.
5. Keep any final trade decision separate: open the Trading Desk and review the full order there.

## Profiles and Account Context

| Profile | Purpose | Account context |
| --- | --- | --- |
| Market Analyst | Read-only market analysis for a selected venue, market, and symbol. | May work without a private account selection, depending on the question and available data. |
| Position Copilot | Read-only, risk-oriented explanation for a position context. | Requires the appropriate selected account and ownership checks when private account data is needed. |

The app can require account selection or block a request when the current profile, plan, account ownership, or environment does not allow the requested data.

## Decision Logs and Conversation History

Each conversation retains its messages. Decision Logs record the analytical evidence and activity associated with a run so that you can inspect what informed the result. Use them to assess freshness, fallbacks, source evidence, and uncertainty—not as proof that an action was correct or executed.

Archive conversations you no longer need. Do not paste API secrets, wallet private keys, seed phrases, or recovery codes into a prompt.

## AI Credits and Availability

AI features can consume AI credits and can be plan-gated. The chat displays available-credit information when it is available. If a profile or account-aware read is locked, check **Settings → Subscription**; do not retry a blocked request repeatedly.

## Using a Recommendation Safely

- Check the timestamp, selected venue, symbol, and account context.
- Read disclosed data limitations, stale signals, and missing evidence.
- Verify positions, balances, orders, and market data directly in the relevant product surface or venue.
- Use small, controlled tests for a new workflow.
- Never treat an AI response as authorization to override risk controls, permissions, or a manual confirmation.

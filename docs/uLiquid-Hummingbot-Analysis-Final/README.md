# uLiquid Desk × Hummingbot Analysis Package
Final consolidated architecture and integration package, September 2026.

## Read first
1. `00_EXECUTIVE_SUMMARY.md`
2. `08_TARGET_ARCHITECTURE_INTEGRATION.md`
3. `implementation/POC_PLAN.md`
4. `implementation/CODEX_IMPLEMENTATION_PLAN.md`

## Detailed analyses
- 01 CEX Connector & Exchange Layer
- 02 Execution Engine & Executors
- 03 Arbitrage & XEMM
- 04 Agents & Condor Architecture
- 05 Skills System
- 06 Memory, Context & Observability
- 07 Market Data & Analytics
- 08 Target Architecture & Integration

## Core rule
**uLiquid owns stable contracts and safety boundaries. Hummingbot is an interchangeable provider behind those contracts.**

## Roadmap authority
The current implementation order is defined in `00_EXECUTIVE_SUMMARY.md`, `08_TARGET_ARCHITECTURE_INTEGRATION.md` and `implementation/CODEX_IMPLEMENTATION_PLAN.md`. Where a detailed area analysis describes its own local phases, those phases remain subordinate to the consolidated roadmap and its Hummingbot Decision Gate.

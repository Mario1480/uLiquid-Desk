# ULIQ Mainnet locking rollout

Date: 2026-09-08. Status: steps 1 and 2 implemented locally; Mainnet locker deployed, source verified and finalized preflight passed. Deployment identity is stored in production configuration with activation disabled. Runtime RPC configuration, application release and live acceptance remain pending.

Validation: 16 API/configuration/RPC tests, four Mainnet locker contract tests, API typecheck and a broadcast-free Mainnet fork deployment simulation passed. See [step-1 evidence](../../docs/archive/tasks/2026-09-08-uliq-mainnet-locking-preflight.md).

## Scope

Deploy the existing `ULIQMainnetLocker` on Arbitrum One, reconcile its address, then integrate Mainnet locking into Desk in separately reviewable steps. The contract pins token `0xF2Fa252134c84Fcf260c73665BAf3f8cCBe03EEd` and chain `42161`. It takes no constructor arguments and has no administrator. Initial terms are 32, 185 and 367 days; position owners can extend and withdraw at maturity.

See the [approved contract inputs and authority review](ULIQ_MAINNET_CONTRACT_APPROVAL.md). This rollout does not change presale dates, purchases, listing, treasury, contract rights or discount eligibility. Independent external audit remains a separate open item.

## Step 1 — isolated configuration and deployment preflight

Implemented locally:

- `apps/api/src/uliq/mainnetLocking.config.ts` consumes a separate Mainnet namespace. The chain and token are pinned; a nonzero locker address, creation transaction hash, positive deployment block and distinct HTTP(S) RPC endpoints are required.
- `apps/api/src/uliq/mainnetLocking.preflight.ts` requires both RPCs to report Arbitrum One, agree on a common finalized block and the deployment block, and return successful direct-creation receipts matching the configured address, transaction and start block.
- At the common finalized block, both providers must agree on code hashes, token identity, configured chain, token decimals, lock durations, total locked and token balance. Token balance must cover outstanding locked principal; donations are allowed. The block hash is checked again after the reads.
- `npm -w apps/api run uliq:mainnet-locking:preflight` prints public reconciliation data. It has no wallet client, signer, transaction submission, database write or activation path. Provider error text is suppressed because it can contain authenticated RPC URLs.

The CLI reads process environment only; it does not load `.env` files implicitly. Prepare these values from the actual deployment receipt using `mainnet-locking.env.example`. RPC URLs must be supplied privately. Never put a Mainnet address in legacy `ULIQ_LOCKER_ADDRESS`.

The result `deployment_reconciled` establishes configured receipt/state agreement only. The reported runtime code hash must still be independently matched to the reviewed build/source verification. Matching getters alone do not prove bytecode identity or an audit. This preflight currently supports the supplied direct deployment script, not a factory deployment.

## Step 2 — application integration before activation

Implemented locally; see [step-2 evidence](../../docs/archive/tasks/2026-09-08-uliq-mainnet-locking-integration.md).

- Authenticated `/uliq/mainnet-locking` routes use the account's linked wallet. Preparation validates uint256 amounts and IDs, exact contract, nominal wallet balance, supported duration, ownership, withdrawal status and expiry. Approvals authorize exactly the requested amount. No backend signer is used.
- A dedicated API polling job indexes only the configured Mainnet locker. Cursor ID: `uliq-mainnet-locking:42161:<lowercase locker address>`. Each poll covers at most 2000 finalized blocks, agrees on logs and block hashes across two RPCs, and commits events, projections and cursor atomically with a lease/compare-and-set. A changed checkpoint resets only this chain/contract's projection and replays from its deployment block. RPC failure leaves the checkpoint unchanged and retries at the configured polling interval. Existing Prisma keys suffice; no migration was added.
- `/uliq/locking` selects the new page when `NEXT_PUBLIC_ULIQ_MAINNET_LOCKING_ENABLED=true`; otherwise it retains the Sepolia hub. Mainnet navigation, wallet-chain availability and Docker build/runtime variables are wired. The page validates full calldata, spender, recipient, expected wallet and chain before signing, rechecks the wallet after switching chain, and rechecks the deposit gate after approval.
- Positions are paginated in groups of 50 and re-read onchain at a common finalized block. Indexer lag is explicit. The page polls every 15 seconds. Wallet-scoped session storage preserves the last submitted transaction through reloads; receipt polling distinguishes confirmation from finalized/indexed progress. During the active receipt wait, cancellation or replacement with different calldata stops subsequent submission; same-call repricing follows the replacement hash. If the original hash disappears after a reload, tracking can be stopped explicitly after explorer inspection; stopping tracking does not cancel an onchain transaction or retry it automatically.
- Entitlement and billing discounts remain unchanged. API jobs own indexing; the execution runner has no new dependency.

### Runtime configuration and rollout sequence

| Variable | Meaning / default |
| --- | --- |
| `ULIQ_MAINNET_LOCKING_ENABLED` | Master API gate; false. Keep enabled while positions must remain accessible. |
| `ULIQ_MAINNET_LOCKING_INDEXER_ENABLED` | Independent indexer gate; false, also requires the master gate. |
| `ULIQ_MAINNET_LOCKING_DEPOSITS_ENABLED` | New lock preparation; false. Does not control withdrawal preparation. |
| `ULIQ_MAINNET_LOCKING_EXTENSIONS_ENABLED` | Extension preparation; false. Does not control withdrawal preparation. |
| `ULIQ_MAINNET_LOCKING_RUNTIME_CODE_HASH` | Required by runtime services: keccak256 of the independently source-verified deployed runtime bytecode, including immutables. Do not blindly copy an unverified preflight result. |
| `ULIQ_MAINNET_LOCKING_INDEXER_INTERVAL_SECONDS` | 15 seconds by default. |
| `NEXT_PUBLIC_ULIQ_MAINNET_LOCKING_ENABLED` | Web build/runtime page and navigation switch; false. A web rebuild is required when changing it. |

The API consumes the existing `.env.prod` environment file through Compose; templates contain only blank addresses/RPCs and disabled gates. Runtime readiness reconciles the real creation receipt and configured code hash before reads/preparation/indexing, cached for 60 seconds per service. Registering lazy services while disabled does not require deployment inputs.

After deployment/source verification, populate the independent namespace, release the reviewed app, enable API and indexing for read-only acceptance, wait for catch-up, then separately enable deposits/extensions under the agreed activation scope. An emergency deposit stop should disable only `DEPOSITS_ENABLED` (and, if needed, `EXTENSIONS_ENABLED`), leaving reads, indexing and mature withdrawals available. The web flag must remain on for the Mainnet page. Disabling the master flag hides all Mainnet API routes; direct contract interaction remains possible.

Local unit and browser fixture checks do not establish a real wallet network-switch/signature, database-runtime acceptance, mined replacement handling or a live lock/withdrawal smoke. These remain release acceptance items after the actual locker exists.

## Step 3 — deployment and address reconciliation

Deployment succeeded on 2026-09-08: `0x1ADDA264ee63Ca0Be4400277c9dfA9896a897BC9`, creation block `503067324`. Creation and runtime bytecode match the frozen local package exactly; Remix reports Sourcify and Blockscout verification success. Finalized preflight passed at common block `503069869`. The verified identity was written to `/opt/uliquid-desk/.env.prod` at Mario's request; all five Mainnet locking activation flags are false. No service was restarted, and runtime RPC URLs still require configuration before application release. See [deployment evidence](../../docs/archive/tasks/2026-09-08-uliq-mainnet-locker-deployment.md) and the [disabled deployment configuration](remix/mainnet-locker-2026-09-08/deployment.env.example).

1. Review the frozen locker source and deployment package. For Remix use an explicitly prepared package with the same compiler settings; for Forge use `script/uliq/mainnet/DeployULIQMainnetLocker.s.sol:DeployULIQMainnetLocker`.
2. Rehearse locally against a finalized Arbitrum One fork without `--broadcast` or a private key. Simulation addresses are not deployment addresses and must not enter runtime configuration.
3. Execute the reviewed deployment with Mario's selected signing workflow. Record real creation hash, locker address, block and compiler/source verification evidence.
4. Wait until the creation block is finalized on both configured RPCs. Run the read-only preflight with the real values. A finality wait or provider failure is not a failed deployment; inspect the existing receipt before any retry to avoid duplicate creation.
5. Verify the source/runtime bytecode independently and record dated evidence. Populate the isolated Mainnet runtime configuration only with these reconciled values.

## Step 4 — runtime release and acceptance

Deploy the reviewed application integration, verify read-only API/indexer/browser state and then enable locking under the agreed activation scope. A small owner-approved live lock/extension/mature-withdrawal smoke is separate transaction evidence; local tests cannot prove live withdrawal before the minimum term has elapsed. Turning off deposits must preserve a route to read and withdraw existing positions. Contract locking itself has no pause switch.

No contract or application deployment, live activation, token approval, lock or fund movement has been performed by steps 1–2.

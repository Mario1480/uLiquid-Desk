# Contracts Deploy On VPS

Dieses Dokument beschreibt den Deploy der Foundry-Contracts aus dem Monorepo auf einem VPS.

## Voraussetzungen

1. Repo liegt auf dem VPS (z. B. `/opt/uliquid-desk`).
2. `npm` ist installiert.
3. Für `devnet`:
   1. RPC Endpoint
   2. Deployer Private Key
   3. USDC Contract-Adresse auf dem Zielnetz

## 1) ENV in `.env.prod` ergänzen

```env
# optional spezifisch für Contracts (überschreibt generische Werte)
CONTRACTS_RPC_URL=https://rpc.hyperliquid.xyz/evm
CONTRACTS_PRIVATE_KEY=0x...
CONTRACTS_USDC_ADDRESS=0x...
CONTRACTS_DEPLOY_OWNER=0x...
CONTRACTS_CHAIN_ID=999
CONTRACTS_FORGE_BROADCAST_ARGS=--legacy

# alternativ funktionieren auch:
# RPC_URL, PRIVATE_KEY, USDC_ADDRESS, DEPLOY_OWNER, CHAIN_ID, FORGE_BROADCAST_ARGS
```

Hinweis:
- Nutze am besten die `CONTRACTS_*` Variablen, damit App-ENV und Deploy-ENV sauber getrennt bleiben.
- Private Keys nie in Git einchecken.
- Fuer HyperEVM ist `--legacy` aktuell der sichere Default, weil EIP-1559 Fee-Schaetzung ueber die RPC haeufig fehlschlaegt.
- Wenn du bewusst andere Forge-Flags brauchst, kannst du `CONTRACTS_FORGE_BROADCAST_ARGS` ueberschreiben.

## 2) Dry-Run

```bash
cd /opt/uliquid-desk
./scripts/deploy_contracts_vps.sh --mode devnet --env-file .env.prod --dry-run
```

## 3) Deploy auf Devnet

```bash
cd /opt/uliquid-desk
./scripts/deploy_contracts_vps.sh --mode devnet --env-file .env.prod
```

## 4) Lokaler Deploy gegen Anvil (optional)

```bash
cd /opt/uliquid-desk
./scripts/deploy_contracts_vps.sh --mode local --install-foundry
```

## 5) Wichtige Optionen

```bash
./scripts/deploy_contracts_vps.sh --help
```

- `--install-foundry`: installiert Foundry automatisch, falls `forge` fehlt.
- `--install-npm-deps`: führt `npm install --workspaces ...` aus.
- `--app-dir <path>`: falls das Repo nicht im aktuellen Pfad liegt.

## Ergebnis-Artefakte

Foundry schreibt Deploy-Artefakte nach:
- `packages/contracts/broadcast/`
- `packages/contracts/cache/`

Diese Pfade enthalten die deployten Contract-Adressen und Tx-Infos.

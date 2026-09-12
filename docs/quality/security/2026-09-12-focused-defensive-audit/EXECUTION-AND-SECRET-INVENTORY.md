# Execution and plaintext inventory

Read with [the report](README.md). Application call sites below identify where execution or decryption occurs; adapter-level rows inherit application authorization, and do not independently authenticate a Desk user. No live orders were sent. Source scanning includes TypeScript implementations and excludes tests/declarations; generated JS is not treated as deployed evidence.

## Decrypt and order/action call sites

| Source | Enclosing function/method | Call |
|---|---|---|
| [apps/api/src/ai/provider.ts:412](../../../../apps/api/src/ai/provider.ts#L412) | `decryptStoredSecret` | `decryptSecret` |
| [apps/api/src/email.ts:61](../../../../apps/api/src/email.ts#L61) | `readDbSmtpConfig` | `decryptSecret` |
| [apps/api/src/exchange-accounts/routes.ts:627](../../../../apps/api/src/exchange-accounts/routes.ts#L627) | `registerExchangeAccountRoutes` | `deps.decryptSecret` |
| [apps/api/src/exchange-accounts/routes.ts:631](../../../../apps/api/src/exchange-accounts/routes.ts#L631) | `registerExchangeAccountRoutes` | `deps.decryptSecret` |
| [apps/api/src/exchange-accounts/routes.ts:843](../../../../apps/api/src/exchange-accounts/routes.ts#L843) | `registerExchangeAccountRoutes` | `deps.decryptSecret` |
| [apps/api/src/exchange-accounts/routes.ts:844](../../../../apps/api/src/exchange-accounts/routes.ts#L844) | `registerExchangeAccountRoutes` | `deps.decryptSecret` |
| [apps/api/src/exchange-accounts/routes.ts:847](../../../../apps/api/src/exchange-accounts/routes.ts#L847) | `registerExchangeAccountRoutes` | `deps.decryptSecret` |
| [apps/api/src/execution/perp-execution-service.ts:360](../../../../apps/api/src/execution/perp-execution-service.ts#L360) | `placeOrder` | `ctx.adapter.placeOrder` |
| [apps/api/src/index.ts:3973](../../../../apps/api/src/index.ts#L3973) | `maskEncrypted` | `decryptSecret` |
| [apps/api/src/index.ts:4135](../../../../apps/api/src/index.ts#L4135) | `resolveEffectiveAiApiKey` | `decryptSecret` |
| [apps/api/src/index.ts:4160](../../../../apps/api/src/index.ts#L4160) | `resolveAiProfileApiKey` | `decryptSecret` |
| [apps/api/src/index.ts:7252](../../../../apps/api/src/index.ts#L7252) | `decodeExchangeSecrets` | `decryptSecret` |
| [apps/api/src/index.ts:7253](../../../../apps/api/src/index.ts#L7253) | `decodeExchangeSecrets` | `decryptSecret` |
| [apps/api/src/index.ts:7254](../../../../apps/api/src/index.ts#L7254) | `decodeExchangeSecrets` | `decryptSecret` |
| [apps/api/src/manual-trading/routes-execution.ts:414](../../../../apps/api/src/manual-trading/routes-execution.ts#L414) | `registerManualTradingExecutionRoutes` | `spotClient.placeOrder` |
| [apps/api/src/manual-trading/routes-execution.ts:430](../../../../apps/api/src/manual-trading/routes-execution.ts#L430) | `registerManualTradingExecutionRoutes` | `perpExecutionService.placeOrder` |
| [apps/api/src/manual-trading/routes-execution.ts:514](../../../../apps/api/src/manual-trading/routes-execution.ts#L514) | `registerManualTradingExecutionRoutes` | `spotClient.editOrder` |
| [apps/api/src/manual-trading/routes-execution.ts:530](../../../../apps/api/src/manual-trading/routes-execution.ts#L530) | `registerManualTradingExecutionRoutes` | `perpExecutionService.editOrder` |
| [apps/api/src/manual-trading/routes-execution.ts:796](../../../../apps/api/src/manual-trading/routes-execution.ts#L796) | `registerManualTradingExecutionRoutes` | `spotClient!.placeOrder` |
| [apps/api/src/manual-trading/routes-execution.ts:804](../../../../apps/api/src/manual-trading/routes-execution.ts#L804) | `registerManualTradingExecutionRoutes` | `perpExecutionService.closePosition` |
| [apps/api/src/mobile/tradingRoutes.ts:596](../../../../apps/api/src/mobile/tradingRoutes.ts#L596) | `registerMobileTradingRoutes` | `spotClient.placeOrder` |
| [apps/api/src/mobile/tradingRoutes.ts:619](../../../../apps/api/src/mobile/tradingRoutes.ts#L619) | `registerMobileTradingRoutes` | `perpExecutionService.placeOrder` |
| [apps/api/src/mobile/tradingRoutes.ts:708](../../../../apps/api/src/mobile/tradingRoutes.ts#L708) | `registerMobileTradingRoutes` | `spotClient.placeOrder` |
| [apps/api/src/mobile/tradingRoutes.ts:720](../../../../apps/api/src/mobile/tradingRoutes.ts#L720) | `registerMobileTradingRoutes` | `perpExecutionService.closePosition` |
| [apps/api/src/secret-crypto.ts:62](../../../../apps/api/src/secret-crypto.ts#L62) | `decryptSecret` | `decryptSecretWithKey` |
| [apps/api/src/spot/bitget-spot.client.ts:451](../../../../apps/api/src/spot/bitget-spot.client.ts#L451) | `editOrder` | `this.placeOrder` |
| [apps/api/src/spot/hyperliquid-spot.client.ts:1057](../../../../apps/api/src/spot/hyperliquid-spot.client.ts#L1057) | `placeOrder` | `this.sdk.exchange.placeOrder` |
| [apps/api/src/spot/hyperliquid-spot.client.ts:1103](../../../../apps/api/src/spot/hyperliquid-spot.client.ts#L1103) | `editOrder` | `this.placeOrder` |
| [apps/api/src/spot/spot-client-factory.ts:319](../../../../apps/api/src/spot/spot-client-factory.ts#L319) | `placeOrder` | `this.client.placeOrder` |
| [apps/api/src/spot/spot-client-factory.ts:335](../../../../apps/api/src/spot/spot-client-factory.ts#L335) | `editOrder` | `this.placeOrder` |
| [apps/api/src/spot/spot-client-factory.ts:396](../../../../apps/api/src/spot/spot-client-factory.ts#L396) | `placeOrder` | `this.delegate.placeOrder` |
| [apps/api/src/spot/spot-client-factory.ts:401](../../../../apps/api/src/spot/spot-client-factory.ts#L401) | `editOrder` | `this.delegate.editOrder` |
| [apps/api/src/spot/spot-client-factory.ts:464](../../../../apps/api/src/spot/spot-client-factory.ts#L464) | `placeOrder` | `this.delegate.placeOrder` |
| [apps/api/src/spot/spot-client-factory.ts:468](../../../../apps/api/src/spot/spot-client-factory.ts#L468) | `editOrder` | `this.delegate.editOrder` |
| [apps/api/src/spot/spot-client-factory.ts:556](../../../../apps/api/src/spot/spot-client-factory.ts#L556) | `placeOrder` | `this.delegate.placeOrder` |
| [apps/api/src/spot/spot-client-factory.ts:569](../../../../apps/api/src/spot/spot-client-factory.ts#L569) | `editOrder` | `this.placeOrder` |
| [apps/api/src/spot/spot-client-factory.ts:668](../../../../apps/api/src/spot/spot-client-factory.ts#L668) | `placeOrder` | `delegate.placeOrder` |
| [apps/api/src/spot/spot-client-factory.ts:671](../../../../apps/api/src/spot/spot-client-factory.ts#L671) | `editOrder` | `delegate.editOrder` |
| [apps/api/src/trading.ts:682](../../../../apps/api/src/trading.ts#L682) | `placeOrder` | `this.adapter.placeOrder` |
| [apps/api/src/trading.ts:1177](../../../../apps/api/src/trading.ts#L1177) | `resolveTradingAccount` | `decryptSecret` |
| [apps/api/src/trading.ts:1178](../../../../apps/api/src/trading.ts#L1178) | `resolveTradingAccount` | `decryptSecret` |
| [apps/api/src/trading.ts:1179](../../../../apps/api/src/trading.ts#L1179) | `resolveTradingAccount` | `decryptSecret` |
| [apps/api/src/trading.ts:3373](../../../../apps/api/src/trading.ts#L3373) | `closePositionsMarket` | `adapter.closePosition` |
| [apps/api/src/trading.ts:3393](../../../../apps/api/src/trading.ts#L3393) | `editOpenOrder` | `adapter.editOrder` |
| [apps/api/src/vaults/agentSecretProvider.ts:249](../../../../apps/api/src/vaults/agentSecretProvider.ts#L249) | `getAgentCredentials` | `decryptSecretWithKey` |
| [apps/api/src/vaults/agentSecretProvider.ts:276](../../../../apps/api/src/vaults/agentSecretProvider.ts#L276) | `getAgentCredentials` | `decryptSecretWithKey` |
| [apps/api/src/vaults/agentSecretProvider.ts:291](../../../../apps/api/src/vaults/agentSecretProvider.ts#L291) | `getAgentCredentials` | `decryptSecretWithKey` |
| [apps/api/src/vaults/botVaultLifecycle.service.ts:155](../../../../apps/api/src/vaults/botVaultLifecycle.service.ts#L155) | `resolveExecutionVaultAddress` | `decryptSecret` |
| [apps/api/src/vaults/botVaultLifecycle.service.ts:394](../../../../apps/api/src/vaults/botVaultLifecycle.service.ts#L394) | `bestEffortFlattenExecutionExposure` | `decryptSecret` |
| [apps/api/src/vaults/botVaultLifecycle.service.ts:395](../../../../apps/api/src/vaults/botVaultLifecycle.service.ts#L395) | `bestEffortFlattenExecutionExposure` | `decryptSecret` |
| [apps/api/src/vaults/botVaultLifecycle.service.ts:397](../../../../apps/api/src/vaults/botVaultLifecycle.service.ts#L397) | `bestEffortFlattenExecutionExposure` | `decryptSecret` |
| [apps/api/src/vaults/botVaultV3.service.ts:3356](../../../../apps/api/src/vaults/botVaultV3.service.ts#L3356) | `resolveExecutionCloseoutAccount` | `decryptSecretValue` |
| [apps/api/src/vaults/botVaultV3.service.ts:3357](../../../../apps/api/src/vaults/botVaultV3.service.ts#L3357) | `resolveExecutionCloseoutAccount` | `decryptSecretValue` |
| [apps/api/src/vaults/botVaultV3.service.ts:5644](../../../../apps/api/src/vaults/botVaultV3.service.ts#L5644) | `bestEffortSettleHypercoreExit` | `adapterAny.transferUsdClass` |
| [apps/api/src/vaults/botVaultV3.service.ts:7127](../../../../apps/api/src/vaults/botVaultV3.service.ts#L7127) | `settleClaimProfitToEvm` | `adapterAny.transferUsdClass` |
| [apps/api/src/vaults/botVaultV3.service.ts:8563](../../../../apps/api/src/vaults/botVaultV3.service.ts#L8563) | `finalizeMarginAdd` | `adapterAny.transferUsdClass` |
| [apps/api/src/vaults/botVaultV3.service.ts:9403](../../../../apps/api/src/vaults/botVaultV3.service.ts#L9403) | `reduceMargin` | `adapterAny.transferUsdClass` |
| [apps/api/src/vaults/executionProvider.hyperliquid.ts:184](../../../../apps/api/src/vaults/executionProvider.hyperliquid.ts#L184) | `decodeHyperliquidSecrets` | `decryptSecret` |
| [apps/api/src/vaults/executionProvider.hyperliquid.ts:185](../../../../apps/api/src/vaults/executionProvider.hyperliquid.ts#L185) | `decodeHyperliquidSecrets` | `decryptSecret` |
| [apps/api/src/vaults/executionProvider.hyperliquid.ts:186](../../../../apps/api/src/vaults/executionProvider.hyperliquid.ts#L186) | `decodeHyperliquidSecrets` | `decryptSecret` |
| [apps/api/src/vaults/onchainAction.service.ts:980](../../../../apps/api/src/vaults/onchainAction.service.ts#L980) | `buildCreateBotVault` | `decryptSecret` |
| [apps/runner/src/db.ts:542](../../../../apps/runner/src/db.ts#L542) | `decodeCredentials` | `decryptSecret` |
| [apps/runner/src/db.ts:543](../../../../apps/runner/src/db.ts#L543) | `decodeCredentials` | `decryptSecret` |
| [apps/runner/src/db.ts:544](../../../../apps/runner/src/db.ts#L544) | `decodeCredentials` | `decryptSecret` |
| [apps/runner/src/execution/agentSecretProvider.ts:241](../../../../apps/runner/src/execution/agentSecretProvider.ts#L241) | `getAgentCredentials` | `decryptSecretWithKey` |
| [apps/runner/src/execution/agentSecretProvider.ts:283](../../../../apps/runner/src/execution/agentSecretProvider.ts#L283) | `getAgentCredentials` | `decryptSecretWithKey` |
| [apps/runner/src/execution/agentSecretProvider.ts:299](../../../../apps/runner/src/execution/agentSecretProvider.ts#L299) | `getAgentCredentials` | `decryptSecretWithKey` |
| [apps/runner/src/execution/futuresGridExecutionMode.ts:2121](../../../../apps/runner/src/execution/futuresGridExecutionMode.ts#L2121) | `execute` | `adapterAny.transferUsdClass` |
| [apps/runner/src/execution/futuresGridExecutionMode.ts:2823](../../../../apps/runner/src/execution/futuresGridExecutionMode.ts#L2823) | `execute` | `adapterAny.transferUsdClass` |
| [apps/runner/src/execution/futuresGridExecutionMode.ts:3123](../../../../apps/runner/src/execution/futuresGridExecutionMode.ts#L3123) | `execute` | `adapter.placeOrder` |
| [apps/runner/src/execution/gridOrderExecution.ts:71](../../../../apps/runner/src/execution/gridOrderExecution.ts#L71) | `executeMappedIntentViaAdapter` | `params.adapter.placeOrder` |
| [apps/runner/src/execution/gridOrderExecution.ts:246](../../../../apps/runner/src/execution/gridOrderExecution.ts#L246) | `closeGridResidualPositionBestEffort` | `params.adapter.placeOrder` |
| [apps/runner/src/secret-crypto.ts:47](../../../../apps/runner/src/secret-crypto.ts#L47) | `decryptSecret` | `decryptSecretWithKey` |
| [packages/exchange/src/ccxt/ccxt.client.ts:303](../../../../packages/exchange/src/ccxt/ccxt.client.ts#L303) | `placeOrder` | `this.exchange.createOrder` |
| [packages/futures-exchange/src/binance/binance.adapter.ts:406](../../../../packages/futures-exchange/src/binance/binance.adapter.ts#L406) | `placeOrder` | `this.placeNormalizedOrder` |
| [packages/futures-exchange/src/binance/binance.adapter.ts:479](../../../../packages/futures-exchange/src/binance/binance.adapter.ts#L479) | `placeNormalizedOrder` | `this.tradeApi.placeOrder` |
| [packages/futures-exchange/src/binance/binance.adapter.ts:651](../../../../packages/futures-exchange/src/binance/binance.adapter.ts#L651) | `closePosition` | `this.placeOrder` |
| [packages/futures-exchange/src/binance/binance.adapter.ts:1136](../../../../packages/futures-exchange/src/binance/binance.adapter.ts#L1136) | `placeConditionalCloseOrder` | `this.tradeApi.placeOrder` |
| [packages/futures-exchange/src/bingx/bingx.adapter.ts:582](../../../../packages/futures-exchange/src/bingx/bingx.adapter.ts#L582) | `placeOrder` | `this.placeNormalizedOrder` |
| [packages/futures-exchange/src/bingx/bingx.adapter.ts:651](../../../../packages/futures-exchange/src/bingx/bingx.adapter.ts#L651) | `placeNormalizedOrder` | `this.tradeApi.placeOrder` |
| [packages/futures-exchange/src/bingx/bingx.adapter.ts:772](../../../../packages/futures-exchange/src/bingx/bingx.adapter.ts#L772) | `editOrder` | `this.tradeApi.placeOrder` |
| [packages/futures-exchange/src/bingx/bingx.adapter.ts:850](../../../../packages/futures-exchange/src/bingx/bingx.adapter.ts#L850) | `closePosition` | `this.placeOrder` |
| [packages/futures-exchange/src/bingx/bingx.adapter.ts:1102](../../../../packages/futures-exchange/src/bingx/bingx.adapter.ts#L1102) | `placeConditionalCloseOrder` | `this.tradeApi.placeOrder` |
| [packages/futures-exchange/src/bitget/bitget.adapter.ts:344](../../../../packages/futures-exchange/src/bitget/bitget.adapter.ts#L344) | `placeOrder` | `this.placeNormalizedOrder` |
| [packages/futures-exchange/src/bitget/bitget.adapter.ts:384](../../../../packages/futures-exchange/src/bitget/bitget.adapter.ts#L384) | `place` | `this.tradeApi.placeOrder` |
| [packages/futures-exchange/src/bitget/bitget.adapter.ts:583](../../../../packages/futures-exchange/src/bitget/bitget.adapter.ts#L583) | `placeClose` | `this.placeOrder` |
| [packages/futures-exchange/src/bitget/fixes/bitget-order-edit.fix.ts:294](../../../../packages/futures-exchange/src/bitget/fixes/bitget-order-edit.fix.ts#L294) | `editBitgetOpenOrder` | `params.adapter.placeOrder` |
| [packages/futures-exchange/src/bitget/fixes/bitget-order-edit.fix.ts:349](../../../../packages/futures-exchange/src/bitget/fixes/bitget-order-edit.fix.ts#L349) | `editBitgetOpenOrder` | `params.adapter.placeOrder` |
| [packages/futures-exchange/src/hyperliquid/hyperliquid.adapter.ts:699](../../../../packages/futures-exchange/src/hyperliquid/hyperliquid.adapter.ts#L699) | `placeOrder` | `this.tradeApi.placeOrder` |
| [packages/futures-exchange/src/hyperliquid/hyperliquid.adapter.ts:918](../../../../packages/futures-exchange/src/hyperliquid/hyperliquid.adapter.ts#L918) | `closePosition` | `this.placeOrder` |
| [packages/futures-exchange/src/hyperliquid/hyperliquid.trade.api.ts:288](../../../../packages/futures-exchange/src/hyperliquid/hyperliquid.trade.api.ts#L288) | `placeTriggerOrder` | `this.sdk.exchange.placeOrder` |
| [packages/futures-exchange/src/hyperliquid/hyperliquid.trade.api.ts:374](../../../../packages/futures-exchange/src/hyperliquid/hyperliquid.trade.api.ts#L374) | `placeOrder` | `this.sdk.exchange.placeOrder` |
| [packages/futures-exchange/src/hyperliquid/hyperliquid.trade.api.ts:480](../../../../packages/futures-exchange/src/hyperliquid/hyperliquid.trade.api.ts#L480) | `modifyOrder` | `this.placeOrder` |
| [packages/futures-exchange/src/mexc/mexc.adapter.ts:475](../../../../packages/futures-exchange/src/mexc/mexc.adapter.ts#L475) | `submitPreparedOrder` | `this.tradingApi.submitOrder` |
| [packages/futures-exchange/src/mexc/mexc.adapter.ts:666](../../../../packages/futures-exchange/src/mexc/mexc.adapter.ts#L666) | `closePosition` | `this.placeOrder` |
| [packages/futures-engine/src/engine.ts:175](../../../../packages/futures-engine/src/engine.ts#L175) | `placeViaExchangeAdapter` | `this.ex.placeNormalizedOrder` |
| [packages/futures-engine/src/engine.ts:187](../../../../packages/futures-engine/src/engine.ts#L187) | `placeViaExchangeAdapter` | `this.ex.placeOrder` |

## Web admin page inventory

All following Next pages are presentation/redirect surfaces. Their client access gates are not backend authorization. Data/actions are protected (or missing protection) as shown in the API matrix. No `use server` actions or Next `route.ts` API handlers were found in the web application source. Locale routing adds locale prefixes; catch-all routes delegate presentation, not new privileged backend handlers.

| Page | Route |
|---|---|
| [apps/web/app/admin/access-section/page.tsx:1](../../../../apps/web/app/admin/access-section/page.tsx#L1) | `/admin/access-section` |
| [apps/web/app/admin/affiliate/page.tsx:1](../../../../apps/web/app/admin/affiliate/page.tsx#L1) | `/admin/affiliate` |
| [apps/web/app/admin/ai-prompts/page.tsx:1](../../../../apps/web/app/admin/ai-prompts/page.tsx#L1) | `/admin/ai-prompts` |
| [apps/web/app/admin/ai-trace/page.tsx:1](../../../../apps/web/app/admin/ai-trace/page.tsx#L1) | `/admin/ai-trace` |
| [apps/web/app/admin/alerts/page.tsx:1](../../../../apps/web/app/admin/alerts/page.tsx#L1) | `/admin/alerts` |
| [apps/web/app/admin/api-keys/page.tsx:1](../../../../apps/web/app/admin/api-keys/page.tsx#L1) | `/admin/api-keys` |
| [apps/web/app/admin/audit/page.tsx:1](../../../../apps/web/app/admin/audit/page.tsx#L1) | `/admin/audit` |
| [apps/web/app/admin/billing/page.tsx:1](../../../../apps/web/app/admin/billing/page.tsx#L1) | `/admin/billing` |
| [apps/web/app/admin/bots/page.tsx:1](../../../../apps/web/app/admin/bots/page.tsx#L1) | `/admin/bots` |
| [apps/web/app/admin/exchanges/page.tsx:1](../../../../apps/web/app/admin/exchanges/page.tsx#L1) | `/admin/exchanges` |
| [apps/web/app/admin/grid-hyperliquid-pilot/page.tsx:1](../../../../apps/web/app/admin/grid-hyperliquid-pilot/page.tsx#L1) | `/admin/grid-hyperliquid-pilot` |
| [apps/web/app/admin/grid-templates/[id]/page.tsx:1](../../../../apps/web/app/admin/grid-templates/[id]/page.tsx#L1) | `/admin/grid-templates/[id]` |
| [apps/web/app/admin/grid-templates/page.tsx:1](../../../../apps/web/app/admin/grid-templates/page.tsx#L1) | `/admin/grid-templates` |
| [apps/web/app/admin/indicator-settings/page.tsx:1](../../../../apps/web/app/admin/indicator-settings/page.tsx#L1) | `/admin/indicator-settings` |
| [apps/web/app/admin/legacy/[...slug]/page.tsx:1](../../../../apps/web/app/admin/legacy/[...slug]/page.tsx#L1) | `/admin/legacy/[...slug]` |
| [apps/web/app/admin/legacy/grid-templates/[id]/page.tsx:1](../../../../apps/web/app/admin/legacy/grid-templates/[id]/page.tsx#L1) | `/admin/legacy/grid-templates/[id]` |
| [apps/web/app/admin/legacy/page.tsx:1](../../../../apps/web/app/admin/legacy/page.tsx#L1) | `/admin/legacy` |
| [apps/web/app/admin/licenses/packages/page.tsx:1](../../../../apps/web/app/admin/licenses/packages/page.tsx#L1) | `/admin/licenses/packages` |
| [apps/web/app/admin/licenses/page.tsx:1](../../../../apps/web/app/admin/licenses/page.tsx#L1) | `/admin/licenses` |
| [apps/web/app/admin/page.tsx:1](../../../../apps/web/app/admin/page.tsx#L1) | `/admin` |
| [apps/web/app/admin/prediction-defaults/page.tsx:1](../../../../apps/web/app/admin/prediction-defaults/page.tsx#L1) | `/admin/prediction-defaults` |
| [apps/web/app/admin/prediction-refresh/page.tsx:1](../../../../apps/web/app/admin/prediction-refresh/page.tsx#L1) | `/admin/prediction-refresh` |
| [apps/web/app/admin/providers/page.tsx:1](../../../../apps/web/app/admin/providers/page.tsx#L1) | `/admin/providers` |
| [apps/web/app/admin/runners/page.tsx:1](../../../../apps/web/app/admin/runners/page.tsx#L1) | `/admin/runners` |
| [apps/web/app/admin/server-info/page.tsx:1](../../../../apps/web/app/admin/server-info/page.tsx#L1) | `/admin/server-info` |
| [apps/web/app/admin/smtp/page.tsx:1](../../../../apps/web/app/admin/smtp/page.tsx#L1) | `/admin/smtp` |
| [apps/web/app/admin/statistics/page.tsx:1](../../../../apps/web/app/admin/statistics/page.tsx#L1) | `/admin/statistics` |
| [apps/web/app/admin/strategies/ai/page.tsx:1](../../../../apps/web/app/admin/strategies/ai/page.tsx#L1) | `/admin/strategies/ai` |
| [apps/web/app/admin/strategies/ai-generator/page.tsx:1](../../../../apps/web/app/admin/strategies/ai-generator/page.tsx#L1) | `/admin/strategies/ai-generator` |
| [apps/web/app/admin/strategies/builder/page.tsx:1](../../../../apps/web/app/admin/strategies/builder/page.tsx#L1) | `/admin/strategies/builder` |
| [apps/web/app/admin/strategies/local/page.tsx:1](../../../../apps/web/app/admin/strategies/local/page.tsx#L1) | `/admin/strategies/local` |
| [apps/web/app/admin/strategies/page.tsx:1](../../../../apps/web/app/admin/strategies/page.tsx#L1) | `/admin/strategies` |
| [apps/web/app/admin/system/[...slug]/page.tsx:1](../../../../apps/web/app/admin/system/[...slug]/page.tsx#L1) | `/admin/system/[...slug]` |
| [apps/web/app/admin/system/ai/grid-templates/[id]/page.tsx:1](../../../../apps/web/app/admin/system/ai/grid-templates/[id]/page.tsx#L1) | `/admin/system/ai/grid-templates/[id]` |
| [apps/web/app/admin/system/ai/grid-templates/page.tsx:1](../../../../apps/web/app/admin/system/ai/grid-templates/page.tsx#L1) | `/admin/system/ai/grid-templates` |
| [apps/web/app/admin/system/bots/grid-templates/[id]/page.tsx:1](../../../../apps/web/app/admin/system/bots/grid-templates/[id]/page.tsx#L1) | `/admin/system/bots/grid-templates/[id]` |
| [apps/web/app/admin/system/bots/grid-templates/page.tsx:1](../../../../apps/web/app/admin/system/bots/grid-templates/page.tsx#L1) | `/admin/system/bots/grid-templates` |
| [apps/web/app/admin/system/page.tsx:1](../../../../apps/web/app/admin/system/page.tsx#L1) | `/admin/system` |
| [apps/web/app/admin/system/ui-components/page.tsx:1](../../../../apps/web/app/admin/system/ui-components/page.tsx#L1) | `/admin/system/ui-components` |
| [apps/web/app/admin/telegram/page.tsx:1](../../../../apps/web/app/admin/telegram/page.tsx#L1) | `/admin/telegram` |
| [apps/web/app/admin/uliq/page.tsx:1](../../../../apps/web/app/admin/uliq/page.tsx#L1) | `/admin/uliq` |
| [apps/web/app/admin/users/[id]/page.tsx:1](../../../../apps/web/app/admin/users/[id]/page.tsx#L1) | `/admin/users/[id]` |
| [apps/web/app/admin/users/page.tsx:1](../../../../apps/web/app/admin/users/page.tsx#L1) | `/admin/users` |
| [apps/web/app/admin/vault-execution/page.tsx:1](../../../../apps/web/app/admin/vault-execution/page.tsx#L1) | `/admin/vault-execution` |
| [apps/web/app/admin/vault-operations/page.tsx:1](../../../../apps/web/app/admin/vault-operations/page.tsx#L1) | `/admin/vault-operations` |
| [apps/web/app/admin/vault-safety/page.tsx:1](../../../../apps/web/app/admin/vault-safety/page.tsx#L1) | `/admin/vault-safety` |
| [apps/web/app/admin/workspaces/[id]/page.tsx:1](../../../../apps/web/app/admin/workspaces/[id]/page.tsx#L1) | `/admin/workspaces/[id]` |
| [apps/web/app/admin/workspaces/page.tsx:1](../../../../apps/web/app/admin/workspaces/page.tsx#L1) | `/admin/workspaces` |

`apps/web/app/admin/providers/page 2.tsx` is a duplicate source file, not a Next `page.tsx` route.


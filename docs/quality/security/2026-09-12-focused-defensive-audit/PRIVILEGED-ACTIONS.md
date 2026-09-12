# Privileged route-to-service action inventory

Read with [the authorization matrix](ADMIN-AUTHORIZATION-MATRIX.md) and [report](README.md).

Each item below enumerates the protected handler and its direct injected service/Prisma/helper calls. Methods are ordinary in-process functions, not independently authenticated RPCs. They inherit the P/B gate only when reached through this handler. Service methods accepting `userId` trust their caller to supply the principal; owner checks within vault services bind the row to that supplied user, not to an independently authenticated session. Background callers have service authority. Serialization/read helpers are included so no response-producing privileged action is hidden. This inventory does not imply each helper is itself privileged.

## GET /admin/settings/affiliate-program

[apps/api/src/admin/routes-affiliate.ts:70](../../../../apps/api/src/admin/routes-affiliate.ts#L70) · `registerAdminAffiliateRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `getAffiliateProgramSettings`

## PUT /admin/settings/affiliate-program

[apps/api/src/admin/routes-affiliate.ts:75](../../../../apps/api/src/admin/routes-affiliate.ts#L75) · `registerAdminAffiliateRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `getUserFromLocals`; `getAffiliateProgramSettings`; `setAffiliateProgramSettings`; `deps.recordAdminAuditEvent`

## GET /admin/affiliate/summary

[apps/api/src/admin/routes-affiliate.ts:115](../../../../apps/api/src/admin/routes-affiliate.ts#L115) · `registerAdminAffiliateRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `getAffiliateProgramSettings`; `getAffiliateProgramSummary`

## GET /admin/users/:id/affiliate

[apps/api/src/admin/routes-affiliate.ts:124](../../../../apps/api/src/admin/routes-affiliate.ts#L124) · `registerAdminAffiliateRoutes` · P · A · scope targeted global administration.

`deps.requireSuperadmin`; `getAdminAffiliateUserDetail`

## PUT /admin/users/:id/affiliate

[apps/api/src/admin/routes-affiliate.ts:132](../../../../apps/api/src/admin/routes-affiliate.ts#L132) · `registerAdminAffiliateRoutes` · P · A · scope targeted global administration.

`deps.requireSuperadmin`; `getUserFromLocals`; `setAffiliateRateOverride`; `deps.recordAdminAuditEvent`; `getAdminAffiliateUserDetail`

## POST /admin/users/:id/referral

[apps/api/src/admin/routes-affiliate.ts:177](../../../../apps/api/src/admin/routes-affiliate.ts#L177) · `registerAdminAffiliateRoutes` · P · A · scope targeted global administration.

`deps.requireSuperadmin`; `getUserFromLocals`; `clearAffiliateReferral`; `deps.recordAdminAuditEvent`; `getAdminAffiliateUserDetail`; `resolveAffiliateUserIdByCode`

## GET /admin/settings/api-keys

[apps/api/src/admin/routes-api-keys.ts:120](../../../../apps/api/src/admin/routes-api-keys.ts#L120) · `registerAdminApiKeyRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.db.globalSetting.findUnique`; `deps.parseStoredApiKeysSettings`; `deps.resolveEffectiveAiProvider`; `deps.resolveEffectiveAiBaseUrl`; `deps.resolveEffectiveAiModel`; `deps.resolveEffectiveAiModelRouting`; `deps.toPublicApiKeysSettings`

## GET /admin/settings/api-keys/status

[apps/api/src/admin/routes-api-keys.ts:153](../../../../apps/api/src/admin/routes-api-keys.ts#L153) · `registerAdminApiKeyRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.externalHealthService.checkAi`

## GET /admin/settings/api-keys/salad-runtime/status

[apps/api/src/admin/routes-api-keys.ts:158](../../../../apps/api/src/admin/routes-api-keys.ts#L158) · `registerAdminApiKeyRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.externalHealthService.checkSaladRuntime`; `resolveSaladRuntimeHttpStatus`

## POST /admin/settings/api-keys/salad-runtime/start

[apps/api/src/admin/routes-api-keys.ts:167](../../../../apps/api/src/admin/routes-api-keys.ts#L167) · `registerAdminApiKeyRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.db.globalSetting.findUnique`; `deps.parseStoredApiKeysSettings`; `deps.resolveSaladRuntimeConfig`; `deps.resolveEffectiveAiProvider`; `deps.resolveAiProfileApiKey`; `deps.startSaladContainer`; `deps.getSaladRuntimeStatus`; `resolveSaladRuntimeHttpStatus`

## POST /admin/settings/api-keys/salad-runtime/stop

[apps/api/src/admin/routes-api-keys.ts:192](../../../../apps/api/src/admin/routes-api-keys.ts#L192) · `registerAdminApiKeyRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.db.globalSetting.findUnique`; `deps.parseStoredApiKeysSettings`; `deps.resolveSaladRuntimeConfig`; `deps.resolveEffectiveAiProvider`; `deps.resolveAiProfileApiKey`; `deps.stopSaladContainer`; `deps.getSaladRuntimeStatus`; `resolveSaladRuntimeHttpStatus`

## PUT /admin/settings/api-keys

[apps/api/src/admin/routes-api-keys.ts:217](../../../../apps/api/src/admin/routes-api-keys.ts#L217) · `registerAdminApiKeyRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.parseStoredApiKeysSettings`; `deps.getGlobalSettingValue`; `deps.normalizeProviderForProfile`; `deps.encryptSecret`; `deps.emptySaladRuntimeSettings`; `deps.setGlobalSettingValue`; `deps.resolveEffectiveAiProvider`; `deps.resolveEffectiveAiBaseUrl`; `deps.resolveEffectiveAiModel`; `deps.resolveEffectiveAiModelRouting`; `deps.invalidateAiApiKeyCache`; `deps.invalidateAiModelCache`; `deps.toPublicApiKeysSettings`

## GET /api/admin/indicator-settings

[apps/api/src/admin/routes-indicator-settings.ts:21](../../../../apps/api/src/admin/routes-indicator-settings.ts#L21) · `registerAdminIndicatorSettingsRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.db.indicatorSetting.findMany`; `deps.normalizeIndicatorSettingsPatch`; `deps.mergeIndicatorSettings`

## GET /api/admin/indicator-settings/resolved

[apps/api/src/admin/routes-indicator-settings.ts:48](../../../../apps/api/src/admin/routes-indicator-settings.ts#L48) · `registerAdminIndicatorSettingsRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.resolveIndicatorSettings`; `deps.normalizeIndicatorSettingExchange`; `deps.normalizeIndicatorSettingAccountId`; `deps.normalizeIndicatorSettingSymbol`; `deps.normalizeIndicatorSettingTimeframe`

## POST /api/admin/indicator-settings

[apps/api/src/admin/routes-indicator-settings.ts:64](../../../../apps/api/src/admin/routes-indicator-settings.ts#L64) · `registerAdminIndicatorSettingsRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.normalizeIndicatorSettingsPatch`; `deps.normalizeIndicatorSettingExchange`; `deps.normalizeIndicatorSettingAccountId`; `deps.normalizeIndicatorSettingSymbol`; `deps.normalizeIndicatorSettingTimeframe`; `deps.db.indicatorSetting.findFirst`; `deps.db.indicatorSetting.create`; `deps.clearIndicatorSettingsCache`; `deps.mergeIndicatorSettings`

## PUT /api/admin/indicator-settings/:id

[apps/api/src/admin/routes-indicator-settings.ts:100](../../../../apps/api/src/admin/routes-indicator-settings.ts#L100) · `registerAdminIndicatorSettingsRoutes` · B · A · scope targeted global administration.

`deps.requireSuperadmin`; `deps.db.indicatorSetting.findUnique`; `deps.normalizeIndicatorSettingsPatch`; `deps.normalizeIndicatorSettingExchange`; `deps.normalizeIndicatorSettingAccountId`; `deps.normalizeIndicatorSettingSymbol`; `deps.normalizeIndicatorSettingTimeframe`; `deps.db.indicatorSetting.findFirst`; `deps.db.indicatorSetting.update`; `deps.clearIndicatorSettingsCache`; `deps.mergeIndicatorSettings`

## DELETE /api/admin/indicator-settings/:id

[apps/api/src/admin/routes-indicator-settings.ts:140](../../../../apps/api/src/admin/routes-indicator-settings.ts#L140) · `registerAdminIndicatorSettingsRoutes` · B · A · scope targeted global administration.

`deps.requireSuperadmin`; `deps.db.indicatorSetting.findUnique`; `deps.db.indicatorSetting.delete`; `deps.clearIndicatorSettingsCache`

## POST /admin/users

[apps/api/src/admin/routes-operations.ts:160](../../../../apps/api/src/admin/routes-operations.ts#L160) · `registerAdminOperationsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `getUserFromLocals`; `deps.db.user.findUnique`; `deps.generateTempPassword`; `deps.hashPassword`; `deps.db.user.create`; `deps.ensureWorkspaceMembership`; `deps.ensureDefaultPaperTradingAccount`; `deps.recordAdminAuditEvent`

## PUT /admin/users/:id/password

[apps/api/src/admin/routes-operations.ts:218](../../../../apps/api/src/admin/routes-operations.ts#L218) · `registerAdminOperationsRoutes` · P · A · scope targeted global administration.

`deps.requireSuperadmin`; `getUserFromLocals`; `deps.db.user.findUnique`; `deps.db.user.update`; `deps.hashPassword`; `deps.db.session.deleteMany`; `deps.recordAdminAuditEvent`

## PUT /admin/users/:id/admin-access

[apps/api/src/admin/routes-operations.ts:255](../../../../apps/api/src/admin/routes-operations.ts#L255) · `registerAdminOperationsRoutes` · P · A · scope targeted global administration.

`deps.requireSuperadmin`; `getUserFromLocals`; `deps.db.user.findUnique`; `deps.isSuperadminEmail`; `deps.parseStoredAdminBackendAccess`; `deps.getGlobalSettingValue`; `deps.db.session.deleteMany`; `deps.setGlobalSettingValue`; `deps.recordAdminAuditEvent`

## PUT /admin/users/:id/plan-override

[apps/api/src/admin/routes-operations.ts:304](../../../../apps/api/src/admin/routes-operations.ts#L304) · `registerAdminOperationsRoutes` · P · A · scope targeted global administration.

`deps.requireSuperadmin`; `getUserFromLocals`; `deps.db.user.findUnique`; `deps.getAdminPlanOverrideForUser`; `deps.setAdminPlanOverrideForUser`; `deps.revokeAdminPlanOverrideForUser`; `deps.resolveCommercialPlanForUser`; `deps.resolveEffectivePlanForUser`; `deps.syncPrimaryWorkspaceEntitlementsForUser`; `deps.recordAdminAuditEvent`

## DELETE /admin/users/:id

[apps/api/src/admin/routes-operations.ts:383](../../../../apps/api/src/admin/routes-operations.ts#L383) · `registerAdminOperationsRoutes` · P · A · scope targeted global administration.

`deps.requireSuperadmin`; `getUserFromLocals`; `deps.db.user.findUnique`; `deps.isSuperadminEmail`; `deps.db.bot.findMany`; `deps.db.$transaction`; `deps.ignoreMissingTable`; `tx.botMetric.deleteMany`; `tx.botAlert.deleteMany`; `tx.riskEvent.deleteMany`; `tx.botRuntime.deleteMany`; `tx.botTradeHistory.deleteMany`; `tx.futuresBotConfig.deleteMany`; `tx.marketMakingConfig.deleteMany`; `tx.volumeConfig.deleteMany`; `tx.riskConfig.deleteMany`; `tx.botNotificationConfig.deleteMany`; `tx.botPriceSupportConfig.deleteMany`; `tx.botFillCursor.deleteMany`; `tx.botFillSeen.deleteMany`; `tx.botOrderMap.deleteMany`; `tx.manualTradeLog.deleteMany`; `tx.bot.deleteMany`; `tx.prediction.deleteMany`; `tx.predictionState.deleteMany`; `tx.exchangeAccount.deleteMany`; `tx.botConfigPreset.deleteMany`; `tx.auditEvent.deleteMany`; `tx.workspaceMember.deleteMany`; `tx.reauthOtp.deleteMany`; `tx.reauthSession.deleteMany`; `tx.session.deleteMany`; `tx.user.delete`; `deps.parseStoredAdminBackendAccess`; `deps.getGlobalSettingValue`; `deps.setGlobalSettingValue`; `deps.recordAdminAuditEvent`

## GET /admin/settings/telegram

[apps/api/src/admin/routes-operations.ts:459](../../../../apps/api/src/admin/routes-operations.ts#L459) · `registerAdminOperationsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.db.alertConfig.findUnique`; `deps.parseTelegramConfigValue`; `deps.normalizeTelegramChatId`; `deps.maskSecret`

## PUT /admin/settings/telegram

[apps/api/src/admin/routes-operations.ts:480](../../../../apps/api/src/admin/routes-operations.ts#L480) · `registerAdminOperationsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.db.alertConfig.findUnique`; `deps.parseTelegramConfigValue`; `resolveAdminTelegramUpdate`; `deps.normalizeTelegramChatId`; `deps.findTelegramChatIdConflict`; `deps.buildTelegramChatIdConflictResponse`; `deps.db.alertConfig.upsert`; `deps.maskSecret`

## POST /admin/settings/telegram/test

[apps/api/src/admin/routes-operations.ts:547](../../../../apps/api/src/admin/routes-operations.ts#L547) · `registerAdminOperationsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `getUserFromLocals`; `deps.resolveSystemTelegramConfig`; `deps.sendTelegramMessage`

## GET /admin/settings/exchanges

[apps/api/src/admin/routes-operations.ts:575](../../../../apps/api/src/admin/routes-operations.ts#L575) · `registerAdminOperationsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.getAllowedExchangeValues`; `deps.getExchangeOptionsResponse`

## GET /admin/venue-health/summary

[apps/api/src/admin/routes-operations.ts:584](../../../../apps/api/src/admin/routes-operations.ts#L584) · `registerAdminOperationsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.getAllowedExchangeValues`; `deps.db.exchangeAccount.findMany`; `deps.normalizeExchangeValue`; `deps.getRuntimeEnabledExchangeValues`; `deps.getExchangeOptionsResponse`; `getFuturesVenueCapabilities`; `runtimeEnabled.has`

## PUT /admin/settings/exchanges

[apps/api/src/admin/routes-operations.ts:721](../../../../apps/api/src/admin/routes-operations.ts#L721) · `registerAdminOperationsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.EXCHANGE_OPTION_VALUES.has`; `deps.getRuntimeEnabledExchangeValues`; `deps.setGlobalSettingValue`; `deps.getExchangeOptionsResponse`

## GET /admin/settings/smtp

[apps/api/src/admin/routes-operations.ts:748](../../../../apps/api/src/admin/routes-operations.ts#L748) · `registerAdminOperationsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.db.globalSetting.findUnique`; `deps.parseStoredSmtpSettings`; `deps.toPublicSmtpSettings`

## PUT /admin/settings/smtp

[apps/api/src/admin/routes-operations.ts:773](../../../../apps/api/src/admin/routes-operations.ts#L773) · `registerAdminOperationsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.parseStoredSmtpSettings`; `deps.getGlobalSettingValue`; `deps.encryptSecret`; `deps.setGlobalSettingValue`; `deps.toPublicSmtpSettings`

## POST /admin/settings/smtp/test

[apps/api/src/admin/routes-operations.ts:805](../../../../apps/api/src/admin/routes-operations.ts#L805) · `registerAdminOperationsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.sendSmtpTestEmail`

## GET /admin/overview

[apps/api/src/admin/routes-platform.ts:619](../../../../apps/api/src/admin/routes-platform.ts#L619) · `registerPlatformAdminRoutes` · P · A · scope global administration.

`deps.requirePlatformSuperadmin`; `deps.db.user.count`; `deps.db.workspace.count`; `deps.db.bot.count`; `deps.db.platformAlert.count`; `deps.db.userSubscription.findMany`; `deps.db.runnerNode.findMany`; `deps.db.botRuntime.findMany`; `deps.db.platformAlert.findMany`; `deps.db.adminAuditEvent.findMany`; `deps.db.bot.findMany`; `runnerRuntimeMap.get`; `deps.db.user.findMany`; `startOfDay`

## GET /admin/users

[apps/api/src/admin/routes-platform.ts:810](../../../../apps/api/src/admin/routes-platform.ts#L810) · `registerPlatformAdminRoutes` · P · A · scope global administration.

`deps.requirePlatformSuperadmin`; `getConfiguredSuperadminEmails`; `buildSearchWhere`; `buildUserStatusWhere`; `buildUserRoleWhere`; `buildUserLicenseStatusWhere`; `deps.db.user.count`; `deps.db.user.findMany`; `deps.getAdminBackendAccessUserIdSet`; `deps.isSuperadminEmail`

## GET /admin/users/:id

[apps/api/src/admin/routes-platform.ts:974](../../../../apps/api/src/admin/routes-platform.ts#L974) · `registerPlatformAdminRoutes` · P · A · scope targeted global administration.

`deps.requirePlatformSuperadmin`; `deps.db.user.findUnique`; `deps.getAdminBackendAccessUserIdSet`; `deps.db.platformAlert.findMany`; `deps.db.adminAuditEvent.findMany`; `deps.db.auditEvent.findMany`; `deps.resolveCommercialPlanForUser`; `deps.resolveEffectivePlanForUser`; `deps.getAdminPlanOverrideForUser`; `deps.isSuperadminEmail`

## GET /admin/workspaces

[apps/api/src/admin/routes-platform.ts:1242](../../../../apps/api/src/admin/routes-platform.ts#L1242) · `registerPlatformAdminRoutes` · P · A · scope global administration.

`deps.requirePlatformSuperadmin`; `buildSearchWhere`; `buildWorkspaceStatusWhere`; `buildWorkspaceLicenseStatusWhere`; `deps.db.workspace.count`; `deps.db.workspace.findMany`; `buildWorkspaceOwnerMap`; `deps.db.bot.findMany`

## GET /admin/workspaces/:id

[apps/api/src/admin/routes-platform.ts:1325](../../../../apps/api/src/admin/routes-platform.ts#L1325) · `registerPlatformAdminRoutes` · P · A · scope targeted global administration.

`deps.requirePlatformSuperadmin`; `deps.db.workspace.findUnique`; `deps.db.platformAlert.findMany`; `deps.db.adminAuditEvent.findMany`; `deps.db.auditEvent.findMany`

## GET /admin/licenses

[apps/api/src/admin/routes-platform.ts:1495](../../../../apps/api/src/admin/routes-platform.ts#L1495) · `registerPlatformAdminRoutes` · P · A · scope global administration.

`deps.requirePlatformSuperadmin`; `buildSubscriptionLicenseStatusWhere`; `deps.db.userSubscription.count`; `deps.db.userSubscription.findMany`

## GET /admin/alerts

[apps/api/src/admin/routes-platform.ts:1595](../../../../apps/api/src/admin/routes-platform.ts#L1595) · `registerPlatformAdminRoutes` · P · A · scope global administration.

`deps.requirePlatformSuperadmin`; `getPlatformAlertRetentionSettings`; `deps.db.platformAlert.count`; `deps.db.platformAlert.findMany`

## PUT /admin/alerts/retention

[apps/api/src/admin/routes-platform.ts:1670](../../../../apps/api/src/admin/routes-platform.ts#L1670) · `registerPlatformAdminRoutes` · P · A · scope global administration.

`deps.requirePlatformSuperadmin`; `deps.readUserFromLocals`; `setPlatformAlertRetentionSettings`; `deps.recordAdminAuditEvent`

## POST /admin/alerts/delete

[apps/api/src/admin/routes-platform.ts:1704](../../../../apps/api/src/admin/routes-platform.ts#L1704) · `registerPlatformAdminRoutes` · P · A · scope global administration.

`deps.requirePlatformSuperadmin`; `deps.readUserFromLocals`; `resolvePlatformAlertRetentionCutoff`; `deps.db.platformAlert.deleteMany`; `deps.recordAdminAuditEvent`

## POST /admin/alerts/:id/status

[apps/api/src/admin/routes-platform.ts:1743](../../../../apps/api/src/admin/routes-platform.ts#L1743) · `registerPlatformAdminRoutes` · P · A · scope targeted global administration.

`deps.requirePlatformSuperadmin`; `deps.readUserFromLocals`; `deps.db.platformAlert.findUnique`; `deps.db.platformAlert.update`; `deps.recordAdminAuditEvent`

## GET /admin/bots

[apps/api/src/admin/routes-platform.ts:1809](../../../../apps/api/src/admin/routes-platform.ts#L1809) · `registerPlatformAdminRoutes` · P · A · scope global administration.

`deps.requirePlatformSuperadmin`; `buildBotStrategyWhere`; `deps.db.bot.count`; `deps.db.bot.findMany`

## GET /admin/runners

[apps/api/src/admin/routes-platform.ts:1880](../../../../apps/api/src/admin/routes-platform.ts#L1880) · `registerPlatformAdminRoutes` · P · A · scope global administration.

`deps.requirePlatformSuperadmin`; `deps.db.botRuntime.findMany`; `buildRuntimeOnlineWhere`; `buildRunnerOnlineWhere`; `buildSearchWhere`; `deps.db.runnerNode.count`; `deps.db.runnerNode.findMany`; `runnerRuntimeMap.get`; `runnerRuntimes.reduce`

## GET /admin/audit

[apps/api/src/admin/routes-platform.ts:1987](../../../../apps/api/src/admin/routes-platform.ts#L1987) · `registerPlatformAdminRoutes` · P · A · scope global administration.

`deps.requirePlatformSuperadmin`; `deps.db.adminAuditEvent.count`; `deps.db.adminAuditEvent.findMany`

## GET /admin/statistics

[apps/api/src/admin/routes-platform.ts:2045](../../../../apps/api/src/admin/routes-platform.ts#L2045) · `registerPlatformAdminRoutes` · P · A · scope global administration.

`deps.requirePlatformSuperadmin`; `startOfDay`; `deps.db.user.findMany`; `deps.db.workspace.findMany`; `deps.db.userSubscription.findMany`; `deps.db.bot.findMany`; `deps.db.platformAlert.findMany`; `deps.db.runnerNode.findMany`; `deps.db.botRuntime.findMany`; `runnerRuntimeMap.get`

## GET /admin/system

[apps/api/src/admin/routes-platform.ts:2151](../../../../apps/api/src/admin/routes-platform.ts#L2151) · `registerPlatformAdminRoutes` · P · A · scope global administration.

`deps.requirePlatformSuperadmin`; `deps.getAccessSectionSettings`; `deps.getServerInfoSettings`; `deps.getBillingFeatureFlagsSettings`

## GET /admin/settings/prediction-refresh

[apps/api/src/admin/routes-prediction-settings.ts:34](../../../../apps/api/src/admin/routes-prediction-settings.ts#L34) · `registerAdminPredictionSettingsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.db.globalSetting.findUnique`; `deps.parseStoredPredictionRefreshSettings`; `deps.toEffectivePredictionRefreshSettings`

## PUT /admin/settings/prediction-refresh

[apps/api/src/admin/routes-prediction-settings.ts:45](../../../../apps/api/src/admin/routes-prediction-settings.ts#L45) · `registerAdminPredictionSettingsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.setGlobalSettingValue`; `deps.applyPredictionRefreshRuntimeSettings`; `deps.clearPredictionTriggerDebounceState`; `deps.toEffectivePredictionRefreshSettings`

## GET /admin/settings/prediction-defaults

[apps/api/src/admin/routes-prediction-settings.ts:63](../../../../apps/api/src/admin/routes-prediction-settings.ts#L63) · `registerAdminPredictionSettingsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.db.globalSetting.findUnique`; `deps.toEffectivePredictionDefaultsSettings`; `deps.parseStoredPredictionDefaultsSettings`

## PUT /admin/settings/prediction-defaults

[apps/api/src/admin/routes-prediction-settings.ts:73](../../../../apps/api/src/admin/routes-prediction-settings.ts#L73) · `registerAdminPredictionSettingsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.normalizePredictionSignalMode`; `deps.setGlobalSettingValue`; `deps.toEffectivePredictionDefaultsSettings`; `deps.parseStoredPredictionDefaultsSettings`

## GET /admin/settings/vault-execution-mode

[apps/api/src/admin/routes-vault-operations.ts:84](../../../../apps/api/src/admin/routes-vault-operations.ts#L84) · `registerAdminVaultOperationsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.getVaultExecutionModeSettings`; `deps.getVaultExecutionProviderSettings`; `deps.getGridHyperliquidPilotSettings`; `deps.db.globalSetting.findUnique`

## PUT /admin/settings/vault-execution-mode

[apps/api/src/admin/routes-vault-operations.ts:95](../../../../apps/api/src/admin/routes-vault-operations.ts#L95) · `registerAdminVaultOperationsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.setVaultExecutionModeSettings`; `deps.setVaultExecutionProviderSettings`; `deps.setGridHyperliquidPilotSettings`; `deps.getVaultExecutionModeSettings`; `deps.getVaultExecutionProviderSettings`; `deps.getGridHyperliquidPilotSettings`

## GET /admin/settings/vault-profit-share-treasury

[apps/api/src/admin/routes-vault-operations.ts:113](../../../../apps/api/src/admin/routes-vault-operations.ts#L113) · `registerAdminVaultOperationsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.getVaultProfitShareTreasurySettings`

## PUT /admin/settings/vault-profit-share-treasury

[apps/api/src/admin/routes-vault-operations.ts:118](../../../../apps/api/src/admin/routes-vault-operations.ts#L118) · `registerAdminVaultOperationsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.normalizeTreasuryWalletAddress`; `deps.normalizeProfitShareFeeRatePct`; `deps.getVaultProfitShareTreasurySettings`; `deps.setVaultProfitShareTreasurySettings`

## POST /admin/vault-profit-share/treasury-config-tx

[apps/api/src/admin/routes-vault-operations.ts:147](../../../../apps/api/src/admin/routes-vault-operations.ts#L147) · `registerAdminVaultOperationsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.getVaultProfitShareTreasurySettings`; `getUserFromLocals`; `deps.onchainActionService.getMode`; `resolveAllOnchainAddressBooks`; `deps.onchainActionService.buildSetProfitShareFeeRate`; `deps.onchainActionService.buildSetTreasuryRecipient`

## GET /admin/vault-profit-share/summary

[apps/api/src/admin/routes-vault-operations.ts:187](../../../../apps/api/src/admin/routes-vault-operations.ts#L187) · `registerAdminVaultOperationsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.db.feeEvent.findMany`; `deps.getVaultProfitShareTreasurySettings`

## GET /admin/vault-profit-share/payouts

[apps/api/src/admin/routes-vault-operations.ts:213](../../../../apps/api/src/admin/routes-vault-operations.ts#L213) · `registerAdminVaultOperationsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.db.feeEvent.findMany`; `deps.parseJsonObject`

## GET /admin/grid-hyperliquid-pilot

[apps/api/src/admin/routes-vault-operations.ts:236](../../../../apps/api/src/admin/routes-vault-operations.ts#L236) · `registerAdminVaultOperationsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.getGridHyperliquidPilotSettings`; `deps.db.user.count`; `deps.db.workspace.count`; `deps.ignoreMissingTable`; `deps.db.botVault.count`; `deps.db.gridBotInstance.count`; `deps.db.botExecutionEvent.findMany`; `deps.db.botVault.findMany`; `deps.parseJsonObject`

## GET /admin/vault-ops/status

[apps/api/src/admin/routes-vault-operations.ts:261](../../../../apps/api/src/admin/routes-vault-operations.ts#L261) · `registerAdminVaultOperationsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.getVaultExecutionModeSettings`; `deps.getVaultExecutionProviderSettings`; `deps.getVaultSafetyControlsSettings`; `deps.ignoreMissingTable`; `deps.db.botVault.count`; `deps.db.onchainAction.count`; `deps.db.botVault.findMany`; `deps.db.onchainAction.findMany`; `deps.vaultAccountingJob.getStatus`; `deps.botVaultRiskJob.getStatus`; `deps.botVaultTradingReconciliationJob.getStatus`; `deps.vaultOnchainIndexerJob.getStatus`; `deps.vaultOnchainReconciliationJob.getStatus`; `deps.systemHealthTelegramJob.getStatus`; `deps.parseJsonObject`

## GET /admin/vault-ops/reconciliation-summary

[apps/api/src/admin/routes-vault-operations.ts:331](../../../../apps/api/src/admin/routes-vault-operations.ts#L331) · `registerAdminVaultOperationsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.ignoreMissingTable`; `deps.db.botVault.findMany`; `deps.db.platformAlert.findMany`; `deps.parseJsonObject`; `deps.botVaultTradingReconciliationJob.getStatus`; `deps.vaultAccountingJob.getStatus`; `deps.vaultOnchainIndexerJob.getStatus`; `deps.vaultOnchainReconciliationJob.getStatus`

## GET /admin/settings/vault-safety

[apps/api/src/admin/routes-vault-operations.ts:524](../../../../apps/api/src/admin/routes-vault-operations.ts#L524) · `registerAdminVaultOperationsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.getVaultSafetyControlsSettings`

## PUT /admin/settings/vault-safety

[apps/api/src/admin/routes-vault-operations.ts:529](../../../../apps/api/src/admin/routes-vault-operations.ts#L529) · `registerAdminVaultOperationsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `getUserFromLocals`; `deps.getVaultSafetyControlsSettings`; `deps.setVaultSafetyControlsSettings`

## POST /admin/users/:id/vaults/close-only-all

[apps/api/src/admin/routes-vault-operations.ts:550](../../../../apps/api/src/admin/routes-vault-operations.ts#L550) · `registerAdminVaultOperationsRoutes` · P + mounted reauth · A · scope targeted global administration.

`deps.requireSuperadmin`; `getUserFromLocals`; `deps.getVaultSafetyControlsSettings`; `deps.setVaultSafetyControlsSettings`; `deps.vaultService.setAllUserBotVaultsCloseOnly`

## GET /admin/vault-ops/bot-vaults/:id

[apps/api/src/admin/routes-vault-operations.ts:579](../../../../apps/api/src/admin/routes-vault-operations.ts#L579) · `registerAdminVaultOperationsRoutes` · P · A · scope targeted global administration.

`deps.requireSuperadmin`; `deps.vaultService.getBotVaultLifecycleSnapshot`

## POST /admin/vault-ops/bot-vaults/:id/intervene

[apps/api/src/admin/routes-vault-operations.ts:592](../../../../apps/api/src/admin/routes-vault-operations.ts#L592) · `registerAdminVaultOperationsRoutes` · P · A · scope targeted global administration.

`deps.requireSuperadmin`; `deps.vaultService.getBotVaultLifecycleSnapshot`; `deps.vaultService.syncBotVaultExecutionState`; `deps.vaultService.pauseBotVault`; `deps.vaultService.activateBotVault`; `deps.vaultService.setBotVaultCloseOnly`; `deps.vaultService.compensateClosedBotVaultRecovery`; `deps.vaultService.closeBotVault`

## GET /admin/ai/pricing

[apps/api/src/ai/credits/routes.ts:289](../../../../apps/api/src/ai/credits/routes.ts#L289) · `registerAiCreditRoutes` · B · A · scope global administration.

`deps.db.aiModelPricing.findMany`; `deps.db.aiAgentRun.aggregate`

## POST /admin/ai/pricing

[apps/api/src/ai/credits/routes.ts:322](../../../../apps/api/src/ai/credits/routes.ts#L322) · `registerAiCreditRoutes` · B · A · scope global administration.

`getUserFromLocals`; `deps.db.$transaction`; `tx.aiModelPricing.findFirst`; `tx.aiModelPricing.updateMany`; `tx.aiModelPricing.create`; `deps.recordAdminAuditEvent`

## GET /admin/beta-access

[apps/api/src/auth/betaAccess.ts:180](../../../../apps/api/src/auth/betaAccess.ts#L180) · `registerBetaAccessRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.db.betaAccessRequest.findMany`; `deps.db.betaAccessRequest.count`

## PUT /admin/beta-access/settings

[apps/api/src/auth/betaAccess.ts:187](../../../../apps/api/src/auth/betaAccess.ts#L187) · `registerBetaAccessRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.db.$transaction`; `tx.globalSetting.upsert`; `deps.recordAdminAuditEvent`; `getUserFromLocals`

## POST /admin/beta-access/:id/action

[apps/api/src/auth/betaAccess.ts:197](../../../../apps/api/src/auth/betaAccess.ts#L197) · `registerBetaAccessRoutes` · P · A · scope targeted global administration.

`deps.requireSuperadmin`; `getUserFromLocals`; `deps.db.$transaction`; `tx.betaAccessRequest.updateMany`; `tx.betaAccessToken.deleteMany`; `tx.betaAccessRequest.delete`; `deps.recordAdminAuditEvent`

## GET /admin/settings/registration

[apps/api/src/auth/registrationSettings.ts:29](../../../../apps/api/src/auth/registrationSettings.ts#L29) · `registerRegistrationSettingsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`

## PUT /admin/settings/registration

[apps/api/src/auth/registrationSettings.ts:34](../../../../apps/api/src/auth/registrationSettings.ts#L34) · `registerRegistrationSettingsRoutes` · P · A · scope global administration.

`deps.requireSuperadmin`; `deps.db.$transaction`; `tx.globalSetting.upsert`; `deps.recordAdminAuditEvent`; `getUserFromLocals`

## GET /admin/settings/billing

[apps/api/src/billing/routes.ts:605](../../../../apps/api/src/billing/routes.ts#L605) · `registerBillingRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.getBillingFeatureFlagsSettings`

## PUT /admin/settings/billing

[apps/api/src/billing/routes.ts:611](../../../../apps/api/src/billing/routes.ts#L611) · `registerBillingRoutes` · B; enabling: P + reauth · A · scope global administration.

`deps.requireSuperadmin`; `deps.updateBillingFeatureFlags`

## GET /admin/billing/payment-config

[apps/api/src/billing/routes.ts:626](../../../../apps/api/src/billing/routes.ts#L626) · `registerBillingRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.getArbitrumUsdcPaymentReadiness`

## PUT /admin/billing/payment-config

[apps/api/src/billing/routes.ts:632](../../../../apps/api/src/billing/routes.ts#L632) · `registerBillingRoutes` · P + reauth · A · scope global administration.

`getUserFromLocals`; `deps.updateArbitrumUsdcPaymentConfiguration`; `deps.getArbitrumUsdcPaymentReadiness`

## GET /admin/billing/packages

[apps/api/src/billing/routes.ts:661](../../../../apps/api/src/billing/routes.ts#L661) · `registerBillingRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.listBillingPackages`

## POST /admin/billing/packages

[apps/api/src/billing/routes.ts:694](../../../../apps/api/src/billing/routes.ts#L694) · `registerBillingRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.upsertBillingPackage`

## PUT /admin/billing/packages/:id

[apps/api/src/billing/routes.ts:716](../../../../apps/api/src/billing/routes.ts#L716) · `registerBillingRoutes` · B · A · scope targeted global administration.

`deps.requireSuperadmin`; `deps.upsertBillingPackage`

## DELETE /admin/billing/packages/:id

[apps/api/src/billing/routes.ts:737](../../../../apps/api/src/billing/routes.ts#L737) · `registerBillingRoutes` · B · A · scope targeted global administration.

`deps.requireSuperadmin`; `deps.deleteBillingPackage`

## GET /admin/billing/users/:id/subscription

[apps/api/src/billing/routes.ts:753](../../../../apps/api/src/billing/routes.ts#L753) · `registerBillingRoutes` · B · A · scope targeted global administration.

`deps.requireSuperadmin`; `resolveUserIdFromLookup`; `deps.getSubscriptionSummary`

## POST /admin/billing/users/:id/credits/adjust

[apps/api/src/billing/routes.ts:763](../../../../apps/api/src/billing/routes.ts#L763) · `registerBillingRoutes` · B · A · scope targeted global administration.

`deps.requireSuperadmin`; `resolveUserIdFromLookup`; `getUserFromLocals`; `deps.adjustAiCreditBalanceByAdmin`

## GET /admin/grid/templates

[apps/api/src/grid/routes-templates.ts:288](../../../../apps/api/src/grid/routes-templates.ts#L288) · `registerGridTemplateRoutes` · B · A · scope global administration.

`shared.requireGridFeatureEnabledOrRespond`; `shared.requireGridCapabilityOrRespond`; `deps.requireSuperadmin`; `deps.db.gridBotTemplate.findMany`; `shared.normalizeTemplateSymbol`; `shared.isMissingTableError`

## POST /admin/grid/templates

[apps/api/src/grid/routes-templates.ts:317](../../../../apps/api/src/grid/routes-templates.ts#L317) · `registerGridTemplateRoutes` · B · A · scope global administration.

`shared.requireGridFeatureEnabledOrRespond`; `shared.requireGridCapabilityOrRespond`; `deps.requireSuperadmin`; `shared.normalizeTemplatePolicyInput`; `shared.isTemplatePolicyImplemented`; `getUserFromLocals`; `deps.db.workspaceMember.findFirst`; `deps.db.gridBotTemplate.create`; `shared.toGridTemplatePersistence`; `shared.normalizeTemplateSymbol`; `shared.mapGridTemplateRow`; `shared.isMissingTableError`

## PUT /admin/grid/templates/:id

[apps/api/src/grid/routes-templates.ts:361](../../../../apps/api/src/grid/routes-templates.ts#L361) · `registerGridTemplateRoutes` · B · A · scope targeted global administration.

`shared.requireGridFeatureEnabledOrRespond`; `shared.requireGridCapabilityOrRespond`; `deps.requireSuperadmin`; `deps.db.gridBotTemplate.findUnique`; `shared.normalizeTemplatePolicyInput`; `shared.isTemplatePolicyImplemented`; `deps.db.gridBotTemplate.update`; `shared.toGridTemplatePersistence`; `shared.normalizeTemplateSymbol`; `shared.mapGridTemplateRow`; `shared.isMissingTableError`

## POST /admin/grid/templates/:id/publish

[apps/api/src/grid/routes-templates.ts:406](../../../../apps/api/src/grid/routes-templates.ts#L406) · `registerGridTemplateRoutes` · B · A · scope targeted global administration.

`shared.requireGridFeatureEnabledOrRespond`; `shared.requireGridCapabilityOrRespond`; `deps.requireSuperadmin`; `deps.db.gridBotTemplate.update`; `shared.mapGridTemplateRow`; `shared.isMissingTableError`

## POST /admin/grid/templates/:id/archive

[apps/api/src/grid/routes-templates.ts:423](../../../../apps/api/src/grid/routes-templates.ts#L423) · `registerGridTemplateRoutes` · B · A · scope targeted global administration.

`shared.requireGridFeatureEnabledOrRespond`; `shared.requireGridCapabilityOrRespond`; `deps.requireSuperadmin`; `deps.db.gridBotTemplate.update`; `shared.mapGridTemplateRow`; `shared.isMissingTableError`

## DELETE /admin/grid/templates/:id

[apps/api/src/grid/routes-templates.ts:440](../../../../apps/api/src/grid/routes-templates.ts#L440) · `registerGridTemplateRoutes` · B · A · scope targeted global administration.

`shared.requireGridFeatureEnabledOrRespond`; `shared.requireGridCapabilityOrRespond`; `deps.requireSuperadmin`; `deps.db.gridBotInstance.count`; `deps.db.gridBotTemplate.delete`; `shared.isMissingTableError`

## POST /admin/grid/templates/draft-preview

[apps/api/src/grid/routes-templates.ts:463](../../../../apps/api/src/grid/routes-templates.ts#L463) · `registerGridTemplateRoutes` · B · A · scope global administration.

`shared.requireGridFeatureEnabledOrRespond`; `shared.requireGridCapabilityOrRespond`; `deps.requireSuperadmin`; `shared.normalizeTemplatePolicyInput`; `getUserFromLocals`; `deps.db.exchangeAccount.findFirst`; `deps.resolveGridHyperliquidPilotAccess`; `shared.isAdminGridDraftPreviewExchangeAllowed`; `shared.ensureGridExchangeAllowed`; `shared.normalizeGridExchange`; `shared.mapDraftTemplateToPreviewContext`; `shared.isTemplatePolicyImplemented`; `deps.computeGridPreviewAndAllocation`; `buildGridPreviewResponse`; `shared.isMissingTableError`

## POST /admin/grid/templates/:id/preview

[apps/api/src/grid/routes-templates.ts:573](../../../../apps/api/src/grid/routes-templates.ts#L573) · `registerGridTemplateRoutes` · B · A · scope targeted global administration.

`shared.requireGridFeatureEnabledOrRespond`; `shared.requireGridCapabilityOrRespond`; `deps.requireSuperadmin`; `deps.db.gridBotTemplate.findUnique`; `shared.isTemplatePolicyImplemented`; `shared.mapGridTemplateRow`; `deps.requestGridPreview`; `shared.isMissingTableError`

## PUT /economic-calendar/config

[apps/api/src/routes/economic-calendar.ts:343](../../../../apps/api/src/routes/economic-calendar.ts#L343) · `registerEconomicCalendarRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `updateEconomicCalendarConfig`

## POST /economic-calendar/refresh

[apps/api/src/routes/economic-calendar.ts:370](../../../../apps/api/src/routes/economic-calendar.ts#L370) · `registerEconomicCalendarRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.refreshJob.runCycle`; `deps.refreshJob.getStatus`

## GET /admin/market-intelligence/providers

[apps/api/src/routes/market-intelligence.ts:191](../../../../apps/api/src/routes/market-intelligence.ts#L191) · `registerMarketIntelligenceRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`

## PUT /admin/market-intelligence/providers/:providerId

[apps/api/src/routes/market-intelligence.ts:200](../../../../apps/api/src/routes/market-intelligence.ts#L200) · `registerMarketIntelligenceRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `getUserFromLocals`

## POST /admin/market-intelligence/refresh

[apps/api/src/routes/market-intelligence.ts:229](../../../../apps/api/src/routes/market-intelligence.ts#L229) · `registerMarketIntelligenceRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.refreshJob.runCycle`; `getUserFromLocals`; `deps.refreshJob.getStatus`

## GET /admin/settings/access-section

[apps/api/src/settings/routes-core.ts:925](../../../../apps/api/src/settings/routes-core.ts#L925) · `registerSettingsCoreRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.db.globalSetting.findUnique`; `deps.toEffectiveAccessSectionSettings`; `deps.parseStoredAccessSectionSettings`

## PUT /admin/settings/access-section

[apps/api/src/settings/routes-core.ts:946](../../../../apps/api/src/settings/routes-core.ts#L946) · `registerSettingsCoreRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.toEffectiveAccessSectionSettings`; `deps.parseStoredAccessSectionSettings`; `deps.setGlobalSettingValue`

## GET /admin/settings/server-info

[apps/api/src/settings/routes-core.ts:969](../../../../apps/api/src/settings/routes-core.ts#L969) · `registerSettingsCoreRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.getServerInfoSettings`

## PUT /admin/settings/server-info

[apps/api/src/settings/routes-core.ts:975](../../../../apps/api/src/settings/routes-core.ts#L975) · `registerSettingsCoreRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.normalizeServerIpAddress`; `deps.setGlobalSettingValue`; `deps.getServerInfoSettings`

## GET /admin/local-strategies/registry

[apps/api/src/strategies/routes-read.ts:151](../../../../apps/api/src/strategies/routes-read.ts#L151) · `registerStrategyReadRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `resolveProductCapabilityAccess`; `deps.sendCapabilityDenied`; `deps.listPythonStrategyRegistry`; `deps.listLocalStrategyRegistryPublic`; `deps.getBuiltinLocalStrategyTemplates`

## GET /admin/local-strategies/python/registry

[apps/api/src/strategies/routes-read.ts:169](../../../../apps/api/src/strategies/routes-read.ts#L169) · `registerStrategyReadRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `resolveProductCapabilityAccess`; `deps.sendCapabilityDenied`; `deps.listPythonStrategyRegistry`

## GET /admin/local-strategies

[apps/api/src/strategies/routes-read.ts:183](../../../../apps/api/src/strategies/routes-read.ts#L183) · `registerStrategyReadRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `resolveProductCapabilityAccess`; `deps.sendCapabilityDenied`; `deps.localStrategiesStoreReady`; `deps.db.localStrategyDefinition.findMany`; `deps.listPythonStrategyRegistry`; `deps.mapLocalStrategyDefinitionPublic`; `deps.listLocalStrategyRegistryPublic`; `deps.getBuiltinLocalStrategyTemplates`

## GET /admin/local-strategies/:id

[apps/api/src/strategies/routes-read.ts:210](../../../../apps/api/src/strategies/routes-read.ts#L210) · `registerStrategyReadRoutes` · B · A · scope targeted global administration.

`deps.requireSuperadmin`; `resolveProductCapabilityAccess`; `deps.sendCapabilityDenied`; `deps.localStrategiesStoreReady`; `deps.db.localStrategyDefinition.findUnique`; `deps.listPythonStrategyRegistry`; `deps.mapLocalStrategyDefinitionPublic`; `deps.listLocalStrategyRegistryPublic`

## GET /admin/composite-strategies

[apps/api/src/strategies/routes-read.ts:327](../../../../apps/api/src/strategies/routes-read.ts#L327) · `registerStrategyReadRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `resolveProductCapabilityAccess`; `deps.sendCapabilityDenied`; `deps.compositeStrategiesStoreReady`; `deps.db.compositeStrategy.findMany`; `deps.mapCompositeStrategyPublic`

## GET /admin/composite-strategies/:id

[apps/api/src/strategies/routes-read.ts:348](../../../../apps/api/src/strategies/routes-read.ts#L348) · `registerStrategyReadRoutes` · B · A · scope targeted global administration.

`deps.requireSuperadmin`; `resolveProductCapabilityAccess`; `deps.sendCapabilityDenied`; `deps.compositeStrategiesStoreReady`; `deps.db.compositeStrategy.findUnique`; `deps.mapCompositeStrategyPublic`

## GET /admin/settings/ai-trace

[apps/api/src/strategies/routes-read.ts:376](../../../../apps/api/src/strategies/routes-read.ts#L376) · `registerStrategyReadRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `resolveProductCapabilityAccess`; `deps.sendCapabilityDenied`; `deps.db.globalSetting.findUnique`; `deps.parseStoredAiTraceSettings`; `deps.getAiPayloadBudgetTelemetrySnapshot`; `deps.getAiQualityGateTelemetrySnapshot`

## GET /admin/settings/ai-prompts

[apps/api/src/strategies/routes-write.ts:220](../../../../apps/api/src/strategies/routes-write.ts#L220) · `registerStrategyWriteRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.db.globalSetting.findUnique`; `deps.parseStoredAiPromptSettings`; `deps.getAiPromptIndicatorOptionsPublic`; `deps.readAiPromptLicensePolicyPublic`

## PUT /admin/settings/ai-prompts

[apps/api/src/strategies/routes-write.ts:240](../../../../apps/api/src/strategies/routes-write.ts#L240) · `registerStrategyWriteRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.normalizeAiPromptSettingsPayload`; `deps.parseStoredAiPromptSettings`; `deps.setGlobalSettingValue`; `deps.invalidateAiPromptSettingsCache`; `deps.getAiPromptIndicatorOptionsPublic`; `deps.readAiPromptLicensePolicyPublic`

## POST /admin/settings/ai-prompts/generate-preview

[apps/api/src/strategies/routes-write.ts:278](../../../../apps/api/src/strategies/routes-write.ts#L278) · `registerStrategyWriteRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.resolveSelectedAiPromptIndicators`; `deps.generateHybridPromptText`

## POST /admin/settings/ai-prompts/generate-save

[apps/api/src/strategies/routes-write.ts:314](../../../../apps/api/src/strategies/routes-write.ts#L314) · `registerStrategyWriteRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.resolveSelectedAiPromptIndicators`; `deps.db.globalSetting.findUnique`; `deps.parseStoredAiPromptSettings`; `deps.getAiModel`; `deps.generateHybridPromptText`; `deps.createGeneratedPromptDraft`; `deps.normalizeAiPromptSettingsPayload`; `deps.setGlobalSettingValue`; `deps.invalidateAiPromptSettingsCache`; `settings.prompts.find`

## POST /admin/settings/ai-prompts/preview

[apps/api/src/strategies/routes-write.ts:433](../../../../apps/api/src/strategies/routes-write.ts#L433) · `registerStrategyWriteRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.normalizeAiPromptSettingsPayload`; `deps.parseStoredAiPromptSettings`; `deps.db.globalSetting.findUnique`; `deps.resolveAiPromptRuntimeSettingsForContext`; `deps.buildPredictionExplainerPromptPreview`

## POST /admin/local-strategies

[apps/api/src/strategies/routes-write.ts:971](../../../../apps/api/src/strategies/routes-write.ts#L971) · `registerStrategyWriteRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.localStrategiesStoreReady`; `deps.getRegisteredLocalStrategy`; `deps.listRegisteredLocalStrategies`; `deps.listLocalFallbackStrategyTypes`; `deps.resolvePythonFallbackStrategyType`; `deps.getBuiltinLocalStrategyTemplates`; `deps.db.localStrategyDefinition.create`; `deps.mapLocalStrategyDefinitionPublic`

## PUT /admin/local-strategies/:id

[apps/api/src/strategies/routes-write.ts:1048](../../../../apps/api/src/strategies/routes-write.ts#L1048) · `registerStrategyWriteRoutes` · B · A · scope targeted global administration.

`deps.requireSuperadmin`; `deps.localStrategiesStoreReady`; `deps.db.localStrategyDefinition.findUnique`; `deps.listLocalFallbackStrategyTypes`; `deps.getRegisteredLocalStrategy`; `deps.listRegisteredLocalStrategies`; `deps.resolvePythonFallbackStrategyType`; `deps.db.localStrategyDefinition.update`; `deps.mapLocalStrategyDefinitionPublic`

## DELETE /admin/local-strategies/:id

[apps/api/src/strategies/routes-write.ts:1180](../../../../apps/api/src/strategies/routes-write.ts#L1180) · `registerStrategyWriteRoutes` · B · A · scope targeted global administration.

`deps.requireSuperadmin`; `deps.localStrategiesStoreReady`; `deps.db.localStrategyDefinition.delete`

## POST /admin/local-strategies/:id/run

[apps/api/src/strategies/routes-write.ts:1206](../../../../apps/api/src/strategies/routes-write.ts#L1206) · `registerStrategyWriteRoutes` · B · A · scope targeted global administration.

`deps.requireSuperadmin`; `deps.readUserFromLocals`; `deps.resolveStrategyEntitlementsPublicForUser`; `deps.localStrategiesStoreReady`; `deps.evaluateStrategySelectionAccess`; `deps.runLocalStrategy`

## POST /admin/composite-strategies

[apps/api/src/strategies/routes-write.ts:1265](../../../../apps/api/src/strategies/routes-write.ts#L1265) · `registerStrategyWriteRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.readUserFromLocals`; `deps.resolveStrategyEntitlementsPublicForUser`; `deps.evaluateStrategySelectionAccess`; `deps.compositeStrategiesStoreReady`; `deps.validateCompositeStrategyPayload`; `deps.db.compositeStrategy.create`; `deps.mapCompositeStrategyPublic`

## PUT /admin/composite-strategies/:id

[apps/api/src/strategies/routes-write.ts:1325](../../../../apps/api/src/strategies/routes-write.ts#L1325) · `registerStrategyWriteRoutes` · B · A · scope targeted global administration.

`deps.requireSuperadmin`; `deps.readUserFromLocals`; `deps.resolveStrategyEntitlementsPublicForUser`; `deps.compositeStrategiesStoreReady`; `deps.evaluateStrategySelectionAccess`; `deps.db.compositeStrategy.findUnique`; `deps.validateCompositeStrategyPayload`; `deps.db.compositeStrategy.update`; `deps.mapCompositeStrategyPublic`

## DELETE /admin/composite-strategies/:id

[apps/api/src/strategies/routes-write.ts:1405](../../../../apps/api/src/strategies/routes-write.ts#L1405) · `registerStrategyWriteRoutes` · B · A · scope targeted global administration.

`deps.requireSuperadmin`; `deps.compositeStrategiesStoreReady`; `deps.db.compositeStrategy.delete`

## POST /admin/composite-strategies/:id/dry-run

[apps/api/src/strategies/routes-write.ts:1429](../../../../apps/api/src/strategies/routes-write.ts#L1429) · `registerStrategyWriteRoutes` · B · A · scope targeted global administration.

`deps.requireSuperadmin`; `deps.readUserFromLocals`; `deps.resolveStrategyEntitlementsPublicForUser`; `deps.compositeStrategiesStoreReady`; `deps.db.compositeStrategy.findUnique`; `deps.db.prediction.findUnique`; `deps.evaluateStrategySelectionAccess`; `deps.countCompositeStrategyNodes`; `deps.toJsonRecord`; `deps.PREDICTION_TIMEFRAMES.has`; `deps.PREDICTION_MARKET_TYPES.has`; `deps.runCompositeStrategy`; `deps.db.localStrategyDefinition.findUnique`; `deps.getAiPromptTemplateById`; `deps.mapCompositeStrategyPublic`

## PUT /admin/settings/ai-trace

[apps/api/src/strategies/routes-write.ts:1535](../../../../apps/api/src/strategies/routes-write.ts#L1535) · `registerStrategyWriteRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.parseStoredAiTraceSettings`; `deps.setGlobalSettingValue`; `deps.invalidateAiTraceSettingsCache`

## GET /admin/ai-trace/logs

[apps/api/src/strategies/routes-write.ts:1554](../../../../apps/api/src/strategies/routes-write.ts#L1554) · `registerStrategyWriteRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.db.aiTraceLog.findMany`; `deps.db.aiTraceLog.count`; `deps.getAiTraceSettingsCached`; `deps.db.user.findMany`; `record.requestedModel.trim`; `record.resolvedModel.trim`; `record.fallbackReason.trim`

## POST /admin/ai-trace/logs/cleanup

[apps/api/src/strategies/routes-write.ts:1775](../../../../apps/api/src/strategies/routes-write.ts#L1775) · `registerStrategyWriteRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.db.aiTraceLog.deleteMany`

## GET /admin/health/details

[apps/api/src/system/routes.ts:64](../../../../apps/api/src/system/routes.ts#L64) · `registerSystemRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `buildHealthDetails`

## GET /license/state

[apps/api/src/system/routes.ts:76](../../../../apps/api/src/system/routes.ts#L76) · `registerSystemRoutes` · B · A · scope global administration.

`deps.requireSuperadmin`; `deps.isBillingEnabled`; `deps.isLicenseEnforcementEnabled`

## GET /admin/queue/metrics

[apps/api/src/system/routes.ts:85](../../../../apps/api/src/system/routes.ts#L85) · `registerSystemRoutes` · A only (L-01) · A · scope global administration.

`deps.getQueueMetrics`

## GET /admin/uliq

[apps/api/src/uliq/admin.routes.ts:229](../../../../apps/api/src/uliq/admin.routes.ts#L229) · `registerUliqAdminRoutes` · B · A · scope global administration.

`deps.presaleService.getOverview`; `deps.treasuryService.getState`; `getScheduleState`; `deps.db.onchainSyncCursor.findFirst`; `deps.db.uliqReconciliationRun.findFirst`; `deps.db.uliqBenefitReservation.groupBy`; `deps.db.uliqPriceSnapshot.findFirst`; `deps.db.uliqPresalePurchase.groupBy`; `deps.db.uliqVestingPosition.aggregate`; `deps.db.uliqLockPosition.aggregate`; `deps.db.uliqTierConfig.findMany`; `deps.db.platformAlert.findMany`; `deps.db.adminAuditEvent.findMany`

## GET /admin/uliq/public-presale

[apps/api/src/uliq/admin.routes.ts:287](../../../../apps/api/src/uliq/admin.routes.ts#L287) · `registerUliqAdminRoutes` · B · A · scope global administration.

`getScheduleState`

## PUT /admin/uliq/presale-rounds/:roundId/schedule

[apps/api/src/uliq/admin.routes.ts:297](../../../../apps/api/src/uliq/admin.routes.ts#L297) · `registerUliqAdminRoutes` · B + reauth · A · scope global administration.

`getUserFromLocals`; `deps.db.$transaction`; `getUliqPresaleRoundSchedule`; `deps.recordAdminAuditEvent`

## PUT /admin/uliq/presale-rounds/schedule

[apps/api/src/uliq/admin.routes.ts:346](../../../../apps/api/src/uliq/admin.routes.ts#L346) · `registerUliqAdminRoutes` · B + reauth · A · scope global administration.

`getUserFromLocals`; `deps.db.$transaction`; `getUliqPresaleRoundSchedule`; `deps.recordAdminAuditEvent`

## POST /admin/uliq/presale-rounds/:roundId/schedule/prepare

[apps/api/src/uliq/admin.routes.ts:388](../../../../apps/api/src/uliq/admin.routes.ts#L388) · `registerUliqAdminRoutes` · B + reauth · A · scope global administration.

`getUserFromLocals`; `getScheduleOnchainService`; `deps.recordAdminAuditEvent`

## POST /admin/uliq/presale-rounds/:roundId/ready/prepare

[apps/api/src/uliq/admin.routes.ts:420](../../../../apps/api/src/uliq/admin.routes.ts#L420) · `registerUliqAdminRoutes` · B + reauth · A · scope global administration.

`getUserFromLocals`; `getScheduleOnchainService`; `deps.recordAdminAuditEvent`

## POST /admin/uliq/presale-rounds/schedule/record-execution

[apps/api/src/uliq/admin.routes.ts:452](../../../../apps/api/src/uliq/admin.routes.ts#L452) · `registerUliqAdminRoutes` · B + reauth · A · scope global administration.

`getUserFromLocals`; `getScheduleOnchainService`; `deps.recordAdminAuditEvent`

## POST /admin/uliq/presale-rounds/:roundId/inventory/fund/prepare

[apps/api/src/uliq/admin.routes.ts:486](../../../../apps/api/src/uliq/admin.routes.ts#L486) · `registerUliqAdminRoutes` · B + reauth · A · scope global administration.

`getUserFromLocals`; `getScheduleOnchainService`; `deps.recordAdminAuditEvent`

## POST /admin/uliq/presale-rounds/:roundId/inventory/release/prepare

[apps/api/src/uliq/admin.routes.ts:517](../../../../apps/api/src/uliq/admin.routes.ts#L517) · `registerUliqAdminRoutes` · B + reauth · A · scope global administration.

`getUserFromLocals`; `getScheduleOnchainService`; `deps.recordAdminAuditEvent`

## POST /admin/uliq/presale-rounds/inventory/record-execution

[apps/api/src/uliq/admin.routes.ts:548](../../../../apps/api/src/uliq/admin.routes.ts#L548) · `registerUliqAdminRoutes` · B + reauth · A · scope global administration.

`getUserFromLocals`; `getScheduleOnchainService`; `deps.recordAdminAuditEvent`

## PUT /admin/uliq/tier-benefits

[apps/api/src/uliq/admin.routes.ts:582](../../../../apps/api/src/uliq/admin.routes.ts#L582) · `registerUliqAdminRoutes` · B + reauth · A · scope global administration.

`getUserFromLocals`; `deps.db.$transaction`; `tx.uliqTierConfig.findMany`; `tx.uliqTierConfig.updateMany`; `tx.uliqTierConfig.create`; `deps.recordAdminAuditEvent`

## PUT /admin/uliq/treasury

[apps/api/src/uliq/admin.routes.ts:681](../../../../apps/api/src/uliq/admin.routes.ts#L681) · `registerUliqAdminRoutes` · B + reauth · A · scope global administration.

`deps.treasuryService.setDesiredTreasury`; `getUserFromLocals`; `deps.recordAdminAuditEvent`

## POST /admin/uliq/treasury/accept/prepare

[apps/api/src/uliq/admin.routes.ts:722](../../../../apps/api/src/uliq/admin.routes.ts#L722) · `registerUliqAdminRoutes` · B + reauth · A · scope global administration.

Treasury entry.prepare() dispatches prepareProposal(), prepareAcceptance(), or prepareCancellation().

## POST /admin/uliq/treasury/cancel/prepare

[apps/api/src/uliq/admin.routes.ts:722](../../../../apps/api/src/uliq/admin.routes.ts#L722) · `registerUliqAdminRoutes` · B + reauth · A · scope global administration.

Treasury entry.prepare() dispatches prepareProposal(), prepareAcceptance(), or prepareCancellation().

## POST /admin/uliq/treasury/propose/prepare

[apps/api/src/uliq/admin.routes.ts:722](../../../../apps/api/src/uliq/admin.routes.ts#L722) · `registerUliqAdminRoutes` · B + reauth · A · scope global administration.

Treasury entry.prepare() dispatches prepareProposal(), prepareAcceptance(), or prepareCancellation().

## POST /admin/uliq/safe/mark-dex-pending/prepare

[apps/api/src/uliq/admin.routes.ts:755](../../../../apps/api/src/uliq/admin.routes.ts#L755) · `registerUliqAdminRoutes` · B + reauth · A · scope global administration.

`deps.presaleService.prepareMarkDexPending`; `getUserFromLocals`; `deps.recordAdminAuditEvent`

## POST /admin/uliq/safe/set-dex-launch/prepare

[apps/api/src/uliq/admin.routes.ts:794](../../../../apps/api/src/uliq/admin.routes.ts#L794) · `registerUliqAdminRoutes` · B + reauth · A · scope global administration.

`deps.presaleService.prepareDexLaunchTimestamp`; `getUserFromLocals`; `deps.recordAdminAuditEvent`

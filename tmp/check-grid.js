const { PrismaClient } = require('@prisma/client');
const id = process.argv[2] || 'cmnmy45yu0o19pm1zg7yecv75';
const db = new PrismaClient();

(async () => {
  const instance = await db.gridBotInstance.findUnique({
    where: { id },
    include: {
      bot: { select: { id: true, status: true, vaultId: true, ownerId: true } },
      botVault: true,
      gridTemplate: { select: { id: true, provider: true, symbol: true } }
    }
  });

  if (instance === null) {
    console.log(JSON.stringify({ found: false, id }, null, 2));
    await db.$disconnect();
    return;
  }

  console.log('INSTANCE', JSON.stringify({
    id: instance.id,
    state: instance.state,
    stateJson: instance.stateJson,
    provisioningStatus: instance.provisioningStatus,
    botVaultId: instance.botVaultId,
    botId: instance.botId,
    templateId: instance.templateId,
    exchange: instance.exchange,
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
    bot: instance.bot,
    template: instance.gridTemplate
  }, null, 2));

  const vaultId = instance.botVaultId || instance.bot && instance.bot.vaultId;
  if (vaultId == null) {
    console.log('NO_VAULT');
    await db.$disconnect();
    return;
  }

  const botVault = await db.botVault.findUnique({
    where: { id: vaultId },
    include: {
      masterVault: { select: { id: true, onchainAddress: true } },
      botVaultExecutionState: { take: 40, orderBy: { createdAt: 'asc' } }
    }
  });

  console.log('BOT_VAULT', JSON.stringify({
    id: botVault && botVault.id,
    status: botVault && botVault.status,
    vaultModel: botVault && botVault.vaultModel,
    executionStatus: botVault && botVault.executionStatus,
    fundingStatus: botVault && botVault.fundingStatus,
    hypercoreFundingStatus: botVault && botVault.hypercoreFundingStatus,
    executionProvider: botVault && botVault.executionProvider,
    principalAllocated: botVault && botVault.principalAllocated,
    principalReturned: botVault && botVault.principalReturned,
    availableUsd: botVault && botVault.availableUsd,
    withdrawnUsd: botVault && botVault.withdrawedUsd,
    vaultAddress: botVault && botVault.vaultAddress,
    beneficiaryAddress: botVault && botVault.beneficiaryAddress,
    executionMetadata: botVault && botVault.executionMetadata,
    masterVaultAddress: botVault && botVault.masterVault && botVault.masterVault.onchainAddress,
    updatedAt: botVault && botVault.updatedAt,
    stateRows: botVault && botVault.botVaultExecutionState.map((row) => ({
      id: row.id,
      executionStatus: row.executionStatus,
      providerStatus: row.providerStatus,
      providerKey: row.providerKey,
      errorReason: row.errorReason,
      createdAt: row.createdAt
    }))
  }, null, 2));

  const actions = await db.onchainAction.findMany({
    where: { botVaultId: vaultId },
    orderBy: { createdAt: 'asc' },
    take: 200
  });
  console.log('ONCHAIN_ACTIONS', JSON.stringify(actions.map((action) => ({
    id: action.id,
    actionType: action.actionType,
    status: action.status,
    txHash: action.txHash,
    failureReason: action.failureReason,
    createdAt: action.createdAt,
    updatedAt: action.updatedAt,
    metadata: action.metadata
  })), null, 2));

  await db.$disconnect();
})();

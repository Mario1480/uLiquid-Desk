import { PrismaClient } from "@prisma/client";

const id = process.argv[2] || "cmnmy45yu0o19pm1zg7yecv75";
const db = new PrismaClient();

async function main() {
  const instance = await db.gridBotInstance.findUnique({
    where: { id },
    include: {
      bot: {
        include: {
          owner: true
        }
      },
      gridTemplate: true,
      botVault: true
    }
  });

  if (instance == null) {
    console.log(JSON.stringify({ found: false, id }, null, 2));
    await db.$disconnect();
    return;
  }

  console.log("instance", JSON.stringify({
    id: instance.id,
    state: instance.state,
    archivedAt: instance.archivedAt,
    stateJson: instance.stateJson,
    botId: instance.botId,
    vaultId: instance.botVaultId,
    template: instance.templateId,
    exchange: instance.exchange,
    provisioningStatus: instance.provisioningStatus,
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt
  }, null, 2));

  if (instance.botVaultId == null) {
    console.log("no botVaultId on instance");
    await db.$disconnect();
    return;
  }

  const botVault = await db.botVault.findUnique({
    where: { id: instance.botVaultId }
  });

  console.log("botVault", JSON.stringify({
    id: botVault?.id,
    status: botVault?.status,
    vaultModel: botVault?.vaultModel,
    executionStatus: botVault?.executionStatus,
    fundingStatus: botVault?.fundingStatus,
    hypercoreFundingStatus: botVault?.hypercoreFundingStatus,
    executionProvider: botVault?.executionProvider,
    principalAllocated: botVault?.principalAllocated,
    principalReturned: botVault?.principalReturned,
    executionMetadata: botVault?.executionMetadata,
    vaultAddress: botVault?.vaultAddress,
    beneficiaryAddress: botVault?.beneficiaryAddress,
    executionUnitId: botVault?.executionUnitId,
    availableUsd: botVault?.availableUsd,
    withdrawnUsd: botVault?.withdrawedUsd,
    updatedAt: botVault?.updatedAt
  }, null, 2));

  const actions = await db.onchainAction.findMany({
    where: { botVaultId: instance.botVaultId },
    orderBy: { createdAt: 'asc' }
  });
  console.log("onchainActions", JSON.stringify(actions.map((action) => ({
    id: action.id,
    actionType: action.actionType,
    status: action.status,
    txHash: action.txHash,
    failureReason: action.failureReason,
    updatedAt: action.updatedAt,
    metadata: action.metadata
  })), null, 2));

  const states = await db.botVaultExecutionState.findMany({
    where: { botVaultId: instance.botVaultId },
    orderBy: { createdAt: 'asc' },
    take: 20
  });
  console.log("executionStates", JSON.stringify(states.map((row) => ({
    id: row.id,
    status: row.executionStatus,
    vaultAddress: row.vaultAddress,
    observedAt: row.observedAt,
    providerStatus: row.providerStatus,
    providerKey: row.providerKey,
    providerMetadata: row.providerMetadata,
    errorReason: row.errorReason,
    createdAt: row.createdAt
  })), null, 2));

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});

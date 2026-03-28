import { parseAbi } from "viem";

const masterVaultFactoryAbiCommon = [
  "function owner() view returns (address)",
  "function treasuryRecipient() view returns (address)",
  "function profitShareFeeRatePct() view returns (uint256)",
  "function setTreasuryRecipient(address nextRecipient)",
  "function setProfitShareFeeRatePct(uint256 nextRatePct)",
  "function createMasterVault(address owner) returns (address vault)",
  "function masterVaultOf(address owner) view returns (address)",
  "event MasterVaultCreated(address indexed owner, address indexed masterVault)",
  "event TreasuryRecipientUpdated(address indexed previousRecipient, address indexed nextRecipient)",
  "event ProfitShareFeeRateUpdated(uint256 previousRatePct, uint256 nextRatePct)"
] as const;

const masterVaultAbiCommon = [
  "function deposit(address token, uint256 amount)",
  "function requestWithdraw(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function pause()",
  "function unpause()",
  "function createBotVault(bytes32 templateId, bytes32 botId, uint256 allocation) returns (address botVault)",
  "function allocateToBotVault(address botVault, uint256 amount)",
  "function reserveForBotVault(address botVault, uint256 amount)",
  "function setBotVaultCloseOnly(address botVault)",
  "function treasuryRecipient() view returns (address)",
  "function profitShareFeeRatePct() view returns (uint256)",
  "function claimFromBotVault(address botVault, uint256 releasedReserved, uint256 grossReturned)",
  "function closeBotVault(address botVault, uint256 releasedReserved, uint256 grossReturned)",
  "function freeBalance() view returns (uint256)",
  "function reservedBalance() view returns (uint256)",
  "function tokenSurplus() view returns (uint256)",
  "function principalOutstanding(address botVault) view returns (uint256)",
  "event Deposited(address indexed sender, address indexed token, uint256 amount, uint256 freeBalanceAfter)",
  "event WithdrawRequested(address indexed requester, uint256 amount, uint256 freeBalanceAtRequest)",
  "event Withdrawn(address indexed owner, uint256 amount, uint256 freeBalanceAfter)",
  "event Paused(address indexed owner)",
  "event Unpaused(address indexed owner)",
  "event BotVaultCreated(address indexed botVault, bytes32 indexed templateId, address indexed agentWallet)",
  "event BotVaultProvisioned(address indexed botVault, bytes32 indexed templateId, bytes32 indexed botId, uint256 allocation)",
  "event ReservedForBotVault(address indexed botVault, uint256 amount, uint256 freeBalanceAfter, uint256 reservedBalanceAfter)",
  "event ReleasedFromBotVault(address indexed botVault, uint256 releasedReserved, uint256 returnedToFree, uint256 freeBalanceAfter, uint256 reservedBalanceAfter)",
  "event BotVaultClaimed(address indexed botVault, uint256 releasedReserved, uint256 returnedToFree, uint256 freeBalanceAfter, uint256 reservedBalanceAfter)",
  "event BotVaultClosed(address indexed botVault, uint256 releasedReserved, uint256 returnedToFree)",
  "event TreasuryFeePaid(address indexed botVault, address indexed recipient, uint256 feeAmount, uint256 grossReturned, uint256 netReturned, uint256 highWaterMarkAfter)"
] as const;

export const masterVaultFactoryAbi = parseAbi(masterVaultFactoryAbiCommon);
export const masterVaultFactoryV2Abi = parseAbi([
  ...masterVaultFactoryAbiCommon,
  "function factoryVersion() pure returns (string)"
]);

export const masterVaultAbi = parseAbi(masterVaultAbiCommon);
export const masterVaultV2Abi = parseAbi([
  ...masterVaultAbiCommon,
  "function createBotVault(bytes32 templateId, address agentWallet) returns (address botVault)",
  "function recoverClosedBotVault(address botVault, uint256 releasedReserved, uint256 grossReturned)",
  "function setBotVaultAgentWallet(address botVault, address nextAgentWallet)",
  "event BotVaultRecovered(address indexed botVault, uint256 releasedReserved, uint256 returnedToFree, uint256 freeBalanceAfter, uint256 reservedBalanceAfter)"
]);

export const botVaultAbi = parseAbi([
  "function status() view returns (uint8)",
  "function principalAllocated() view returns (uint256)",
  "function principalReturned() view returns (uint256)",
  "function realizedPnlNet() view returns (int256)",
  "function feePaidTotal() view returns (uint256)",
  "function highWaterMark() view returns (uint256)",
  "event StatusChanged(uint8 indexed fromStatus, uint8 indexed toStatus)",
  "event BotInitialized(bytes32 indexed templateId, bytes32 indexed botId, address indexed agentWallet)",
  "event BotToppedUp(uint256 amount, uint256 principalAllocatedAfter)",
  "event BotReleased(uint256 releasedReserved, uint256 grossReturned, int256 pnlDelta, int256 realizedPnlNetAfter)",
  "event FeePaidRecorded(uint256 feeAmount, uint256 feePaidTotalAfter)"
]);

export const botVaultV2Abi = parseAbi([
  "function owner() view returns (address)",
  "function agentWallet() view returns (address)",
  "function status() view returns (uint8)",
  "function principalAllocated() view returns (uint256)",
  "function principalReturned() view returns (uint256)",
  "function realizedPnlNet() view returns (int256)",
  "function feePaidTotal() view returns (uint256)",
  "function highWaterMark() view returns (uint256)",
  "function setAgentWallet(address nextAgentWallet)",
  "function sendUsdClassTransfer(uint64 ntl, bool toPerp)",
  "function placeHyperCoreLimitOrder(uint32 asset, bool isBuy, uint64 limitPx, uint64 sz, bool reduceOnly, uint8 encodedTif, uint128 cloid)",
  "function cancelHyperCoreOrderByOid(uint32 asset, uint64 oid)",
  "function cancelHyperCoreOrderByCloid(uint32 asset, uint128 cloid)",
  "event StatusChanged(uint8 indexed fromStatus, uint8 indexed toStatus)",
  "event BotInitialized(bytes32 indexed templateId, bytes32 indexed botId, address indexed agentWallet)",
  "event BotToppedUp(uint256 amount, uint256 principalAllocatedAfter)",
  "event BotReleased(uint256 releasedReserved, uint256 grossReturned, int256 pnlDelta, int256 realizedPnlNetAfter)",
  "event ClosedRecoveryApplied(uint256 releasedReserved, uint256 grossReturned, int256 pnlDelta, int256 realizedPnlNetAfter)",
  "event FeePaidRecorded(uint256 feeAmount, uint256 feePaidTotalAfter)",
  "event AgentWalletUpdated(address indexed previousAgentWallet, address indexed nextAgentWallet)",
  "event HyperCoreActionForwarded(uint24 indexed actionId, bytes data)"
]);

export const onchainEventNames = new Set<string>([
  "MasterVaultCreated",
  "Deposited",
  "WithdrawRequested",
  "Withdrawn",
  "Paused",
  "Unpaused",
  "BotVaultCreated",
  "BotVaultProvisioned",
  "ReservedForBotVault",
  "ReleasedFromBotVault",
  "BotVaultClaimed",
  "BotVaultClosed",
  "BotVaultRecovered",
  "TreasuryFeePaid",
  "TreasuryRecipientUpdated",
  "ProfitShareFeeRateUpdated",
  "StatusChanged",
  "BotInitialized",
  "BotToppedUp",
  "BotReleased",
  "ClosedRecoveryApplied",
  "FeePaidRecorded",
  "AgentWalletUpdated",
  "HyperCoreActionForwarded"
]);

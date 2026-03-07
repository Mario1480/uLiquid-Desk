import { parseAbi } from "viem";

export const masterVaultFactoryAbi = parseAbi([
  "function createMasterVault(address owner) returns (address vault)",
  "function masterVaultOf(address owner) view returns (address)",
  "event MasterVaultCreated(address indexed owner, address indexed masterVault)"
]);

export const masterVaultAbi = parseAbi([
  "function deposit(address token, uint256 amount)",
  "function requestWithdraw(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function createBotVault(bytes32 templateId, bytes32 botId, uint256 allocation) returns (address botVault)",
  "function claimFromBotVault(address botVault, uint256 releasedReserved, uint256 returnedToFree)",
  "function closeBotVault(address botVault, uint256 releasedReserved, uint256 returnedToFree)",
  "function freeBalance() view returns (uint256)",
  "function reservedBalance() view returns (uint256)",
  "event Deposited(address indexed sender, address indexed token, uint256 amount, uint256 freeBalanceAfter)",
  "event WithdrawRequested(address indexed requester, uint256 amount, uint256 freeBalanceAtRequest)",
  "event Withdrawn(address indexed owner, uint256 amount, uint256 freeBalanceAfter)",
  "event BotVaultCreated(address indexed botVault, bytes32 indexed templateId, address indexed agentWallet)",
  "event BotVaultProvisioned(address indexed botVault, bytes32 indexed templateId, bytes32 indexed botId, uint256 allocation)",
  "event ReservedForBotVault(address indexed botVault, uint256 amount, uint256 freeBalanceAfter, uint256 reservedBalanceAfter)",
  "event ReleasedFromBotVault(address indexed botVault, uint256 releasedReserved, uint256 returnedToFree, uint256 freeBalanceAfter, uint256 reservedBalanceAfter)",
  "event BotVaultClaimed(address indexed botVault, uint256 releasedReserved, uint256 returnedToFree, uint256 freeBalanceAfter, uint256 reservedBalanceAfter)",
  "event BotVaultClosed(address indexed botVault, uint256 releasedReserved, uint256 returnedToFree)"
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
  "event BotReleased(uint256 releasedReserved, uint256 returnedToFree, int256 pnlDelta, int256 realizedPnlNetAfter)",
  "event FeePaidRecorded(uint256 feeAmount, uint256 feePaidTotalAfter)"
]);

export const onchainEventNames = new Set<string>([
  "MasterVaultCreated",
  "Deposited",
  "WithdrawRequested",
  "Withdrawn",
  "BotVaultCreated",
  "BotVaultProvisioned",
  "ReservedForBotVault",
  "ReleasedFromBotVault",
  "BotVaultClaimed",
  "BotVaultClosed",
  "StatusChanged",
  "BotInitialized",
  "BotToppedUp",
  "BotReleased",
  "FeePaidRecorded"
]);

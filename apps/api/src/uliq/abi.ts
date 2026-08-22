import { parseAbi } from "viem";

export const uliqTokenAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "event Transfer(address indexed from,address indexed to,uint256 value)"
]);

export const uliqPresaleAbi = parseAbi([
  "function owner() view returns (address)",
  "function state() view returns (uint8)",
  "function saleStart() view returns (uint64)",
  "function saleEnd() view returns (uint64)",
  "function withdrawalPeriodSeconds() view returns (uint64)",
  "function dexLaunchTimestamp() view returns (uint64)",
  "function hardCapUsdcRaw() view returns (uint256)",
  "function totalRaisedUsdcRaw() view returns (uint256)",
  "function totalSoldUliqRaw() view returns (uint256)",
  "function pendingAllocationUliqRaw() view returns (uint256)",
  "function pendingPurchaseCount() view returns (uint256)",
  "function maximumPurchasableUsdcRaw() view returns (uint256)",
  "function quotePurchase(uint256 requestedUsdcRaw) view returns (uint256 acceptedUsdcRaw,uint256 uliqAllocationRaw)",
  "function purchases(uint256 purchaseId) view returns (address buyer,uint256 usdcAmountRaw,uint256 uliqAllocationRaw,uint64 purchasedAt,uint64 withdrawalDeadline,uint8 state)",
  "function buy(uint256 maxUsdcAmountRaw,uint256 minUliqAllocationRaw) returns (uint256 purchaseId,uint256 acceptedUsdcRaw,uint256 uliqAllocationRaw)",
  "function withdrawPurchase(uint256 purchaseId)",
  "function finalizePurchase(uint256 purchaseId)",
  "function setDexLaunchTimestamp(uint64 dexLaunchTimestamp)",
  "event SaleStateChanged(uint8 indexed previousState,uint8 indexed nextState)",
  "event PurchaseCreated(uint256 indexed purchaseId,address indexed buyer,uint256 usdcAmountRaw,uint256 uliqAllocationRaw,uint64 withdrawalDeadline)",
  "event PurchaseWithdrawn(uint256 indexed purchaseId,address indexed buyer,uint256 usdcRefundRaw,uint256 cancelledUliqAllocationRaw)",
  "event PurchaseFinalized(uint256 indexed purchaseId,address indexed buyer,address indexed caller,uint256 walletUliqRaw,uint256 vestingUliqRaw)",
  "event DexLaunchTimestampSet(uint64 indexed dexLaunchTimestamp)"
]);

export const uliqVestingAbi = parseAbi([
  "function allocated(address beneficiary) view returns (uint256)",
  "function released(address beneficiary) view returns (uint256)",
  "function unreleased(address beneficiary) view returns (uint256)",
  "function vested(address beneficiary) view returns (uint256)",
  "function claimable(address beneficiary) view returns (uint256)",
  "function vestingStart() view returns (uint64)",
  "function vestingEnd() view returns (uint64)",
  "function claim() returns (uint256 amount)",
  "event AllocationCreated(address indexed beneficiary,uint256 amount,uint256 allocatedTotal)",
  "event TokensReleased(address indexed beneficiary,uint256 amount,uint256 releasedTotal)",
  "event VestingStartSet(uint64 indexed vestingStart,uint64 indexed vestingEnd)"
]);

export const uliqLockerAbi = parseAbi([
  "function lockedBalanceOf(address owner) view returns (uint256)",
  "function locks(uint256 lockId) view returns (address owner,uint256 amount,uint64 startedAt,uint64 unlockAt,bool withdrawn)",
  "function lock(uint256 amount,uint64 durationSeconds) returns (uint256 lockId)",
  "function unlock(uint256 lockId)",
  "event TokensLocked(uint256 indexed lockId,address indexed owner,uint256 amount,uint64 durationSeconds,uint64 unlockAt)",
  "event TokensUnlocked(uint256 indexed lockId,address indexed owner,uint256 amount)"
]);

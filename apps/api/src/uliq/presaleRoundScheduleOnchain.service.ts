import {
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  isAddress,
  zeroAddress,
  type Hex
} from "viem";
import {
  uliqGlobalListingAbi,
  uliqPaymentCustodyAbi,
  uliqPresaleRoundAbi,
  uliqPresaleRoundVestingAbi,
  uliqTokenAbi
} from "./abi.js";
import {
  getUliqPublicPresaleConfig,
  type UliqPublicPresaleConfig,
  type UliqPublicPresaleRoundConfig,
  type UliqPublicPresaleRoundId
} from "./publicPresale.config.js";
import { getUliqPresaleRoundSchedule } from "./presaleRoundSchedule.js";
import {
  createUliqRpcPair,
  getConsistentFinalizedBlock,
  type UliqRpcPair
} from "./rpc.js";

const ACTION_TYPE_CONFIGURE = "uliq_configure_sale_window";
const ACTION_TYPE_MARK_READY = "uliq_mark_presale_round_ready";
const ACTION_TYPE_FUND_INVENTORY = "uliq_fund_presale_inventory";
const ACTION_TYPE_RELEASE_UNSOLD = "uliq_release_unsold_inventory";

type OnchainRound = {
  owner: `0x${string}`;
  state: number;
  saleStart: bigint;
  saleEnd: bigint;
  saleWindowVersion: bigint;
  inventorySource: `0x${string}`;
  inventoryFunded: boolean;
  allocationCap: bigint;
  inventory: bigint;
  pendingPurchaseCount: bigint;
  unsoldReleased: bigint;
  unsoldInventory: bigint;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function timestampSeconds(value: string): bigint {
  const milliseconds = new Date(value).getTime();
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0 || milliseconds % 1_000 !== 0) {
    throw new Error("uliq_presale_schedule_requires_exact_seconds");
  }
  return BigInt(milliseconds / 1_000);
}

function transactionHash(value: unknown): Hex {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) throw new Error("invalid_transaction_hash");
  return normalized as Hex;
}

function actionKey(
  config: UliqPublicPresaleConfig,
  round: UliqPublicPresaleRoundConfig,
  draftVersion: number,
  expectedOnchainVersion: bigint
): string {
  return [
    "uliq:schedule",
    config.chainId,
    round.contractAddress.toLowerCase(),
    draftVersion,
    expectedOnchainVersion.toString()
  ].join(":");
}

function readyActionKey(
  config: UliqPublicPresaleConfig,
  round: UliqPublicPresaleRoundConfig,
  draftVersion: number,
  saleWindowVersion: bigint
): string {
  return [
    "uliq:mark-ready",
    config.chainId,
    round.contractAddress.toLowerCase(),
    draftVersion,
    saleWindowVersion.toString()
  ].join(":");
}

function inventoryActionKey(
  action: "fund" | "release",
  config: UliqPublicPresaleConfig,
  round: UliqPublicPresaleRoundConfig
): string {
  return ["uliq:inventory", action, config.chainId, round.contractAddress.toLowerCase()].join(":");
}

function sameAddress(actual: unknown, expected: unknown): boolean {
  return String(actual).toLowerCase() === String(expected).toLowerCase();
}

function comparable(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => typeof nested === "bigint" ? nested.toString() : nested);
}

function safeTransaction(
  chainId: number,
  to: `0x${string}`,
  data: Hex,
  expectedSender: `0x${string}`
) {
  return { chainId, to, data, value: "0", operation: 0, expectedSender };
}

export class UliqPresaleRoundScheduleOnchainService {
  private readonly config: UliqPublicPresaleConfig;
  private readonly rpc: UliqRpcPair;

  constructor(private readonly db: any, deps: { config?: UliqPublicPresaleConfig; rpc?: UliqRpcPair } = {}) {
    this.config = deps.config ?? getUliqPublicPresaleConfig();
    this.rpc = deps.rpc ?? createUliqRpcPair(this.config);
  }

  async getState() {
    const schedule = await getUliqPresaleRoundSchedule(this.db);
    const head = await getConsistentFinalizedBlock(this.rpc);
    const rounds = [];
    for (const round of this.config.rounds) {
      const draft = schedule.rounds.find((entry) => entry.id === round.id)!;
      const onchain = await this.readRound(round, head.number);
      const start = draft.saleStart ? timestampSeconds(draft.saleStart) : null;
      const end = draft.saleEnd ? timestampSeconds(draft.saleEnd) : null;
      const matches = start !== null && end !== null && start === onchain.saleStart && end === onchain.saleEnd;
      const pendingAction = await this.db.onchainAction.findFirst({
        where: {
          actionType: ACTION_TYPE_CONFIGURE,
          chainId: this.config.chainId,
          toAddress: round.contractAddress.toLowerCase(),
          status: { in: ["prepared", "submitted", "submitting"] }
        },
        orderBy: { createdAt: "desc" }
      });
      let bindingStatus = "DRAFT_ONLY";
      if (!draft.saleStart || !draft.saleEnd) bindingStatus = onchain.saleEnd === 0n ? "NOT_CONFIGURED" : "DRIFTED";
      else if (matches) bindingStatus = onchain.state === 0 ? "BOUND" : "FROZEN";
      else if (pendingAction?.status === "prepared") bindingStatus = "PREPARED";
      else if (["submitted", "submitting"].includes(String(pendingAction?.status))) bindingStatus = "PENDING";
      else if (onchain.saleEnd !== 0n) bindingStatus = "DRIFTED";

      rounds.push({
        ...draft,
        onchain: {
          contractAddress: round.contractAddress,
          owner: onchain.owner,
          state: onchain.state,
          saleStart: onchain.saleStart === 0n ? null : new Date(Number(onchain.saleStart) * 1_000).toISOString(),
          saleEnd: onchain.saleEnd === 0n ? null : new Date(Number(onchain.saleEnd) * 1_000).toISOString(),
          saleWindowVersion: onchain.saleWindowVersion.toString(),
          inventorySourceAddress: onchain.inventorySource,
          inventoryFunded: onchain.inventoryFunded,
          inventoryUliqRaw: onchain.inventory.toString(),
          allocationCapUliqRaw: onchain.allocationCap.toString(),
          pendingPurchaseCount: onchain.pendingPurchaseCount.toString(),
          unsoldReleasedUliqRaw: onchain.unsoldReleased.toString(),
          unsoldInventoryUliqRaw: onchain.unsoldInventory.toString(),
          bindingStatus,
          actionId: pendingAction?.id ?? null,
          transactionHash: pendingAction?.txHash ?? null
        }
      });
    }
    const statuses = rounds.map((round) => round.onchain.bindingStatus);
    const onchainStatus = statuses.includes("DRIFTED")
      ? "DRIFTED"
      : statuses.includes("PENDING")
        ? "PENDING"
        : statuses.includes("PREPARED")
          ? "PREPARED"
          : statuses.every((status) => status === "BOUND")
            ? "BOUND"
            : statuses.every((status) => status === "BOUND" || status === "FROZEN")
              ? "FROZEN"
              : "DRAFT_ONLY";
    return {
      ...schedule,
      onchainStatus,
      chainId: this.config.chainId,
      asOfBlock: head.number.toString(),
      blockHash: head.hash,
      rounds
    };
  }

  async prepare(roundId: UliqPublicPresaleRoundId, draftVersion: number) {
    const schedule = await getUliqPresaleRoundSchedule(this.db);
    if (schedule.version !== draftVersion) throw new Error("uliq_presale_schedule_version_stale");
    const round = this.round(roundId);
    const draft = schedule.rounds.find((entry) => entry.id === roundId);
    if (!draft?.saleStart || !draft.saleEnd) throw new Error("uliq_presale_schedule_not_configured");
    const saleStart = timestampSeconds(draft.saleStart);
    const saleEnd = timestampSeconds(draft.saleEnd);
    const head = await getConsistentFinalizedBlock(this.rpc);
    const onchain = await this.readRound(round, head.number);
    if (onchain.state !== 0) throw new Error("uliq_presale_schedule_frozen");
    if (saleStart >= saleEnd || saleEnd <= head.timestamp) throw new Error("uliq_presale_schedule_window_invalid");
    if (!await this.ownerHasCode(onchain.owner, head.number)) throw new Error("uliq_presale_schedule_owner_not_contract");

    const data = encodeFunctionData({
      abi: uliqPresaleRoundAbi,
      functionName: "configureSaleWindow",
      args: [onchain.saleWindowVersion, saleStart, saleEnd]
    });
    const key = actionKey(this.config, round, draftVersion, onchain.saleWindowVersion);
    const action = await this.db.onchainAction.upsert({
      where: { actionKey: key },
      create: {
        actionKey: key,
        actionType: ACTION_TYPE_CONFIGURE,
        status: "prepared",
        chainId: this.config.chainId,
        toAddress: round.contractAddress.toLowerCase(),
        dataHex: data,
        valueWei: "0",
        metadata: {
          roundId,
          draftVersion,
          expectedOnchainVersion: onchain.saleWindowVersion.toString(),
          saleStart: saleStart.toString(),
          saleEnd: saleEnd.toString(),
          owner: onchain.owner.toLowerCase(),
          preparedAtBlock: head.number.toString(),
          preparedAtBlockHash: head.hash
        }
      },
      update: {}
    });
    return {
      actionId: action.id,
      safeTransaction: safeTransaction(this.config.chainId, round.contractAddress, data, onchain.owner),
      preflight: {
        roundId,
        draftVersion,
        expectedOnchainVersion: onchain.saleWindowVersion.toString(),
        saleStart: draft.saleStart,
        saleEnd: draft.saleEnd,
        state: "DRAFT",
        asOfBlock: head.number.toString(),
        blockHash: head.hash
      }
    };
  }

  async prepareMarkReady(roundId: UliqPublicPresaleRoundId, draftVersion: number) {
    const schedule = await getUliqPresaleRoundSchedule(this.db);
    if (schedule.version !== draftVersion) throw new Error("uliq_presale_schedule_version_stale");
    const round = this.round(roundId);
    const draft = schedule.rounds.find((entry) => entry.id === roundId);
    if (!draft?.saleStart || !draft.saleEnd) throw new Error("uliq_presale_schedule_not_configured");
    const expectedStart = timestampSeconds(draft.saleStart);
    const expectedEnd = timestampSeconds(draft.saleEnd);
    const head = await getConsistentFinalizedBlock(this.rpc);
    const [primary, secondary] = await Promise.all([
      this.readReadiness(this.rpc.primary, round, head.number),
      this.readReadiness(this.rpc.secondary, round, head.number)
    ]);
    if (comparable(primary) !== comparable(secondary)) throw new Error("uliq_presale_ready_rpc_mismatch");
    if (primary.state !== 0) throw new Error("uliq_presale_ready_state_invalid");
    if (primary.saleStart !== expectedStart || primary.saleEnd !== expectedEnd || primary.saleWindowVersion === 0n) {
      throw new Error("uliq_presale_ready_schedule_not_bound");
    }
    if (!await this.ownerHasCode(primary.owner, head.number)) throw new Error("uliq_presale_schedule_owner_not_contract");

    const expectedPredecessor = round.number === 1 ? zeroAddress : this.config.rounds[0].contractAddress;
    const addressChecks: Array<[unknown, unknown, string]> = [
      [primary.uliq, this.config.tokenAddress, "uliq_presale_ready_token_mismatch"],
      [primary.usdc, this.config.usdcAddress, "uliq_presale_ready_payment_token_mismatch"],
      [primary.paymentCustody, round.paymentCustodyAddress, "uliq_presale_ready_custody_mismatch"],
      [primary.vesting, round.vestingAddress, "uliq_presale_ready_vesting_mismatch"],
      [primary.globalListing, this.config.globalListingAddress, "uliq_presale_ready_listing_mismatch"],
      [primary.predecessor, expectedPredecessor, "uliq_presale_ready_predecessor_mismatch"],
      [primary.inventorySource, round.inventorySourceAddress, "uliq_presale_ready_inventory_source_mismatch"],
      [primary.custodyPaymentToken, this.config.usdcAddress, "uliq_presale_ready_custody_token_mismatch"],
      [primary.custodyPresale, round.contractAddress, "uliq_presale_ready_custody_presale_mismatch"],
      [primary.vestingToken, this.config.tokenAddress, "uliq_presale_ready_vesting_token_mismatch"],
      [primary.vestingListing, this.config.globalListingAddress, "uliq_presale_ready_vesting_listing_mismatch"],
      [primary.vestingPresale, round.contractAddress, "uliq_presale_ready_vesting_presale_mismatch"],
      [primary.listingRoundOne, this.config.rounds[0].contractAddress, "uliq_presale_ready_listing_round_one_mismatch"],
      [primary.listingRoundTwo, this.config.rounds[1].contractAddress, "uliq_presale_ready_listing_round_two_mismatch"]
    ];
    for (const [actual, expected, reason] of addressChecks) {
      if (!sameAddress(actual, expected)) throw new Error(reason);
    }
    if (primary.allocationCap !== round.expected.allocationUliqRaw) {
      throw new Error("uliq_presale_ready_allocation_mismatch");
    }
    if (!primary.inventoryFunded) throw new Error("uliq_presale_ready_inventory_not_funded");
    if (primary.inventory < primary.allocationCap) throw new Error("uliq_presale_ready_inventory_insufficient");

    const data = encodeFunctionData({ abi: uliqPresaleRoundAbi, functionName: "markReady" });
    const key = readyActionKey(this.config, round, draftVersion, primary.saleWindowVersion);
    const action = await this.db.onchainAction.upsert({
      where: { actionKey: key },
      create: {
        actionKey: key,
        actionType: ACTION_TYPE_MARK_READY,
        status: "prepared",
        chainId: this.config.chainId,
        toAddress: round.contractAddress.toLowerCase(),
        dataHex: data,
        valueWei: "0",
        metadata: {
          roundId,
          draftVersion,
          saleWindowVersion: primary.saleWindowVersion.toString(),
          saleStart: primary.saleStart.toString(),
          saleEnd: primary.saleEnd.toString(),
          inventoryUliqRaw: primary.inventory.toString(),
          allocationCapUliqRaw: primary.allocationCap.toString(),
          owner: primary.owner.toLowerCase(),
          preparedAtBlock: head.number.toString(),
          preparedAtBlockHash: head.hash
        }
      },
      update: {}
    });
    return {
      actionId: action.id,
      safeTransaction: safeTransaction(this.config.chainId, round.contractAddress, data, primary.owner),
      preflight: {
        roundId,
        draftVersion,
        saleWindowVersion: primary.saleWindowVersion.toString(),
        saleStart: draft.saleStart,
        saleEnd: draft.saleEnd,
        state: "DRAFT",
        inventoryUliqRaw: primary.inventory.toString(),
        allocationCapUliqRaw: primary.allocationCap.toString(),
        custodyBound: true,
        vestingBound: true,
        listingBound: true,
        asOfBlock: head.number.toString(),
        blockHash: head.hash
      }
    };
  }

  async prepareFundInventory(roundId: UliqPublicPresaleRoundId) {
    const round = this.round(roundId);
    const head = await getConsistentFinalizedBlock(this.rpc);
    const onchain = await this.readRound(round, head.number);
    if (onchain.state !== 0) throw new Error("uliq_presale_inventory_funding_state_invalid");
    if (onchain.inventoryFunded) throw new Error("uliq_presale_inventory_already_funded");
    if (!sameAddress(onchain.inventorySource, round.inventorySourceAddress)) {
      throw new Error("uliq_presale_inventory_source_mismatch");
    }
    if (onchain.allocationCap !== round.expected.allocationUliqRaw) {
      throw new Error("uliq_presale_inventory_allocation_mismatch");
    }
    if (!await this.ownerHasCode(onchain.inventorySource, head.number)) {
      throw new Error("uliq_presale_inventory_source_not_contract");
    }

    const [allowance, sourceBalance] = await Promise.all([
      this.readAllowance(onchain.inventorySource, round.contractAddress, head.number),
      this.readTokenBalance(onchain.inventorySource, head.number)
    ]);
    if (sourceBalance < onchain.allocationCap) throw new Error("uliq_presale_inventory_source_balance_insufficient");
    const approvalData = encodeFunctionData({
      abi: uliqTokenAbi,
      functionName: "approve",
      args: [round.contractAddress, onchain.allocationCap]
    });
    const fundingData = encodeFunctionData({ abi: uliqPresaleRoundAbi, functionName: "fundInventory" });
    const transactions = [];
    if (allowance < onchain.allocationCap) {
      transactions.push(safeTransaction(this.config.chainId, this.config.tokenAddress, approvalData, onchain.inventorySource));
    }
    transactions.push(safeTransaction(this.config.chainId, round.contractAddress, fundingData, onchain.inventorySource));

    const key = inventoryActionKey("fund", this.config, round);
    const action = await this.db.onchainAction.upsert({
      where: { actionKey: key },
      create: {
        actionKey: key,
        actionType: ACTION_TYPE_FUND_INVENTORY,
        status: "prepared",
        chainId: this.config.chainId,
        toAddress: round.contractAddress.toLowerCase(),
        dataHex: fundingData,
        valueWei: "0",
        metadata: {
          roundId,
          inventorySource: onchain.inventorySource.toLowerCase(),
          allocationCapUliqRaw: onchain.allocationCap.toString(),
          allowanceUliqRaw: allowance.toString(),
          sourceBalanceUliqRaw: sourceBalance.toString(),
          approvalRequired: allowance < onchain.allocationCap,
          preparedAtBlock: head.number.toString(),
          preparedAtBlockHash: head.hash
        }
      },
      update: {}
    });
    return {
      actionId: action.id,
      safeTransaction: transactions[transactions.length - 1],
      safeTransactions: transactions,
      preflight: {
        roundId,
        state: "DRAFT",
        inventorySourceAddress: onchain.inventorySource,
        inventoryFunded: false,
        allocationCapUliqRaw: onchain.allocationCap.toString(),
        currentAllowanceUliqRaw: allowance.toString(),
        sourceBalanceUliqRaw: sourceBalance.toString(),
        approvalRequired: allowance < onchain.allocationCap,
        executionOrder: allowance < onchain.allocationCap ? ["approve", "fundInventory"] : ["fundInventory"],
        asOfBlock: head.number.toString(),
        blockHash: head.hash
      }
    };
  }

  async prepareReleaseUnsold(roundId: UliqPublicPresaleRoundId) {
    const round = this.round(roundId);
    const head = await getConsistentFinalizedBlock(this.rpc);
    const onchain = await this.readRound(round, head.number);
    if (![4, 5, 6, 7].includes(onchain.state)) throw new Error("uliq_presale_unsold_release_state_invalid");
    if (onchain.pendingPurchaseCount !== 0n) throw new Error("uliq_presale_unsold_release_pending_purchases");
    if (onchain.unsoldReleased !== 0n) throw new Error("uliq_presale_unsold_already_released");
    if (onchain.unsoldInventory === 0n) throw new Error("uliq_presale_unsold_inventory_empty");
    if (!sameAddress(onchain.inventorySource, round.inventorySourceAddress)) {
      throw new Error("uliq_presale_inventory_source_mismatch");
    }
    if (onchain.inventory < onchain.unsoldInventory) throw new Error("uliq_presale_unsold_inventory_insufficient");
    if (!await this.ownerHasCode(onchain.owner, head.number)) throw new Error("uliq_presale_schedule_owner_not_contract");

    const data = encodeFunctionData({ abi: uliqPresaleRoundAbi, functionName: "releaseUnsold" });
    const key = inventoryActionKey("release", this.config, round);
    const action = await this.db.onchainAction.upsert({
      where: { actionKey: key },
      create: {
        actionKey: key,
        actionType: ACTION_TYPE_RELEASE_UNSOLD,
        status: "prepared",
        chainId: this.config.chainId,
        toAddress: round.contractAddress.toLowerCase(),
        dataHex: data,
        valueWei: "0",
        metadata: {
          roundId,
          inventorySource: onchain.inventorySource.toLowerCase(),
          unsoldInventoryUliqRaw: onchain.unsoldInventory.toString(),
          owner: onchain.owner.toLowerCase(),
          preparedAtBlock: head.number.toString(),
          preparedAtBlockHash: head.hash
        }
      },
      update: {}
    });
    return {
      actionId: action.id,
      safeTransaction: safeTransaction(this.config.chainId, round.contractAddress, data, onchain.owner),
      safeTransactions: [safeTransaction(this.config.chainId, round.contractAddress, data, onchain.owner)],
      preflight: {
        roundId,
        state: onchain.state,
        inventorySourceAddress: onchain.inventorySource,
        pendingPurchaseCount: "0",
        unsoldInventoryUliqRaw: onchain.unsoldInventory.toString(),
        asOfBlock: head.number.toString(),
        blockHash: head.hash
      }
    };
  }

  async recordInventoryExecution(actionId: string, txHashInput: unknown) {
    const txHash = transactionHash(txHashInput);
    const action = await this.db.onchainAction.findUnique({ where: { id: actionId } });
    const actionType = String(action?.actionType ?? "");
    if (
      !action
      || (actionType !== ACTION_TYPE_FUND_INVENTORY && actionType !== ACTION_TYPE_RELEASE_UNSOLD)
      || Number(action.chainId) !== this.config.chainId
    ) throw new Error("uliq_presale_inventory_action_not_found");
    const metadata = asRecord(action.metadata);
    const roundId = String(metadata.roundId) as UliqPublicPresaleRoundId;
    const round = this.round(roundId);
    if (String(action.toAddress).toLowerCase() !== round.contractAddress.toLowerCase()) {
      throw new Error("uliq_presale_inventory_action_target_mismatch");
    }
    const receipts = await Promise.all([
      this.receiptOrNull(this.rpc.primary, txHash),
      this.receiptOrNull(this.rpc.secondary, txHash)
    ]);
    if (!receipts[0] || !receipts[1]) {
      return this.db.onchainAction.update({
        where: { id: action.id },
        data: { status: "submitted", txHash, metadata: { ...metadata, submittedAt: new Date().toISOString() } }
      });
    }
    if (
      receipts[0].status !== "success"
      || receipts[1].status !== "success"
      || receipts[0].blockHash.toLowerCase() !== receipts[1].blockHash.toLowerCase()
      || receipts[0].blockNumber !== receipts[1].blockNumber
    ) throw new Error("uliq_presale_inventory_receipt_invalid");

    const expectedEvent = action.actionType === ACTION_TYPE_FUND_INVENTORY ? "InventoryFunded" : "UnsoldUliqReleased";
    const expectedAmount = BigInt(String(
      action.actionType === ACTION_TYPE_FUND_INVENTORY
        ? metadata.allocationCapUliqRaw
        : metadata.unsoldInventoryUliqRaw
    ));
    const matchingEvent = receipts[0].logs.some((log: any) => {
      if (String(log.address).toLowerCase() !== round.contractAddress.toLowerCase()) return false;
      try {
        const decoded: any = decodeEventLog({
          abi: uliqPresaleRoundAbi,
          data: log.data,
          topics: log.topics,
          strict: true
        });
        return decoded.eventName === expectedEvent
          && sameAddress(decoded.args.inventorySource, metadata.inventorySource)
          && BigInt(decoded.args.amount) === expectedAmount;
      } catch {
        return false;
      }
    });
    if (!matchingEvent) throw new Error("uliq_presale_inventory_event_mismatch");
    const head = await getConsistentFinalizedBlock(this.rpc);
    if (receipts[0].blockNumber > head.number) {
      return this.db.onchainAction.update({
        where: { id: action.id },
        data: { status: "submitted", txHash, metadata: { ...metadata, submittedAt: new Date().toISOString() } }
      });
    }
    const onchain = await this.readRound(round, head.number);
    if (action.actionType === ACTION_TYPE_FUND_INVENTORY) {
      if (!onchain.inventoryFunded || onchain.inventory < expectedAmount) {
        throw new Error("uliq_presale_inventory_finalized_state_mismatch");
      }
    } else if (onchain.unsoldReleased !== expectedAmount || onchain.unsoldInventory !== 0n) {
      throw new Error("uliq_presale_unsold_finalized_state_mismatch");
    }
    return this.db.onchainAction.update({
      where: { id: action.id },
      data: {
        status: "confirmed",
        txHash,
        metadata: {
          ...metadata,
          confirmedAt: new Date().toISOString(),
          confirmedBlockNumber: receipts[0].blockNumber.toString(),
          confirmedBlockHash: receipts[0].blockHash
        }
      }
    });
  }

  async recordExecution(actionId: string, txHashInput: unknown) {
    const txHash = transactionHash(txHashInput);
    const action = await this.db.onchainAction.findUnique({ where: { id: actionId } });
    if (!action || action.actionType !== ACTION_TYPE_CONFIGURE || Number(action.chainId) !== this.config.chainId) {
      throw new Error("uliq_presale_schedule_action_not_found");
    }
    const metadata = asRecord(action.metadata);
    const roundId = String(metadata.roundId) as UliqPublicPresaleRoundId;
    const round = this.round(roundId);
    if (String(action.toAddress).toLowerCase() !== round.contractAddress.toLowerCase()) {
      throw new Error("uliq_presale_schedule_action_target_mismatch");
    }
    const receipts = await Promise.all([
      this.receiptOrNull(this.rpc.primary, txHash),
      this.receiptOrNull(this.rpc.secondary, txHash)
    ]);
    if (!receipts[0] || !receipts[1]) {
      return this.db.onchainAction.update({
        where: { id: action.id },
        data: {
          status: "submitted",
          txHash,
          metadata: { ...metadata, submittedAt: new Date().toISOString() }
        }
      });
    }
    if (
      receipts[0].status !== "success"
      || receipts[1].status !== "success"
      || receipts[0].blockHash.toLowerCase() !== receipts[1].blockHash.toLowerCase()
      || receipts[0].blockNumber !== receipts[1].blockNumber
    ) throw new Error("uliq_presale_schedule_receipt_invalid");

    const expectedVersion = BigInt(String(metadata.expectedOnchainVersion)) + 1n;
    const expectedStart = BigInt(String(metadata.saleStart));
    const expectedEnd = BigInt(String(metadata.saleEnd));
    const matchingEvent = receipts[0].logs.some((log: any) => {
      if (String(log.address).toLowerCase() !== round.contractAddress.toLowerCase()) return false;
      try {
        const decoded = decodeEventLog({ abi: uliqPresaleRoundAbi, data: log.data, topics: log.topics, strict: true });
        return decoded.eventName === "SaleWindowConfigured"
          && BigInt(decoded.args.version) === expectedVersion
          && BigInt(decoded.args.saleStart) === expectedStart
          && BigInt(decoded.args.saleEnd) === expectedEnd;
      } catch {
        return false;
      }
    });
    if (!matchingEvent) throw new Error("uliq_presale_schedule_event_mismatch");
    const head = await getConsistentFinalizedBlock(this.rpc);
    if (receipts[0].blockNumber > head.number) {
      return this.db.onchainAction.update({
        where: { id: action.id },
        data: { status: "submitted", txHash, metadata: { ...metadata, submittedAt: new Date().toISOString() } }
      });
    }
    const onchain = await this.readRound(round, head.number);
    if (
      onchain.saleWindowVersion !== expectedVersion
      || onchain.saleStart !== expectedStart
      || onchain.saleEnd !== expectedEnd
    ) throw new Error("uliq_presale_schedule_finalized_state_mismatch");
    return this.db.onchainAction.update({
      where: { id: action.id },
      data: {
        status: "confirmed",
        txHash,
        metadata: {
          ...metadata,
          confirmedAt: new Date().toISOString(),
          confirmedBlockNumber: receipts[0].blockNumber.toString(),
          confirmedBlockHash: receipts[0].blockHash
        }
      }
    });
  }

  private round(roundId: UliqPublicPresaleRoundId): UliqPublicPresaleRoundConfig {
    const round = this.config.rounds.find((candidate) => candidate.id === roundId);
    if (!round) throw new Error("uliq_public_presale_invalid_round_id");
    return round;
  }

  private async readRound(round: UliqPublicPresaleRoundConfig, blockNumber: bigint): Promise<OnchainRound> {
    const [primary, secondary] = await Promise.all([
      this.readRoundFromClient(this.rpc.primary, round, blockNumber),
      this.readRoundFromClient(this.rpc.secondary, round, blockNumber)
    ]);
    if (comparable(primary) !== comparable(secondary)) throw new Error("uliq_presale_schedule_rpc_mismatch");
    return primary;
  }

  private async readRoundFromClient(client: any, round: UliqPublicPresaleRoundConfig, blockNumber: bigint) {
    const [
      owner,
      state,
      saleStart,
      saleEnd,
      saleWindowVersion,
      inventorySource,
      inventoryFunded,
      allocationCap,
      inventory,
      pendingPurchaseCount,
      unsoldReleased,
      unsoldInventory
    ] = await Promise.all([
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "owner", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "state", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "saleStart", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "saleEnd", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "saleWindowVersion", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "inventorySource", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "inventoryFunded", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "allocationCapUliqRaw", blockNumber }),
      client.readContract({ address: this.config.tokenAddress, abi: uliqTokenAbi, functionName: "balanceOf", args: [round.contractAddress], blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "pendingPurchaseCount", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "unsoldReleasedUliqRaw", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "unsoldInventoryUliqRaw", blockNumber })
    ]);
    const normalizedOwner = String(owner);
    const normalizedInventorySource = String(inventorySource);
    if (!isAddress(normalizedOwner)) throw new Error("uliq_presale_schedule_owner_invalid");
    if (!isAddress(normalizedInventorySource)) throw new Error("uliq_presale_inventory_source_invalid");
    return {
      owner: getAddress(normalizedOwner),
      state: Number(state),
      saleStart: BigInt(saleStart),
      saleEnd: BigInt(saleEnd),
      saleWindowVersion: BigInt(saleWindowVersion),
      inventorySource: getAddress(normalizedInventorySource),
      inventoryFunded: Boolean(inventoryFunded),
      allocationCap: BigInt(allocationCap),
      inventory: BigInt(inventory),
      pendingPurchaseCount: BigInt(pendingPurchaseCount),
      unsoldReleased: BigInt(unsoldReleased),
      unsoldInventory: BigInt(unsoldInventory)
    };
  }

  private async readReadiness(client: any, round: UliqPublicPresaleRoundConfig, blockNumber: bigint) {
    const [
      owner,
      state,
      saleStart,
      saleEnd,
      saleWindowVersion,
      uliq,
      usdc,
      paymentCustody,
      vesting,
      globalListing,
      predecessor,
      allocationCap,
      inventory,
      custodyPaymentToken,
      custodyPresale,
      vestingToken,
      vestingListing,
      vestingPresale,
      listingRoundOne,
      listingRoundTwo,
      inventorySource,
      inventoryFunded
    ] = await Promise.all([
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "owner", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "state", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "saleStart", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "saleEnd", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "saleWindowVersion", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "uliq", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "usdc", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "paymentCustody", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "vesting", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "globalListing", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "predecessor", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "allocationCapUliqRaw", blockNumber }),
      client.readContract({ address: this.config.tokenAddress, abi: uliqTokenAbi, functionName: "balanceOf", args: [round.contractAddress], blockNumber }),
      client.readContract({ address: round.paymentCustodyAddress, abi: uliqPaymentCustodyAbi, functionName: "paymentToken", blockNumber }),
      client.readContract({ address: round.paymentCustodyAddress, abi: uliqPaymentCustodyAbi, functionName: "presale", blockNumber }),
      client.readContract({ address: round.vestingAddress, abi: uliqPresaleRoundVestingAbi, functionName: "token", blockNumber }),
      client.readContract({ address: round.vestingAddress, abi: uliqPresaleRoundVestingAbi, functionName: "globalListing", blockNumber }),
      client.readContract({ address: round.vestingAddress, abi: uliqPresaleRoundVestingAbi, functionName: "presale", blockNumber }),
      client.readContract({ address: this.config.globalListingAddress, abi: uliqGlobalListingAbi, functionName: "roundOne", blockNumber }),
      client.readContract({ address: this.config.globalListingAddress, abi: uliqGlobalListingAbi, functionName: "roundTwo", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "inventorySource", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "inventoryFunded", blockNumber })
    ]);
    const normalizedOwner = String(owner);
    if (!isAddress(normalizedOwner)) throw new Error("uliq_presale_schedule_owner_invalid");
    return {
      owner: getAddress(normalizedOwner),
      state: Number(state),
      saleStart: BigInt(saleStart),
      saleEnd: BigInt(saleEnd),
      saleWindowVersion: BigInt(saleWindowVersion),
      uliq: String(uliq),
      usdc: String(usdc),
      paymentCustody: String(paymentCustody),
      vesting: String(vesting),
      globalListing: String(globalListing),
      predecessor: String(predecessor),
      allocationCap: BigInt(allocationCap),
      inventory: BigInt(inventory),
      custodyPaymentToken: String(custodyPaymentToken),
      custodyPresale: String(custodyPresale),
      vestingToken: String(vestingToken),
      vestingListing: String(vestingListing),
      vestingPresale: String(vestingPresale),
      listingRoundOne: String(listingRoundOne),
      listingRoundTwo: String(listingRoundTwo),
      inventorySource: String(inventorySource),
      inventoryFunded: Boolean(inventoryFunded)
    };
  }

  private async ownerHasCode(owner: `0x${string}`, blockNumber: bigint): Promise<boolean> {
    const [primary, secondary] = await Promise.all([
      this.rpc.primary.getBytecode({ address: owner, blockNumber }),
      this.rpc.secondary.getBytecode({ address: owner, blockNumber })
    ]);
    return Boolean(primary && primary !== "0x" && secondary && secondary !== "0x" && primary === secondary);
  }

  private async readAllowance(owner: `0x${string}`, spender: `0x${string}`, blockNumber: bigint): Promise<bigint> {
    const [primary, secondary] = await Promise.all([
      this.rpc.primary.readContract({
        address: this.config.tokenAddress,
        abi: uliqTokenAbi,
        functionName: "allowance",
        args: [owner, spender],
        blockNumber
      }),
      this.rpc.secondary.readContract({
        address: this.config.tokenAddress,
        abi: uliqTokenAbi,
        functionName: "allowance",
        args: [owner, spender],
        blockNumber
      })
    ]);
    if (BigInt(primary) !== BigInt(secondary)) throw new Error("uliq_presale_inventory_allowance_rpc_mismatch");
    return BigInt(primary);
  }

  private async readTokenBalance(account: `0x${string}`, blockNumber: bigint): Promise<bigint> {
    const [primary, secondary] = await Promise.all([
      this.rpc.primary.readContract({
        address: this.config.tokenAddress,
        abi: uliqTokenAbi,
        functionName: "balanceOf",
        args: [account],
        blockNumber
      }),
      this.rpc.secondary.readContract({
        address: this.config.tokenAddress,
        abi: uliqTokenAbi,
        functionName: "balanceOf",
        args: [account],
        blockNumber
      })
    ]);
    if (BigInt(primary) !== BigInt(secondary)) throw new Error("uliq_presale_inventory_balance_rpc_mismatch");
    return BigInt(primary);
  }

  private async receiptOrNull(client: any, txHash: Hex): Promise<any | null> {
    try {
      return await client.getTransactionReceipt({ hash: txHash });
    } catch (error) {
      if (/not found|could not be found/i.test(String(error))) return null;
      throw error;
    }
  }
}

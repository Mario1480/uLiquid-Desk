// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IULIQPaymentCustody} from "./interfaces/IULIQPaymentCustody.sol";
import {ULIQPresaleVesting} from "./ULIQPresaleVesting.sol";

/// @title ULIQ Presale
/// @notice Arbitrum Sepolia MVP state machine with provisional, replaceable testnet custody.
/// @dev This contract is not a legal or production safeguarding decision. ADR-001 remains blocked.
contract ULIQPresale is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum SaleState {
        DRAFT,
        READY,
        ACTIVE,
        PAUSED,
        ENDED,
        DEX_PENDING,
        DEX_LAUNCHED,
        COMPLETED,
        CANCELLED
    }

    enum PurchaseState {
        PENDING_WITHDRAWAL,
        WITHDRAWN,
        FINALIZED
    }

    struct Purchase {
        address buyer;
        uint256 usdcAmountRaw;
        uint256 uliqAllocationRaw;
        uint64 purchasedAt;
        uint64 withdrawalDeadline;
        PurchaseState state;
    }

    uint16 public constant IMMEDIATE_BPS = 2_500;
    uint16 public constant VESTING_BPS = 7_500;
    uint16 private constant BPS_DENOMINATOR = 10_000;

    IERC20 public immutable uliq;
    IERC20 public immutable usdc;
    IULIQPaymentCustody public immutable paymentCustody;
    ULIQPresaleVesting public immutable vesting;
    uint256 public immutable hardCapUsdcRaw;
    uint256 public immutable allocationCapUliqRaw;
    uint256 public immutable rateNumerator;
    uint256 public immutable rateDenominator;
    uint64 public immutable saleStart;
    uint64 public immutable saleEnd;
    uint64 public immutable withdrawalPeriodSeconds;

    SaleState public state;
    uint64 public dexLaunchTimestamp;
    uint256 public nextPurchaseId = 1;
    uint256 public totalRaisedUsdcRaw;
    uint256 public totalSoldUliqRaw;
    uint256 public pendingAllocationUliqRaw;
    uint256 public pendingPurchaseCount;
    uint256 public finalizedAllocationUliqRaw;
    uint256 public withdrawnAllocationUliqRaw;
    mapping(uint256 => Purchase) public purchases;

    error ZeroAddress();
    error InvalidConfiguration();
    error InvalidTokenDecimals();
    error InvalidState(SaleState expected, SaleState actual);
    error SaleNotActive();
    error SaleWindowClosed();
    error ZeroAmount();
    error NothingAvailable();
    error AllocationBelowMinimum(uint256 actual, uint256 minimum);
    error InsufficientInventory(uint256 available, uint256 required);
    error PurchaseNotPending();
    error NotBuyer();
    error WithdrawalWindowClosed();
    error WithdrawalWindowActive();
    error PendingPurchasesRemain(uint256 count);
    error DexLaunchAlreadySet();
    error InvalidDexLaunchTimestamp();
    error CancellationRequiresNoPurchases();

    event SaleStateChanged(SaleState indexed previousState, SaleState indexed nextState);
    event PurchaseCreated(
        uint256 indexed purchaseId,
        address indexed buyer,
        uint256 usdcAmountRaw,
        uint256 uliqAllocationRaw,
        uint64 withdrawalDeadline
    );
    event PurchaseWithdrawn(
        uint256 indexed purchaseId,
        address indexed buyer,
        uint256 usdcRefundRaw,
        uint256 cancelledUliqAllocationRaw
    );
    event PurchaseFinalized(
        uint256 indexed purchaseId,
        address indexed buyer,
        address indexed caller,
        uint256 walletUliqRaw,
        uint256 vestingUliqRaw
    );
    event DexLaunchTimestampSet(uint64 indexed dexLaunchTimestamp);

    constructor(
        address uliq_,
        address usdc_,
        address paymentCustody_,
        address vesting_,
        address admin,
        uint256 hardCapUsdcRaw_,
        uint256 allocationCapUliqRaw_,
        uint256 rateNumerator_,
        uint256 rateDenominator_,
        uint64 saleStart_,
        uint64 saleEnd_,
        uint64 withdrawalPeriodSeconds_
    ) Ownable(admin) {
        if (
            uliq_ == address(0) || usdc_ == address(0) || paymentCustody_ == address(0)
                || vesting_ == address(0) || admin == address(0)
        ) revert ZeroAddress();
        if (
            hardCapUsdcRaw_ == 0 || allocationCapUliqRaw_ == 0 || rateNumerator_ == 0
                || rateDenominator_ == 0 || saleStart_ >= saleEnd_ || withdrawalPeriodSeconds_ == 0
        ) revert InvalidConfiguration();

        uliq = IERC20(uliq_);
        usdc = IERC20(usdc_);
        paymentCustody = IULIQPaymentCustody(paymentCustody_);
        vesting = ULIQPresaleVesting(vesting_);
        if (paymentCustody.paymentToken() != usdc_) revert InvalidConfiguration();
        if (IERC20Metadata(usdc_).decimals() != 6 || IERC20Metadata(uliq_).decimals() != 18) {
            revert InvalidTokenDecimals();
        }
        hardCapUsdcRaw = hardCapUsdcRaw_;
        allocationCapUliqRaw = allocationCapUliqRaw_;
        rateNumerator = rateNumerator_;
        rateDenominator = rateDenominator_;
        saleStart = saleStart_;
        saleEnd = saleEnd_;
        withdrawalPeriodSeconds = withdrawalPeriodSeconds_;
    }

    function markReady() external onlyOwner {
        _requireState(SaleState.DRAFT);
        uint256 inventory = uliq.balanceOf(address(this));
        if (inventory < allocationCapUliqRaw) revert InsufficientInventory(inventory, allocationCapUliqRaw);
        _setState(SaleState.READY);
    }

    function activateSale() external onlyOwner {
        _requireState(SaleState.READY);
        if (block.timestamp < saleStart || block.timestamp >= saleEnd) revert SaleWindowClosed();
        _setState(SaleState.ACTIVE);
    }

    function pauseSale() external onlyOwner {
        _requireState(SaleState.ACTIVE);
        _setState(SaleState.PAUSED);
    }

    function unpauseSale() external onlyOwner {
        _requireState(SaleState.PAUSED);
        if (block.timestamp >= saleEnd || totalRaisedUsdcRaw >= hardCapUsdcRaw) revert SaleWindowClosed();
        _setState(SaleState.ACTIVE);
    }

    function endSale() external {
        if (state != SaleState.ACTIVE && state != SaleState.PAUSED) {
            revert InvalidState(SaleState.ACTIVE, state);
        }
        if (block.timestamp < saleEnd && totalRaisedUsdcRaw < hardCapUsdcRaw) revert SaleWindowClosed();
        _setState(SaleState.ENDED);
    }

    function markDexPending() external onlyOwner {
        _requireState(SaleState.ENDED);
        _setState(SaleState.DEX_PENDING);
    }

    /// @notice Cancels only an empty testnet sale. Finalized/pending cancellation remains ADR-001-blocked.
    function cancelEmptySale() external onlyOwner {
        if (state != SaleState.ACTIVE && state != SaleState.PAUSED) {
            revert InvalidState(SaleState.ACTIVE, state);
        }
        if (totalSoldUliqRaw != 0 || pendingPurchaseCount != 0) revert CancellationRequiresNoPurchases();
        _setState(SaleState.CANCELLED);
    }

    function completeSale() external onlyOwner {
        _requireState(SaleState.DEX_LAUNCHED);
        _setState(SaleState.COMPLETED);
    }

    function quotePurchase(uint256 requestedUsdcRaw)
        public
        view
        returns (uint256 acceptedUsdcRaw, uint256 uliqAllocationRaw)
    {
        if (requestedUsdcRaw == 0) return (0, 0);
        uint256 remainingCap = hardCapUsdcRaw - totalRaisedUsdcRaw;
        if (remainingCap == 0) return (0, 0);
        acceptedUsdcRaw = Math.min(requestedUsdcRaw, remainingCap);
        uliqAllocationRaw = Math.mulDiv(acceptedUsdcRaw, rateNumerator, rateDenominator);

        uint256 remainingAllocation = allocationCapUliqRaw - totalSoldUliqRaw;
        if (uliqAllocationRaw > remainingAllocation) {
            acceptedUsdcRaw = Math.mulDiv(remainingAllocation, rateDenominator, rateNumerator);
            uliqAllocationRaw = Math.mulDiv(acceptedUsdcRaw, rateNumerator, rateDenominator);
        }
    }

    function buy(uint256 maxUsdcAmountRaw, uint256 minUliqAllocationRaw)
        external
        nonReentrant
        returns (uint256 purchaseId, uint256 acceptedUsdcRaw, uint256 uliqAllocationRaw)
    {
        if (state != SaleState.ACTIVE) revert SaleNotActive();
        if (block.timestamp < saleStart || block.timestamp >= saleEnd) revert SaleWindowClosed();
        if (maxUsdcAmountRaw == 0) revert ZeroAmount();

        (acceptedUsdcRaw, uliqAllocationRaw) = quotePurchase(maxUsdcAmountRaw);
        if (acceptedUsdcRaw == 0 || uliqAllocationRaw == 0) revert NothingAvailable();
        if (uliqAllocationRaw < minUliqAllocationRaw) {
            revert AllocationBelowMinimum(uliqAllocationRaw, minUliqAllocationRaw);
        }

        uint256 requiredInventory = pendingAllocationUliqRaw + uliqAllocationRaw;
        uint256 inventory = uliq.balanceOf(address(this));
        if (inventory < requiredInventory) revert InsufficientInventory(inventory, requiredInventory);

        purchaseId = nextPurchaseId++;
        uint64 purchasedAt = uint64(block.timestamp);
        uint64 withdrawalDeadline = purchasedAt + withdrawalPeriodSeconds;
        purchases[purchaseId] = Purchase({
            buyer: msg.sender,
            usdcAmountRaw: acceptedUsdcRaw,
            uliqAllocationRaw: uliqAllocationRaw,
            purchasedAt: purchasedAt,
            withdrawalDeadline: withdrawalDeadline,
            state: PurchaseState.PENDING_WITHDRAWAL
        });

        totalRaisedUsdcRaw += acceptedUsdcRaw;
        totalSoldUliqRaw += uliqAllocationRaw;
        pendingAllocationUliqRaw += uliqAllocationRaw;
        pendingPurchaseCount += 1;

        if (totalRaisedUsdcRaw == hardCapUsdcRaw || totalSoldUliqRaw == allocationCapUliqRaw) {
            _setState(SaleState.ENDED);
        }

        emit PurchaseCreated(purchaseId, msg.sender, acceptedUsdcRaw, uliqAllocationRaw, withdrawalDeadline);
        paymentCustody.collectFrom(msg.sender, acceptedUsdcRaw);
    }

    function withdrawPurchase(uint256 purchaseId) external nonReentrant {
        Purchase storage purchase = purchases[purchaseId];
        if (purchase.buyer == address(0) || purchase.state != PurchaseState.PENDING_WITHDRAWAL) {
            revert PurchaseNotPending();
        }
        if (msg.sender != purchase.buyer) revert NotBuyer();
        if (block.timestamp > purchase.withdrawalDeadline) revert WithdrawalWindowClosed();

        purchase.state = PurchaseState.WITHDRAWN;
        pendingPurchaseCount -= 1;
        pendingAllocationUliqRaw -= purchase.uliqAllocationRaw;
        totalRaisedUsdcRaw -= purchase.usdcAmountRaw;
        totalSoldUliqRaw -= purchase.uliqAllocationRaw;
        withdrawnAllocationUliqRaw += purchase.uliqAllocationRaw;

        paymentCustody.refundTo(purchase.buyer, purchase.usdcAmountRaw);
        emit PurchaseWithdrawn(
            purchaseId, purchase.buyer, purchase.usdcAmountRaw, purchase.uliqAllocationRaw
        );
    }

    function finalizePurchase(uint256 purchaseId) external nonReentrant {
        Purchase storage purchase = purchases[purchaseId];
        if (purchase.buyer == address(0) || purchase.state != PurchaseState.PENDING_WITHDRAWAL) {
            revert PurchaseNotPending();
        }
        if (block.timestamp <= purchase.withdrawalDeadline) revert WithdrawalWindowActive();
        if (state == SaleState.CANCELLED) revert SaleNotActive();

        uint256 walletAmount = Math.mulDiv(purchase.uliqAllocationRaw, IMMEDIATE_BPS, BPS_DENOMINATOR);
        uint256 vestingAmount = purchase.uliqAllocationRaw - walletAmount;

        purchase.state = PurchaseState.FINALIZED;
        pendingPurchaseCount -= 1;
        pendingAllocationUliqRaw -= purchase.uliqAllocationRaw;
        finalizedAllocationUliqRaw += purchase.uliqAllocationRaw;

        uliq.safeTransfer(purchase.buyer, walletAmount);
        uliq.safeTransfer(address(vesting), vestingAmount);
        vesting.allocate(purchase.buyer, vestingAmount);

        emit PurchaseFinalized(purchaseId, purchase.buyer, msg.sender, walletAmount, vestingAmount);
    }

    function setDexLaunchTimestamp(uint64 dexLaunchTimestamp_) external onlyOwner {
        _requireState(SaleState.DEX_PENDING);
        if (pendingPurchaseCount != 0) revert PendingPurchasesRemain(pendingPurchaseCount);
        if (dexLaunchTimestamp != 0) revert DexLaunchAlreadySet();
        if (dexLaunchTimestamp_ < block.timestamp) revert InvalidDexLaunchTimestamp();

        dexLaunchTimestamp = dexLaunchTimestamp_;
        _setState(SaleState.DEX_LAUNCHED);
        emit DexLaunchTimestampSet(dexLaunchTimestamp_);
        vesting.setVestingStart(dexLaunchTimestamp_);
    }

    function maximumPurchasableUsdcRaw() external view returns (uint256 acceptedUsdcRaw) {
        (acceptedUsdcRaw,) = quotePurchase(type(uint256).max);
    }

    function _requireState(SaleState expected) private view {
        if (state != expected) revert InvalidState(expected, state);
    }

    function _setState(SaleState nextState) private {
        SaleState previousState = state;
        state = nextState;
        emit SaleStateChanged(previousState, nextState);
    }
}

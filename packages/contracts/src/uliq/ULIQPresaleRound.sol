// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IULIQGlobalListing} from "./interfaces/IULIQGlobalListing.sol";
import {IULIQPaymentCustody} from "./interfaces/IULIQPaymentCustody.sol";
import {IULIQPresaleRoundLifecycle} from "./interfaces/IULIQPresaleRoundLifecycle.sol";
import {ULIQPresaleRoundVesting} from "./ULIQPresaleRoundVesting.sol";

/// @title ULIQ Presale Round
/// @notice Generic, non-upgradeable implementation deployed once per accepted ULIQ presale round.
/// @dev Review draft only. Production custody, legal access, cancellation, and unsold-token policy remain open.
contract ULIQPresaleRound is Ownable2Step, ReentrancyGuard, IULIQPresaleRoundLifecycle {
    using SafeERC20 for IERC20;

    uint256 public constant ONE_ULIQ = 1 ether;
    uint16 private constant BPS_DENOMINATOR = 10_000;

    enum SaleState {
        DRAFT,
        READY,
        ACTIVE,
        PAUSED,
        ENDED,
        LISTING_PENDING,
        LISTING_LAUNCHED,
        COMPLETED
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

    uint8 public immutable roundId;
    IERC20 public immutable uliq;
    IERC20 public immutable usdc;
    IULIQPaymentCustody public immutable paymentCustody;
    ULIQPresaleRoundVesting public immutable vesting;
    IULIQGlobalListing public immutable globalListing;
    address public immutable predecessor;
    uint256 public immutable hardCapUsdcRaw;
    uint256 public immutable allocationCapUliqRaw;
    uint256 public immutable priceUsdcRawPerUliq;
    uint256 public immutable minPurchaseUsdcRaw;
    uint256 public immutable maxPurchaseUsdcRaw;
    uint64 public immutable withdrawalPeriodSeconds;

    SaleState public state;
    uint64 public saleStart;
    uint64 public saleEnd;
    uint256 public nextPurchaseId = 1;
    uint256 public totalRaisedUsdcRaw;
    uint256 public totalSoldUliqRaw;
    uint256 public pendingAllocationUliqRaw;
    uint256 public pendingPurchaseCount;
    uint256 public finalizedAllocationUliqRaw;
    uint256 public withdrawnAllocationUliqRaw;

    mapping(address buyer => uint256 amount) public purchasedUsdcRawByBuyer;
    mapping(uint256 purchaseId => Purchase purchase) public purchases;

    error ZeroAddress();
    error InvalidConfiguration();
    error InvalidTokenDecimals();
    error InvalidState(SaleState expected, SaleState actual);
    error SaleWindowNotConfigured();
    error SaleWindowFrozen();
    error SaleNotActive();
    error SaleWindowClosed();
    error PredecessorNotEnded();
    error PurchaseBelowMinimum(uint256 requested, uint256 minimum);
    error WalletMaximumReached(uint256 maximum);
    error NothingAvailable();
    error AllocationBelowMinimum(uint256 actual, uint256 minimum);
    error InsufficientInventory(uint256 available, uint256 required);
    error PurchaseNotPending();
    error NotBuyer();
    error WithdrawalWindowClosed();
    error WithdrawalWindowActive();
    error PendingPurchasesRemain(uint256 count);
    error ListingAlreadyScheduled();
    error ListingNotScheduled();
    error ListingNotLaunched();

    event SaleWindowConfigured(uint64 indexed saleStart, uint64 indexed saleEnd);
    event SaleStateChanged(SaleState indexed previousState, SaleState indexed nextState);
    event PurchaseCreated(
        uint8 indexed roundId,
        uint256 indexed purchaseId,
        address indexed buyer,
        uint256 usdcAmountRaw,
        uint256 uliqAllocationRaw,
        uint64 withdrawalDeadline
    );
    event PurchaseWithdrawn(
        uint8 indexed roundId,
        uint256 indexed purchaseId,
        address indexed buyer,
        uint256 usdcRefundRaw,
        uint256 cancelledUliqAllocationRaw
    );
    event PurchaseFinalized(
        uint8 indexed roundId,
        uint256 indexed purchaseId,
        address indexed buyer,
        address caller,
        uint256 initialUnlockUliqRaw,
        uint256 linearVestingUliqRaw
    );

    constructor(
        uint8 roundId_,
        address uliq_,
        address usdc_,
        address paymentCustody_,
        address vesting_,
        address globalListing_,
        address predecessor_,
        address admin,
        uint256 hardCapUsdcRaw_,
        uint256 allocationCapUliqRaw_,
        uint256 priceUsdcRawPerUliq_,
        uint256 minPurchaseUsdcRaw_,
        uint256 maxPurchaseUsdcRaw_,
        uint64 withdrawalPeriodSeconds_
    ) Ownable(admin) {
        if (
            uliq_ == address(0) || usdc_ == address(0) || paymentCustody_ == address(0) || vesting_ == address(0)
                || globalListing_ == address(0) || admin == address(0)
        ) revert ZeroAddress();
        if (
            roundId_ == 0 || hardCapUsdcRaw_ == 0 || allocationCapUliqRaw_ == 0 || priceUsdcRawPerUliq_ == 0
                || minPurchaseUsdcRaw_ == 0 || minPurchaseUsdcRaw_ > hardCapUsdcRaw_
                || maxPurchaseUsdcRaw_ < minPurchaseUsdcRaw_ || predecessor_ == address(this)
                || withdrawalPeriodSeconds_ == 0
                || Math.mulDiv(allocationCapUliqRaw_, priceUsdcRawPerUliq_, ONE_ULIQ) != hardCapUsdcRaw_
        ) revert InvalidConfiguration();

        if (IERC20Metadata(usdc_).decimals() != 6 || IERC20Metadata(uliq_).decimals() != 18) {
            revert InvalidTokenDecimals();
        }
        if (IULIQPaymentCustody(paymentCustody_).paymentToken() != usdc_) revert InvalidConfiguration();
        if (
            address(ULIQPresaleRoundVesting(vesting_).token()) != uliq_
                || address(ULIQPresaleRoundVesting(vesting_).globalListing()) != globalListing_
        ) revert InvalidConfiguration();

        roundId = roundId_;
        uliq = IERC20(uliq_);
        usdc = IERC20(usdc_);
        paymentCustody = IULIQPaymentCustody(paymentCustody_);
        vesting = ULIQPresaleRoundVesting(vesting_);
        globalListing = IULIQGlobalListing(globalListing_);
        predecessor = predecessor_;
        hardCapUsdcRaw = hardCapUsdcRaw_;
        allocationCapUliqRaw = allocationCapUliqRaw_;
        priceUsdcRawPerUliq = priceUsdcRawPerUliq_;
        minPurchaseUsdcRaw = minPurchaseUsdcRaw_;
        maxPurchaseUsdcRaw = maxPurchaseUsdcRaw_;
        withdrawalPeriodSeconds = withdrawalPeriodSeconds_;
    }

    /// @notice Allows backend-prepared Safe calls to adjust dates until the round is marked ready.
    function configureSaleWindow(uint64 saleStart_, uint64 saleEnd_) external onlyOwner {
        if (state != SaleState.DRAFT) revert SaleWindowFrozen();
        if (saleStart_ >= saleEnd_ || saleEnd_ <= block.timestamp) revert SaleWindowClosed();
        saleStart = saleStart_;
        saleEnd = saleEnd_;
        emit SaleWindowConfigured(saleStart_, saleEnd_);
    }

    function markReady() external onlyOwner {
        _requireState(SaleState.DRAFT);
        if (saleEnd == 0) revert SaleWindowNotConfigured();
        if (vesting.presale() != address(this)) revert InvalidConfiguration();
        uint256 inventory = uliq.balanceOf(address(this));
        if (inventory < allocationCapUliqRaw) revert InsufficientInventory(inventory, allocationCapUliqRaw);
        _setState(SaleState.READY);
    }

    function activateSale() external onlyOwner {
        _requireState(SaleState.READY);
        if (block.timestamp < saleStart || block.timestamp >= saleEnd) revert SaleWindowClosed();
        address previousRound = predecessor;
        if (previousRound != address(0) && !IULIQPresaleRoundLifecycle(previousRound).isRoundEnded()) {
            revert PredecessorNotEnded();
        }
        if (globalListing.listingTimestamp() != 0) revert ListingAlreadyScheduled();
        _setState(SaleState.ACTIVE);
    }

    function pauseSale() external onlyOwner {
        _requireState(SaleState.ACTIVE);
        _setState(SaleState.PAUSED);
    }

    function unpauseSale() external onlyOwner {
        _requireState(SaleState.PAUSED);
        if (block.timestamp >= saleEnd || _remainingGlobalUsdcCapacity() < minPurchaseUsdcRaw) {
            revert SaleWindowClosed();
        }
        _setState(SaleState.ACTIVE);
    }

    /// @notice Ends at the configured time, or earlier only after economic exhaustion is final.
    function endSale() external {
        if (state != SaleState.ACTIVE && state != SaleState.PAUSED) {
            revert InvalidState(SaleState.ACTIVE, state);
        }
        if (block.timestamp < saleEnd) {
            if (_remainingGlobalUsdcCapacity() >= minPurchaseUsdcRaw || pendingPurchaseCount != 0) {
                revert SaleWindowClosed();
            }
        }
        _setState(SaleState.ENDED);
    }

    /// @notice Declares this round ready for the shared listing without moving unsold inventory.
    function markListingPending() external onlyOwner {
        _requireState(SaleState.ENDED);
        if (pendingPurchaseCount != 0) revert PendingPurchasesRemain(pendingPurchaseCount);
        _setState(SaleState.LISTING_PENDING);
    }

    /// @notice Materializes the time-based listing transition after the global timestamp is reached.
    function acknowledgeListingLaunch() external {
        _requireState(SaleState.LISTING_PENDING);
        uint64 launch = globalListing.listingTimestamp();
        if (launch == 0) revert ListingNotScheduled();
        if (block.timestamp < launch) revert ListingNotLaunched();
        _setState(SaleState.LISTING_LAUNCHED);
    }

    function completeSale() external onlyOwner {
        _requireState(SaleState.LISTING_LAUNCHED);
        _setState(SaleState.COMPLETED);
    }

    function quotePurchase(address buyer, uint256 requestedUsdcRaw)
        public
        view
        returns (uint256 acceptedUsdcRaw, uint256 uliqAllocationRaw)
    {
        if (buyer == address(0) || requestedUsdcRaw < minPurchaseUsdcRaw) return (0, 0);

        uint256 alreadyPurchased = purchasedUsdcRawByBuyer[buyer];
        if (alreadyPurchased >= maxPurchaseUsdcRaw) return (0, 0);

        acceptedUsdcRaw = Math.min(requestedUsdcRaw, maxPurchaseUsdcRaw - alreadyPurchased);
        acceptedUsdcRaw = Math.min(acceptedUsdcRaw, hardCapUsdcRaw - totalRaisedUsdcRaw);
        uliqAllocationRaw = Math.mulDiv(acceptedUsdcRaw, ONE_ULIQ, priceUsdcRawPerUliq);

        uint256 remainingAllocation = allocationCapUliqRaw - totalSoldUliqRaw;
        if (uliqAllocationRaw > remainingAllocation) {
            acceptedUsdcRaw = Math.mulDiv(remainingAllocation, priceUsdcRawPerUliq, ONE_ULIQ);
            uliqAllocationRaw = Math.mulDiv(acceptedUsdcRaw, ONE_ULIQ, priceUsdcRawPerUliq);
        }

        if (acceptedUsdcRaw < minPurchaseUsdcRaw || uliqAllocationRaw == 0) return (0, 0);
    }

    function buy(uint256 maxUsdcAmountRaw, uint256 minUliqAllocationRaw)
        external
        nonReentrant
        returns (uint256 purchaseId, uint256 acceptedUsdcRaw, uint256 uliqAllocationRaw)
    {
        if (state != SaleState.ACTIVE) revert SaleNotActive();
        if (block.timestamp < saleStart || block.timestamp >= saleEnd) revert SaleWindowClosed();
        if (maxUsdcAmountRaw < minPurchaseUsdcRaw) {
            revert PurchaseBelowMinimum(maxUsdcAmountRaw, minPurchaseUsdcRaw);
        }
        if (purchasedUsdcRawByBuyer[msg.sender] >= maxPurchaseUsdcRaw) {
            revert WalletMaximumReached(maxPurchaseUsdcRaw);
        }

        (acceptedUsdcRaw, uliqAllocationRaw) = quotePurchase(msg.sender, maxUsdcAmountRaw);
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
        purchasedUsdcRawByBuyer[msg.sender] += acceptedUsdcRaw;

        emit PurchaseCreated(roundId, purchaseId, msg.sender, acceptedUsdcRaw, uliqAllocationRaw, withdrawalDeadline);
        paymentCustody.collectFrom(purchaseId, msg.sender, acceptedUsdcRaw);
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
        purchasedUsdcRawByBuyer[purchase.buyer] -= purchase.usdcAmountRaw;
        withdrawnAllocationUliqRaw += purchase.uliqAllocationRaw;

        paymentCustody.refundTo(purchaseId, purchase.buyer, purchase.usdcAmountRaw);
        emit PurchaseWithdrawn(roundId, purchaseId, purchase.buyer, purchase.usdcAmountRaw, purchase.uliqAllocationRaw);
    }

    /// @notice Finalizes into the round vesting pool; no ULIQ reaches the wallet before listing.
    function finalizePurchase(uint256 purchaseId) external nonReentrant {
        Purchase storage purchase = purchases[purchaseId];
        if (purchase.buyer == address(0) || purchase.state != PurchaseState.PENDING_WITHDRAWAL) {
            revert PurchaseNotPending();
        }
        if (block.timestamp <= purchase.withdrawalDeadline) revert WithdrawalWindowActive();
        if (globalListing.listingTimestamp() != 0) revert ListingAlreadyScheduled();

        purchase.state = PurchaseState.FINALIZED;
        pendingPurchaseCount -= 1;
        pendingAllocationUliqRaw -= purchase.uliqAllocationRaw;
        finalizedAllocationUliqRaw += purchase.uliqAllocationRaw;

        uint256 initialAmount = Math.mulDiv(purchase.uliqAllocationRaw, vesting.initialUnlockBps(), BPS_DENOMINATOR);
        uint256 linearAmount = purchase.uliqAllocationRaw - initialAmount;

        uliq.safeTransfer(address(vesting), purchase.uliqAllocationRaw);
        vesting.allocate(purchase.buyer, purchase.uliqAllocationRaw);
        paymentCustody.releaseToTreasury(purchaseId, purchase.buyer, purchase.usdcAmountRaw);

        emit PurchaseFinalized(roundId, purchaseId, purchase.buyer, msg.sender, initialAmount, linearAmount);
    }

    function maximumPurchasableUsdcRaw(address buyer) external view returns (uint256 acceptedUsdcRaw) {
        (acceptedUsdcRaw,) = quotePurchase(buyer, type(uint256).max);
    }

    function isRoundEnded() external view returns (bool) {
        return state == SaleState.ENDED || state == SaleState.LISTING_PENDING || state == SaleState.LISTING_LAUNCHED
            || state == SaleState.COMPLETED;
    }

    function isListingReady() external view returns (bool) {
        return state == SaleState.LISTING_PENDING && pendingPurchaseCount == 0;
    }

    function unsoldInventoryUliqRaw() external view returns (uint256) {
        return allocationCapUliqRaw - totalSoldUliqRaw;
    }

    function _remainingGlobalUsdcCapacity() private view returns (uint256) {
        uint256 remainingUsdc = hardCapUsdcRaw - totalRaisedUsdcRaw;
        uint256 remainingAllocationUsdc =
            Math.mulDiv(allocationCapUliqRaw - totalSoldUliqRaw, priceUsdcRawPerUliq, ONE_ULIQ);
        return Math.min(remainingUsdc, remainingAllocationUsdc);
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

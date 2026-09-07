// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ULIQGlobalListing} from "../../../src/uliq/presale-v2/ULIQGlobalListing.sol";
import {ULIQPaymentCustody} from "../../../src/uliq/presale-v2/ULIQPaymentCustody.sol";
import {ULIQPresaleRound} from "../../../src/uliq/presale-v2/ULIQPresaleRound.sol";
import {ULIQPresaleRoundVesting} from "../../../src/uliq/presale-v2/ULIQPresaleRoundVesting.sol";
import {ULIQLocker} from "../../../src/uliq/legacy-testnet/ULIQLocker.sol";
import {ULIQToken} from "../../../src/uliq/shared/ULIQToken.sol";
import {ULIQPresaleMockUSDC} from "./fixtures/ULIQPresaleMockUSDC.sol";

interface VmUliqAudit {
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata data) external;
}

/// @dev Test-only stand-in for a payment issuer rejecting a recipient.
contract ULIQAuditPaymentToken is ULIQPresaleMockUSDC {
    address public blockedRecipient;

    error RecipientBlocked();

    function setBlockedRecipient(address recipient) external {
        blockedRecipient = recipient;
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (to != address(0) && to == blockedRecipient) revert RecipientBlocked();
        super._update(from, to, amount);
    }
}

/// @notice Audit regression and recovery evidence with real candidate custody.
contract ULIQAuditRegressionTest {
    VmUliqAudit private constant VM = VmUliqAudit(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant BUYER = address(0xB0B);
    address private constant OUTSIDER = address(0xCA11);
    address private constant TREASURY = address(0x7EAA5);
    uint64 private constant WITHDRAWAL = 14 days;

    ULIQToken private token;
    ULIQAuditPaymentToken private usdc;
    ULIQGlobalListing private listing;
    ULIQPresaleRound private first;
    ULIQPresaleRound private second;
    ULIQPresaleRoundVesting private firstVesting;
    ULIQPresaleRoundVesting private secondVesting;
    ULIQPaymentCustody private firstCustody;
    ULIQPaymentCustody private secondCustody;
    uint64 private firstEnd;
    uint64 private secondEnd;

    function setUp() public {
        token = new ULIQToken(address(this));
        usdc = new ULIQAuditPaymentToken();
        listing = new ULIQGlobalListing(address(this));
        firstVesting =
            new ULIQPresaleRoundVesting(address(token), address(listing), address(this), 500, 90 days, 548 days);
        secondVesting = new ULIQPresaleRoundVesting(address(token), address(listing), address(this), 2500, 0, 274 days);
        firstCustody = new ULIQPaymentCustody(address(usdc), address(this), TREASURY);
        secondCustody = new ULIQPaymentCustody(address(usdc), address(this), TREASURY);
        first = _round(1, firstVesting, firstCustody, address(0));
        second = _round(2, secondVesting, secondCustody, address(first));
        listing.configureRounds(address(first), address(second));
        firstEnd = uint64(block.timestamp + 30 days);
        secondEnd = firstEnd + 30 days;
        _prepare(first, firstVesting, firstCustody, uint64(block.timestamp), firstEnd);
        _prepare(second, secondVesting, secondCustody, firstEnd, secondEnd);
        first.activateSale();
        usdc.mint(BUYER, 20_000e6);
        VM.prank(BUYER);
        usdc.approve(address(firstCustody), type(uint256).max);
        VM.prank(BUYER);
        usdc.approve(address(secondCustody), type(uint256).max);
    }

    function testExpiredReadyRoundReturnsInventoryAndUnblocksEarlierVesting() public {
        uint256 id = _buy(first, 500e6);
        VM.warp(block.timestamp + WITHDRAWAL + 1);
        first.finalizePurchase(id);
        VM.warp(firstEnd);
        first.endSale();
        first.markListingPending();
        VM.warp(secondEnd);

        VM.expectRevert(ULIQPresaleRound.SaleWindowClosed.selector);
        second.activateSale();
        VM.expectRevert(ULIQPresaleRound.SaleWindowFrozen.selector);
        second.configureSaleWindow(1, secondEnd, secondEnd + 30 days);
        VM.expectRevert(ULIQPresaleRound.UnsoldReleaseUnavailable.selector);
        second.releaseUnsold();
        VM.expectRevert(abi.encodeWithSelector(ULIQGlobalListing.RoundNotReady.selector, address(second)));
        listing.scheduleListing(secondEnd + 1);

        VM.prank(OUTSIDER);
        second.endSale();
        require(second.isRoundEnded() && second.pendingPurchaseCount() == 0, "round_not_ended");
        uint256 sourceBefore = token.balanceOf(address(this));
        require(second.releaseUnsold() == 100_000_000 ether, "unsold_amount");
        require(token.balanceOf(address(this)) == sourceBefore + 100_000_000 ether, "source_balance");
        require(token.balanceOf(address(second)) == 0, "inventory_not_returned");
        VM.expectRevert(ULIQPresaleRound.UnsoldInventoryAlreadyReleased.selector);
        second.releaseUnsold();
        second.markListingPending();
        listing.scheduleListing(secondEnd + 1);
        VM.warp(uint256(secondEnd) + 1);
        VM.prank(BUYER);
        require(firstVesting.claim() == 12_500 ether, "listing_unlock");
        VM.warp(uint256(secondEnd) + 1 + 90 days + 548 days);
        VM.prank(BUYER);
        firstVesting.claim();
        require(token.balanceOf(BUYER) == 250_000 ether, "earlier_round_vesting_not_recovered");
        require(firstVesting.totalReleased() == firstVesting.totalAllocated(), "vesting_accounting");
        require(usdc.balanceOf(TREASURY) == 500e6 && secondCustody.totalCollected() == 0, "payment_accounting");
    }

    function testFuzzReadyRoundCannotEndBeforeDeadline(uint32 secondsBefore) public {
        VM.warp(uint256(secondEnd) - 1 - (uint256(secondsBefore) % (60 days)));
        VM.prank(OUTSIDER);
        VM.expectRevert(ULIQPresaleRound.SaleWindowClosed.selector);
        second.endSale();
        require(second.state() == ULIQPresaleRound.SaleState.READY, "ready_ended_early");
    }

    function testFuzzExpiredReadyRoundEndsOnceAndReturnsExactInventory(uint32 secondsAfter) public {
        VM.warp(uint256(secondEnd) + secondsAfter);
        VM.prank(OUTSIDER);
        second.endSale();
        VM.expectRevert(
            abi.encodeWithSelector(
                ULIQPresaleRound.InvalidState.selector,
                ULIQPresaleRound.SaleState.ACTIVE,
                ULIQPresaleRound.SaleState.ENDED
            )
        );
        second.endSale();
        require(second.totalSoldUliqRaw() == 0 && second.totalRaisedUsdcRaw() == 0, "unstarted_sales");
        require(second.releaseUnsold() == 100_000_000 ether, "full_inventory_return");
        require(second.unsoldInventoryUliqRaw() == 0 && token.balanceOf(address(second)) == 0, "inventory_accounting");
        VM.expectRevert(
            abi.encodeWithSelector(
                ULIQPresaleRound.InvalidState.selector,
                ULIQPresaleRound.SaleState.READY,
                ULIQPresaleRound.SaleState.ENDED
            )
        );
        second.activateSale();
    }

    function testExpiredReadyRecoveryStillWaitsForOtherRoundsPendingPurchase() public {
        uint256 id = _buy(first, 500e6);
        VM.warp(secondEnd);
        first.endSale();
        second.endSale();
        second.markListingPending();
        VM.expectRevert(abi.encodeWithSelector(ULIQPresaleRound.PendingPurchasesRemain.selector, 1));
        first.markListingPending();
        VM.expectRevert(abi.encodeWithSelector(ULIQPresaleRound.PendingPurchasesRemain.selector, 1));
        first.releaseUnsold();
        VM.expectRevert(abi.encodeWithSelector(ULIQGlobalListing.RoundNotReady.selector, address(first)));
        listing.scheduleListing(secondEnd + 1);
        first.finalizePurchase(id);
        first.markListingPending();
        listing.scheduleListing(secondEnd + 1);
        require(
            first.pendingPurchaseCount() == 0 && firstVesting.allocated(BUYER) == 250_000 ether, "pending_settlement"
        );
    }

    function testExpiredReadyPredecessorDoesNotBlockSuccessorActivation() public {
        listing = new ULIQGlobalListing(address(this));
        ULIQPresaleRoundVesting v1 =
            new ULIQPresaleRoundVesting(address(token), address(listing), address(this), 500, 90 days, 548 days);
        ULIQPresaleRoundVesting v2 =
            new ULIQPresaleRoundVesting(address(token), address(listing), address(this), 2500, 0, 274 days);
        ULIQPaymentCustody c1 = new ULIQPaymentCustody(address(usdc), address(this), TREASURY);
        ULIQPaymentCustody c2 = new ULIQPaymentCustody(address(usdc), address(this), TREASURY);
        ULIQPresaleRound r1 = _round(1, v1, c1, address(0));
        ULIQPresaleRound r2 = _round(2, v2, c2, address(r1));
        listing.configureRounds(address(r1), address(r2));
        _prepare(r1, v1, c1, uint64(block.timestamp), firstEnd);
        _prepare(r2, v2, c2, firstEnd, secondEnd);
        VM.warp(firstEnd);
        VM.expectRevert(ULIQPresaleRound.PredecessorNotEnded.selector);
        r2.activateSale();
        VM.prank(OUTSIDER);
        r1.endSale();
        require(r1.releaseUnsold() == 50_000_000 ether, "predecessor_inventory");
        r2.activateSale();
        require(r2.state() == ULIQPresaleRound.SaleState.ACTIVE, "successor_blocked");
        VM.prank(BUYER);
        usdc.approve(address(c2), 100e6);
        uint256 id = _buy(r2, 100e6);
        VM.warp(block.timestamp + WITHDRAWAL + 1);
        r2.finalizePurchase(id);
        VM.warp(secondEnd);
        r2.endSale();
        r1.markListingPending();
        r2.markListingPending();
        listing.scheduleListing(secondEnd + 1);
        VM.warp(uint256(secondEnd) + 1 + 274 days);
        VM.prank(BUYER);
        v2.claim();
        require(token.balanceOf(BUYER) == v2.allocated(BUYER), "successor_vesting");
    }

    function testExpiredDraftCannotBecomeReadyButCanBeRescheduled() public {
        ULIQPresaleRoundVesting vesting =
            new ULIQPresaleRoundVesting(address(token), address(listing), address(this), 500, 90 days, 548 days);
        ULIQPaymentCustody custody = new ULIQPaymentCustody(address(usdc), address(this), TREASURY);
        ULIQPresaleRound draft = _round(1, vesting, custody, address(0));
        vesting.setPresale(address(draft));
        custody.setPresale(address(draft));
        token.approve(address(draft), 50_000_000 ether);
        draft.fundInventory();
        draft.configureSaleWindow(0, uint64(block.timestamp), firstEnd);
        VM.warp(firstEnd);
        VM.expectRevert(ULIQPresaleRound.SaleWindowClosed.selector);
        draft.markReady();
        require(draft.state() == ULIQPresaleRound.SaleState.DRAFT, "draft_frozen");
        draft.configureSaleWindow(1, firstEnd, secondEnd);
        draft.markReady();
        draft.activateSale();
        require(draft.state() == ULIQPresaleRound.SaleState.ACTIVE, "draft_not_repaired");
    }

    function testActiveAndPausedRoundsCannotBeEndedEarlyWithCapacity() public {
        VM.expectRevert(ULIQPresaleRound.SaleWindowClosed.selector);
        first.endSale();
        first.pauseSale();
        VM.expectRevert(ULIQPresaleRound.SaleWindowClosed.selector);
        first.endSale();
    }

    function testWithdrawalDeadlineIsInclusiveAndFinalizationStartsNextSecond() public {
        uint256 refunded = _buy(first, 500e6);
        uint256 finalized = _buy(first, 500e6);
        (,,,, uint64 deadline,) = first.purchases(refunded);
        VM.warp(deadline);
        VM.expectRevert(ULIQPresaleRound.WithdrawalWindowActive.selector);
        first.finalizePurchase(finalized);
        VM.prank(BUYER);
        first.withdrawPurchase(refunded);
        VM.warp(uint256(deadline) + 1);
        VM.prank(BUYER);
        VM.expectRevert(ULIQPresaleRound.WithdrawalWindowClosed.selector);
        first.withdrawPurchase(finalized);
        VM.prank(OUTSIDER);
        first.finalizePurchase(finalized);
        require(first.pendingPurchaseCount() == 0 && firstVesting.allocated(BUYER) == 250_000 ether, "settlement_wrong");
        require(token.balanceOf(OUTSIDER) == 0 && usdc.balanceOf(OUTSIDER) == 0, "relayer_reward");
    }

    function testPauseDoesNotBlockRefundOrFinalization() public {
        uint256 refunded = _buy(first, 500e6);
        uint256 finalized = _buy(first, 500e6);
        first.pauseSale();
        VM.prank(BUYER);
        first.withdrawPurchase(refunded);
        VM.warp(block.timestamp + WITHDRAWAL + 1);
        first.finalizePurchase(finalized);
        require(first.pendingPurchaseCount() == 0, "pause_trapped_purchase");
    }

    function testRejectedTreasuryTransferRollsBackAllFinalizationAndCanRetry() public {
        uint256 id = _buy(first, 500e6);
        VM.warp(block.timestamp + WITHDRAWAL + 1);
        usdc.setBlockedRecipient(TREASURY);
        VM.expectRevert(ULIQAuditPaymentToken.RecipientBlocked.selector);
        first.finalizePurchase(id);
        (,,,,, ULIQPresaleRound.PurchaseState state) = first.purchases(id);
        require(state == ULIQPresaleRound.PurchaseState.PENDING_WITHDRAWAL, "partial_purchase_state");
        require(
            first.pendingPurchaseCount() == 1 && first.finalizedAllocationUliqRaw() == 0, "partial_round_accounting"
        );
        require(firstVesting.totalAllocated() == 0 && token.balanceOf(address(firstVesting)) == 0, "partial_vesting");
        require(firstCustody.accountedBalance() == 500e6 && firstCustody.totalReleased() == 0, "partial_custody");
        usdc.setBlockedRecipient(address(0));
        first.finalizePurchase(id);
        require(first.pendingPurchaseCount() == 0 && firstCustody.balance() == 0, "retry_failed");
    }

    function testBlockedBuyerRefundDoesNotPreventPostDeadlineFinalization() public {
        uint256 id = _buy(first, 500e6);
        usdc.setBlockedRecipient(BUYER);
        VM.prank(BUYER);
        VM.expectRevert(ULIQAuditPaymentToken.RecipientBlocked.selector);
        first.withdrawPurchase(id);
        require(first.pendingPurchaseCount() == 1 && firstCustody.balance() == 500e6, "refund_not_atomic");
        VM.warp(block.timestamp + WITHDRAWAL + 1);
        first.finalizePurchase(id);
        require(first.pendingPurchaseCount() == 0 && usdc.balanceOf(TREASURY) == 500e6, "buyer_blocks_settlement");
    }

    function testRoundTwoRoundingFullVestingAndRepeatedClaim() public {
        VM.warp(firstEnd);
        first.endSale();
        first.markListingPending();
        second.activateSale();
        uint256 a = _buy(second, 100e6 + 1);
        uint256 b = _buy(second, 100e6 + 2);
        VM.warp(block.timestamp + WITHDRAWAL + 1);
        second.finalizePurchase(a);
        second.finalizePurchase(b);
        VM.warp(secondEnd);
        second.endSale();
        second.markListingPending();
        uint64 launch = uint64(block.timestamp + 1);
        listing.scheduleListing(launch);
        VM.prank(BUYER);
        VM.expectRevert(ULIQPresaleRoundVesting.NothingToClaim.selector);
        secondVesting.claim();
        VM.warp(launch);
        VM.prank(BUYER);
        secondVesting.claim();
        VM.warp(uint256(launch) + 137 days);
        VM.prank(BUYER);
        secondVesting.claim();
        VM.warp(uint256(launch) + 274 days);
        VM.prank(BUYER);
        secondVesting.claim();
        require(token.balanceOf(BUYER) == secondVesting.allocated(BUYER), "rounding_stranded_claim");
        require(secondVesting.totalReleased() == secondVesting.totalAllocated(), "release_accounting");
        require(token.balanceOf(address(secondVesting)) == 0, "vesting_dust");
        VM.prank(BUYER);
        VM.expectRevert(ULIQPresaleRoundVesting.NothingToClaim.selector);
        secondVesting.claim();
    }

    function testLockerOwnerExpiryAndDuplicateWithdrawal() public {
        ULIQLocker locker = new ULIQLocker(address(token));
        token.approve(address(locker), 7 ether);
        uint256 id = locker.lock(7 ether, locker.ONE_MONTH());
        (,,, uint64 expiry,) = locker.locks(id);
        VM.warp(uint256(expiry) - 1);
        VM.expectRevert(ULIQLocker.LockStillActive.selector);
        locker.unlock(id);
        VM.warp(expiry);
        VM.prank(OUTSIDER);
        VM.expectRevert(ULIQLocker.NotLockOwner.selector);
        locker.unlock(id);
        require(locker.unlock(id) == 7 ether, "unlock_amount");
        require(locker.totalLocked() == 0 && locker.lockedBalanceOf(address(this)) == 0, "lock_accounting");
        VM.expectRevert(ULIQLocker.AlreadyWithdrawn.selector);
        locker.unlock(id);
    }

    function _round(uint8 id, ULIQPresaleRoundVesting vesting, ULIQPaymentCustody custody, address predecessor)
        private
        returns (ULIQPresaleRound)
    {
        bool r1 = id == 1;
        return new ULIQPresaleRound(
            id,
            address(token),
            address(usdc),
            address(custody),
            address(vesting),
            address(listing),
            predecessor,
            address(this),
            address(this),
            r1 ? 100_000e6 : 350_000e6,
            r1 ? 50_000_000 ether : 100_000_000 ether,
            r1 ? 2000 : 3500,
            r1 ? 500e6 : 100e6,
            r1 ? 10_000e6 : 5000e6,
            WITHDRAWAL
        );
    }

    function _prepare(
        ULIQPresaleRound round,
        ULIQPresaleRoundVesting vesting,
        ULIQPaymentCustody custody,
        uint64 start,
        uint64 end
    ) private {
        vesting.setPresale(address(round));
        custody.setPresale(address(round));
        token.approve(address(round), round.allocationCapUliqRaw());
        round.fundInventory();
        round.configureSaleWindow(0, start, end);
        round.markReady();
    }

    function _buy(ULIQPresaleRound round, uint256 amount) private returns (uint256 id) {
        VM.prank(BUYER);
        (id,,) = round.buy(amount, 0);
    }
}

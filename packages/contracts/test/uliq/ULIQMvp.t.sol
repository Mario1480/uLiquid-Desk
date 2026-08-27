// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ULIQToken} from "../../src/uliq/ULIQToken.sol";
import {ULIQPresale} from "../../src/uliq/ULIQPresale.sol";
import {ULIQPresaleVesting} from "../../src/uliq/ULIQPresaleVesting.sol";
import {ULIQLocker} from "../../src/uliq/ULIQLocker.sol";
import {ULIQTestnetEscrow} from "../../src/uliq/testnet/ULIQTestnetEscrow.sol";
import {ULIQMockUSDC} from "../../src/uliq/testnet/ULIQMockUSDC.sol";
import {DeployULIQTestnet} from "../../script/uliq/DeployULIQTestnet.s.sol";

interface VmUliq {
    function addr(uint256 privateKey) external returns (address);
    function prank(address msgSender) external;
    function startPrank(address msgSender) external;
    function stopPrank() external;
    function warp(uint256 timestamp) external;
    function expectRevert() external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert(bytes4 revertData) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
}

contract ULIQMvpTest {
    VmUliq internal constant VM = VmUliq(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant BUYER_KEY = 0xA11CE;
    address internal constant RELAYER = address(0xB0B);
    address internal constant TREASURY = address(0x7EAA5);
    address internal constant NEXT_TREASURY = address(0x7EAA6);
    uint256 internal constant HARD_CAP_USDC_RAW = 120_000 * 1e6;
    uint256 internal constant PRESALE_ALLOCATION_RAW = 120_000_000 ether;
    uint256 internal constant RATE = 1e15;
    uint64 internal constant WITHDRAWAL_PERIOD = 5 minutes;
    uint64 internal constant VESTING_DURATION = 270 days;

    event LockExtended(uint256 indexed lockId, address indexed owner, uint64 previousUnlockAt, uint64 newUnlockAt);

    address internal buyer;
    ULIQToken internal token;
    ULIQMockUSDC internal usdc;
    ULIQTestnetEscrow internal custody;
    ULIQPresaleVesting internal vesting;
    ULIQPresale internal presale;
    ULIQLocker internal locker;
    uint64 internal saleEnd;

    function setUp() public {
        buyer = VM.addr(BUYER_KEY);
        token = new ULIQToken(address(this));
        usdc = new ULIQMockUSDC();
        vesting = new ULIQPresaleVesting(address(token), address(this), VESTING_DURATION);
        custody = new ULIQTestnetEscrow(address(usdc), address(this), TREASURY);
        saleEnd = uint64(block.timestamp + 30 days);
        presale = new ULIQPresale(
            address(token),
            address(usdc),
            address(custody),
            address(vesting),
            address(this),
            HARD_CAP_USDC_RAW,
            PRESALE_ALLOCATION_RAW,
            RATE,
            1,
            uint64(block.timestamp),
            saleEnd,
            WITHDRAWAL_PERIOD
        );
        locker = new ULIQLocker(address(token));

        custody.setPresale(address(presale));
        vesting.setPresale(address(presale));
        require(token.transfer(address(presale), PRESALE_ALLOCATION_RAW), "presale_inventory_transfer_failed");
        presale.markReady();
        presale.activateSale();

        usdc.mint(buyer, HARD_CAP_USDC_RAW * 2);
        VM.prank(buyer);
        usdc.approve(address(custody), type(uint256).max);
    }

    function testTokenHasFixedSupplyBurnAndPermit() public {
        require(token.totalSupply() == 1_000_000_000 ether, "fixed_supply_wrong");
        require(token.decimals() == 18, "decimals_wrong");

        uint256 value = 10 ether;
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = token.nonces(buyer);
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                buyer,
                RELAYER,
                value,
                nonce,
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(BUYER_KEY, digest);
        token.permit(buyer, RELAYER, value, deadline, v, r, s);
        require(token.allowance(buyer, RELAYER) == value, "permit_allowance_wrong");

        uint256 beforeSupply = token.totalSupply();
        token.burn(1 ether);
        require(token.totalSupply() == beforeSupply - 1 ether, "burn_supply_wrong");
    }

    function testTestnetDeploymentRejectsWithdrawalPeriodBelowOneHour() public {
        DeployULIQTestnet deployment = new DeployULIQTestnet();
        VM.expectRevert(
            abi.encodeWithSelector(DeployULIQTestnet.WithdrawalPeriodTooShort.selector, uint64(3_599), uint64(1 hours))
        );
        deployment.run(
            address(this), TREASURY, address(usdc), uint64(block.timestamp), uint64(block.timestamp + 30 days), 3_599
        );
    }

    function testBuyCreatesPendingOnly() public {
        uint256 purchaseId = _buy(1_000 * 1e6);
        (
            address storedBuyer,
            uint256 paid,
            uint256 allocation,,
            uint64 deadline,
            ULIQPresale.PurchaseState purchaseState
        ) = presale.purchases(purchaseId);

        require(storedBuyer == buyer, "buyer_wrong");
        require(paid == 1_000 * 1e6, "paid_wrong");
        require(allocation == 1_000_000 ether, "allocation_wrong");
        require(purchaseState == ULIQPresale.PurchaseState.PENDING_WITHDRAWAL, "state_wrong");
        require(deadline == block.timestamp + WITHDRAWAL_PERIOD, "deadline_wrong");
        require(token.balanceOf(buyer) == 0, "pending_wallet_not_zero");
        require(vesting.unreleased(buyer) == 0, "pending_vesting_not_zero");
        require(presale.pendingPurchaseCount() == 1, "pending_count_wrong");
        (address paymentBuyer, uint256 paymentAmount, ULIQTestnetEscrow.PaymentState paymentState) =
            custody.payments(purchaseId);
        require(paymentBuyer == buyer, "custody_buyer_wrong");
        require(paymentAmount == paid, "custody_amount_wrong");
        require(paymentState == ULIQTestnetEscrow.PaymentState.COLLECTED, "custody_state_wrong");
    }

    function testWithdrawRefundsAndPreventsFinalize() public {
        uint256 beforeBalance = usdc.balanceOf(buyer);
        uint256 purchaseId = _buy(1_000 * 1e6);

        VM.prank(buyer);
        presale.withdrawPurchase(purchaseId);

        require(usdc.balanceOf(buyer) == beforeBalance, "refund_wrong");
        require(token.balanceOf(buyer) == 0, "withdraw_wallet_not_zero");
        require(vesting.unreleased(buyer) == 0, "withdraw_vesting_not_zero");
        require(presale.pendingPurchaseCount() == 0, "pending_not_decremented");
        (,, ULIQTestnetEscrow.PaymentState paymentState) = custody.payments(purchaseId);
        require(paymentState == ULIQTestnetEscrow.PaymentState.REFUNDED, "refund_not_settled");
        require(custody.totalRefunded() == 1_000 * 1e6, "refunded_total_wrong");
        require(custody.totalReleased() == 0, "unexpected_release");

        VM.warp(block.timestamp + WITHDRAWAL_PERIOD + 1);
        VM.expectRevert(ULIQPresale.PurchaseNotPending.selector);
        presale.finalizePurchase(purchaseId);
    }

    function testPermissionlessFinalizeIsAtomicTwentyFiveSeventyFive() public {
        uint256 purchaseId = _buy(1_000 * 1e6);
        uint256 treasuryBefore = usdc.balanceOf(TREASURY);
        VM.warp(block.timestamp + WITHDRAWAL_PERIOD + 1);

        VM.prank(RELAYER);
        presale.finalizePurchase(purchaseId);

        require(token.balanceOf(buyer) == 250_000 ether, "wallet_split_wrong");
        require(vesting.allocated(buyer) == 750_000 ether, "vesting_split_wrong");
        require(vesting.unreleased(buyer) == 750_000 ether, "unreleased_wrong");
        require(presale.finalizedAllocationUliqRaw() == 1_000_000 ether, "finalized_total_wrong");
        require(presale.pendingPurchaseCount() == 0, "pending_count_wrong");
        require(token.balanceOf(RELAYER) == 0, "relayer_received_tokens");
        require(usdc.balanceOf(TREASURY) == treasuryBefore + 1_000 * 1e6, "treasury_release_wrong");
        (,, ULIQTestnetEscrow.PaymentState paymentState) = custody.payments(purchaseId);
        require(paymentState == ULIQTestnetEscrow.PaymentState.RELEASED, "release_not_settled");
        require(custody.totalReleased() == 1_000 * 1e6, "released_total_wrong");
        require(custody.balance() == 0, "settled_balance_wrong");

        VM.expectRevert(ULIQPresale.PurchaseNotPending.selector);
        presale.finalizePurchase(purchaseId);
        VM.prank(buyer);
        VM.expectRevert(ULIQPresale.PurchaseNotPending.selector);
        presale.withdrawPurchase(purchaseId);
    }

    function testTreasuryRotationRequiresOwnerProposalAndRecipientAcceptance() public {
        VM.prank(buyer);
        VM.expectRevert();
        custody.proposeTreasury(NEXT_TREASURY);

        custody.proposeTreasury(NEXT_TREASURY);
        require(custody.treasury() == TREASURY, "treasury_changed_before_acceptance");
        require(custody.pendingTreasury() == NEXT_TREASURY, "pending_treasury_wrong");
        VM.expectRevert(ULIQTestnetEscrow.TreasuryTransferPending.selector);
        custody.proposeTreasury(address(0x7EAA7));

        VM.prank(buyer);
        VM.expectRevert(ULIQTestnetEscrow.UnauthorizedTreasuryAcceptance.selector);
        custody.acceptTreasury();

        VM.prank(NEXT_TREASURY);
        custody.acceptTreasury();
        require(custody.treasury() == NEXT_TREASURY, "treasury_not_rotated");
        require(custody.pendingTreasury() == address(0), "pending_treasury_not_cleared");

        uint256 purchaseId = _buy(10 * 1e6);
        VM.warp(block.timestamp + WITHDRAWAL_PERIOD + 1);
        presale.finalizePurchase(purchaseId);
        require(usdc.balanceOf(NEXT_TREASURY) == 10 * 1e6, "new_treasury_not_used");
    }

    function testTreasuryRotationCanBeCancelledAndOwnershipCannotBeRenounced() public {
        custody.proposeTreasury(NEXT_TREASURY);
        custody.cancelTreasuryTransfer();
        require(custody.treasury() == TREASURY, "active_treasury_changed");
        require(custody.pendingTreasury() == address(0), "cancel_did_not_clear_pending");

        VM.expectRevert(ULIQTestnetEscrow.OwnershipRenunciationDisabled.selector);
        custody.renounceOwnership();
    }

    function testCustodyRejectsUnauthorizedOrDuplicateSettlement() public {
        VM.prank(buyer);
        VM.expectRevert(ULIQTestnetEscrow.UnauthorizedPresale.selector);
        custody.collectFrom(99, buyer, 1e6);

        uint256 purchaseId = _buy(10 * 1e6);
        VM.warp(block.timestamp + WITHDRAWAL_PERIOD + 1);
        presale.finalizePurchase(purchaseId);

        VM.prank(address(presale));
        VM.expectRevert(abi.encodeWithSelector(ULIQTestnetEscrow.PaymentNotCollected.selector, purchaseId));
        custody.releaseToTreasury(purchaseId, buyer, 10 * 1e6);
    }

    function testPauseBlocksBuyButAllowsWithdrawal() public {
        uint256 purchaseId = _buy(100 * 1e6);
        presale.pauseSale();

        VM.prank(buyer);
        VM.expectRevert(ULIQPresale.SaleNotActive.selector);
        presale.buy(1e6, 0);

        VM.prank(buyer);
        presale.withdrawPurchase(purchaseId);
        require(presale.pendingPurchaseCount() == 0, "paused_withdraw_blocked");
    }

    function testHardCapUsesPartialFillWithoutDust() public {
        _buy(119_999 * 1e6);
        uint256 buyerBefore = usdc.balanceOf(buyer);
        uint256 purchaseId = _buy(10 * 1e6);
        (, uint256 accepted, uint256 allocation,,,) = presale.purchases(purchaseId);

        require(accepted == 1e6, "partial_fill_wrong");
        require(allocation == 1_000 ether, "partial_allocation_wrong");
        require(buyerBefore - usdc.balanceOf(buyer) == 1e6, "overfill_dust_collected");
        require(presale.totalRaisedUsdcRaw() == HARD_CAP_USDC_RAW, "hard_cap_wrong");
        require(presale.totalSoldUliqRaw() == PRESALE_ALLOCATION_RAW, "allocation_cap_wrong");
        require(presale.state() == ULIQPresale.SaleState.ENDED, "sale_not_ended");
    }

    function testEndedSaleReleasesUnsoldOnlyToCurrentTreasury() public {
        custody.proposeTreasury(NEXT_TREASURY);
        VM.prank(NEXT_TREASURY);
        custody.acceptTreasury();

        uint256 purchaseId = _buy(1_000 * 1e6);
        VM.warp(block.timestamp + WITHDRAWAL_PERIOD + 1);
        presale.finalizePurchase(purchaseId);
        require(usdc.balanceOf(NEXT_TREASURY) == 1_000 * 1e6, "usdc_treasury_wrong");

        require(token.transfer(address(presale), 1 ether), "extra_inventory_transfer_failed");
        VM.warp(saleEnd);
        presale.endSale();

        uint256 treasuryBefore = token.balanceOf(NEXT_TREASURY);
        uint256 expectedUnsold = PRESALE_ALLOCATION_RAW - 1_000_000 ether;
        presale.markDexPending();

        require(presale.state() == ULIQPresale.SaleState.DEX_PENDING, "dex_pending_not_set");
        require(token.balanceOf(NEXT_TREASURY) == treasuryBefore + expectedUnsold, "unsold_treasury_wrong");
        require(token.balanceOf(address(presale)) == 1 ether, "non_presale_inventory_swept");
        require(token.totalSupply() == 1_000_000_000 ether, "release_changed_supply");
    }

    function testCancelEmptySaleReleasesEntireAllocationToCurrentTreasury() public {
        custody.proposeTreasury(NEXT_TREASURY);
        VM.prank(NEXT_TREASURY);
        custody.acceptTreasury();

        presale.cancelEmptySale();

        require(presale.state() == ULIQPresale.SaleState.CANCELLED, "cancelled_not_set");
        require(token.balanceOf(NEXT_TREASURY) == PRESALE_ALLOCATION_RAW, "cancel_inventory_not_released");
        require(token.balanceOf(address(presale)) == 0, "cancel_inventory_remaining");
    }

    function testReadySaleCanBeCancelledBeforeActivationWithoutStrandingInventory() public {
        ULIQToken readyToken = new ULIQToken(address(this));
        ULIQPresaleVesting readyVesting = new ULIQPresaleVesting(address(readyToken), address(this), VESTING_DURATION);
        ULIQTestnetEscrow readyCustody = new ULIQTestnetEscrow(address(usdc), address(this), TREASURY);
        ULIQPresale readyPresale = new ULIQPresale(
            address(readyToken),
            address(usdc),
            address(readyCustody),
            address(readyVesting),
            address(this),
            HARD_CAP_USDC_RAW,
            PRESALE_ALLOCATION_RAW,
            RATE,
            1,
            uint64(block.timestamp + 7 days),
            uint64(block.timestamp + 37 days),
            WITHDRAWAL_PERIOD
        );
        readyCustody.setPresale(address(readyPresale));
        readyVesting.setPresale(address(readyPresale));
        require(readyToken.transfer(address(readyPresale), PRESALE_ALLOCATION_RAW), "ready_inventory_transfer_failed");
        readyPresale.markReady();

        VM.prank(buyer);
        VM.expectRevert();
        readyPresale.cancelEmptySale();
        require(readyToken.balanceOf(address(readyPresale)) == PRESALE_ALLOCATION_RAW, "unauthorized_ready_cancel");

        readyPresale.cancelEmptySale();
        require(readyPresale.state() == ULIQPresale.SaleState.CANCELLED, "ready_cancel_state_wrong");
        require(readyToken.balanceOf(TREASURY) == PRESALE_ALLOCATION_RAW, "ready_cancel_treasury_wrong");
        require(readyToken.balanceOf(address(readyPresale)) == 0, "ready_cancel_inventory_remaining");
    }

    function testOnlyOwnerCanAdvanceEndedSaleAndReleaseUnsold() public {
        VM.warp(saleEnd);
        presale.endSale();

        VM.prank(buyer);
        VM.expectRevert();
        presale.markDexPending();

        require(token.balanceOf(TREASURY) == 0, "unauthorized_release_succeeded");
        require(token.balanceOf(address(presale)) == PRESALE_ALLOCATION_RAW, "unauthorized_inventory_changed");
    }

    function testFullySoldSaleAdvancesWithZeroUnsoldRelease() public {
        uint256 purchaseId = _buy(HARD_CAP_USDC_RAW);
        VM.warp(block.timestamp + WITHDRAWAL_PERIOD + 1);
        presale.finalizePurchase(purchaseId);

        uint256 treasuryBefore = token.balanceOf(TREASURY);
        presale.markDexPending();

        require(presale.state() == ULIQPresale.SaleState.DEX_PENDING, "sold_out_dex_pending_not_set");
        require(token.balanceOf(TREASURY) == treasuryBefore, "sold_out_released_extra");
        require(token.balanceOf(address(presale)) == 0, "sold_out_inventory_remaining");
    }

    function testFuzzQuoteAndSplitRounding(uint96 rawRequested) public {
        uint256 requested = 1 + (uint256(rawRequested) % HARD_CAP_USDC_RAW);
        (uint256 accepted, uint256 allocation) = presale.quotePurchase(requested);
        require(accepted == requested, "accepted_wrong");
        require(allocation == requested * RATE, "floor_allocation_wrong");

        uint256 walletAmount = allocation * 2_500 / 10_000;
        uint256 vestingAmount = allocation - walletAmount;
        require(walletAmount + vestingAmount == allocation, "split_rounding_loss");
    }

    function testFuzzFinalizationNeverLosesAllocation(uint64 rawRequested) public {
        uint256 requested = 1 + (uint256(rawRequested) % HARD_CAP_USDC_RAW);
        uint256 purchaseId = _buy(requested);
        VM.warp(block.timestamp + WITHDRAWAL_PERIOD + 1);
        presale.finalizePurchase(purchaseId);

        uint256 allocation = requested * RATE;
        require(token.balanceOf(buyer) + vesting.allocated(buyer) == allocation, "finalization_rounding_loss");
        require(vesting.released(buyer) <= vesting.allocated(buyer), "released_above_allocation");
    }

    function testDexLaunchRequiresNoPendingAndStartsGlobalVesting() public {
        uint256 purchaseId = _buy(1_000 * 1e6);
        VM.warp(saleEnd);
        presale.endSale();

        VM.expectRevert(abi.encodeWithSelector(ULIQPresale.PendingPurchasesRemain.selector, 1));
        presale.markDexPending();

        presale.finalizePurchase(purchaseId);
        presale.markDexPending();
        uint64 launchAt = uint64(block.timestamp + 1);
        presale.setDexLaunchTimestamp(launchAt);
        require(vesting.vestingStart() == launchAt, "vesting_start_wrong");

        VM.warp(launchAt + VESTING_DURATION / 2);
        uint256 claimable = vesting.claimable(buyer);
        require(claimable == 375_000 ether, "half_vesting_wrong");
        VM.prank(buyer);
        vesting.claim();
        require(token.balanceOf(buyer) == 625_000 ether, "claim_wallet_wrong");
        require(vesting.unreleased(buyer) == 375_000 ether, "claim_unreleased_wrong");
    }

    function testLockerSupportsOnlyFixedDurationsAndNoEarlyUnlock() public {
        uint256 purchaseId = _buy(1_000 * 1e6);
        VM.warp(block.timestamp + WITHDRAWAL_PERIOD + 1);
        presale.finalizePurchase(purchaseId);

        VM.startPrank(buyer);
        token.approve(address(locker), type(uint256).max);
        VM.expectRevert(ULIQLocker.UnsupportedDuration.selector);
        locker.lock(1 ether, 60 days);
        VM.expectRevert(ULIQLocker.UnsupportedDuration.selector);
        locker.lock(1 ether, 31 days);
        VM.expectRevert(ULIQLocker.UnsupportedDuration.selector);
        locker.lock(1 ether, 184 days);
        VM.expectRevert(ULIQLocker.UnsupportedDuration.selector);
        locker.lock(1 ether, 366 days);
        uint256 lockId = locker.lock(150_000 ether, 32 days);
        VM.expectRevert(ULIQLocker.LockStillActive.selector);
        locker.unlock(lockId);
        VM.stopPrank();

        require(token.balanceOf(buyer) == 100_000 ether, "lock_wallet_wrong");
        require(locker.lockedBalanceOf(buyer) == 150_000 ether, "locked_wrong");

        VM.warp(block.timestamp + 32 days);
        VM.prank(buyer);
        locker.unlock(lockId);
        require(token.balanceOf(buyer) == 250_000 ether, "unlock_wallet_wrong");
        require(locker.lockedBalanceOf(buyer) == 0, "unlock_locked_wrong");
    }

    function testLockerSupportsAllInitialTermsAndExtensionPreservesBalances() public {
        uint256 purchaseId = _buy(1_000 * 1e6);
        VM.warp(block.timestamp + WITHDRAWAL_PERIOD + 1);
        presale.finalizePurchase(purchaseId);

        VM.startPrank(buyer);
        token.approve(address(locker), type(uint256).max);
        uint256 oneMonthLock = locker.lock(10_000 ether, 32 days);
        locker.lock(20_000 ether, 185 days);
        locker.lock(30_000 ether, 367 days);
        (address owner, uint256 amount, uint64 startedAt, uint64 previousUnlockAt, bool withdrawn) =
            locker.locks(oneMonthLock);
        uint64 newUnlockAt = previousUnlockAt + 90 days;
        uint256 ownerBalanceBefore = locker.lockedBalanceOf(buyer);
        uint256 totalBefore = locker.totalLocked();

        VM.expectEmit(true, true, false, true);
        emit LockExtended(oneMonthLock, buyer, previousUnlockAt, newUnlockAt);
        locker.extendLock(oneMonthLock, newUnlockAt);

        (
            address extendedOwner,
            uint256 extendedAmount,
            uint64 extendedStartedAt,
            uint64 extendedUnlockAt,
            bool extendedWithdrawn
        ) = locker.locks(oneMonthLock);
        require(owner == extendedOwner && owner == buyer, "extension_owner_changed");
        require(amount == extendedAmount && amount == 10_000 ether, "extension_amount_changed");
        require(startedAt == extendedStartedAt, "extension_start_changed");
        require(!withdrawn && !extendedWithdrawn, "extension_withdrawn_changed");
        require(extendedUnlockAt == newUnlockAt, "extension_expiry_wrong");
        require(locker.lockedBalanceOf(buyer) == ownerBalanceBefore, "extension_owner_balance_changed");
        require(locker.totalLocked() == totalBefore, "extension_total_changed");

        uint64 repeatedUnlockAt = newUnlockAt + 30 days;
        locker.extendLock(oneMonthLock, repeatedUnlockAt);
        (,,, uint64 finalUnlockAt,) = locker.locks(oneMonthLock);
        require(finalUnlockAt == repeatedUnlockAt, "repeated_extension_failed");
        VM.stopPrank();
    }

    function testLockerExtensionRejectsShorteningWrongOwnerAndWithdrawnPosition() public {
        uint256 purchaseId = _buy(1_000 * 1e6);
        VM.warp(block.timestamp + WITHDRAWAL_PERIOD + 1);
        presale.finalizePurchase(purchaseId);

        VM.startPrank(buyer);
        token.approve(address(locker), type(uint256).max);
        uint256 lockId = locker.lock(10_000 ether, 32 days);
        (,,, uint64 unlockAt,) = locker.locks(lockId);
        VM.expectRevert(ULIQLocker.LockExpiryNotIncreasing.selector);
        locker.extendLock(lockId, unlockAt);
        VM.expectRevert(ULIQLocker.LockExpiryNotIncreasing.selector);
        locker.extendLock(lockId, unlockAt - 1);
        VM.stopPrank();

        VM.prank(RELAYER);
        VM.expectRevert(ULIQLocker.NotLockOwner.selector);
        locker.extendLock(lockId, unlockAt + 1 days);

        VM.warp(unlockAt);
        VM.prank(buyer);
        locker.unlock(lockId);
        VM.prank(buyer);
        VM.expectRevert(ULIQLocker.AlreadyWithdrawn.selector);
        locker.extendLock(lockId, unlockAt + 1 days);
    }

    function _buy(uint256 usdcAmountRaw) private returns (uint256 purchaseId) {
        VM.prank(buyer);
        (purchaseId,,) = presale.buy(usdcAmountRaw, 0);
    }
}

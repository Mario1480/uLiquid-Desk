// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ULIQGlobalListing} from "../../../src/uliq/presale-v2/ULIQGlobalListing.sol";
import {ULIQPresaleRound} from "../../../src/uliq/presale-v2/ULIQPresaleRound.sol";
import {ULIQPresaleRoundVesting} from "../../../src/uliq/presale-v2/ULIQPresaleRoundVesting.sol";
import {ULIQToken} from "../../../src/uliq/shared/ULIQToken.sol";
import {ULIQPresaleMockUSDC} from "./fixtures/ULIQPresaleMockUSDC.sol";
import {ULIQPresaleMockCustody} from "./fixtures/ULIQPresaleMockCustody.sol";

interface VmUliqRounds {
    function addr(uint256 privateKey) external returns (address);
    function prank(address msgSender) external;
    function startPrank(address msgSender) external;
    function stopPrank() external;
    function warp(uint256 timestamp) external;
    function expectRevert() external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert(bytes4 revertData) external;
}

contract ULIQPresaleRoundsTest {
    VmUliqRounds internal constant VM = VmUliqRounds(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant BUYER_KEY = 0xA11CE;
    address internal constant SECOND_BUYER = address(0xB0B);
    address internal constant RELAYER = address(0xCA11E2);
    address internal constant TREASURY = address(0x7EAA5);

    uint256 internal constant ROUND_ONE_HARD_CAP = 100_000 * 1e6;
    uint256 internal constant ROUND_ONE_ALLOCATION = 50_000_000 ether;
    uint256 internal constant ROUND_ONE_PRICE_E6 = 2_000;
    uint256 internal constant ROUND_ONE_MINIMUM = 500 * 1e6;
    uint256 internal constant ROUND_ONE_MAXIMUM = 10_000 * 1e6;
    uint16 internal constant ROUND_ONE_INITIAL_BPS = 500;
    uint64 internal constant ROUND_ONE_CLIFF = 90 days;
    uint64 internal constant ROUND_ONE_VESTING = 548 days;

    uint256 internal constant ROUND_TWO_HARD_CAP = 350_000 * 1e6;
    uint256 internal constant ROUND_TWO_ALLOCATION = 100_000_000 ether;
    uint256 internal constant ROUND_TWO_PRICE_E6 = 3_500;
    uint256 internal constant ROUND_TWO_MINIMUM = 100 * 1e6;
    uint256 internal constant ROUND_TWO_MAXIMUM = 5_000 * 1e6;
    uint16 internal constant ROUND_TWO_INITIAL_BPS = 2_500;
    uint64 internal constant ROUND_TWO_VESTING = 274 days;

    uint64 internal constant WITHDRAWAL_PERIOD = 1 hours;

    address internal buyer;
    ULIQToken internal token;
    ULIQPresaleMockUSDC internal usdc;
    ULIQGlobalListing internal listing;
    ULIQPresaleRoundVesting internal roundOneVesting;
    ULIQPresaleRoundVesting internal roundTwoVesting;
    ULIQPresaleMockCustody internal roundOneCustody;
    ULIQPresaleMockCustody internal roundTwoCustody;
    ULIQPresaleRound internal roundOne;
    ULIQPresaleRound internal roundTwo;
    uint64 internal roundOneEnd;
    uint64 internal roundTwoEnd;

    function setUp() public {
        buyer = VM.addr(BUYER_KEY);
        token = new ULIQToken(address(this));
        usdc = new ULIQPresaleMockUSDC();
        listing = new ULIQGlobalListing(address(this));

        roundOneVesting = new ULIQPresaleRoundVesting(
            address(token), address(listing), address(this), ROUND_ONE_INITIAL_BPS, ROUND_ONE_CLIFF, ROUND_ONE_VESTING
        );
        roundTwoVesting = new ULIQPresaleRoundVesting(
            address(token), address(listing), address(this), ROUND_TWO_INITIAL_BPS, 0, ROUND_TWO_VESTING
        );
        roundOneCustody = new ULIQPresaleMockCustody(address(usdc), TREASURY);
        roundTwoCustody = new ULIQPresaleMockCustody(address(usdc), TREASURY);

        roundOne = new ULIQPresaleRound(
            1,
            address(token),
            address(usdc),
            address(roundOneCustody),
            address(roundOneVesting),
            address(listing),
            address(0),
            address(this),
            address(this),
            ROUND_ONE_HARD_CAP,
            ROUND_ONE_ALLOCATION,
            ROUND_ONE_PRICE_E6,
            ROUND_ONE_MINIMUM,
            ROUND_ONE_MAXIMUM,
            WITHDRAWAL_PERIOD
        );
        roundTwo = new ULIQPresaleRound(
            2,
            address(token),
            address(usdc),
            address(roundTwoCustody),
            address(roundTwoVesting),
            address(listing),
            address(roundOne),
            address(this),
            address(this),
            ROUND_TWO_HARD_CAP,
            ROUND_TWO_ALLOCATION,
            ROUND_TWO_PRICE_E6,
            ROUND_TWO_MINIMUM,
            ROUND_TWO_MAXIMUM,
            WITHDRAWAL_PERIOD
        );

        listing.configureRounds(address(roundOne), address(roundTwo));
        roundOneVesting.setPresale(address(roundOne));
        roundTwoVesting.setPresale(address(roundTwo));
        roundOneCustody.setPresale(address(roundOne));
        roundTwoCustody.setPresale(address(roundTwo));

        token.approve(address(roundOne), ROUND_ONE_ALLOCATION);
        roundOne.fundInventory();
        token.approve(address(roundTwo), ROUND_TWO_ALLOCATION);
        roundTwo.fundInventory();

        roundOneEnd = uint64(block.timestamp + 30 days);
        roundTwoEnd = uint64(uint256(roundOneEnd) + 30 days);
        roundOne.configureSaleWindow(0, uint64(block.timestamp), roundOneEnd);
        roundTwo.configureSaleWindow(0, roundOneEnd, roundTwoEnd);
        roundOne.markReady();
        roundTwo.markReady();
        roundOne.activateSale();

        usdc.mint(buyer, 1_000_000 * 1e6);
        usdc.mint(SECOND_BUYER, 1_000_000 * 1e6);
        VM.startPrank(buyer);
        usdc.approve(address(roundOneCustody), type(uint256).max);
        usdc.approve(address(roundTwoCustody), type(uint256).max);
        VM.stopPrank();
        VM.startPrank(SECOND_BUYER);
        usdc.approve(address(roundOneCustody), type(uint256).max);
        usdc.approve(address(roundTwoCustody), type(uint256).max);
        VM.stopPrank();
    }

    function testAcceptedRoundParametersAndSupplyAreExact() public view {
        require(token.totalSupply() == 1_000_000_000 ether, "fixed_supply_wrong");
        require(roundOne.allocationCapUliqRaw() == ROUND_ONE_ALLOCATION, "round_one_allocation_wrong");
        require(roundOne.inventorySource() == address(this), "round_one_inventory_source_wrong");
        require(roundOne.inventoryFunded(), "round_one_inventory_not_funded");
        require(roundOne.hardCapUsdcRaw() == ROUND_ONE_HARD_CAP, "round_one_hard_cap_wrong");
        require(roundOne.priceUsdcRawPerUliq() == ROUND_ONE_PRICE_E6, "round_one_price_wrong");
        require(roundOne.minPurchaseUsdcRaw() == ROUND_ONE_MINIMUM, "round_one_minimum_wrong");
        require(roundOne.maxPurchaseUsdcRaw() == ROUND_ONE_MAXIMUM, "round_one_maximum_wrong");
        require(roundOneVesting.initialUnlockBps() == ROUND_ONE_INITIAL_BPS, "round_one_unlock_wrong");
        require(roundOneVesting.cliffSeconds() == ROUND_ONE_CLIFF, "round_one_cliff_wrong");
        require(roundOneVesting.linearVestingDurationSeconds() == ROUND_ONE_VESTING, "round_one_vesting_wrong");

        require(roundTwo.allocationCapUliqRaw() == ROUND_TWO_ALLOCATION, "round_two_allocation_wrong");
        require(roundTwo.inventorySource() == address(this), "round_two_inventory_source_wrong");
        require(roundTwo.inventoryFunded(), "round_two_inventory_not_funded");
        require(roundTwo.hardCapUsdcRaw() == ROUND_TWO_HARD_CAP, "round_two_hard_cap_wrong");
        require(roundTwo.priceUsdcRawPerUliq() == ROUND_TWO_PRICE_E6, "round_two_price_wrong");
        require(roundTwo.minPurchaseUsdcRaw() == ROUND_TWO_MINIMUM, "round_two_minimum_wrong");
        require(roundTwo.maxPurchaseUsdcRaw() == ROUND_TWO_MAXIMUM, "round_two_maximum_wrong");
        require(roundTwoVesting.initialUnlockBps() == ROUND_TWO_INITIAL_BPS, "round_two_unlock_wrong");
        require(roundTwoVesting.cliffSeconds() == 0, "round_two_cliff_wrong");
        require(roundTwoVesting.linearVestingDurationSeconds() == ROUND_TWO_VESTING, "round_two_vesting_wrong");
        require(ROUND_ONE_ALLOCATION + ROUND_TWO_ALLOCATION == 150_000_000 ether, "presale_total_wrong");
    }

    function testSaleWindowCanChangeOnlyInDraft() public {
        VM.expectRevert(ULIQPresaleRound.SaleWindowFrozen.selector);
        roundOne.configureSaleWindow(1, uint64(block.timestamp), uint64(block.timestamp + 60 days));
    }

    function testSaleWindowVersionRejectsStaleSafeProposal() public {
        ULIQPresaleRoundVesting vesting = new ULIQPresaleRoundVesting(
            address(token), address(listing), address(this), ROUND_ONE_INITIAL_BPS, ROUND_ONE_CLIFF, ROUND_ONE_VESTING
        );
        ULIQPresaleMockCustody custody = new ULIQPresaleMockCustody(address(usdc), TREASURY);
        ULIQPresaleRound draft = new ULIQPresaleRound(
            3,
            address(token),
            address(usdc),
            address(custody),
            address(vesting),
            address(listing),
            address(0),
            address(this),
            address(this),
            ROUND_ONE_HARD_CAP,
            ROUND_ONE_ALLOCATION,
            ROUND_ONE_PRICE_E6,
            ROUND_ONE_MINIMUM,
            ROUND_ONE_MAXIMUM,
            WITHDRAWAL_PERIOD
        );
        uint64 firstEnd = uint64(block.timestamp + 10 days);
        draft.configureSaleWindow(0, uint64(block.timestamp), firstEnd);
        require(draft.saleWindowVersion() == 1, "schedule_version_wrong");

        VM.expectRevert(abi.encodeWithSelector(ULIQPresaleRound.SaleWindowVersionMismatch.selector, 0, 1));
        draft.configureSaleWindow(0, uint64(block.timestamp + 1 days), uint64(uint256(firstEnd) + 1 days));

        draft.configureSaleWindow(1, uint64(block.timestamp + 1 days), uint64(uint256(firstEnd) + 1 days));
        require(draft.saleWindowVersion() == 2, "schedule_version_not_incremented");
    }

    function testInventoryCanOnlyBePulledOnceFromImmutableSource() public {
        ULIQPresaleRoundVesting vesting = new ULIQPresaleRoundVesting(
            address(token), address(listing), address(this), ROUND_ONE_INITIAL_BPS, ROUND_ONE_CLIFF, ROUND_ONE_VESTING
        );
        ULIQPresaleMockCustody custody = new ULIQPresaleMockCustody(address(usdc), TREASURY);
        ULIQPresaleRound draft = new ULIQPresaleRound(
            3,
            address(token),
            address(usdc),
            address(custody),
            address(vesting),
            address(listing),
            address(0),
            address(this),
            address(this),
            ROUND_ONE_HARD_CAP,
            ROUND_ONE_ALLOCATION,
            ROUND_ONE_PRICE_E6,
            ROUND_ONE_MINIMUM,
            ROUND_ONE_MAXIMUM,
            WITHDRAWAL_PERIOD
        );

        VM.prank(buyer);
        VM.expectRevert(abi.encodeWithSelector(ULIQPresaleRound.UnauthorizedInventorySource.selector, buyer));
        draft.fundInventory();

        token.approve(address(draft), ROUND_ONE_ALLOCATION);
        draft.fundInventory();
        VM.expectRevert(ULIQPresaleRound.InventoryAlreadyFunded.selector);
        draft.fundInventory();

        require(draft.inventorySource() == address(this), "inventory_source_changed");
        require(token.balanceOf(address(draft)) == ROUND_ONE_ALLOCATION, "inventory_amount_wrong");
    }

    function testMarkReadyRejectsDirectTransferWithoutSourceFunding() public {
        ULIQPresaleRoundVesting vesting = new ULIQPresaleRoundVesting(
            address(token), address(listing), address(this), ROUND_ONE_INITIAL_BPS, ROUND_ONE_CLIFF, ROUND_ONE_VESTING
        );
        ULIQPresaleMockCustody custody = new ULIQPresaleMockCustody(address(usdc), TREASURY);
        ULIQPresaleRound draft = new ULIQPresaleRound(
            3,
            address(token),
            address(usdc),
            address(custody),
            address(vesting),
            address(listing),
            address(0),
            address(this),
            address(this),
            ROUND_ONE_HARD_CAP,
            ROUND_ONE_ALLOCATION,
            ROUND_ONE_PRICE_E6,
            ROUND_ONE_MINIMUM,
            ROUND_ONE_MAXIMUM,
            WITHDRAWAL_PERIOD
        );
        vesting.setPresale(address(draft));
        require(token.transfer(address(draft), ROUND_ONE_ALLOCATION), "direct_inventory_transfer_failed");
        draft.configureSaleWindow(0, uint64(block.timestamp), uint64(block.timestamp + 10 days));

        VM.expectRevert(ULIQPresaleRound.InventoryNotFunded.selector);
        draft.markReady();
    }

    function testRoundTwoRequiresRoundOneToEnd() public {
        VM.warp(roundOneEnd);
        VM.expectRevert(ULIQPresaleRound.PredecessorNotEnded.selector);
        roundTwo.activateSale();
    }

    function testUnauthorizedControlPlaneCallsRevert() public {
        VM.prank(buyer);
        VM.expectRevert();
        roundOne.pauseSale();

        VM.prank(buyer);
        VM.expectRevert();
        listing.scheduleListing(uint64(block.timestamp + 1 days));

        VM.prank(buyer);
        VM.expectRevert();
        roundTwo.configureSaleWindow(1, roundOneEnd, uint64(uint256(roundTwoEnd) + 1 days));
    }

    function testRoundOneMinimumAndCumulativeMaximumAreEnforced() public {
        VM.prank(buyer);
        VM.expectRevert(
            abi.encodeWithSelector(ULIQPresaleRound.PurchaseBelowMinimum.selector, 499 * 1e6, ROUND_ONE_MINIMUM)
        );
        roundOne.buy(499 * 1e6, 0);

        uint256 firstPurchase = _buy(roundOne, buyer, 6_000 * 1e6);
        uint256 secondPurchase = _buy(roundOne, buyer, 6_000 * 1e6);
        (, uint256 acceptedSecond,,,,) = roundOne.purchases(secondPurchase);
        require(acceptedSecond == 4_000 * 1e6, "round_one_partial_max_wrong");
        require(roundOne.purchasedUsdcRawByBuyer(buyer) == ROUND_ONE_MAXIMUM, "round_one_cumulative_wrong");

        VM.prank(buyer);
        VM.expectRevert(abi.encodeWithSelector(ULIQPresaleRound.WalletMaximumReached.selector, ROUND_ONE_MAXIMUM));
        roundOne.buy(ROUND_ONE_MINIMUM, 0);

        VM.prank(buyer);
        roundOne.withdrawPurchase(firstPurchase);
        require(roundOne.purchasedUsdcRawByBuyer(buyer) == 4_000 * 1e6, "withdrawal_did_not_restore_limit");
        _buy(roundOne, buyer, 6_000 * 1e6);
        require(roundOne.purchasedUsdcRawByBuyer(buyer) == ROUND_ONE_MAXIMUM, "restored_capacity_wrong");
    }

    function testQuotesUseExactAcceptedPrices() public view {
        (uint256 roundOneUsdc, uint256 roundOneUliq) = roundOne.quotePurchase(buyer, 1_000 * 1e6);
        require(roundOneUsdc == 1_000 * 1e6, "round_one_quote_usdc_wrong");
        require(roundOneUliq == 500_000 ether, "round_one_quote_uliq_wrong");

        (uint256 roundTwoUsdc, uint256 roundTwoUliq) = roundTwo.quotePurchase(buyer, 3_500 * 1e6);
        require(roundTwoUsdc == 3_500 * 1e6, "round_two_quote_usdc_wrong");
        require(roundTwoUliq == 1_000_000 ether, "round_two_quote_uliq_wrong");
    }

    function testFinalizationAllocatesAllTokensButUnlocksNothingBeforeListing() public {
        uint256 purchaseId = _buy(roundOne, buyer, 1_000 * 1e6);
        VM.warp(block.timestamp + WITHDRAWAL_PERIOD + 1);
        VM.prank(RELAYER);
        roundOne.finalizePurchase(purchaseId);

        require(token.balanceOf(buyer) == 0, "wallet_unlocked_before_listing");
        require(roundOneVesting.allocated(buyer) == 500_000 ether, "vesting_allocation_wrong");
        require(roundOneVesting.vested(buyer) == 0, "vesting_started_before_listing");
        require(roundOneVesting.claimable(buyer) == 0, "claimable_before_listing");
        require(roundOne.pendingPurchaseCount() == 0, "pending_not_cleared");
        require(roundOne.finalizedAllocationUliqRaw() == 500_000 ether, "finalized_total_wrong");
        require(usdc.balanceOf(TREASURY) == 1_000 * 1e6, "treasury_release_wrong");
    }

    function testWithdrawalAndFinalizationAreMutuallyExclusive() public {
        uint256 withdrawnPurchase = _buy(roundOne, buyer, 500 * 1e6);
        VM.prank(buyer);
        roundOne.withdrawPurchase(withdrawnPurchase);
        VM.warp(block.timestamp + WITHDRAWAL_PERIOD + 1);
        VM.expectRevert(ULIQPresaleRound.PurchaseNotPending.selector);
        roundOne.finalizePurchase(withdrawnPurchase);

        uint256 finalizedPurchase = _buy(roundOne, buyer, 500 * 1e6);
        VM.warp(block.timestamp + WITHDRAWAL_PERIOD + 1);
        roundOne.finalizePurchase(finalizedPurchase);
        VM.prank(buyer);
        VM.expectRevert(ULIQPresaleRound.PurchaseNotPending.selector);
        roundOne.withdrawPurchase(finalizedPurchase);
    }

    function testGlobalListingRequiresBothRoundsAndCanOnlyBeScheduledOnce() public {
        _finishRoundOne(1_000 * 1e6);
        uint64 proposedLaunch = uint64(block.timestamp + 1 days);
        VM.expectRevert(abi.encodeWithSelector(ULIQGlobalListing.RoundNotReady.selector, address(roundTwo)));
        listing.scheduleListing(proposedLaunch);

        _finishRoundTwo(3_500 * 1e6);
        proposedLaunch = uint64(uint256(roundTwoEnd) + 1 days);
        listing.scheduleListing(proposedLaunch);
        require(listing.listingTimestamp() == proposedLaunch, "global_listing_wrong");

        VM.expectRevert(ULIQGlobalListing.ListingAlreadyScheduled.selector);
        listing.scheduleListing(uint64(uint256(proposedLaunch) + 1 days));
    }

    function testBothRoundsUnlockAtOneListingWithSeparateSchedules() public {
        uint256 roundOneAllocation = _finishRoundOne(1_000 * 1e6);
        uint256 roundTwoAllocation = _finishRoundTwo(3_500 * 1e6);
        uint64 launch = uint64(block.timestamp + 1 days);
        listing.scheduleListing(launch);

        VM.warp(launch);
        uint256 roundOneInitial = roundOneAllocation * ROUND_ONE_INITIAL_BPS / 10_000;
        uint256 roundTwoInitial = roundTwoAllocation * ROUND_TWO_INITIAL_BPS / 10_000;
        require(roundOneVesting.vested(buyer) == roundOneInitial, "round_one_initial_unlock_wrong");
        require(roundTwoVesting.vested(buyer) == roundTwoInitial, "round_two_initial_unlock_wrong");

        VM.prank(buyer);
        roundOneVesting.claim();
        VM.prank(buyer);
        roundTwoVesting.claim();
        require(token.balanceOf(buyer) == roundOneInitial + roundTwoInitial, "listing_claim_wrong");

        VM.warp(uint256(launch) + ROUND_ONE_CLIFF);
        require(roundOneVesting.vested(buyer) == roundOneInitial, "round_one_cliff_leaked");

        VM.warp(uint256(launch) + ROUND_TWO_VESTING);
        require(roundTwoVesting.vested(buyer) == roundTwoAllocation, "round_two_full_vesting_wrong");

        VM.warp(uint256(launch) + ROUND_ONE_CLIFF + ROUND_ONE_VESTING / 2);
        uint256 roundOneRemaining = roundOneAllocation - roundOneInitial;
        require(
            roundOneVesting.vested(buyer) == roundOneInitial + roundOneRemaining / 2, "round_one_half_vesting_wrong"
        );
    }

    function testUnsoldInventoryReturnsExactlyOnceToImmutableSource() public {
        uint256 roundOneAllocation = _finishRoundOne(1_000 * 1e6);
        uint256 roundTwoAllocation = _finishRoundTwo(3_500 * 1e6);
        uint64 launch = uint64(block.timestamp + 1 days);
        listing.scheduleListing(launch);

        uint256 sourceBalanceBefore = token.balanceOf(address(this));
        uint256 roundOneUnsold = ROUND_ONE_ALLOCATION - roundOneAllocation;
        uint256 roundTwoUnsold = ROUND_TWO_ALLOCATION - roundTwoAllocation;
        VM.prank(buyer);
        VM.expectRevert();
        roundOne.releaseUnsold();
        roundOne.releaseUnsold();
        roundTwo.releaseUnsold();

        require(token.balanceOf(address(roundOne)) == 0, "round_one_unsold_not_released");
        require(token.balanceOf(address(roundTwo)) == 0, "round_two_unsold_not_released");
        require(
            token.balanceOf(address(this)) == sourceBalanceBefore + roundOneUnsold + roundTwoUnsold,
            "source_refund_wrong"
        );
        require(roundOne.unsoldReleasedUliqRaw() == roundOneUnsold, "round_one_released_accounting_wrong");
        require(roundTwo.unsoldReleasedUliqRaw() == roundTwoUnsold, "round_two_released_accounting_wrong");
        require(roundOne.unsoldInventoryUliqRaw() == 0, "round_one_unsold_not_cleared");
        require(roundTwo.unsoldInventoryUliqRaw() == 0, "round_two_unsold_not_cleared");

        VM.expectRevert(ULIQPresaleRound.UnsoldInventoryAlreadyReleased.selector);
        roundOne.releaseUnsold();
    }

    function testUnsoldReleaseWaitsForEndAndPendingFinalization() public {
        VM.expectRevert(ULIQPresaleRound.UnsoldReleaseUnavailable.selector);
        roundOne.releaseUnsold();

        _buy(roundOne, buyer, ROUND_ONE_MINIMUM);
        VM.warp(roundOneEnd);
        roundOne.endSale();
        VM.expectRevert(abi.encodeWithSelector(ULIQPresaleRound.PendingPurchasesRemain.selector, 1));
        roundOne.releaseUnsold();
    }

    function testWithdrawnAllocationIsIncludedInUnsoldReturn() public {
        uint256 purchaseId = _buy(roundOne, buyer, ROUND_ONE_MINIMUM);
        VM.prank(buyer);
        roundOne.withdrawPurchase(purchaseId);
        VM.warp(roundOneEnd);
        roundOne.endSale();

        uint256 sourceBalanceBefore = token.balanceOf(address(this));
        roundOne.releaseUnsold();

        require(token.balanceOf(address(this)) == sourceBalanceBefore + ROUND_ONE_ALLOCATION, "withdrawn_return_wrong");
        require(roundOne.unsoldReleasedUliqRaw() == ROUND_ONE_ALLOCATION, "withdrawn_release_accounting_wrong");
        require(
            roundOne.withdrawnAllocationUliqRaw() == ROUND_ONE_MINIMUM * 1 ether / ROUND_ONE_PRICE_E6,
            "withdrawn_allocation_wrong"
        );
    }

    function testFuzzRoundOneQuoteNeverExceedsWalletMaximum(uint96 rawRequested) public view {
        uint256 requested = ROUND_ONE_MINIMUM + (uint256(rawRequested) % (50_000 * 1e6));
        (uint256 accepted, uint256 allocation) = roundOne.quotePurchase(buyer, requested);
        require(accepted <= ROUND_ONE_MAXIMUM, "quote_above_wallet_maximum");
        require(allocation == accepted * 1 ether / ROUND_ONE_PRICE_E6, "quote_price_drift");
    }

    function _finishRoundOne(uint256 usdcAmountRaw) private returns (uint256 allocation) {
        uint256 purchaseId = _buy(roundOne, buyer, usdcAmountRaw);
        (,, allocation,,,) = roundOne.purchases(purchaseId);
        VM.warp(block.timestamp + WITHDRAWAL_PERIOD + 1);
        roundOne.finalizePurchase(purchaseId);
        VM.warp(roundOneEnd);
        roundOne.endSale();
        roundOne.markListingPending();
    }

    function _finishRoundTwo(uint256 usdcAmountRaw) private returns (uint256 allocation) {
        roundTwo.activateSale();
        uint256 purchaseId = _buy(roundTwo, buyer, usdcAmountRaw);
        (,, allocation,,,) = roundTwo.purchases(purchaseId);
        VM.warp(block.timestamp + WITHDRAWAL_PERIOD + 1);
        roundTwo.finalizePurchase(purchaseId);
        VM.warp(roundTwoEnd);
        roundTwo.endSale();
        roundTwo.markListingPending();
    }

    function _buy(ULIQPresaleRound target, address account, uint256 usdcAmountRaw)
        private
        returns (uint256 purchaseId)
    {
        VM.prank(account);
        (purchaseId,,) = target.buy(usdcAmountRaw, 0);
    }
}

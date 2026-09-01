// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ULIQGlobalListing} from "../../../src/uliq/presale-v2/ULIQGlobalListing.sol";
import {ULIQPaymentCustody} from "../../../src/uliq/presale-v2/ULIQPaymentCustody.sol";
import {ULIQPresaleRound} from "../../../src/uliq/presale-v2/ULIQPresaleRound.sol";
import {ULIQPresaleRoundVesting} from "../../../src/uliq/presale-v2/ULIQPresaleRoundVesting.sol";
import {ULIQToken} from "../../../src/uliq/shared/ULIQToken.sol";
import {ULIQPresaleMockUSDC} from "./fixtures/ULIQPresaleMockUSDC.sol";

interface VmUliqCustody {
    function addr(uint256 privateKey) external returns (address);
    function prank(address msgSender) external;
    function startPrank(address msgSender) external;
    function stopPrank() external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert(bytes4 revertData) external;
}

contract ULIQPaymentCustodyTest {
    VmUliqCustody internal constant VM = VmUliqCustody(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant TREASURY = address(0x7EAA5);
    address internal constant NEXT_TREASURY = address(0xBEEF);
    uint256 internal constant HARD_CAP = 100_000 * 1e6;
    uint256 internal constant ALLOCATION = 50_000_000 ether;
    uint256 internal constant MINIMUM = 500 * 1e6;
    uint256 internal constant MAXIMUM = 10_000 * 1e6;
    uint64 internal constant WITHDRAWAL_PERIOD = 14 days;

    address internal buyer;
    ULIQToken internal token;
    ULIQPresaleMockUSDC internal usdc;
    ULIQPaymentCustody internal custody;
    ULIQPresaleRound internal presale;

    function setUp() public {
        buyer = VM.addr(0xA11CE);
        token = new ULIQToken(address(this));
        usdc = new ULIQPresaleMockUSDC();
        ULIQGlobalListing listing = new ULIQGlobalListing(address(this));
        ULIQPresaleRoundVesting vesting =
            new ULIQPresaleRoundVesting(address(token), address(listing), address(this), 500, 90 days, 548 days);
        custody = new ULIQPaymentCustody(address(usdc), address(this), TREASURY);
        presale = new ULIQPresaleRound(
            1,
            address(token),
            address(usdc),
            address(custody),
            address(vesting),
            address(listing),
            address(0),
            address(this),
            HARD_CAP,
            ALLOCATION,
            2_000,
            MINIMUM,
            MAXIMUM,
            WITHDRAWAL_PERIOD
        );

        vesting.setPresale(address(presale));
        custody.setPresale(address(presale));
        require(token.transfer(address(presale), ALLOCATION), "inventory_transfer_failed");
        presale.configureSaleWindow(0, uint64(block.timestamp), uint64(block.timestamp + 365 days));
        presale.markReady();
        presale.activateSale();

        usdc.mint(buyer, MAXIMUM);
        VM.prank(buyer);
        usdc.approve(address(custody), type(uint256).max);
    }

    function testPurchaseFundsRemainBoundUntilBuyerWithdraws() public {
        uint256 purchaseId = _buy(MINIMUM);
        (address paymentBuyer, uint256 paymentAmount, ULIQPaymentCustody.PaymentState paymentState) =
            custody.payments(purchaseId);
        require(paymentBuyer == buyer, "payment_buyer_wrong");
        require(paymentAmount == MINIMUM, "payment_amount_wrong");
        require(paymentState == ULIQPaymentCustody.PaymentState.COLLECTED, "payment_state_wrong");
        require(custody.balance() == MINIMUM, "custody_balance_wrong");
        require(usdc.balanceOf(TREASURY) == 0, "treasury_released_early");

        VM.prank(buyer);
        presale.withdrawPurchase(purchaseId);
        (,, paymentState) = custody.payments(purchaseId);
        require(paymentState == ULIQPaymentCustody.PaymentState.REFUNDED, "refund_state_wrong");
        require(custody.balance() == 0, "refund_balance_wrong");
        require(custody.totalCollected() == custody.totalRefunded(), "refund_accounting_wrong");
    }

    function testFinalizationReleasesExactlyOnceToActiveTreasury() public {
        uint256 purchaseId = _buy(MINIMUM);
        VM.warp(block.timestamp + WITHDRAWAL_PERIOD + 1);
        presale.finalizePurchase(purchaseId);
        (,, ULIQPaymentCustody.PaymentState paymentState) = custody.payments(purchaseId);
        require(paymentState == ULIQPaymentCustody.PaymentState.RELEASED, "release_state_wrong");
        require(usdc.balanceOf(TREASURY) == MINIMUM, "treasury_amount_wrong");
        require(custody.totalCollected() == custody.totalReleased(), "release_accounting_wrong");

        VM.expectRevert(ULIQPresaleRound.PurchaseNotPending.selector);
        presale.finalizePurchase(purchaseId);
    }

    function testOnlyBoundPresaleCanSettlePayments() public {
        VM.expectRevert(ULIQPaymentCustody.UnauthorizedPresale.selector);
        custody.collectFrom(99, buyer, MINIMUM);

        VM.expectRevert(ULIQPaymentCustody.PresaleAlreadySet.selector);
        custody.setPresale(address(presale));
    }

    function testTreasuryRotationRequiresProposedTreasuryAcceptance() public {
        custody.proposeTreasury(NEXT_TREASURY);
        VM.prank(buyer);
        VM.expectRevert(ULIQPaymentCustody.UnauthorizedTreasuryAcceptance.selector);
        custody.acceptTreasury();

        VM.prank(NEXT_TREASURY);
        custody.acceptTreasury();
        require(custody.treasury() == NEXT_TREASURY, "treasury_not_rotated");
        require(custody.pendingTreasury() == address(0), "pending_treasury_not_cleared");
    }

    function testPaymentTokenCannotBeRecoveredButForeignTokenCan() public {
        VM.expectRevert(ULIQPaymentCustody.PaymentTokenRecoveryForbidden.selector);
        custody.recoverForeignToken(address(usdc), 1);

        uint256 amount = 10 ether;
        require(token.transfer(address(custody), amount), "foreign_token_transfer_failed");
        custody.recoverForeignToken(address(token), amount);
        require(token.balanceOf(TREASURY) == amount, "foreign_token_not_recovered");
    }

    function testDirectUsdcDonationIsReportedAsSurplusAndCannotAffectSettlement() public {
        uint256 purchaseId = _buy(MINIMUM);
        uint256 donation = 1e6;
        usdc.mint(address(custody), donation);
        require(custody.accountedBalance() == MINIMUM, "accounted_balance_wrong");
        require(custody.surplusBalance() == donation, "surplus_balance_wrong");

        VM.warp(block.timestamp + WITHDRAWAL_PERIOD + 1);
        presale.finalizePurchase(purchaseId);
        require(usdc.balanceOf(TREASURY) == MINIMUM, "treasury_received_surplus");
        require(custody.balance() == donation, "surplus_not_isolated");
    }

    function testOwnershipCannotBeRenounced() public {
        VM.expectRevert(ULIQPaymentCustody.OwnershipRenunciationDisabled.selector);
        custody.renounceOwnership();
    }

    function invariant_CustodyAccountingRemainsExact() public view {
        require(
            custody.totalCollected()
                == custody.accountedBalance() + custody.totalRefunded() + custody.totalReleased(),
            "custody_accounting_drift"
        );
        require(custody.balance() >= custody.accountedBalance(), "custody_backing_shortfall");
    }

    function _buy(uint256 amount) private returns (uint256 purchaseId) {
        VM.prank(buyer);
        (purchaseId,,) = presale.buy(amount, 0);
    }
}

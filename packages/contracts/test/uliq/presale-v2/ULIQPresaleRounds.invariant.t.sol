// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ULIQGlobalListing} from "../../../src/uliq/presale-v2/ULIQGlobalListing.sol";
import {ULIQPresaleRound} from "../../../src/uliq/presale-v2/ULIQPresaleRound.sol";
import {ULIQPresaleRoundVesting} from "../../../src/uliq/presale-v2/ULIQPresaleRoundVesting.sol";
import {ULIQToken} from "../../../src/uliq/shared/ULIQToken.sol";
import {ULIQPresaleMockUSDC} from "./fixtures/ULIQPresaleMockUSDC.sol";
import {ULIQPresaleMockCustody} from "./fixtures/ULIQPresaleMockCustody.sol";

contract ULIQPresaleRoundHandler {
    ULIQPresaleRound public immutable presale;
    ULIQPresaleMockUSDC public immutable usdc;
    uint256 public expectedPendingCount;
    uint256 public expectedPendingAllocation;
    uint256[] public purchaseIds;

    constructor(ULIQPresaleRound presale_, ULIQPresaleMockUSDC usdc_, ULIQPresaleMockCustody custody_) {
        presale = presale_;
        usdc = usdc_;
        usdc_.approve(address(custody_), type(uint256).max);
    }

    function buy(uint96 rawAmount) external {
        uint256 maximum = presale.maximumPurchasableUsdcRaw(address(this));
        uint256 minimum = presale.minPurchaseUsdcRaw();
        if (maximum < minimum || presale.state() != ULIQPresaleRound.SaleState.ACTIVE) return;

        uint256 amount = minimum + (uint256(rawAmount) % (maximum - minimum + 1));
        (uint256 purchaseId,, uint256 allocation) = presale.buy(amount, 0);
        purchaseIds.push(purchaseId);
        expectedPendingCount += 1;
        expectedPendingAllocation += allocation;
    }

    function withdraw(uint256 seed) external {
        uint256 length = purchaseIds.length;
        if (length == 0) return;
        uint256 purchaseId = purchaseIds[seed % length];
        (,, uint256 allocation,,, ULIQPresaleRound.PurchaseState purchaseState) = presale.purchases(purchaseId);
        if (purchaseState != ULIQPresaleRound.PurchaseState.PENDING_WITHDRAWAL) return;

        presale.withdrawPurchase(purchaseId);
        expectedPendingCount -= 1;
        expectedPendingAllocation -= allocation;
    }
}

contract ULIQPresaleRoundsInvariantTest {
    uint256 internal constant HARD_CAP = 100_000 * 1e6;
    uint256 internal constant ALLOCATION = 50_000_000 ether;
    uint256 internal constant MAXIMUM = 10_000 * 1e6;

    ULIQToken internal token;
    ULIQPresaleRound internal presale;
    ULIQPresaleMockCustody internal custody;
    ULIQPresaleRoundHandler internal handler;
    address[] private _targets;

    function setUp() public {
        token = new ULIQToken(address(this));
        ULIQPresaleMockUSDC usdc = new ULIQPresaleMockUSDC();
        ULIQGlobalListing listing = new ULIQGlobalListing(address(this));
        ULIQPresaleRoundVesting vesting =
            new ULIQPresaleRoundVesting(address(token), address(listing), address(this), 500, 90 days, 548 days);
        custody = new ULIQPresaleMockCustody(address(usdc), address(0x7EAA5));
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
            500 * 1e6,
            MAXIMUM,
            14 days
        );

        vesting.setPresale(address(presale));
        custody.setPresale(address(presale));
        require(token.transfer(address(presale), ALLOCATION), "inventory_transfer_failed");
        presale.configureSaleWindow(0, uint64(block.timestamp), uint64(block.timestamp + 365 days));
        presale.markReady();
        presale.activateSale();

        handler = new ULIQPresaleRoundHandler(presale, usdc, custody);
        usdc.mint(address(handler), HARD_CAP);
        _targets.push(address(handler));
    }

    function targetContracts() external view returns (address[] memory) {
        return _targets;
    }

    function invariant_RoundCapsAndWalletMaximumAreNeverExceeded() public view {
        require(presale.totalRaisedUsdcRaw() <= HARD_CAP, "raised_above_hard_cap");
        require(presale.totalSoldUliqRaw() <= ALLOCATION, "sold_above_allocation");
        require(presale.purchasedUsdcRawByBuyer(address(handler)) <= MAXIMUM, "wallet_above_maximum");
    }

    function invariant_PendingAccountingMatchesHandlerState() public view {
        require(presale.pendingPurchaseCount() == handler.expectedPendingCount(), "pending_count_drift");
        require(presale.pendingAllocationUliqRaw() == handler.expectedPendingAllocation(), "pending_allocation_drift");
        require(
            presale.totalRaisedUsdcRaw() == presale.purchasedUsdcRawByBuyer(address(handler)),
            "buyer_raised_accounting_drift"
        );
    }

    function invariant_InventoryAndCustodyRemainSolvent() public view {
        require(token.balanceOf(address(presale)) >= presale.pendingAllocationUliqRaw(), "pending_inventory_insolvent");
        require(
            custody.totalCollected() == custody.balance() + custody.totalRefunded() + custody.totalReleased(),
            "custody_accounting_drift"
        );
        require(token.totalSupply() == 1_000_000_000 ether, "presale_created_supply");
    }
}

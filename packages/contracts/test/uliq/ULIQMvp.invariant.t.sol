// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ULIQToken} from "../../src/uliq/ULIQToken.sol";
import {ULIQPresale} from "../../src/uliq/ULIQPresale.sol";
import {ULIQPresaleVesting} from "../../src/uliq/ULIQPresaleVesting.sol";
import {ULIQLocker} from "../../src/uliq/ULIQLocker.sol";
import {ULIQTestnetEscrow} from "../../src/uliq/testnet/ULIQTestnetEscrow.sol";
import {ULIQMockUSDC} from "../../src/uliq/testnet/ULIQMockUSDC.sol";

contract ULIQPresaleHandler {
    ULIQPresale public immutable presale;
    ULIQMockUSDC public immutable usdc;
    uint256[] public purchaseIds;
    uint256 public expectedPendingCount;

    constructor(ULIQPresale presale_, ULIQMockUSDC usdc_, ULIQTestnetEscrow custody_) {
        presale = presale_;
        usdc = usdc_;
        usdc_.approve(address(custody_), type(uint256).max);
    }

    function buy(uint96 rawAmount) external {
        (uint256 maximum,) = presale.quotePurchase(type(uint256).max);
        if (maximum == 0 || presale.state() != ULIQPresale.SaleState.ACTIVE) return;
        uint256 amount = 1 + (uint256(rawAmount) % maximum);
        (uint256 purchaseId,,) = presale.buy(amount, 0);
        purchaseIds.push(purchaseId);
        expectedPendingCount += 1;
    }

    function withdraw(uint256 seed) external {
        uint256 length = purchaseIds.length;
        if (length == 0) return;
        uint256 purchaseId = purchaseIds[seed % length];
        (,,,,, ULIQPresale.PurchaseState purchaseState) = presale.purchases(purchaseId);
        if (purchaseState != ULIQPresale.PurchaseState.PENDING_WITHDRAWAL) return;
        presale.withdrawPurchase(purchaseId);
        expectedPendingCount -= 1;
    }
}

contract ULIQMvpInvariantTest {
    uint256 internal constant HARD_CAP_USDC_RAW = 120_000 * 1e6;
    uint256 internal constant PRESALE_ALLOCATION_RAW = 120_000_000 ether;

    ULIQToken internal token;
    ULIQPresale internal presale;
    ULIQPresaleVesting internal vesting;
    ULIQTestnetEscrow internal custody;
    ULIQPresaleHandler internal handler;
    address[] private _targets;

    function setUp() public {
        token = new ULIQToken(address(this));
        ULIQMockUSDC usdc = new ULIQMockUSDC();
        vesting = new ULIQPresaleVesting(address(token), address(this), 270 days);
        custody = new ULIQTestnetEscrow(address(usdc), address(this), address(0x7EAA5));
        presale = new ULIQPresale(
            address(token),
            address(usdc),
            address(custody),
            address(vesting),
            address(this),
            HARD_CAP_USDC_RAW,
            PRESALE_ALLOCATION_RAW,
            1e15,
            1,
            uint64(block.timestamp),
            uint64(block.timestamp + 30 days),
            5 minutes
        );
        custody.setPresale(address(presale));
        vesting.setPresale(address(presale));
        require(token.transfer(address(presale), PRESALE_ALLOCATION_RAW), "presale_inventory_transfer_failed");
        presale.markReady();
        presale.activateSale();

        handler = new ULIQPresaleHandler(presale, usdc, custody);
        usdc.mint(address(handler), HARD_CAP_USDC_RAW * 4);
        _targets.push(address(handler));
    }

    function targetContracts() external view returns (address[] memory) {
        return _targets;
    }

    function invariant_SaleCapsAreNeverExceeded() public view {
        require(presale.totalRaisedUsdcRaw() <= HARD_CAP_USDC_RAW, "raised_above_hard_cap");
        require(presale.totalSoldUliqRaw() <= PRESALE_ALLOCATION_RAW, "sold_above_allocation");
    }

    function invariant_PendingCountMatchesEconomicState() public view {
        require(presale.pendingPurchaseCount() == handler.expectedPendingCount(), "pending_count_drift");
    }

    function invariant_PresaleNeverCreatesUliq() public view {
        require(token.totalSupply() == 1_000_000_000 ether, "presale_created_supply");
    }

    function invariant_InventoryAlwaysCoversPendingAllocations() public view {
        require(token.balanceOf(address(presale)) >= presale.pendingAllocationUliqRaw(), "pending_inventory_insolvent");
    }

    function invariant_CustodyAccountingMatchesBalance() public view {
        require(
            custody.totalCollected() == custody.balance() + custody.totalRefunded() + custody.totalReleased(),
            "custody_accounting_drift"
        );
    }
}

contract ULIQLockerHandler {
    ULIQLocker public immutable locker;
    ULIQToken public immutable token;
    uint256[] public lockIds;

    constructor(ULIQLocker locker_, ULIQToken token_) {
        locker = locker_;
        token = token_;
        token_.approve(address(locker_), type(uint256).max);
    }

    function lock(uint96 rawAmount, uint8 rawTerm) external {
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) return;
        uint256 amount = 1 + (uint256(rawAmount) % balance);
        uint64[3] memory terms = [uint64(32 days), uint64(185 days), uint64(367 days)];
        lockIds.push(locker.lock(amount, terms[rawTerm % terms.length]));
    }

    function extend(uint256 seed, uint32 rawExtension) external {
        if (lockIds.length == 0) return;
        uint256 lockId = lockIds[seed % lockIds.length];
        (,,,, bool withdrawn) = locker.locks(lockId);
        if (withdrawn) return;
        (,,, uint64 unlockAt,) = locker.locks(lockId);
        uint64 extension = uint64(1 + (uint256(rawExtension) % 367 days));
        locker.extendLock(lockId, unlockAt + extension);
    }
}

contract ULIQLockerInvariantTest {
    ULIQToken internal token;
    ULIQLocker internal locker;
    ULIQLockerHandler internal handler;
    address[] private _targets;
    uint256 internal constant FUNDED_AMOUNT = 1_000_000 ether;

    function setUp() public {
        token = new ULIQToken(address(this));
        locker = new ULIQLocker(address(token));
        handler = new ULIQLockerHandler(locker, token);
        require(token.transfer(address(handler), FUNDED_AMOUNT), "handler_funding_failed");
        _targets.push(address(handler));
    }

    function targetContracts() external view returns (address[] memory) {
        return _targets;
    }

    function invariant_ExtensionsNeverChangeLockedAccounting() public view {
        uint256 locked = locker.totalLocked();
        require(locked == locker.lockedBalanceOf(address(handler)), "locker_owner_total_drift");
        require(locked == token.balanceOf(address(locker)), "locker_token_total_drift");
        require(locked <= FUNDED_AMOUNT, "locker_exceeded_funding");
    }
}

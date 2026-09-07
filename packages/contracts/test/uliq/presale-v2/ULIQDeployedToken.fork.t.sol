// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ULIQGlobalListing} from "../../../src/uliq/presale-v2/ULIQGlobalListing.sol";
import {ULIQPaymentCustody} from "../../../src/uliq/presale-v2/ULIQPaymentCustody.sol";
import {ULIQPresaleRound} from "../../../src/uliq/presale-v2/ULIQPresaleRound.sol";
import {ULIQPresaleRoundVesting} from "../../../src/uliq/presale-v2/ULIQPresaleRoundVesting.sol";
import {ULIQMainnetLocker} from "../../../src/uliq/mainnet/ULIQMainnetLocker.sol";

interface IAuditNativeUsdc is IERC20Metadata {
    function masterMinter() external view returns (address);
    function configureMinter(address minter, uint256 allowance) external returns (bool);
    function mint(address to, uint256 amount) external returns (bool);
}

interface VmUliqDeployedAudit {
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function skip(bool condition) external;
}

/// @notice Explicitly pinned local fork evidence using the existing Mainnet token, never a broadcast.
/// @dev Safe and USDC issuer impersonation only funds local fixtures; no signatures or broadcasts.
contract ULIQDeployedTokenForkAuditTest {
    VmUliqDeployedAudit private constant VM =
        VmUliqDeployedAudit(address(uint160(uint256(keccak256("hevm cheat code")))));
    IERC20Metadata private constant TOKEN = IERC20Metadata(0xF2Fa252134c84Fcf260c73665BAf3f8cCBe03EEd);
    address private constant SOURCE = 0x9C96F9AE59e30786fD325EFD969884FC1f751739;

    function testForkExistingUliqFundsPresaleVestsAndLocks() public {
        _exerciseFork(false);
    }

    function testForkExpiredReadyRoundUnblocksVestingWithExistingUliq() public {
        _exerciseFork(true);
    }

    function _exerciseFork(bool missSecondRoundActivation) private {
        VM.skip(block.chainid != 42161);
        require(address(TOKEN).code.length != 0 && TOKEN.decimals() == 18, "deployed_token_identity");
        require(keccak256(bytes(TOKEN.symbol())) == keccak256("ULIQ"), "token_symbol");
        uint256 supplyBefore = TOKEN.totalSupply();
        uint256 sourceBefore = TOKEN.balanceOf(SOURCE);
        IAuditNativeUsdc usdc = IAuditNativeUsdc(0xaf88d065e77c8cC2239327C5EDb3A432268e5831);
        require(address(usdc).code.length != 0 && usdc.decimals() == 6, "native_usdc_identity");
        require(keccak256(bytes(usdc.symbol())) == keccak256("USDC"), "native_usdc_symbol");
        uint256 treasuryUsdcBefore = usdc.balanceOf(SOURCE);
        ULIQGlobalListing listing = new ULIQGlobalListing(address(this));
        ULIQPresaleRoundVesting v1 =
            new ULIQPresaleRoundVesting(address(TOKEN), address(listing), address(this), 500, 90 days, 548 days);
        ULIQPresaleRoundVesting v2 =
            new ULIQPresaleRoundVesting(address(TOKEN), address(listing), address(this), 2500, 0, 274 days);
        ULIQPaymentCustody c1 = new ULIQPaymentCustody(address(usdc), address(this), SOURCE);
        ULIQPaymentCustody c2 = new ULIQPaymentCustody(address(usdc), address(this), SOURCE);
        ULIQPresaleRound r1 = _round(1, usdc, listing, v1, c1, address(0));
        ULIQPresaleRound r2 = _round(2, usdc, listing, v2, c2, address(r1));
        listing.configureRounds(address(r1), address(r2));
        uint64 end1 = uint64(block.timestamp + 30 days);
        uint64 end2 = end1 + 30 days;
        _prepare(r1, v1, c1, uint64(block.timestamp), end1);
        _prepare(r2, v2, c2, end1, end2);
        r1.activateSale();
        address masterMinter = usdc.masterMinter();
        VM.prank(masterMinter);
        require(usdc.configureMinter(address(this), 500e6), "local_fixture_minter");
        require(usdc.mint(address(this), 500e6), "local_fixture_funds");
        usdc.approve(address(c1), 500e6);
        (uint256 refundedId,,) = r1.buy(500e6, 250_000 ether);
        require(usdc.balanceOf(address(c1)) == 500e6, "native_custody_balance");
        r1.withdrawPurchase(refundedId);
        require(usdc.balanceOf(address(this)) == 500e6 && c1.accountedBalance() == 0, "native_refund");
        usdc.approve(address(c1), 500e6);
        (uint256 id,, uint256 allocation) = r1.buy(500e6, 250_000 ether);
        VM.warp(block.timestamp + 14 days + 1);
        r1.finalizePurchase(id);
        require(usdc.balanceOf(SOURCE) == treasuryUsdcBefore + 500e6, "native_treasury_release");
        require(usdc.balanceOf(address(c1)) == 0 && c1.accountedBalance() == 0, "native_settlement");
        require(TOKEN.balanceOf(address(this)) == 0 && TOKEN.balanceOf(address(v1)) == allocation, "premature_delivery");
        VM.warp(end1);
        r1.endSale();
        r1.markListingPending();
        if (!missSecondRoundActivation) r2.activateSale();
        VM.warp(end2);
        VM.prank(SOURCE);
        r2.endSale();
        r2.markListingPending();
        r1.releaseUnsold();
        r2.releaseUnsold();
        require(TOKEN.balanceOf(SOURCE) == sourceBefore - allocation, "source_reconciliation");
        uint64 launch = uint64(block.timestamp + 1);
        listing.scheduleListing(launch);
        VM.warp(uint256(launch) + 90 days + 548 days);
        require(v1.claim() == allocation && TOKEN.balanceOf(address(this)) == allocation, "claim_reconciliation");

        ULIQMainnetLocker locker = new ULIQMainnetLocker();
        TOKEN.approve(address(locker), allocation);
        uint256 lockId = locker.lock(allocation, locker.ONE_MONTH());
        require(
            TOKEN.balanceOf(address(locker)) == allocation && locker.totalLocked() == allocation, "lock_reconciliation"
        );
        (,,, uint64 expiry,) = locker.locks(lockId);
        VM.warp(expiry);
        require(locker.unlock(lockId) == allocation, "unlock_amount");
        require(TOKEN.balanceOf(address(this)) == allocation && locker.totalLocked() == 0, "unlock_reconciliation");
        require(TOKEN.totalSupply() == supplyBefore, "supply_changed");
    }

    function _round(
        uint8 id,
        IAuditNativeUsdc usdc,
        ULIQGlobalListing listing,
        ULIQPresaleRoundVesting vesting,
        ULIQPaymentCustody custody,
        address predecessor
    ) private returns (ULIQPresaleRound) {
        bool r1 = id == 1;
        return new ULIQPresaleRound(
            id,
            address(TOKEN),
            address(usdc),
            address(custody),
            address(vesting),
            address(listing),
            predecessor,
            SOURCE,
            address(this),
            r1 ? 100_000e6 : 350_000e6,
            r1 ? 50_000_000 ether : 100_000_000 ether,
            r1 ? 2000 : 3500,
            r1 ? 500e6 : 100e6,
            r1 ? 10_000e6 : 5000e6,
            14 days
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
        uint256 allocation = round.allocationCapUliqRaw();
        VM.prank(SOURCE);
        TOKEN.approve(address(round), allocation);
        VM.prank(SOURCE);
        round.fundInventory();
        round.configureSaleWindow(0, start, end);
        round.markReady();
    }
}

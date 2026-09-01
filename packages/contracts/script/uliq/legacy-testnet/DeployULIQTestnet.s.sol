// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ScriptBase} from "../../ScriptBase.sol";
import {ULIQToken} from "../../../src/uliq/shared/ULIQToken.sol";
import {ULIQPresale} from "../../../src/uliq/legacy-testnet/ULIQPresale.sol";
import {ULIQPresaleVesting} from "../../../src/uliq/legacy-testnet/ULIQPresaleVesting.sol";
import {ULIQLocker} from "../../../src/uliq/legacy-testnet/ULIQLocker.sol";
import {ULIQTestnetEscrow} from "../../../src/uliq/legacy-testnet/ULIQTestnetEscrow.sol";
import {ULIQMockUSDC} from "../../../src/uliq/legacy-testnet/ULIQMockUSDC.sol";

/// @notice Reproducible legacy MVP deployment for local/Arbitrum Sepolia. Mainnet chain IDs are rejected.
contract DeployULIQTestnet is ScriptBase {
    uint256 public constant ARBITRUM_SEPOLIA_CHAIN_ID = 421_614;
    uint256 public constant LOCAL_CHAIN_ID = 31_337;
    uint256 public constant HARD_CAP_USDC_RAW = 120_000 * 1e6;
    uint256 public constant PRESALE_ALLOCATION_RAW = 120_000_000 ether;
    uint256 public constant RATE_NUMERATOR = 1e15;
    uint256 public constant RATE_DENOMINATOR = 1;
    uint64 public constant TESTNET_VESTING_DURATION_SECONDS = 270 days;
    uint64 public constant MIN_TESTNET_WITHDRAWAL_PERIOD_SECONDS = 1 hours;

    error UnsupportedChain(uint256 chainId);
    error InvalidAdmin();
    error InvalidTreasury();
    error WithdrawalPeriodTooShort(uint64 configured, uint64 minimum);

    event ULIQTestnetDeploymentCompleted(
        uint256 indexed chainId,
        address indexed admin,
        address indexed treasury,
        address usdc,
        address token,
        address presale,
        address vesting,
        address locker,
        address paymentCustody,
        uint64 withdrawalPeriodSeconds
    );

    function run(
        address admin,
        address treasury,
        address testUsdc,
        uint64 saleStart,
        uint64 saleEnd,
        uint64 withdrawalPeriodSeconds
    )
        external
        returns (
            address tokenAddress,
            address presaleAddress,
            address vestingAddress,
            address lockerAddress,
            address custodyAddress,
            address usdcAddress
        )
    {
        if (block.chainid != ARBITRUM_SEPOLIA_CHAIN_ID && block.chainid != LOCAL_CHAIN_ID) {
            revert UnsupportedChain(block.chainid);
        }
        if (admin == address(0)) revert InvalidAdmin();
        if (treasury == address(0)) revert InvalidTreasury();
        if (withdrawalPeriodSeconds < MIN_TESTNET_WITHDRAWAL_PERIOD_SECONDS) {
            revert WithdrawalPeriodTooShort(withdrawalPeriodSeconds, MIN_TESTNET_WITHDRAWAL_PERIOD_SECONDS);
        }

        vm.startBroadcast();

        if (testUsdc == address(0)) {
            testUsdc = address(new ULIQMockUSDC());
        }
        ULIQToken token = new ULIQToken(admin);
        ULIQPresaleVesting vesting = new ULIQPresaleVesting(address(token), admin, TESTNET_VESTING_DURATION_SECONDS);
        ULIQTestnetEscrow custody = new ULIQTestnetEscrow(testUsdc, admin, treasury);
        ULIQPresale presale = new ULIQPresale(
            address(token),
            testUsdc,
            address(custody),
            address(vesting),
            admin,
            HARD_CAP_USDC_RAW,
            PRESALE_ALLOCATION_RAW,
            RATE_NUMERATOR,
            RATE_DENOMINATOR,
            saleStart,
            saleEnd,
            withdrawalPeriodSeconds
        );
        ULIQLocker locker = new ULIQLocker(address(token));

        vm.stopBroadcast();

        tokenAddress = address(token);
        presaleAddress = address(presale);
        vestingAddress = address(vesting);
        lockerAddress = address(locker);
        custodyAddress = address(custody);
        usdcAddress = testUsdc;

        emit ULIQTestnetDeploymentCompleted(
            block.chainid,
            admin,
            treasury,
            testUsdc,
            tokenAddress,
            presaleAddress,
            vestingAddress,
            lockerAddress,
            custodyAddress,
            withdrawalPeriodSeconds
        );
    }
}

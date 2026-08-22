// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ScriptBase} from "../ScriptBase.sol";
import {ULIQToken} from "../../src/uliq/ULIQToken.sol";
import {ULIQPresale} from "../../src/uliq/ULIQPresale.sol";
import {ULIQPresaleVesting} from "../../src/uliq/ULIQPresaleVesting.sol";
import {ULIQTestnetEscrow} from "../../src/uliq/testnet/ULIQTestnetEscrow.sol";

/// @notice Second deployment stage, executed by the testnet allocation-controller/admin signer.
contract ConfigureULIQTestnet is ScriptBase {
    uint256 public constant ARBITRUM_SEPOLIA_CHAIN_ID = 421_614;
    uint256 public constant LOCAL_CHAIN_ID = 31_337;
    uint256 public constant PRESALE_ALLOCATION_RAW = 120_000_000 ether;

    error UnsupportedChain(uint256 chainId);
    error InvalidContract(address target);
    error ConfigurationMismatch();

    event ULIQTestnetConfigured(
        uint256 indexed chainId,
        address indexed token,
        address indexed presale,
        address vesting,
        address paymentCustody,
        uint256 fundedInventory
    );

    function run(address tokenAddress, address presaleAddress, address vestingAddress, address custodyAddress)
        external
    {
        if (block.chainid != ARBITRUM_SEPOLIA_CHAIN_ID && block.chainid != LOCAL_CHAIN_ID) {
            revert UnsupportedChain(block.chainid);
        }
        _requireContract(tokenAddress);
        _requireContract(presaleAddress);
        _requireContract(vestingAddress);
        _requireContract(custodyAddress);

        ULIQToken token = ULIQToken(tokenAddress);
        ULIQPresale presale = ULIQPresale(presaleAddress);
        ULIQPresaleVesting vesting = ULIQPresaleVesting(vestingAddress);
        ULIQTestnetEscrow custody = ULIQTestnetEscrow(custodyAddress);
        if (
            address(presale.uliq()) != tokenAddress || address(presale.vesting()) != vestingAddress
                || address(presale.paymentCustody()) != custodyAddress
        ) revert ConfigurationMismatch();

        vm.startBroadcast();
        vesting.setPresale(presaleAddress);
        custody.setPresale(presaleAddress);
        require(token.transfer(presaleAddress, PRESALE_ALLOCATION_RAW), "presale_inventory_transfer_failed");
        presale.markReady();
        vm.stopBroadcast();

        if (token.balanceOf(presaleAddress) != PRESALE_ALLOCATION_RAW) revert ConfigurationMismatch();
        if (presale.state() != ULIQPresale.SaleState.READY) revert ConfigurationMismatch();

        emit ULIQTestnetConfigured(
            block.chainid,
            tokenAddress,
            presaleAddress,
            vestingAddress,
            custodyAddress,
            PRESALE_ALLOCATION_RAW
        );
    }

    function _requireContract(address target) private view {
        if (target == address(0) || target.code.length == 0) revert InvalidContract(target);
    }
}

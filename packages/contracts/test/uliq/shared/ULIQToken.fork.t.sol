// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ULIQToken} from "../../../src/uliq/shared/ULIQToken.sol";

interface VmTokenForkAudit {
    function prank(address sender) external;
    function skip(bool condition) external;
}

interface ITokenAuditSafe {
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
}

/// @notice Optional local fork smoke for candidate addresses, not approval of the allocation architecture.
/// @dev Run with an explicit Arbitrum One fork block. Pranks bypass Safe signatures; this does not test signer control.
contract ULIQTokenForkAuditTest {
    VmTokenForkAudit internal constant VM = VmTokenForkAudit(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant TREASURY = 0x9C96F9AE59e30786fD325EFD969884FC1f751739;
    address internal constant ADMIN = 0xf6EB22eC94be977A668967f44F89eB1e056FF70f;
    address internal constant DEPLOYER = 0x89473caAb2d0d5aC4B0fcCd45B0348E65307810E;

    function testForkCandidateTreasuryReceivesSupplyAndCanApprove() public {
        VM.skip(block.chainid != 42161);
        require(TREASURY.code.length != 0 && ADMIN.code.length != 0, "safe_not_deployed");
        require(DEPLOYER.code.length == 0, "unexpected_deployer_code");
        _checkSafe(TREASURY);
        _checkSafe(ADMIN);

        VM.prank(DEPLOYER);
        ULIQToken token = new ULIQToken(TREASURY);
        uint256 supply = 1_000_000_000 ether;
        require(token.balanceOf(TREASURY) == supply && token.totalSupply() == supply, "mint_target");
        require(token.balanceOf(DEPLOYER) == 0 && token.balanceOf(ADMIN) == 0, "unexpected_allocation");

        // Local impersonation tests ERC-20 compatibility only; no Safe transaction is signed or sent.
        VM.prank(TREASURY);
        token.approve(address(this), 1 ether);
        token.transferFrom(TREASURY, address(0xB0B), 1 ether);
        require(token.balanceOf(address(0xB0B)) == 1 ether, "destination_balance");
        require(token.balanceOf(TREASURY) == supply - 1 ether, "treasury_balance");
        require(token.allowance(TREASURY, address(this)) == 0 && token.totalSupply() == supply, "allowance_or_supply");
    }

    function _checkSafe(address safe) internal view {
        address[] memory owners = ITokenAuditSafe(safe).getOwners();
        require(owners.length == 2 && ITokenAuditSafe(safe).getThreshold() == 2, "expected_2_of_2");
        for (uint256 i; i < owners.length; ++i) {
            require(owners[i] != DEPLOYER, "deployer_is_owner");
        }
    }
}

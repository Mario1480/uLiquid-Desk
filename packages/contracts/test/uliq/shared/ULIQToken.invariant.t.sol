// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ULIQToken} from "../../../src/uliq/shared/ULIQToken.sol";
import {VmTokenAudit} from "./ULIQToken.t.sol";

/// @dev All recipients stay inside the tracked actor set. Burns are tracked separately from transfers.
contract ULIQTokenAuditHandler {
    VmTokenAudit internal constant VM = VmTokenAudit(address(uint160(uint256(keccak256("hevm cheat code")))));
    ULIQToken public immutable token;
    address[3] public actors = [address(0xA11CE), address(0xB0B), address(0xCAFE)];
    uint256 public burned;

    constructor(ULIQToken token_) {
        token = token_;
    }

    function transfer(uint256 fromSeed, uint256 toSeed, uint256 rawAmount) external {
        address from = actors[fromSeed % 3];
        uint256 amount = rawAmount % (token.balanceOf(from) + 1);
        VM.prank(from);
        token.transfer(actors[toSeed % 3], amount);
    }

    function approve(uint256 ownerSeed, uint256 spenderSeed, uint256 rawAmount, bool unlimited) external {
        VM.prank(actors[ownerSeed % 3]);
        token.approve(actors[spenderSeed % 3], unlimited ? type(uint256).max : rawAmount);
    }

    function transferFrom(uint256 ownerSeed, uint256 spenderSeed, uint256 recipientSeed, uint256 rawAmount) external {
        address owner = actors[ownerSeed % 3];
        address spender = actors[spenderSeed % 3];
        uint256 amount = rawAmount % (_spendable(owner, spender) + 1);
        VM.prank(spender);
        token.transferFrom(owner, actors[recipientSeed % 3], amount);
    }

    function burn(uint256 ownerSeed, uint256 rawAmount) external {
        address owner = actors[ownerSeed % 3];
        uint256 amount = rawAmount % (token.balanceOf(owner) + 1);
        VM.prank(owner);
        token.burn(amount);
        burned += amount;
    }

    function burnFrom(uint256 ownerSeed, uint256 spenderSeed, uint256 rawAmount) external {
        address owner = actors[ownerSeed % 3];
        address spender = actors[spenderSeed % 3];
        uint256 amount = rawAmount % (_spendable(owner, spender) + 1);
        VM.prank(spender);
        token.burnFrom(owner, amount);
        burned += amount;
    }

    function _spendable(address owner, address spender) internal view returns (uint256) {
        uint256 balance = token.balanceOf(owner);
        uint256 allowance = token.allowance(owner, spender);
        return balance < allowance ? balance : allowance;
    }
}

contract ULIQTokenAuditInvariantTest {
    ULIQToken internal token;
    ULIQTokenAuditHandler internal handler;
    address[] private _targets;

    function setUp() public {
        token = new ULIQToken(address(0xA11CE));
        handler = new ULIQTokenAuditHandler(token);
        _targets.push(address(handler));
    }

    function targetContracts() external view returns (address[] memory) {
        return _targets;
    }

    function invariant_BalancesEqualSupply() public view {
        uint256 sum;
        for (uint256 i; i < 3; ++i) {
            sum += token.balanceOf(handler.actors(i));
        }
        require(sum == token.totalSupply(), "balance_conservation");
        require(token.balanceOf(address(0)) == 0, "zero_address_balance");
    }

    function invariant_OnlyBurnsChangeSupply() public view {
        require(token.totalSupply() + handler.burned() == token.MAX_SUPPLY(), "supply_conservation");
        require(token.MAX_SUPPLY() == 1_000_000_000 ether, "initial_supply_changed");
    }
}

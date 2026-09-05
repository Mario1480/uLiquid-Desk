// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ULIQToken} from "../../../src/uliq/shared/ULIQToken.sol";

interface VmTokenAudit {
    function addr(uint256 privateKey) external returns (address);
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function chainId(uint256 newChainId) external;
    function getChainId() external view returns (uint256);
    function expectRevert() external;
    function expectRevert(bytes4 selector) external;
    function expectEmit(bool topic1, bool topic2, bool topic3, bool data) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
}

/// @notice Deployment audit regression tests; no production transactions or private keys are used.
contract ULIQTokenAuditTest {
    VmTokenAudit internal constant VM = VmTokenAudit(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant OWNER_KEY = 0xA11CE;
    uint256 internal constant SUPPLY = 1_000_000_000 ether;
    uint256 internal constant CURVE_ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    address internal constant SPENDER = address(0xB0B);
    address internal constant RECIPIENT = address(0xCAFE);
    ULIQToken internal token;
    address internal owner;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function setUp() public {
        owner = VM.addr(OWNER_KEY);
        token = new ULIQToken(owner);
    }

    function testConstructorMintsOnlyToAllocationController() public {
        VM.expectEmit(true, true, false, true);
        emit Transfer(address(0), RECIPIENT, SUPPLY);
        ULIQToken deployed = new ULIQToken(RECIPIENT);
        require(deployed.balanceOf(RECIPIENT) == SUPPLY, "allocation");
        require(deployed.balanceOf(address(this)) == 0, "deployer_received_supply");
        require(deployed.balanceOf(address(deployed)) == 0, "token_received_supply");
        require(deployed.totalSupply() == SUPPLY && deployed.MAX_SUPPLY() == SUPPLY, "supply");
        require(deployed.decimals() == 18, "decimals");
        require(keccak256(bytes(deployed.name())) == keccak256("uLiquid Token"), "name");
        require(keccak256(bytes(deployed.symbol())) == keccak256("ULIQ"), "symbol");
    }

    function testConstructorRejectsZeroRecipient() public {
        VM.expectRevert(ULIQToken.ZeroAllocationController.selector);
        new ULIQToken(address(0));
    }

    function testNoRuntimeMintOwnerUpgradeOrRecoveryEntrypoints() public {
        bytes[] memory calls = new bytes[](5);
        calls[0] = abi.encodeWithSignature("mint(address,uint256)", RECIPIENT, 1);
        calls[1] = abi.encodeWithSignature("_mint(address,uint256)", RECIPIENT, 1);
        calls[2] = abi.encodeWithSignature("owner()");
        calls[3] = abi.encodeWithSignature("upgradeTo(address)", RECIPIENT);
        calls[4] = abi.encodeWithSignature("transferOwnership(address)", RECIPIENT);
        for (uint256 i; i < calls.length; ++i) {
            (bool success,) = address(token).call(calls[i]);
            require(!success, "unexpected_entrypoint");
        }
        (bool acceptsEmptyCall,) = address(token).call("");
        require(!acceptsEmptyCall && token.totalSupply() == SUPPLY, "fallback_or_supply");
    }

    function testFuzzTransferConservesSupply(uint256 rawAmount) public {
        uint256 amount = rawAmount % (SUPPLY + 1);
        VM.prank(owner);
        require(token.transfer(RECIPIENT, amount), "transfer");
        require(token.balanceOf(owner) == SUPPLY - amount, "debit");
        require(token.balanceOf(RECIPIENT) == amount && token.totalSupply() == SUPPLY, "credit");
    }

    function testSelfAndZeroTransferPreserveBalances() public {
        VM.prank(owner);
        token.transfer(owner, SUPPLY);
        VM.prank(RECIPIENT);
        token.transfer(SPENDER, 0);
        require(token.balanceOf(owner) == SUPPLY && token.totalSupply() == SUPPLY, "self_transfer");
    }

    function testTransferRejectsZeroAndInsufficientBalance() public {
        VM.expectRevert();
        VM.prank(owner);
        token.transfer(address(0), 0);
        VM.expectRevert();
        VM.prank(RECIPIENT);
        token.transfer(owner, 1);
        require(token.balanceOf(owner) == SUPPLY && token.balanceOf(address(0)) == 0, "revert_changed_balance");
    }

    function testFuzzBurnReducesSupplyWithoutRemint(uint256 rawAmount) public {
        uint256 amount = rawAmount % (SUPPLY + 1);
        VM.expectEmit(true, true, false, true);
        emit Transfer(owner, address(0), amount);
        VM.prank(owner);
        token.burn(amount);
        require(token.totalSupply() == SUPPLY - amount && token.balanceOf(owner) == SUPPLY - amount, "burn");
        require(token.MAX_SUPPLY() == SUPPLY && token.balanceOf(address(0)) == 0, "cap_or_zero_balance");
    }

    function testFullSupplyCanBeBurned() public {
        VM.prank(owner);
        token.burn(SUPPLY);
        require(token.totalSupply() == 0 && token.balanceOf(owner) == 0, "full_burn");
        VM.expectRevert();
        VM.prank(owner);
        token.burn(1);
    }

    function testBurnCannotSpendAnotherHoldersBalance() public {
        VM.expectRevert();
        VM.prank(SPENDER);
        token.burn(1);
        VM.expectRevert();
        VM.prank(SPENDER);
        token.burnFrom(owner, 1);
        require(token.totalSupply() == SUPPLY && token.balanceOf(owner) == SUPPLY, "unauthorized_burn");
    }

    function testFiniteAllowanceIsSharedByTransferFromAndBurnFrom() public {
        VM.prank(owner);
        token.approve(SPENDER, 10);
        VM.prank(SPENDER);
        token.transferFrom(owner, RECIPIENT, 4);
        VM.prank(SPENDER);
        token.burnFrom(owner, 6);
        require(token.allowance(owner, SPENDER) == 0, "allowance");
        require(token.balanceOf(owner) == SUPPLY - 10 && token.balanceOf(RECIPIENT) == 4, "balances");
        require(token.totalSupply() == SUPPLY - 6, "supply");
        VM.expectRevert();
        VM.prank(SPENDER);
        token.transferFrom(owner, RECIPIENT, 1);
    }

    function testInfiniteAllowanceIsNotConsumedByTransferOrBurn() public {
        VM.prank(owner);
        token.approve(SPENDER, type(uint256).max);
        VM.prank(SPENDER);
        token.transferFrom(owner, RECIPIENT, 1);
        VM.prank(SPENDER);
        token.burnFrom(owner, 1);
        require(token.allowance(owner, SPENDER) == type(uint256).max, "infinite_allowance");
    }

    function testRevertedDelegatedCallsRollBackAllowance() public {
        VM.prank(RECIPIENT);
        token.approve(SPENDER, 10);
        VM.expectRevert();
        VM.prank(SPENDER);
        token.transferFrom(RECIPIENT, owner, 1);
        VM.expectRevert();
        VM.prank(SPENDER);
        token.burnFrom(RECIPIENT, 1);
        require(token.allowance(RECIPIENT, SPENDER) == 10, "allowance_changed");
        VM.prank(owner);
        token.approve(SPENDER, 10);
        VM.expectRevert();
        VM.prank(SPENDER);
        token.transferFrom(owner, address(0), 1);
        require(token.allowance(owner, SPENDER) == 10 && token.totalSupply() == SUPPLY, "failed_transfer_state");
    }

    function testApprovalReplacementAndRevocationFollowStandardSemantics() public {
        VM.prank(owner);
        token.approve(SPENDER, 10);
        VM.prank(SPENDER);
        token.transferFrom(owner, RECIPIENT, 10);
        VM.prank(owner);
        token.approve(SPENDER, 5);
        VM.prank(SPENDER);
        token.transferFrom(owner, RECIPIENT, 5);
        require(token.balanceOf(RECIPIENT) == 15, "replacement_is_not_cumulative_cap");
        VM.prank(owner);
        token.approve(SPENDER, 10);
        VM.prank(owner);
        token.approve(SPENDER, 0);
        VM.expectRevert();
        VM.prank(SPENDER);
        token.transferFrom(owner, RECIPIENT, 1);
    }

    function testApprovalRejectsZeroSpender() public {
        VM.expectRevert();
        VM.prank(owner);
        token.approve(address(0), 1);
    }

    function testPermitCanBeRelayedAndUsedForBurn() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signature(token, owner, SPENDER, 10, 0, deadline, OWNER_KEY);
        VM.expectEmit(true, true, false, true);
        emit Approval(owner, SPENDER, 10);
        VM.prank(RECIPIENT);
        token.permit(owner, SPENDER, 10, deadline, v, r, s);
        require(token.nonces(owner) == 1 && token.allowance(owner, SPENDER) == 10, "permit");
        VM.prank(SPENDER);
        token.burnFrom(owner, 10);
        require(token.totalSupply() == SUPPLY - 10, "permit_burn");
    }

    function testPermitReplayRevertsWithoutChangingState() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signature(token, owner, SPENDER, 10, 0, deadline, OWNER_KEY);
        token.permit(owner, SPENDER, 10, deadline, v, r, s);
        VM.expectRevert();
        token.permit(owner, SPENDER, 10, deadline, v, r, s);
        require(token.nonces(owner) == 1 && token.allowance(owner, SPENDER) == 10, "replay_state");
    }

    function testPermitDeadlineIsInclusiveThenExpires() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signature(token, owner, SPENDER, 10, 0, deadline, OWNER_KEY);
        VM.warp(deadline);
        token.permit(owner, SPENDER, 10, deadline, v, r, s);
        (v, r, s) = _signature(token, owner, SPENDER, 20, 1, deadline, OWNER_KEY);
        VM.warp(deadline + 1);
        VM.expectRevert();
        token.permit(owner, SPENDER, 20, deadline, v, r, s);
        require(token.nonces(owner) == 1 && token.allowance(owner, SPENDER) == 10, "expiry_state");
    }

    function testPermitCannotReplayAcrossTokens() public {
        ULIQToken another = new ULIQToken(owner);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signature(token, owner, SPENDER, 10, 0, deadline, OWNER_KEY);
        VM.expectRevert();
        another.permit(owner, SPENDER, 10, deadline, v, r, s);
        require(another.nonces(owner) == 0 && another.allowance(owner, SPENDER) == 0, "cross_token_state");
    }

    function testPermitDomainUpdatesAndRejectsOldChainSignature() public {
        // Use the cheatcode getter: the optimizer treats CHAINID as transaction-constant.
        uint256 oldChain = VM.getChainId();
        bytes32 oldDomain = token.DOMAIN_SEPARATOR();
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signature(token, owner, SPENDER, 10, 0, deadline, OWNER_KEY);
        VM.chainId(oldChain + 1);
        require(token.DOMAIN_SEPARATOR() != oldDomain, "domain_not_updated");
        VM.expectRevert();
        token.permit(owner, SPENDER, 10, deadline, v, r, s);
        require(token.nonces(owner) == 0, "cross_chain_nonce");
        (v, r, s) = _signature(token, owner, SPENDER, 10, 0, deadline, OWNER_KEY);
        token.permit(owner, SPENDER, 10, deadline, v, r, s);
        VM.chainId(oldChain);
        require(token.DOMAIN_SEPARATOR() == oldDomain, "cached_domain");
    }

    function testPermitRejectsAlteredSpenderAmountDeadlineAndNonce() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signature(token, owner, SPENDER, 10, 0, deadline, OWNER_KEY);
        VM.expectRevert();
        token.permit(owner, RECIPIENT, 10, deadline, v, r, s);
        VM.expectRevert();
        token.permit(owner, SPENDER, 11, deadline, v, r, s);
        VM.expectRevert();
        token.permit(owner, SPENDER, 10, deadline + 1, v, r, s);
        (v, r, s) = _signature(token, owner, SPENDER, 10, 1, deadline, OWNER_KEY);
        VM.expectRevert();
        token.permit(owner, SPENDER, 10, deadline, v, r, s);
        require(token.nonces(owner) == 0 && token.allowance(owner, SPENDER) == 0, "altered_permit_state");
    }

    function testPermitRejectsWrongSignerAndZeroOwner() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signature(token, owner, SPENDER, 10, 0, deadline, 0xBAD);
        VM.expectRevert();
        token.permit(owner, SPENDER, 10, deadline, v, r, s);
        VM.expectRevert();
        token.permit(address(0), SPENDER, 10, deadline, 27, bytes32(0), bytes32(0));
        require(token.nonces(owner) == 0 && token.nonces(address(0)) == 0, "invalid_signer_nonce");
    }

    function testPermitRejectsHighSAndInvalidV() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signature(token, owner, SPENDER, 10, 0, deadline, OWNER_KEY);
        uint8 flippedV = v == 27 ? 28 : 27;
        VM.expectRevert();
        token.permit(owner, SPENDER, 10, deadline, flippedV, r, bytes32(CURVE_ORDER - uint256(s)));
        VM.expectRevert();
        token.permit(owner, SPENDER, 10, deadline, 0, r, s);
        require(token.nonces(owner) == 0, "malleability_nonce");
    }

    function testPermitToZeroSpenderRollsBackNonce() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signature(token, owner, address(0), 10, 0, deadline, OWNER_KEY);
        VM.expectRevert();
        token.permit(owner, address(0), 10, deadline, v, r, s);
        require(token.nonces(owner) == 0, "zero_spender_nonce");
    }

    function testERC1271WalletSignatureIsNotSupported() public {
        AuditSignatureWallet wallet = new AuditSignatureWallet();
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signature(token, address(wallet), SPENDER, 10, 0, deadline, OWNER_KEY);
        VM.expectRevert();
        token.permit(address(wallet), SPENDER, 10, deadline, v, r, s);
        require(token.nonces(address(wallet)) == 0, "contract_wallet_nonce");
    }

    function _signature(
        ULIQToken target,
        address tokenOwner,
        address spender,
        uint256 value,
        uint256 nonce,
        uint256 deadline,
        uint256 signingKey
    ) internal returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, tokenOwner, spender, value, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", target.DOMAIN_SEPARATOR(), structHash));
        return VM.sign(signingKey, digest);
    }
}

contract AuditSignatureWallet {
    function isValidSignature(bytes32, bytes memory) external pure returns (bytes4) {
        return 0x1626ba7e;
    }
}

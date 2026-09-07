// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ULIQMainnetLocker} from "../../../src/uliq/mainnet/ULIQMainnetLocker.sol";
import {ULIQLocker} from "../../../src/uliq/legacy-testnet/ULIQLocker.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ULIQPresaleMockUSDC} from "../presale-v2/fixtures/ULIQPresaleMockUSDC.sol";

interface VmMainnetLocker {
    function chainId(uint256 newChainId) external;
    function etch(address target, bytes calldata code) external;
    function expectRevert(bytes calldata data) external;
    function expectRevert(bytes4 selector) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract MainnetLockerTokenFixture is ERC20 {
    constructor() ERC20("Local ULIQ fixture", "ULIQ") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ULIQMainnetLockerTest {
    VmMainnetLocker private constant VM = VmMainnetLocker(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant TOKEN = 0xF2Fa252134c84Fcf260c73665BAf3f8cCBe03EEd;

    function testRejectsWrongChain() public {
        VM.chainId(421614);
        VM.expectRevert(abi.encodeWithSelector(ULIQMainnetLocker.UnsupportedChain.selector, 421614));
        new ULIQMainnetLocker();
    }

    function testRejectsMissingTokenCode() public {
        VM.chainId(42161);
        VM.etch(TOKEN, hex"");
        VM.expectRevert(ULIQMainnetLocker.InvalidMainnetToken.selector);
        new ULIQMainnetLocker();
    }

    function testRejectsWrongDecimals() public {
        VM.chainId(42161);
        ULIQPresaleMockUSDC wrong = new ULIQPresaleMockUSDC();
        VM.etch(TOKEN, address(wrong).code);
        VM.expectRevert(ULIQMainnetLocker.InvalidMainnetToken.selector);
        new ULIQMainnetLocker();
    }

    function testPinnedTokenOwnerMaturityExtensionAndSingleExit() public {
        VM.chainId(42161);
        // Local-only fixture: install nominal ERC20 code at the pinned address.
        MainnetLockerTokenFixture fixture = new MainnetLockerTokenFixture();
        VM.etch(TOKEN, address(fixture).code);
        MainnetLockerTokenFixture token = MainnetLockerTokenFixture(TOKEN);
        token.mint(address(this), 100 ether);
        ULIQMainnetLocker locker = new ULIQMainnetLocker();
        require(address(locker.token()) == TOKEN, "token");
        token.approve(address(locker), 100 ether);
        uint256 id = locker.lock(100 ether, locker.ONE_MONTH());
        (,,, uint64 expiry,) = locker.locks(id);
        VM.prank(address(0xB0B));
        VM.expectRevert(ULIQLocker.NotLockOwner.selector);
        locker.unlock(id);
        VM.expectRevert(ULIQLocker.LockStillActive.selector);
        locker.unlock(id);
        locker.extendLock(id, expiry + 1 days);
        VM.warp(expiry);
        VM.expectRevert(ULIQLocker.LockStillActive.selector);
        locker.unlock(id);
        VM.warp(expiry + 1 days);
        require(locker.unlock(id) == 100 ether, "principal");
        require(token.balanceOf(address(this)) == 100 ether && locker.totalLocked() == 0, "balances");
        VM.expectRevert(ULIQLocker.AlreadyWithdrawn.selector);
        locker.unlock(id);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IULIQPaymentCustody} from "../interfaces/IULIQPaymentCustody.sol";

/// @title ULIQ Testnet Escrow
/// @notice TESTNET / PROVISIONAL custody adapter. It only collects and refunds USDC.
/// @dev It intentionally has no treasury-release function while ADR-001 is blocked.
contract ULIQTestnetEscrow is IULIQPaymentCustody, Ownable2Step {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public presale;

    error ZeroAddress();
    error PresaleAlreadySet();
    error UnauthorizedPresale();

    event PresaleConfigured(address indexed presale);
    event PaymentCollected(address indexed buyer, uint256 amount);
    event PaymentRefunded(address indexed buyer, uint256 amount);

    modifier onlyPresale() {
        if (msg.sender != presale) revert UnauthorizedPresale();
        _;
    }

    constructor(address usdc_, address admin) Ownable(admin) {
        if (usdc_ == address(0) || admin == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
    }

    function paymentToken() external view returns (address) {
        return address(usdc);
    }

    function setPresale(address presale_) external onlyOwner {
        if (presale_ == address(0)) revert ZeroAddress();
        if (presale != address(0)) revert PresaleAlreadySet();
        presale = presale_;
        emit PresaleConfigured(presale_);
    }

    function collectFrom(address buyer, uint256 amount) external onlyPresale {
        usdc.safeTransferFrom(buyer, address(this), amount);
        emit PaymentCollected(buyer, amount);
    }

    function refundTo(address buyer, uint256 amount) external onlyPresale {
        usdc.safeTransfer(buyer, amount);
        emit PaymentRefunded(buyer, amount);
    }

    function balance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}

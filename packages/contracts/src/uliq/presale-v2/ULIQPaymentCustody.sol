// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IULIQPaymentCustody} from "../shared/interfaces/IULIQPaymentCustody.sol";

interface IULIQPresaleRoundCustodyBinding {
    function usdc() external view returns (address);
    function paymentCustody() external view returns (address);
}

/// @title ULIQ Payment Custody
/// @notice Non-upgradeable, purchase-bound USDC custody deployed once per ULIQ presale round.
/// @dev Production activation remains subject to ADR-001 legal approval and an independent audit.
contract ULIQPaymentCustody is IULIQPaymentCustody, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum PaymentState {
        NONE,
        COLLECTED,
        REFUNDED,
        RELEASED
    }

    struct Payment {
        address buyer;
        uint256 amount;
        PaymentState state;
    }

    IERC20 public immutable usdc;
    address public presale;
    address public override treasury;
    address public pendingTreasury;
    uint256 public totalCollected;
    uint256 public totalRefunded;
    uint256 public totalReleased;
    mapping(uint256 purchaseId => Payment payment) public payments;

    error ZeroAddress();
    error ZeroAmount();
    error InvalidPresaleBinding();
    error PresaleAlreadySet();
    error UnauthorizedPresale();
    error PaymentAlreadyExists(uint256 purchaseId);
    error PaymentNotCollected(uint256 purchaseId);
    error PaymentDetailsMismatch(uint256 purchaseId);
    error PaymentAmountMismatch(uint256 expected, uint256 received);
    error TreasuryUnchanged();
    error TreasuryTransferPending();
    error UnauthorizedTreasuryAcceptance();
    error NoPendingTreasury();
    error PaymentTokenRecoveryForbidden();
    error OwnershipRenunciationDisabled();

    event PresaleConfigured(address indexed presale);
    event PaymentCollected(uint256 indexed purchaseId, address indexed buyer, uint256 amount);
    event PaymentRefunded(uint256 indexed purchaseId, address indexed buyer, uint256 amount);
    event PaymentReleased(uint256 indexed purchaseId, address indexed buyer, address indexed treasury, uint256 amount);
    event TreasuryTransferStarted(address indexed previousTreasury, address indexed proposedTreasury);
    event TreasuryTransferCancelled(address indexed activeTreasury, address indexed cancelledTreasury);
    event TreasuryTransferred(address indexed previousTreasury, address indexed newTreasury);
    event ForeignTokenRecovered(address indexed token, address indexed treasury, uint256 amount);

    modifier onlyPresale() {
        if (msg.sender != presale) revert UnauthorizedPresale();
        _;
    }

    constructor(address usdc_, address admin, address treasury_) Ownable(admin) {
        if (usdc_ == address(0) || admin == address(0) || treasury_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        treasury = treasury_;
    }

    function paymentToken() external view returns (address) {
        return address(usdc);
    }

    /// @notice Permanently binds this custody instance to its single presale round.
    function setPresale(address presale_) external onlyOwner {
        if (presale_ == address(0)) revert ZeroAddress();
        if (presale != address(0)) revert PresaleAlreadySet();
        if (
            IULIQPresaleRoundCustodyBinding(presale_).usdc() != address(usdc)
                || IULIQPresaleRoundCustodyBinding(presale_).paymentCustody() != address(this)
        ) revert InvalidPresaleBinding();
        presale = presale_;
        emit PresaleConfigured(presale_);
    }

    function collectFrom(uint256 purchaseId, address buyer, uint256 amount) external onlyPresale nonReentrant {
        if (buyer == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        Payment storage payment = payments[purchaseId];
        if (payment.state != PaymentState.NONE) revert PaymentAlreadyExists(purchaseId);

        uint256 balanceBefore = usdc.balanceOf(address(this));
        payment.buyer = buyer;
        payment.amount = amount;
        payment.state = PaymentState.COLLECTED;
        totalCollected += amount;
        usdc.safeTransferFrom(buyer, address(this), amount);
        uint256 received = usdc.balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert PaymentAmountMismatch(amount, received);
        emit PaymentCollected(purchaseId, buyer, amount);
    }

    function refundTo(uint256 purchaseId, address buyer, uint256 amount) external onlyPresale nonReentrant {
        Payment storage payment = _requireCollectedPayment(purchaseId, buyer, amount);
        payment.state = PaymentState.REFUNDED;
        totalRefunded += amount;
        usdc.safeTransfer(buyer, amount);
        emit PaymentRefunded(purchaseId, buyer, amount);
    }

    function releaseToTreasury(uint256 purchaseId, address buyer, uint256 amount)
        external
        onlyPresale
        nonReentrant
    {
        Payment storage payment = _requireCollectedPayment(purchaseId, buyer, amount);
        payment.state = PaymentState.RELEASED;
        totalReleased += amount;
        address recipient = treasury;
        usdc.safeTransfer(recipient, amount);
        emit PaymentReleased(purchaseId, buyer, recipient, amount);
    }

    function proposeTreasury(address proposedTreasury) external onlyOwner {
        if (proposedTreasury == address(0)) revert ZeroAddress();
        if (proposedTreasury == treasury) revert TreasuryUnchanged();
        if (pendingTreasury != address(0)) revert TreasuryTransferPending();
        pendingTreasury = proposedTreasury;
        emit TreasuryTransferStarted(treasury, proposedTreasury);
    }

    function acceptTreasury() external {
        address proposedTreasury = pendingTreasury;
        if (proposedTreasury == address(0)) revert NoPendingTreasury();
        if (msg.sender != proposedTreasury) revert UnauthorizedTreasuryAcceptance();
        address previousTreasury = treasury;
        treasury = proposedTreasury;
        pendingTreasury = address(0);
        emit TreasuryTransferred(previousTreasury, proposedTreasury);
    }

    function cancelTreasuryTransfer() external onlyOwner {
        address proposedTreasury = pendingTreasury;
        if (proposedTreasury == address(0)) revert NoPendingTreasury();
        pendingTreasury = address(0);
        emit TreasuryTransferCancelled(treasury, proposedTreasury);
    }

    /// @notice Recovers only tokens other than the configured payment token to the active treasury.
    function recoverForeignToken(address token, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (token == address(usdc)) revert PaymentTokenRecoveryForbidden();
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransfer(treasury, amount);
        emit ForeignTokenRecovered(token, treasury, amount);
    }

    function renounceOwnership() public view override onlyOwner {
        revert OwnershipRenunciationDisabled();
    }

    function balance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function accountedBalance() public view returns (uint256) {
        return totalCollected - totalRefunded - totalReleased;
    }

    function surplusBalance() external view returns (uint256) {
        uint256 tokenBalance = usdc.balanceOf(address(this));
        uint256 accounted = accountedBalance();
        return tokenBalance > accounted ? tokenBalance - accounted : 0;
    }

    function _requireCollectedPayment(uint256 purchaseId, address buyer, uint256 amount)
        private
        view
        returns (Payment storage payment)
    {
        payment = payments[purchaseId];
        if (payment.state != PaymentState.COLLECTED) revert PaymentNotCollected(purchaseId);
        if (payment.buyer != buyer || payment.amount != amount) revert PaymentDetailsMismatch(purchaseId);
    }
}

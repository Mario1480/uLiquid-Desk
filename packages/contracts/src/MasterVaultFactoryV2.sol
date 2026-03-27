// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MasterVaultV2} from "./MasterVaultV2.sol";

contract MasterVaultFactoryV2 {
  address public immutable owner;
  address public immutable usdc;
  address public treasuryRecipient;
  uint256 public profitShareFeeRatePct;
  mapping(address => address) public masterVaultOf;

  event MasterVaultCreated(address indexed owner, address indexed masterVault);
  event TreasuryRecipientUpdated(address indexed previousRecipient, address indexed nextRecipient);
  event ProfitShareFeeRateUpdated(uint256 previousRatePct, uint256 nextRatePct);

  modifier onlyOwner() {
    require(msg.sender == owner, "only_owner");
    _;
  }

  constructor(address owner_, address usdc_, address treasuryRecipient_, uint256 profitShareFeeRatePct_) {
    require(owner_ != address(0), "owner_required");
    require(usdc_ != address(0), "usdc_required");
    require(treasuryRecipient_ != address(0), "treasury_recipient_required");
    require(profitShareFeeRatePct_ <= 100, "invalid_profit_share_fee_rate");
    owner = owner_;
    usdc = usdc_;
    treasuryRecipient = treasuryRecipient_;
    profitShareFeeRatePct = profitShareFeeRatePct_;
  }

  function factoryVersion() external pure returns (string memory) {
    return "v2";
  }

  function createMasterVault(address vaultOwner) external returns (address masterVault) {
    require(vaultOwner != address(0), "owner_required");
    require(masterVaultOf[vaultOwner] == address(0), "master_vault_exists");
    MasterVaultV2 vault = new MasterVaultV2(vaultOwner, usdc, address(this));
    masterVault = address(vault);
    masterVaultOf[vaultOwner] = masterVault;
    emit MasterVaultCreated(vaultOwner, masterVault);
  }

  function setTreasuryRecipient(address nextRecipient) external onlyOwner {
    require(nextRecipient != address(0), "treasury_recipient_required");
    address previousRecipient = treasuryRecipient;
    treasuryRecipient = nextRecipient;
    emit TreasuryRecipientUpdated(previousRecipient, nextRecipient);
  }

  function setProfitShareFeeRatePct(uint256 nextRatePct) external onlyOwner {
    require(nextRatePct <= 100, "invalid_profit_share_fee_rate");
    uint256 previousRatePct = profitShareFeeRatePct;
    profitShareFeeRatePct = nextRatePct;
    emit ProfitShareFeeRateUpdated(previousRatePct, nextRatePct);
  }
}

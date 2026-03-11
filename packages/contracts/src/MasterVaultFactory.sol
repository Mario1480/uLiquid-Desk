// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MasterVault} from "./MasterVault.sol";

contract MasterVaultFactory {
  address public immutable owner;
  address public immutable usdc;
  address public treasuryRecipient;
  mapping(address => address) public masterVaultOf;

  event MasterVaultCreated(address indexed owner, address indexed masterVault);
  event TreasuryRecipientUpdated(address indexed previousRecipient, address indexed nextRecipient);

  modifier onlyOwner() {
    require(msg.sender == owner, "only_owner");
    _;
  }

  constructor(address owner_, address usdc_, address treasuryRecipient_) {
    require(owner_ != address(0), "owner_required");
    require(usdc_ != address(0), "usdc_required");
    require(treasuryRecipient_ != address(0), "treasury_recipient_required");
    owner = owner_;
    usdc = usdc_;
    treasuryRecipient = treasuryRecipient_;
  }

  function createMasterVault(address owner) external returns (address masterVault) {
    require(owner != address(0), "owner_required");
    require(masterVaultOf[owner] == address(0), "master_vault_exists");
    MasterVault vault = new MasterVault(owner, usdc, address(this));
    masterVault = address(vault);
    masterVaultOf[owner] = masterVault;
    emit MasterVaultCreated(owner, masterVault);
  }

  function setTreasuryRecipient(address nextRecipient) external onlyOwner {
    require(nextRecipient != address(0), "treasury_recipient_required");
    address previousRecipient = treasuryRecipient;
    treasuryRecipient = nextRecipient;
    emit TreasuryRecipientUpdated(previousRecipient, nextRecipient);
  }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {MasterVaultV2} from "./MasterVaultV2.sol";

contract MasterVaultFactoryV2 {
  address public immutable owner;
  address public immutable usdc;
  address public immutable masterVaultImplementation;
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

  constructor(
    address owner_,
    address usdc_,
    address masterVaultImplementation_,
    address treasuryRecipient_,
    uint256 profitShareFeeRatePct_
  ) {
    require(owner_ != address(0), "owner_required");
    require(usdc_ != address(0), "usdc_required");
    require(masterVaultImplementation_ != address(0), "implementation_required");
    require(treasuryRecipient_ != address(0), "treasury_recipient_required");
    require(profitShareFeeRatePct_ <= 100, "invalid_profit_share_fee_rate");
    owner = owner_;
    usdc = usdc_;
    masterVaultImplementation = masterVaultImplementation_;
    treasuryRecipient = treasuryRecipient_;
    profitShareFeeRatePct = profitShareFeeRatePct_;
  }

  function factoryVersion() external pure returns (string memory) {
    return "v2";
  }

  function createMasterVault(address vaultOwner) external returns (address masterVault) {
    require(vaultOwner != address(0), "owner_required");
    require(masterVaultOf[vaultOwner] == address(0), "master_vault_exists");
    masterVault = _clone(masterVaultImplementation);
    MasterVaultV2(masterVault).initialize(vaultOwner, usdc, address(this));
    masterVaultOf[vaultOwner] = masterVault;
    emit MasterVaultCreated(vaultOwner, masterVault);
  }

  function _clone(address implementation) private returns (address instance) {
    bytes memory initCode = abi.encodePacked(
      hex"3d602d80600a3d3981f3",
      hex"363d3d373d3d3d363d73",
      bytes20(implementation),
      hex"5af43d82803e903d91602b57fd5bf3"
    );
    assembly {
      instance := create(0, add(initCode, 0x20), mload(initCode))
    }
    require(instance != address(0), "clone_create_failed");
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

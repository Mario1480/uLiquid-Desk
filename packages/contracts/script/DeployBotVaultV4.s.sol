// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ScriptBase} from "./ScriptBase.sol";
import {BotVaultFactoryV4} from "../src/BotVaultFactoryV4.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract DeployBotVaultV4 is ScriptBase {
  address internal constant DEFAULT_CORE_DEPOSIT_WALLET = 0x6B9E773128f453f5c2C60935Ee2DE2CBc5390A24;

  event DeploymentBotVaultV4Completed(
    address indexed owner,
    address indexed usdc,
    address treasuryRecipient,
    address indexed factory,
    bool deployedMockUsdc
  );

  function runLocal(address owner) external returns (address usdc, address factory) {
    return _run(owner, address(0), true);
  }

  function runDevnet(address owner, address usdc) external returns (address factory) {
    (, address deployedFactory) = _run(owner, usdc, false);
    return deployedFactory;
  }

  function _run(address owner, address usdc, bool deployMockUsdc)
    private
    returns (address resolvedUsdc, address factory)
  {
    vm.startBroadcast();
    address resolvedOwner = owner == address(0) ? msg.sender : owner;
    if (deployMockUsdc) {
      MockUSDC mock = new MockUSDC();
      resolvedUsdc = address(mock);
      mock.mint(resolvedOwner, 1_000_000_000_000);
    } else {
      require(usdc != address(0), "usdc_required");
      require(usdc.code.length > 0, "usdc_not_contract");
      resolvedUsdc = usdc;
    }

    BotVaultFactoryV4 deployedFactory = new BotVaultFactoryV4(
      resolvedUsdc,
      DEFAULT_CORE_DEPOSIT_WALLET,
      resolvedOwner
    );
    if (resolvedOwner != msg.sender) {
      deployedFactory.transferOwnership(resolvedOwner);
    }
    require(deployedFactory.usdc() == resolvedUsdc, "factory_usdc_mismatch");
    require(deployedFactory.coreDepositWallet() == DEFAULT_CORE_DEPOSIT_WALLET, "core_deposit_wallet_mismatch");
    require(deployedFactory.owner() == resolvedOwner, "factory_owner_mismatch");
    require(deployedFactory.treasuryRecipient() == resolvedOwner, "treasury_recipient_mismatch");
    vm.stopBroadcast();

    emit DeploymentBotVaultV4Completed(
      resolvedOwner,
      resolvedUsdc,
      resolvedOwner,
      address(deployedFactory),
      deployMockUsdc
    );
    return (resolvedUsdc, address(deployedFactory));
  }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ScriptBase} from "./ScriptBase.sol";
import {FundingVaultFactoryV1} from "../src/FundingVaultFactoryV1.sol";

contract DeployFundingVaultFactoryV1 is ScriptBase {
    event DeploymentFundingVaultFactoryV1Completed(
        address indexed usdc, address indexed botVaultFactory, address indexed fundingVaultFactory
    );

    function runProd(address usdc, address botVaultFactory) external returns (address fundingVaultFactory) {
        require(usdc != address(0), "usdc_required");
        require(botVaultFactory != address(0), "bot_vault_factory_required");
        require(usdc.code.length > 0, "usdc_not_contract");
        require(botVaultFactory.code.length > 0, "bot_vault_factory_not_contract");

        vm.startBroadcast();
        FundingVaultFactoryV1 deployedFactory = new FundingVaultFactoryV1(usdc, botVaultFactory);
        vm.stopBroadcast();

        fundingVaultFactory = address(deployedFactory);
        require(deployedFactory.usdc() == usdc, "factory_usdc_mismatch");
        require(deployedFactory.botVaultFactory() == botVaultFactory, "bot_vault_factory_mismatch");

        emit DeploymentFundingVaultFactoryV1Completed(usdc, botVaultFactory, fundingVaultFactory);
    }
}

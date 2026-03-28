// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {MasterVaultFactoryV2} from "../src/MasterVaultFactoryV2.sol";
import {MasterVaultV2} from "../src/MasterVaultV2.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

interface Vm {
  function etch(address target, bytes calldata code) external;
}

contract MockHyperCoreWriter {
  bytes public lastData;
  uint256 public calls;

  function sendRawAction(bytes calldata data) external payable {
    lastData = data;
    calls += 1;
  }
}

contract MasterVaultV2HyperCoreTest {
  Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
  address internal constant HYPERCORE_WRITER = 0x3333333333333333333333333333333333333333;

  function _setup() private returns (MasterVaultV2 masterVault, address botVault, MockHyperCoreWriter writer) {
    MockHyperCoreWriter deployedWriter = new MockHyperCoreWriter();
    vm.etch(HYPERCORE_WRITER, address(deployedWriter).code);
    writer = MockHyperCoreWriter(HYPERCORE_WRITER);

    MockUSDC usdc = new MockUSDC();
    MasterVaultFactoryV2 factory =
      new MasterVaultFactoryV2(address(this), address(usdc), address(new MasterVaultV2()), address(0xBEEF), 30);
    address masterVaultAddress = factory.createMasterVault(address(this));
    masterVault = MasterVaultV2(masterVaultAddress);

    usdc.mint(address(this), 500_000_000);
    bool approved = usdc.approve(address(masterVault), 500_000_000);
    require(approved, "approve_failed");
    masterVault.deposit(address(usdc), 500_000_000);

    botVault = masterVault.createBotVault(bytes32("futures_grid"), address(0xA9137));
    masterVault.allocateToBotVault(botVault, 100_000_000);
  }

  function testOwnerCanFundBotVaultOnHyperCore() public {
    (MasterVaultV2 masterVault, address botVault, MockHyperCoreWriter writer) = _setup();

    masterVault.fundBotVaultOnHyperCore(botVault, 73_000_000);

    require(writer.calls() == 1, "writer_not_called");
    bytes memory expected = abi.encodePacked(
      bytes1(uint8(1)),
      bytes3(uint24(2)),
      abi.encode(botVault, true, uint64(73_000_000))
    );
    require(keccak256(writer.lastData()) == keccak256(expected), "encoded_vault_transfer_mismatch");
  }
}

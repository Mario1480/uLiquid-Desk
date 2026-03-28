// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MasterVaultFactoryV2} from "../src/MasterVaultFactoryV2.sol";
import {MasterVaultV2} from "../src/MasterVaultV2.sol";
import {BotVaultV2} from "../src/BotVaultV2.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

interface Vm {
  function prank(address msgSender) external;
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

contract BotVaultV2HyperCoreTest {
  Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
  address internal constant HYPERCORE_WRITER = 0x3333333333333333333333333333333333333333;
  address internal constant AGENT = address(0xA9137);
  address internal constant NEXT_AGENT = address(0xA9138);

  function _setup() private returns (MasterVaultV2 masterVault, BotVaultV2 botVault, MockHyperCoreWriter writer) {
    MockHyperCoreWriter deployedWriter = new MockHyperCoreWriter();
    vm.etch(HYPERCORE_WRITER, address(deployedWriter).code);
    writer = MockHyperCoreWriter(HYPERCORE_WRITER);

    MockUSDC usdc = new MockUSDC();
    MasterVaultFactoryV2 factory = new MasterVaultFactoryV2(address(this), address(usdc), address(0xBEEF), 30);
    address masterVaultAddress = factory.createMasterVault(address(this));
    masterVault = MasterVaultV2(masterVaultAddress);

    usdc.mint(address(this), 500_000_000);
    bool approved = usdc.approve(address(masterVault), 500_000_000);
    require(approved, "approve_failed");
    masterVault.deposit(address(usdc), 500_000_000);

    address botVaultAddress = masterVault.createBotVault(bytes32("futures_grid"), AGENT);
    masterVault.allocateToBotVault(botVaultAddress, 100_000_000);
    botVault = BotVaultV2(botVaultAddress);
  }

  function testAgentCanForwardLimitOrderViaCoreWriter() public {
    (MasterVaultV2 masterVault, BotVaultV2 botVault, MockHyperCoreWriter writer) = _setup();
    require(botVault.agentWallet() == AGENT, "agent_not_set");
    require(address(masterVault) != address(0), "master_missing");

    vm.prank(AGENT);
    botVault.placeHyperCoreLimitOrder(7, true, 6_600_000_000, 100_000_000, false, 2, 0);

    require(writer.calls() == 1, "writer_not_called");
    bytes memory expected = abi.encodePacked(
      bytes1(uint8(1)),
      bytes3(uint24(1)),
      abi.encode(uint32(7), true, uint64(6_600_000_000), uint64(100_000_000), false, uint8(2), uint128(0))
    );
    require(keccak256(writer.lastData()) == keccak256(expected), "encoded_limit_order_mismatch");
  }

  function testCloseOnlyRequiresReduceOnlyForLimitOrders() public {
    (MasterVaultV2 masterVault, BotVaultV2 botVault,) = _setup();
    masterVault.setBotVaultCloseOnly(address(botVault));

    vm.prank(AGENT);
    (bool ok,) = address(botVault).call(
      abi.encodeWithSelector(
        BotVaultV2.placeHyperCoreLimitOrder.selector,
        uint32(7),
        true,
        uint64(6_600_000_000),
        uint64(100_000_000),
        false,
        uint8(2),
        uint128(0)
      )
    );
    require(!ok, "close_only_non_reduce_order_should_revert");

    vm.prank(AGENT);
    botVault.placeHyperCoreLimitOrder(7, false, 6_500_000_000, 100_000_000, true, 3, 123);
  }

  function testOwnerCanRotateAgentAndNewAgentCanCancelByCloid() public {
    (MasterVaultV2 masterVault, BotVaultV2 botVault, MockHyperCoreWriter writer) = _setup();
    masterVault.setBotVaultAgentWallet(address(botVault), NEXT_AGENT);
    require(botVault.agentWallet() == NEXT_AGENT, "agent_rotation_failed");

    vm.prank(NEXT_AGENT);
    botVault.cancelHyperCoreOrderByCloid(7, 987654321);

    require(writer.calls() == 1, "writer_not_called_after_rotation");
    bytes memory expected = abi.encodePacked(
      bytes1(uint8(1)),
      bytes3(uint24(11)),
      abi.encode(uint32(7), uint128(987654321))
    );
    require(keccak256(writer.lastData()) == keccak256(expected), "encoded_cancel_cloid_mismatch");
  }
}

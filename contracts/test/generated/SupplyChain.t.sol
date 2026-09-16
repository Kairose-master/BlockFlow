// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/SupplyChain.sol";

// 자동 생성 — BlockFlow codegen (IR → Foundry 테스트). 손으로 고치지 말고 IR/템플릿을 고친 뒤 다시 생성할 것.

/// @dev 무작위 역할 계정이 무작위 태스크를 호출한다. 거부는 정상이다 (fail_on_revert = false).
contract SupplyChainHandler is Test {
    SupplyChain p;
    address[4] acc;

    constructor(SupplyChain _p, address[4] memory _acc) {
        p = _p;
        acc = _acc;
    }

    function create() external {
        p.createInstance(acc);
    }

    function ship(uint256 id, bytes32 shipmentHash, uint256 qty, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 4]);
        try p.ship(id, shipmentHash, qty) {} catch {}
    }

    function deliver(uint256 id, bytes32 trackingHash, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 4]);
        try p.deliver(id, trackingHash) {} catch {}
    }

    function inspect(uint256 id, bool accepted, uint256 receivedQty, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 4]);
        try p.inspect(id, accepted, receivedQty) {} catch {}
    }

    function pay(uint256 id, bytes32 paymentRef, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 4]);
        try p.pay(id, paymentRef) {} catch {}
    }

    function raiseClaim(uint256 id, bytes32 claimHash, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 4]);
        try p.raiseClaim(id, claimHash) {} catch {}
    }
}

contract SupplyChainInvariants is Test {
    SupplyChain p;
    SupplyChainHandler h;
    uint256 constant ALL_FLOWS = 0xff; // IR flows 집합

    function setUp() public {
        address[4] memory acc = [address(uint160(161)), address(uint160(162)), address(uint160(163)), address(uint160(164))];
        p = new SupplyChain(address(this));
        h = new SupplyChainHandler(p, acc);
        targetContract(address(h));
    }

    /// 모든 인스턴스의 marking 은 알려진 플로우 비트만 갖는다
    function invariant_noGhostTokens() public view {
        for (uint256 id = 1; id <= p.instanceCount(); id++) {
            (uint256 m,,) = p.instances(id);
            assertEq(m & ~ALL_FLOWS, 0);
        }
    }

    /// 종료된 인스턴스는 토큰이 없다 (proper completion)
    function invariant_endedMeansEmpty() public view {
        for (uint256 id = 1; id <= p.instanceCount(); id++) {
            (uint256 m, bool ended,) = p.instances(id);
            if (ended) assertEq(m, 0);
        }
    }

    /// 종료되지 않은 인스턴스는 항상 활성 태스크가 있다 (데드락 없음)
    function invariant_noDeadlock() public view {
        for (uint256 id = 1; id <= p.instanceCount(); id++) {
            (uint256 m, bool ended,) = p.instances(id);
            if (!ended) {
                assertTrue(m != 0);
                assertTrue(p.enabledTasks(id) != 0);
            }
        }
    }

    /// 1-safe: XOR 분기의 두 가지는 동시에 토큰을 가질 수 없다
    function invariant_xorExclusive() public view {
        for (uint256 id = 1; id <= p.instanceCount(); id++) {
            (uint256 m,,) = p.instances(id);
            assertTrue((m & 0x10) == 0 || (m & 0x20) == 0); // X1
        }
    }
}

/// @dev V2 BFS 도달 경로마다 시나리오 1개. 활성화 전 실행·권한 없는 실행·종료 후 실행은 커스텀 에러로 거부돼야 한다.
contract SupplyChainScenarios is Test {
    SupplyChain p;
    address owner = address(0x01);
    address stranger = address(0xBAD);
    address accSupplier = address(uint160(161));
    address accCarrier = address(uint160(162));
    address accBuyer = address(uint160(163));
    address accFinance = address(uint160(164));
    bytes32 ROLE_SUPPLIER;
    bytes32 ROLE_CARRIER;
    bytes32 ROLE_BUYER;
    bytes32 ROLE_FINANCE;
    uint8 TASK_SHIP;
    uint8 TASK_DELIVER;
    uint8 TASK_INSPECT;
    uint8 TASK_PAY;
    uint8 TASK_CLAIM;

    function setUp() public {
        p = new SupplyChain(owner);
        // vm.prank 는 다음 외부 호출 1개에만 적용되므로 상수 getter 는 미리 읽어 둔다.
        ROLE_SUPPLIER = p.ROLE_SUPPLIER();
        ROLE_CARRIER = p.ROLE_CARRIER();
        ROLE_BUYER = p.ROLE_BUYER();
        ROLE_FINANCE = p.ROLE_FINANCE();
        TASK_SHIP = p.TASK_SHIP();
        TASK_DELIVER = p.TASK_DELIVER();
        TASK_INSPECT = p.TASK_INSPECT();
        TASK_PAY = p.TASK_PAY();
        TASK_CLAIM = p.TASK_CLAIM();
    }

    function _create() internal returns (uint256 id) {
        id = p.createInstance([accSupplier, accCarrier, accBuyer, accFinance]);
    }

    function _marking(uint256 id) internal view returns (uint256 m, bool ended) {
        (m, ended,) = p.instances(id);
    }

    /// 경로 1: ship → deliver → inspect → raiseClaim | X1→F6 → disputed
    function test_path_1() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(SupplyChain.NotAuthorized.selector, id, ROLE_SUPPLIER));
        p.ship(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 0);
        vm.prank(accCarrier);
        vm.expectRevert(abi.encodeWithSelector(SupplyChain.TaskNotEnabled.selector, id, TASK_DELIVER));
        p.deliver(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000));
        vm.prank(accSupplier);
        p.ship(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x2);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(SupplyChain.NotAuthorized.selector, id, ROLE_CARRIER));
        p.deliver(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000021));
        vm.prank(accSupplier);
        vm.expectRevert(abi.encodeWithSelector(SupplyChain.TaskNotEnabled.selector, id, TASK_SHIP));
        p.ship(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accCarrier);
        p.deliver(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000021));
        (m, ended) = _marking(id);
        assertEq(m, 0x4);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(SupplyChain.NotAuthorized.selector, id, ROLE_BUYER));
        p.inspect(id, false, 0);
        vm.prank(accSupplier);
        vm.expectRevert(abi.encodeWithSelector(SupplyChain.TaskNotEnabled.selector, id, TASK_SHIP));
        p.ship(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accBuyer);
        p.inspect(id, false, 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x20);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(SupplyChain.NotAuthorized.selector, id, ROLE_BUYER));
        p.raiseClaim(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000061));
        vm.prank(accSupplier);
        vm.expectRevert(abi.encodeWithSelector(SupplyChain.TaskNotEnabled.selector, id, TASK_SHIP));
        p.ship(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accBuyer);
        p.raiseClaim(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000061));
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accSupplier);
        vm.expectRevert(abi.encodeWithSelector(SupplyChain.AlreadyEnded.selector, id));
        p.ship(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
    }

    /// 경로 2: ship → deliver → inspect → pay | X1→F5 → completed
    function test_path_2() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(SupplyChain.NotAuthorized.selector, id, ROLE_SUPPLIER));
        p.ship(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 0);
        vm.prank(accCarrier);
        vm.expectRevert(abi.encodeWithSelector(SupplyChain.TaskNotEnabled.selector, id, TASK_DELIVER));
        p.deliver(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000));
        vm.prank(accSupplier);
        p.ship(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x2);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(SupplyChain.NotAuthorized.selector, id, ROLE_CARRIER));
        p.deliver(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000021));
        vm.prank(accSupplier);
        vm.expectRevert(abi.encodeWithSelector(SupplyChain.TaskNotEnabled.selector, id, TASK_SHIP));
        p.ship(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accCarrier);
        p.deliver(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000021));
        (m, ended) = _marking(id);
        assertEq(m, 0x4);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(SupplyChain.NotAuthorized.selector, id, ROLE_BUYER));
        p.inspect(id, true, 0);
        vm.prank(accSupplier);
        vm.expectRevert(abi.encodeWithSelector(SupplyChain.TaskNotEnabled.selector, id, TASK_SHIP));
        p.ship(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accBuyer);
        p.inspect(id, true, 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x10);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(SupplyChain.NotAuthorized.selector, id, ROLE_FINANCE));
        p.pay(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000051));
        vm.prank(accSupplier);
        vm.expectRevert(abi.encodeWithSelector(SupplyChain.TaskNotEnabled.selector, id, TASK_SHIP));
        p.ship(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accFinance);
        p.pay(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000051));
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accSupplier);
        vm.expectRevert(abi.encodeWithSelector(SupplyChain.AlreadyEnded.selector, id));
        p.ship(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/FxTransfer.sol";

// 자동 생성 — BlockFlow codegen (IR → Foundry 테스트). 손으로 고치지 말고 IR/템플릿을 고친 뒤 다시 생성할 것.

/// @dev 무작위 역할 계정이 무작위 태스크를 호출한다. 거부는 정상이다 (fail_on_revert = false).
contract FxTransferHandler is Test {
    FxTransfer p;
    address[2] acc;

    constructor(FxTransfer _p, address[2] memory _acc) {
        p = _p;
        acc = _acc;
    }

    function create() external {
        p.createInstance(acc);
    }

    function request(uint256 id, uint256 amountUsd, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 2]);
        try p.request(id, amountUsd) {} catch {}
    }

    function fetchRate(uint256 id, uint256 rateKrw, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(who % 2 == 0 ? p.oracle() : acc[who % 2]);
        try p.fetchRate(id, rateKrw) {} catch {}
    }

    function send_(uint256 id, bytes32 txRef, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 2]);
        try p.send_(id, txRef) {} catch {}
    }
}

contract FxTransferInvariants is Test {
    FxTransfer p;
    FxTransferHandler h;
    uint256 constant ALL_FLOWS = 0x3f; // IR flows 집합

    function setUp() public {
        address[2] memory acc = [address(uint160(161)), address(uint160(162))];
        p = new FxTransfer(address(this));
        h = new FxTransferHandler(p, acc);
        targetContract(address(h));
        p.setOracle(address(0xACC0));
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
            assertTrue((m & 0x8) == 0 || (m & 0x10) == 0); // X1
        }
    }
}

/// @dev V2 BFS 도달 경로마다 시나리오 1개. 활성화 전 실행·권한 없는 실행·종료 후 실행은 커스텀 에러로 거부돼야 한다.
contract FxTransferScenarios is Test {
    FxTransfer p;
    address owner = address(0x01);
    address stranger = address(0xBAD);
    address accOracle = address(0xACC0);
    address accRequester = address(uint160(161));
    address accFinance = address(uint160(162));
    bytes32 ROLE_REQUESTER;
    bytes32 ROLE_FINANCE;
    uint8 TASK_REQUEST;
    uint8 TASK_RATE;
    uint8 TASK_SEND;

    function setUp() public {
        p = new FxTransfer(owner);
        vm.prank(owner);
        p.setOracle(accOracle);
        // vm.prank 는 다음 외부 호출 1개에만 적용되므로 상수 getter 는 미리 읽어 둔다.
        ROLE_REQUESTER = p.ROLE_REQUESTER();
        ROLE_FINANCE = p.ROLE_FINANCE();
        TASK_REQUEST = p.TASK_REQUEST();
        TASK_RATE = p.TASK_RATE();
        TASK_SEND = p.TASK_SEND();
    }

    function _create() internal returns (uint256 id) {
        id = p.createInstance([accRequester, accFinance]);
    }

    function _marking(uint256 id) internal view returns (uint256 m, bool ended) {
        (m, ended,) = p.instances(id);
    }

    /// 경로 1: request → fetchRate | X1→F5 → error
    function test_path_1() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(FxTransfer.NotAuthorized.selector, id, ROLE_REQUESTER));
        p.request(id, 0);
        vm.prank(accOracle);
        vm.expectRevert(abi.encodeWithSelector(FxTransfer.TaskNotEnabled.selector, id, TASK_RATE));
        p.fetchRate(id, 0);
        vm.prank(accRequester);
        p.request(id, 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x2);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(FxTransfer.NotOracle.selector));
        p.fetchRate(id, 0);
        vm.prank(accRequester);
        vm.expectRevert(abi.encodeWithSelector(FxTransfer.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, 0);
        vm.prank(accOracle);
        p.fetchRate(id, 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accRequester);
        vm.expectRevert(abi.encodeWithSelector(FxTransfer.AlreadyEnded.selector, id));
        p.request(id, 0);
    }

    /// 경로 2: request → fetchRate → send_ | X1→F4 → completed
    function test_path_2() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(FxTransfer.NotAuthorized.selector, id, ROLE_REQUESTER));
        p.request(id, 0);
        vm.prank(accOracle);
        vm.expectRevert(abi.encodeWithSelector(FxTransfer.TaskNotEnabled.selector, id, TASK_RATE));
        p.fetchRate(id, 0);
        vm.prank(accRequester);
        p.request(id, 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x2);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(FxTransfer.NotOracle.selector));
        p.fetchRate(id, 1);
        vm.prank(accRequester);
        vm.expectRevert(abi.encodeWithSelector(FxTransfer.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, 0);
        vm.prank(accOracle);
        p.fetchRate(id, 1);
        (m, ended) = _marking(id);
        assertEq(m, 0x8);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(FxTransfer.NotAuthorized.selector, id, ROLE_FINANCE));
        p.send_(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000021));
        vm.prank(accRequester);
        vm.expectRevert(abi.encodeWithSelector(FxTransfer.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, 0);
        vm.prank(accFinance);
        p.send_(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000021));
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accRequester);
        vm.expectRevert(abi.encodeWithSelector(FxTransfer.AlreadyEnded.selector, id));
        p.request(id, 0);
    }
}

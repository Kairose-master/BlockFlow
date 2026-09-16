// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ExpenseApproval.sol";

/// @dev 가이드 부록 D — 생성기가 IR 에서 만들어 낼 불변식 테스트의 손으로 쓴 참조본.
///      Handler 는 무작위 역할 계정이 무작위 태스크를 호출한다 (거부는 정상: fail_on_revert = false).
contract Handler is Test {
    ExpenseApproval p;
    address[3] acc;

    constructor(ExpenseApproval _p, address[3] memory _acc) {
        p = _p;
        acc = _acc;
    }

    function create() external {
        p.createInstance(acc);
    }

    function submit(uint256 id, uint256 amt, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 3]);
        try p.submit(id, amt) {} catch {}
    }

    function approve(uint256 id, bool ok, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 3]);
        try p.approve(id, ok) {} catch {}
    }

    function pay(uint256 id, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 3]);
        try p.pay(id) {} catch {}
    }

    function uploadReceipt(uint256 id, bytes32 h, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 3]);
        try p.uploadReceipt(id, h) {} catch {}
    }
}

contract ExpenseApprovalInvariants is Test {
    ExpenseApproval p;
    Handler h;
    uint256 constant ALL_FLOWS = (1 << 12) - 1; // IR flows 집합 (생성기가 채움)

    function setUp() public {
        address[3] memory acc = [address(0xA1), address(0xB2), address(0xC3)];
        p = new ExpenseApproval(address(this));
        h = new Handler(p, acc);
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

    /// 1-safe: AND 분기 뒤 두 가지(F6,F7) 는 동시에 있을 수 있지만, XOR 양 가지(F3,F4) 는 동시에 없다
    function invariant_xorExclusive() public view {
        for (uint256 id = 1; id <= p.instanceCount(); id++) {
            (uint256 m,,) = p.instances(id);
            assertTrue((m & (1 << 2)) == 0 || (m & (1 << 3)) == 0);
        }
    }

    /// 종료되지 않은 인스턴스는 항상 활성 태스크가 있거나 아직 시작 전이다 (데드락 없음)
    function invariant_noDeadlock() public view {
        for (uint256 id = 1; id <= p.instanceCount(); id++) {
            (uint256 m, bool ended,) = p.instances(id);
            if (!ended) {
                assertTrue(m != 0);
                assertTrue(p.enabledTasks(id) != 0);
            }
        }
    }
}

/// @dev 가이드 7.6 의 17개 트랜잭션 시나리오 (V2 BFS 도달 경로 = 승인 / 소액 우회 / 반려).
contract ExpenseApprovalScenarios is Test {
    ExpenseApproval p;
    address owner = address(0x01);
    address requester = address(0xA1);
    address manager = address(0xB2);
    address finance = address(0xC3);
    address stranger = address(0xD4);

    uint256 constant F1 = 1 << 0;
    uint256 constant F3 = 1 << 2;
    uint256 constant F6 = 1 << 5;
    uint256 constant F7 = 1 << 6;
    uint256 constant F8 = 1 << 7;
    uint256 constant F9 = 1 << 8;

    function setUp() public {
        p = new ExpenseApproval(owner);
    }

    function _create() internal returns (uint256 id) {
        id = p.createInstance([requester, manager, finance]);
    }

    function _marking(uint256 id) internal view returns (uint256 m, bool ended) {
        (m, ended,) = p.instances(id);
    }

    function test_path_approved() public {
        uint256 id = _create();
        (uint256 m,) = _marking(id);
        assertEq(m, F1);
        assertEq(p.enabledTasks(id), 1 << p.TASK_SUBMIT());

        vm.prank(manager);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.TaskNotEnabled.selector, id, 2));
        p.approve(id, true);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.NotAuthorized.selector, id, p.ROLE_REQUESTER()));
        p.submit(id, 5000);

        vm.prank(requester);
        p.submit(id, 5000);
        (m,) = _marking(id);
        assertEq(m, F3);

        vm.prank(finance);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.TaskNotEnabled.selector, id, 3));
        p.pay(id);

        vm.prank(manager);
        p.approve(id, true);
        (m,) = _marking(id);
        assertEq(m, F6 | F7);
        assertEq(p.enabledTasks(id), (1 << p.TASK_PAY()) | (1 << p.TASK_RECEIPT()));

        vm.prank(requester);
        p.uploadReceipt(id, keccak256("receipt"));
        (m,) = _marking(id);
        assertEq(m, F6 | F9);

        vm.prank(finance);
        vm.expectEmit(true, false, false, true);
        emit ExpenseApproval.InstanceEnded(id, true);
        p.pay(id);
        bool ended;
        (m, ended) = _marking(id);
        assertEq(m, 0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);

        vm.prank(finance);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.AlreadyEnded.selector, id));
        p.pay(id);
    }

    function test_path_smallAmountSkipsApproval() public {
        uint256 id = _create();
        vm.prank(requester);
        p.submit(id, 300);
        (uint256 m,) = _marking(id);
        assertEq(m, F6 | F7); // X1 default → A1

        vm.prank(finance);
        p.pay(id);
        (m,) = _marking(id);
        assertEq(m, F7 | F8);

        vm.prank(requester);
        p.uploadReceipt(id, keccak256("r"));
        bool ended;
        (m, ended) = _marking(id);
        assertEq(m, 0);
        assertTrue(ended);
    }

    function test_path_rejected() public {
        uint256 id = _create();
        vm.prank(requester);
        p.submit(id, 9000);
        vm.prank(manager);
        vm.expectEmit(true, false, false, true);
        emit ExpenseApproval.InstanceEnded(id, false);
        p.approve(id, false);
        (uint256 m, bool ended) = _marking(id);
        assertEq(m, 0);
        assertTrue(ended);

        vm.prank(finance);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.AlreadyEnded.selector, id));
        p.pay(id);
    }

    function test_ownerControls() public {
        vm.prank(stranger);
        vm.expectRevert(ExpenseApproval.NotOwner.selector);
        p.setPaused(true);

        vm.prank(owner);
        p.setPaused(true);
        vm.expectRevert(ExpenseApproval.IsPaused.selector);
        p.createInstance([requester, manager, finance]);
        vm.prank(owner);
        p.setPaused(false);

        uint256 id = _create();
        vm.prank(owner);
        p.rebindRole(id, p.ROLE_REQUESTER(), stranger);
        vm.prank(stranger);
        p.submit(id, 10);
        vm.prank(requester);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.NotAuthorized.selector, id, p.ROLE_REQUESTER()));
        p.uploadReceipt(id, bytes32(0));
    }

    function test_zeroRoleRejected() public {
        vm.expectRevert(ExpenseApproval.RoleCount.selector);
        p.createInstance([requester, address(0), finance]);
    }
}

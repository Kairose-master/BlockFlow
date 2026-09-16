// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/ExpenseApproval.sol";

// 자동 생성 — BlockFlow codegen (IR → Foundry 테스트). 손으로 고치지 말고 IR/템플릿을 고친 뒤 다시 생성할 것.

/// @dev 무작위 역할 계정이 무작위 태스크를 호출한다. 거부는 정상이다 (fail_on_revert = false).
contract ExpenseApprovalHandler is Test {
    ExpenseApproval p;
    address[3] acc;

    constructor(ExpenseApproval _p, address[3] memory _acc) {
        p = _p;
        acc = _acc;
    }

    function create() external {
        p.createInstance(acc);
    }

    function submit(uint256 id, uint256 amount, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 3]);
        try p.submit(id, amount) {} catch {}
    }

    function approve(uint256 id, bool approved, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 3]);
        try p.approve(id, approved) {} catch {}
    }

    function pay(uint256 id, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 3]);
        try p.pay(id) {} catch {}
    }

    function uploadReceipt(uint256 id, bytes32 receiptHash, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 3]);
        try p.uploadReceipt(id, receiptHash) {} catch {}
    }
}

contract ExpenseApprovalInvariants is Test {
    ExpenseApproval p;
    ExpenseApprovalHandler h;
    uint256 constant ALL_FLOWS = 0xfff; // IR flows 집합

    function setUp() public {
        address[3] memory acc = [address(uint160(161)), address(uint160(162)), address(uint160(163))];
        p = new ExpenseApproval(address(this));
        h = new ExpenseApprovalHandler(p, acc);
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
            assertTrue((m & 0x4) == 0 || (m & 0x8) == 0); // X1
            assertTrue((m & 0x400) == 0 || (m & 0x800) == 0); // X2
        }
    }
}

/// @dev V2 BFS 도달 경로마다 시나리오 1개. 활성화 전 실행·권한 없는 실행·종료 후 실행은 커스텀 에러로 거부돼야 한다.
contract ExpenseApprovalScenarios is Test {
    ExpenseApproval p;
    address owner = address(0x01);
    address stranger = address(0xBAD);
    address accRequester = address(uint160(161));
    address accManager = address(uint160(162));
    address accFinance = address(uint160(163));
    bytes32 ROLE_REQUESTER;
    bytes32 ROLE_MANAGER;
    bytes32 ROLE_FINANCE;
    uint8 TASK_SUBMIT;
    uint8 TASK_APPROVE;
    uint8 TASK_PAY;
    uint8 TASK_RECEIPT;

    function setUp() public {
        p = new ExpenseApproval(owner);
        // vm.prank 는 다음 외부 호출 1개에만 적용되므로 상수 getter 는 미리 읽어 둔다.
        ROLE_REQUESTER = p.ROLE_REQUESTER();
        ROLE_MANAGER = p.ROLE_MANAGER();
        ROLE_FINANCE = p.ROLE_FINANCE();
        TASK_SUBMIT = p.TASK_SUBMIT();
        TASK_APPROVE = p.TASK_APPROVE();
        TASK_PAY = p.TASK_PAY();
        TASK_RECEIPT = p.TASK_RECEIPT();
    }

    function _create() internal returns (uint256 id) {
        id = p.createInstance([accRequester, accManager, accFinance]);
    }

    function _marking(uint256 id) internal view returns (uint256 m, bool ended) {
        (m, ended,) = p.instances(id);
    }

    /// 경로 1: submit → pay → uploadReceipt | X1→F4 → completed
    function test_path_1() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.NotAuthorized.selector, id, ROLE_REQUESTER));
        p.submit(id, 0);
        vm.prank(accManager);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.TaskNotEnabled.selector, id, TASK_APPROVE));
        p.approve(id, false);
        vm.prank(accRequester);
        p.submit(id, 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x60);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.NotAuthorized.selector, id, ROLE_FINANCE));
        p.pay(id);
        vm.prank(accRequester);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submit(id, 0);
        vm.prank(accFinance);
        p.pay(id);
        (m, ended) = _marking(id);
        assertEq(m, 0xc0);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.NotAuthorized.selector, id, ROLE_REQUESTER));
        p.uploadReceipt(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000021));
        vm.prank(accRequester);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submit(id, 0);
        vm.prank(accRequester);
        p.uploadReceipt(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000021));
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accRequester);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.AlreadyEnded.selector, id));
        p.submit(id, 0);
    }

    /// 경로 2: submit → uploadReceipt → pay | X1→F4 → completed
    function test_path_2() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.NotAuthorized.selector, id, ROLE_REQUESTER));
        p.submit(id, 0);
        vm.prank(accManager);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.TaskNotEnabled.selector, id, TASK_APPROVE));
        p.approve(id, false);
        vm.prank(accRequester);
        p.submit(id, 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x60);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.NotAuthorized.selector, id, ROLE_REQUESTER));
        p.uploadReceipt(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000021));
        vm.prank(accRequester);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submit(id, 0);
        vm.prank(accRequester);
        p.uploadReceipt(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000021));
        (m, ended) = _marking(id);
        assertEq(m, 0x120);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.NotAuthorized.selector, id, ROLE_FINANCE));
        p.pay(id);
        vm.prank(accRequester);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submit(id, 0);
        vm.prank(accFinance);
        p.pay(id);
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accRequester);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.AlreadyEnded.selector, id));
        p.submit(id, 0);
    }

    /// 경로 3: submit → approve | X1→F3, X2→F12 → rejected
    function test_path_3() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.NotAuthorized.selector, id, ROLE_REQUESTER));
        p.submit(id, 1001);
        vm.prank(accManager);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.TaskNotEnabled.selector, id, TASK_APPROVE));
        p.approve(id, false);
        vm.prank(accRequester);
        p.submit(id, 1001);
        (m, ended) = _marking(id);
        assertEq(m, 0x4);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.NotAuthorized.selector, id, ROLE_MANAGER));
        p.approve(id, false);
        vm.prank(accRequester);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submit(id, 0);
        vm.prank(accManager);
        p.approve(id, false);
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accRequester);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.AlreadyEnded.selector, id));
        p.submit(id, 0);
    }

    /// 경로 4: submit → approve → pay → uploadReceipt | X1→F3, X2→F11 → completed
    function test_path_4() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.NotAuthorized.selector, id, ROLE_REQUESTER));
        p.submit(id, 1001);
        vm.prank(accManager);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.TaskNotEnabled.selector, id, TASK_APPROVE));
        p.approve(id, false);
        vm.prank(accRequester);
        p.submit(id, 1001);
        (m, ended) = _marking(id);
        assertEq(m, 0x4);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.NotAuthorized.selector, id, ROLE_MANAGER));
        p.approve(id, true);
        vm.prank(accRequester);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submit(id, 0);
        vm.prank(accManager);
        p.approve(id, true);
        (m, ended) = _marking(id);
        assertEq(m, 0x60);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.NotAuthorized.selector, id, ROLE_FINANCE));
        p.pay(id);
        vm.prank(accRequester);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submit(id, 0);
        vm.prank(accFinance);
        p.pay(id);
        (m, ended) = _marking(id);
        assertEq(m, 0xc0);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.NotAuthorized.selector, id, ROLE_REQUESTER));
        p.uploadReceipt(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000021));
        vm.prank(accRequester);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submit(id, 0);
        vm.prank(accRequester);
        p.uploadReceipt(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000021));
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accRequester);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.AlreadyEnded.selector, id));
        p.submit(id, 0);
    }

    /// 경로 5: submit → approve → uploadReceipt → pay | X1→F3, X2→F11 → completed
    function test_path_5() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.NotAuthorized.selector, id, ROLE_REQUESTER));
        p.submit(id, 1001);
        vm.prank(accManager);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.TaskNotEnabled.selector, id, TASK_APPROVE));
        p.approve(id, false);
        vm.prank(accRequester);
        p.submit(id, 1001);
        (m, ended) = _marking(id);
        assertEq(m, 0x4);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.NotAuthorized.selector, id, ROLE_MANAGER));
        p.approve(id, true);
        vm.prank(accRequester);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submit(id, 0);
        vm.prank(accManager);
        p.approve(id, true);
        (m, ended) = _marking(id);
        assertEq(m, 0x60);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.NotAuthorized.selector, id, ROLE_REQUESTER));
        p.uploadReceipt(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000021));
        vm.prank(accRequester);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submit(id, 0);
        vm.prank(accRequester);
        p.uploadReceipt(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000021));
        (m, ended) = _marking(id);
        assertEq(m, 0x120);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.NotAuthorized.selector, id, ROLE_FINANCE));
        p.pay(id);
        vm.prank(accRequester);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submit(id, 0);
        vm.prank(accFinance);
        p.pay(id);
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accRequester);
        vm.expectRevert(abi.encodeWithSelector(ExpenseApproval.AlreadyEnded.selector, id));
        p.submit(id, 0);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/CreditReview.sol";

// 자동 생성 — BlockFlow codegen (IR → Foundry 테스트). 손으로 고치지 말고 IR/템플릿을 고친 뒤 다시 생성할 것.

/// @dev 무작위 역할 계정이 무작위 태스크를 호출한다. 거부는 정상이다 (fail_on_revert = false).
contract CreditReviewHandler is Test {
    CreditReview p;
    address[4] acc;

    constructor(CreditReview _p, address[4] memory _acc) {
        p = _p;
        acc = _acc;
    }

    function create() external {
        p.createInstance(acc);
    }

    function apply_(uint256 id, uint256 amount, bytes32 docHash, uint256 reviewWithin, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 4]);
        try p.apply_(id, amount, docHash, reviewWithin) {} catch {}
    }

    function score(uint256 id, uint256 score, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 4]);
        try p.score(id, score) {} catch {}
    }

    function approve(uint256 id, bool approved, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 4]);
        try p.approve(id, approved) {} catch {}
    }

    function disburse(uint256 id, bytes32 contractHash, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 4]);
        try p.disburse(id, contractHash) {} catch {}
    }
}

contract CreditReviewInvariants is Test {
    CreditReview p;
    CreditReviewHandler h;
    uint256 constant ALL_FLOWS = 0xfff; // IR flows 집합

    function setUp() public {
        address[4] memory acc = [address(uint160(161)), address(uint160(162)), address(uint160(163)), address(uint160(164))];
        p = new CreditReview(address(this));
        h = new CreditReviewHandler(p, acc);
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
            assertTrue((m & 0x8) == 0 || (m & 0x10) == 0); // X1
            assertTrue((m & 0x20) == 0 || (m & 0x40) == 0); // X2
            assertTrue((m & 0x100) == 0 || (m & 0x200) == 0); // X3
        }
    }
}

/// @dev V2 BFS 도달 경로마다 시나리오 1개. 활성화 전 실행·권한 없는 실행·종료 후 실행은 커스텀 에러로 거부돼야 한다.
contract CreditReviewScenarios is Test {
    CreditReview p;
    address owner = address(0x01);
    address stranger = address(0xBAD);
    address accApplicant = address(uint160(161));
    address accOfficer = address(uint160(162));
    address accCommittee = address(uint160(163));
    address accDisburser = address(uint160(164));
    bytes32 ROLE_APPLICANT;
    bytes32 ROLE_OFFICER;
    bytes32 ROLE_COMMITTEE;
    bytes32 ROLE_DISBURSER;
    uint8 TASK_APPLY;
    uint8 TASK_SCORE;
    uint8 TASK_APPROVE;
    uint8 TASK_DISBURSE;

    function setUp() public {
        p = new CreditReview(owner);
        // vm.prank 는 다음 외부 호출 1개에만 적용되므로 상수 getter 는 미리 읽어 둔다.
        ROLE_APPLICANT = p.ROLE_APPLICANT();
        ROLE_OFFICER = p.ROLE_OFFICER();
        ROLE_COMMITTEE = p.ROLE_COMMITTEE();
        ROLE_DISBURSER = p.ROLE_DISBURSER();
        TASK_APPLY = p.TASK_APPLY();
        TASK_SCORE = p.TASK_SCORE();
        TASK_APPROVE = p.TASK_APPROVE();
        TASK_DISBURSE = p.TASK_DISBURSE();
    }

    function _create() internal returns (uint256 id) {
        id = p.createInstance([accApplicant, accOfficer, accCommittee, accDisburser]);
    }

    function _marking(uint256 id) internal view returns (uint256 m, bool ended) {
        (m, ended,) = p.instances(id);
    }

    /// 경로 1: apply_ → score | X1→F5 → rejected
    function test_path_1() public {
        vm.warp(1700000000);
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.NotAuthorized.selector, id, ROLE_APPLICANT));
        p.apply_(id, 0, bytes32(0x0000000000000000000000000000000000000000000000000000000000000011), 0);
        vm.prank(accOfficer);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.TaskNotEnabled.selector, id, TASK_SCORE));
        p.score(id, 0);
        vm.warp(1700000010);
        vm.prank(accApplicant);
        p.apply_(id, 0, bytes32(0x0000000000000000000000000000000000000000000000000000000000000011), 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x2);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.NotAuthorized.selector, id, ROLE_OFFICER));
        p.score(id, 0);
        vm.prank(accApplicant);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.TaskNotEnabled.selector, id, TASK_APPLY));
        p.apply_(id, 0, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.warp(1700000020);
        vm.prank(accOfficer);
        p.score(id, 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accApplicant);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.AlreadyEnded.selector, id));
        p.apply_(id, 0, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
    }

    /// 경로 2: apply_ → score → disburse | X1→F4, X2→F7 → completed
    function test_path_2() public {
        vm.warp(1700000000);
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.NotAuthorized.selector, id, ROLE_APPLICANT));
        p.apply_(id, 0, bytes32(0x0000000000000000000000000000000000000000000000000000000000000011), 0);
        vm.prank(accOfficer);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.TaskNotEnabled.selector, id, TASK_SCORE));
        p.score(id, 0);
        vm.warp(1700000010);
        vm.prank(accApplicant);
        p.apply_(id, 0, bytes32(0x0000000000000000000000000000000000000000000000000000000000000011), 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x2);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.NotAuthorized.selector, id, ROLE_OFFICER));
        p.score(id, 60);
        vm.prank(accApplicant);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.TaskNotEnabled.selector, id, TASK_APPLY));
        p.apply_(id, 0, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.warp(1700000020);
        vm.prank(accOfficer);
        p.score(id, 60);
        (m, ended) = _marking(id);
        assertEq(m, 0x40);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.NotAuthorized.selector, id, ROLE_DISBURSER));
        p.disburse(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000051));
        vm.prank(accApplicant);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.TaskNotEnabled.selector, id, TASK_APPLY));
        p.apply_(id, 0, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.warp(1700000030);
        vm.prank(accDisburser);
        p.disburse(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000051));
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accApplicant);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.AlreadyEnded.selector, id));
        p.apply_(id, 0, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
    }

    /// 경로 3: apply_ → score⏰ → delayed
    function test_path_3() public {
        vm.warp(1700000000);
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.NotAuthorized.selector, id, ROLE_APPLICANT));
        p.apply_(id, 0, bytes32(0x0000000000000000000000000000000000000000000000000000000000000011), 0);
        vm.prank(accOfficer);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.TaskNotEnabled.selector, id, TASK_SCORE));
        p.score(id, 0);
        vm.warp(1700000010);
        vm.prank(accApplicant);
        p.apply_(id, 0, bytes32(0x0000000000000000000000000000000000000000000000000000000000000011), 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x2);
        assertFalse(ended);
        vm.warp(1700000011);
        vm.prank(stranger);
        p.expireScore(id);
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accApplicant);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.AlreadyEnded.selector, id));
        p.apply_(id, 0, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
    }

    /// 경로 4: apply_ → score → approve | X1→F4, X2→F6, X3→F10 → rejected
    function test_path_4() public {
        vm.warp(1700000000);
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.NotAuthorized.selector, id, ROLE_APPLICANT));
        p.apply_(id, 50001, bytes32(0x0000000000000000000000000000000000000000000000000000000000000011), 0);
        vm.prank(accOfficer);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.TaskNotEnabled.selector, id, TASK_SCORE));
        p.score(id, 0);
        vm.warp(1700000010);
        vm.prank(accApplicant);
        p.apply_(id, 50001, bytes32(0x0000000000000000000000000000000000000000000000000000000000000011), 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x2);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.NotAuthorized.selector, id, ROLE_OFFICER));
        p.score(id, 60);
        vm.prank(accApplicant);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.TaskNotEnabled.selector, id, TASK_APPLY));
        p.apply_(id, 0, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.warp(1700000020);
        vm.prank(accOfficer);
        p.score(id, 60);
        (m, ended) = _marking(id);
        assertEq(m, 0x20);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.NotAuthorized.selector, id, ROLE_COMMITTEE));
        p.approve(id, false);
        vm.prank(accApplicant);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.TaskNotEnabled.selector, id, TASK_APPLY));
        p.apply_(id, 0, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.warp(1700000030);
        vm.prank(accCommittee);
        p.approve(id, false);
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accApplicant);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.AlreadyEnded.selector, id));
        p.apply_(id, 0, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
    }

    /// 경로 5: apply_ → score → approve → disburse | X1→F4, X2→F6, X3→F9 → completed
    function test_path_5() public {
        vm.warp(1700000000);
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.NotAuthorized.selector, id, ROLE_APPLICANT));
        p.apply_(id, 50001, bytes32(0x0000000000000000000000000000000000000000000000000000000000000011), 0);
        vm.prank(accOfficer);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.TaskNotEnabled.selector, id, TASK_SCORE));
        p.score(id, 0);
        vm.warp(1700000010);
        vm.prank(accApplicant);
        p.apply_(id, 50001, bytes32(0x0000000000000000000000000000000000000000000000000000000000000011), 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x2);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.NotAuthorized.selector, id, ROLE_OFFICER));
        p.score(id, 60);
        vm.prank(accApplicant);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.TaskNotEnabled.selector, id, TASK_APPLY));
        p.apply_(id, 0, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.warp(1700000020);
        vm.prank(accOfficer);
        p.score(id, 60);
        (m, ended) = _marking(id);
        assertEq(m, 0x20);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.NotAuthorized.selector, id, ROLE_COMMITTEE));
        p.approve(id, true);
        vm.prank(accApplicant);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.TaskNotEnabled.selector, id, TASK_APPLY));
        p.apply_(id, 0, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.warp(1700000030);
        vm.prank(accCommittee);
        p.approve(id, true);
        (m, ended) = _marking(id);
        assertEq(m, 0x100);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.NotAuthorized.selector, id, ROLE_DISBURSER));
        p.disburse(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000051));
        vm.prank(accApplicant);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.TaskNotEnabled.selector, id, TASK_APPLY));
        p.apply_(id, 0, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.warp(1700000040);
        vm.prank(accDisburser);
        p.disburse(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000051));
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accApplicant);
        vm.expectRevert(abi.encodeWithSelector(CreditReview.AlreadyEnded.selector, id));
        p.apply_(id, 0, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
    }
}

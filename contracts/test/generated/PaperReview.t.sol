// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/PaperReview.sol";

// 자동 생성 — BlockFlow codegen (IR → Foundry 테스트). 손으로 고치지 말고 IR/템플릿을 고친 뒤 다시 생성할 것.

/// @dev 무작위 역할 계정이 무작위 태스크를 호출한다. 거부는 정상이다 (fail_on_revert = false).
contract PaperReviewHandler is Test {
    PaperReview p;
    address[4] acc;

    constructor(PaperReview _p, address[4] memory _acc) {
        p = _p;
        acc = _acc;
    }

    function create() external {
        p.createInstance(acc);
    }

    function submitPaper(uint256 id, bytes32 paperHash, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 4]);
        try p.submitPaper(id, paperHash) {} catch {}
    }

    function reviewA(uint256 id, uint256 scoreA, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 4]);
        try p.reviewA(id, scoreA) {} catch {}
    }

    function reviewB(uint256 id, uint256 scoreB, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 4]);
        try p.reviewB(id, scoreB) {} catch {}
    }

    function decide(uint256 id, bool accepted, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 4]);
        try p.decide(id, accepted) {} catch {}
    }
}

contract PaperReviewInvariants is Test {
    PaperReview p;
    PaperReviewHandler h;
    uint256 constant ALL_FLOWS = 0x3ff; // IR flows 집합

    function setUp() public {
        address[4] memory acc = [address(uint160(161)), address(uint160(162)), address(uint160(163)), address(uint160(164))];
        p = new PaperReview(address(this));
        h = new PaperReviewHandler(p, acc);
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
            assertTrue((m & 0x100) == 0 || (m & 0x200) == 0); // X1
        }
    }
}

/// @dev V2 BFS 도달 경로마다 시나리오 1개. 활성화 전 실행·권한 없는 실행·종료 후 실행은 커스텀 에러로 거부돼야 한다.
contract PaperReviewScenarios is Test {
    PaperReview p;
    address owner = address(0x01);
    address stranger = address(0xBAD);
    address accAuthor = address(uint160(161));
    address accReviewerA = address(uint160(162));
    address accReviewerB = address(uint160(163));
    address accEditor = address(uint160(164));
    bytes32 ROLE_AUTHOR;
    bytes32 ROLE_REVIEWER_A;
    bytes32 ROLE_REVIEWER_B;
    bytes32 ROLE_EDITOR;
    uint8 TASK_SUBMIT;
    uint8 TASK_REVIEW_A;
    uint8 TASK_REVIEW_B;
    uint8 TASK_DECIDE;

    function setUp() public {
        p = new PaperReview(owner);
        // vm.prank 는 다음 외부 호출 1개에만 적용되므로 상수 getter 는 미리 읽어 둔다.
        ROLE_AUTHOR = p.ROLE_AUTHOR();
        ROLE_REVIEWER_A = p.ROLE_REVIEWER_A();
        ROLE_REVIEWER_B = p.ROLE_REVIEWER_B();
        ROLE_EDITOR = p.ROLE_EDITOR();
        TASK_SUBMIT = p.TASK_SUBMIT();
        TASK_REVIEW_A = p.TASK_REVIEW_A();
        TASK_REVIEW_B = p.TASK_REVIEW_B();
        TASK_DECIDE = p.TASK_DECIDE();
    }

    function _create() internal returns (uint256 id) {
        id = p.createInstance([accAuthor, accReviewerA, accReviewerB, accEditor]);
    }

    function _marking(uint256 id) internal view returns (uint256 m, bool ended) {
        (m, ended,) = p.instances(id);
    }

    /// 경로 1: submitPaper → reviewA → reviewB → decide | X1→F10 → rejected
    function test_path_1() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.NotAuthorized.selector, id, ROLE_AUTHOR));
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001));
        vm.prank(accReviewerA);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.TaskNotEnabled.selector, id, TASK_REVIEW_A));
        p.reviewA(id, 0);
        vm.prank(accAuthor);
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001));
        (m, ended) = _marking(id);
        assertEq(m, 0xc);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.NotAuthorized.selector, id, ROLE_REVIEWER_A));
        p.reviewA(id, 0);
        vm.prank(accAuthor);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000));
        vm.prank(accReviewerA);
        p.reviewA(id, 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x18);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.NotAuthorized.selector, id, ROLE_REVIEWER_B));
        p.reviewB(id, 0);
        vm.prank(accAuthor);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000));
        vm.prank(accReviewerB);
        p.reviewB(id, 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x40);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.NotAuthorized.selector, id, ROLE_EDITOR));
        p.decide(id, false);
        vm.prank(accAuthor);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000));
        vm.prank(accEditor);
        p.decide(id, false);
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accAuthor);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.AlreadyEnded.selector, id));
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000));
    }

    /// 경로 2: submitPaper → reviewA → reviewB → decide | X1→F9 → completed
    function test_path_2() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.NotAuthorized.selector, id, ROLE_AUTHOR));
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001));
        vm.prank(accReviewerA);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.TaskNotEnabled.selector, id, TASK_REVIEW_A));
        p.reviewA(id, 0);
        vm.prank(accAuthor);
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001));
        (m, ended) = _marking(id);
        assertEq(m, 0xc);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.NotAuthorized.selector, id, ROLE_REVIEWER_A));
        p.reviewA(id, 3);
        vm.prank(accAuthor);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000));
        vm.prank(accReviewerA);
        p.reviewA(id, 3);
        (m, ended) = _marking(id);
        assertEq(m, 0x18);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.NotAuthorized.selector, id, ROLE_REVIEWER_B));
        p.reviewB(id, 3);
        vm.prank(accAuthor);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000));
        vm.prank(accReviewerB);
        p.reviewB(id, 3);
        (m, ended) = _marking(id);
        assertEq(m, 0x40);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.NotAuthorized.selector, id, ROLE_EDITOR));
        p.decide(id, true);
        vm.prank(accAuthor);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000));
        vm.prank(accEditor);
        p.decide(id, true);
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accAuthor);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.AlreadyEnded.selector, id));
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000));
    }

    /// 경로 3: submitPaper → reviewB → reviewA → decide | X1→F10 → rejected
    function test_path_3() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.NotAuthorized.selector, id, ROLE_AUTHOR));
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001));
        vm.prank(accReviewerA);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.TaskNotEnabled.selector, id, TASK_REVIEW_A));
        p.reviewA(id, 0);
        vm.prank(accAuthor);
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001));
        (m, ended) = _marking(id);
        assertEq(m, 0xc);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.NotAuthorized.selector, id, ROLE_REVIEWER_B));
        p.reviewB(id, 0);
        vm.prank(accAuthor);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000));
        vm.prank(accReviewerB);
        p.reviewB(id, 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x24);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.NotAuthorized.selector, id, ROLE_REVIEWER_A));
        p.reviewA(id, 0);
        vm.prank(accAuthor);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000));
        vm.prank(accReviewerA);
        p.reviewA(id, 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x40);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.NotAuthorized.selector, id, ROLE_EDITOR));
        p.decide(id, false);
        vm.prank(accAuthor);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000));
        vm.prank(accEditor);
        p.decide(id, false);
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accAuthor);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.AlreadyEnded.selector, id));
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000));
    }

    /// 경로 4: submitPaper → reviewB → reviewA → decide | X1→F9 → completed
    function test_path_4() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.NotAuthorized.selector, id, ROLE_AUTHOR));
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001));
        vm.prank(accReviewerA);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.TaskNotEnabled.selector, id, TASK_REVIEW_A));
        p.reviewA(id, 0);
        vm.prank(accAuthor);
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001));
        (m, ended) = _marking(id);
        assertEq(m, 0xc);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.NotAuthorized.selector, id, ROLE_REVIEWER_B));
        p.reviewB(id, 3);
        vm.prank(accAuthor);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000));
        vm.prank(accReviewerB);
        p.reviewB(id, 3);
        (m, ended) = _marking(id);
        assertEq(m, 0x24);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.NotAuthorized.selector, id, ROLE_REVIEWER_A));
        p.reviewA(id, 3);
        vm.prank(accAuthor);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000));
        vm.prank(accReviewerA);
        p.reviewA(id, 3);
        (m, ended) = _marking(id);
        assertEq(m, 0x40);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.NotAuthorized.selector, id, ROLE_EDITOR));
        p.decide(id, true);
        vm.prank(accAuthor);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.TaskNotEnabled.selector, id, TASK_SUBMIT));
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000));
        vm.prank(accEditor);
        p.decide(id, true);
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accAuthor);
        vm.expectRevert(abi.encodeWithSelector(PaperReview.AlreadyEnded.selector, id));
        p.submitPaper(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000));
    }
}

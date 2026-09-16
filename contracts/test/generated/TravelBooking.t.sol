// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/TravelBooking.sol";

// 자동 생성 — BlockFlow codegen (IR → Foundry 테스트). 손으로 고치지 말고 IR/템플릿을 고친 뒤 다시 생성할 것.

/// @dev 무작위 역할 계정이 무작위 태스크를 호출한다. 거부는 정상이다 (fail_on_revert = false).
contract TravelBookingHandler is Test {
    TravelBooking p;
    address[3] acc;

    constructor(TravelBooking _p, address[3] memory _acc) {
        p = _p;
        acc = _acc;
    }

    function create() external {
        p.createInstance(acc);
    }

    function request(uint256 id, bytes32 destinationHash, uint256 budget, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 3]);
        try p.request(id, destinationHash, budget) {} catch {}
    }

    function approveBudget(uint256 id, bool approved, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 3]);
        try p.approveBudget(id, approved) {} catch {}
    }

    function bookFlight(uint256 id, bytes32 flightHash, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 3]);
        try p.bookFlight(id, flightHash) {} catch {}
    }

    function bookHotel(uint256 id, bytes32 hotelHash, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 3]);
        try p.bookHotel(id, hotelHash) {} catch {}
    }

    function confirm(uint256 id, bool confirmed, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 3]);
        try p.confirm(id, confirmed) {} catch {}
    }
}

contract TravelBookingInvariants is Test {
    TravelBooking p;
    TravelBookingHandler h;
    uint256 constant ALL_FLOWS = 0x7fff; // IR flows 집합

    function setUp() public {
        address[3] memory acc = [address(uint160(161)), address(uint160(162)), address(uint160(163))];
        p = new TravelBooking(address(this));
        h = new TravelBookingHandler(p, acc);
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
            assertTrue((m & 0x20) == 0 || (m & 0x40) == 0); // X2
            assertTrue((m & 0x2000) == 0 || (m & 0x4000) == 0); // X3
        }
    }
}

/// @dev V2 BFS 도달 경로마다 시나리오 1개. 활성화 전 실행·권한 없는 실행·종료 후 실행은 커스텀 에러로 거부돼야 한다.
contract TravelBookingScenarios is Test {
    TravelBooking p;
    address owner = address(0x01);
    address stranger = address(0xBAD);
    address accTraveler = address(uint160(161));
    address accApprover = address(uint160(162));
    address accAgent = address(uint160(163));
    bytes32 ROLE_TRAVELER;
    bytes32 ROLE_APPROVER;
    bytes32 ROLE_AGENT;
    uint8 TASK_REQUEST;
    uint8 TASK_APPROVE;
    uint8 TASK_FLIGHT;
    uint8 TASK_HOTEL;
    uint8 TASK_CONFIRM;

    function setUp() public {
        p = new TravelBooking(owner);
        // vm.prank 는 다음 외부 호출 1개에만 적용되므로 상수 getter 는 미리 읽어 둔다.
        ROLE_TRAVELER = p.ROLE_TRAVELER();
        ROLE_APPROVER = p.ROLE_APPROVER();
        ROLE_AGENT = p.ROLE_AGENT();
        TASK_REQUEST = p.TASK_REQUEST();
        TASK_APPROVE = p.TASK_APPROVE();
        TASK_FLIGHT = p.TASK_FLIGHT();
        TASK_HOTEL = p.TASK_HOTEL();
        TASK_CONFIRM = p.TASK_CONFIRM();
    }

    function _create() internal returns (uint256 id) {
        id = p.createInstance([accTraveler, accApprover, accAgent]);
    }

    function _marking(uint256 id) internal view returns (uint256 m, bool ended) {
        (m, ended,) = p.instances(id);
    }

    /// 경로 1: request → bookFlight → bookHotel → confirm | X1→F4, X3→F15 → cancelled
    function test_path_1() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_TRAVELER));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 0);
        vm.prank(accApprover);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_APPROVE));
        p.approveBudget(id, false);
        vm.prank(accTraveler);
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x180);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_AGENT));
        p.bookFlight(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000031));
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accAgent);
        p.bookFlight(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000031));
        (m, ended) = _marking(id);
        assertEq(m, 0x300);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_AGENT));
        p.bookHotel(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000041));
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accAgent);
        p.bookHotel(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000041));
        (m, ended) = _marking(id);
        assertEq(m, 0x800);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_TRAVELER));
        p.confirm(id, false);
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accTraveler);
        p.confirm(id, false);
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.AlreadyEnded.selector, id));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
    }

    /// 경로 2: request → bookFlight → bookHotel → confirm | X1→F4, X3→F14 → completed
    function test_path_2() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_TRAVELER));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 0);
        vm.prank(accApprover);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_APPROVE));
        p.approveBudget(id, false);
        vm.prank(accTraveler);
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x180);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_AGENT));
        p.bookFlight(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000031));
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accAgent);
        p.bookFlight(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000031));
        (m, ended) = _marking(id);
        assertEq(m, 0x300);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_AGENT));
        p.bookHotel(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000041));
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accAgent);
        p.bookHotel(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000041));
        (m, ended) = _marking(id);
        assertEq(m, 0x800);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_TRAVELER));
        p.confirm(id, true);
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accTraveler);
        p.confirm(id, true);
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.AlreadyEnded.selector, id));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
    }

    /// 경로 3: request → bookHotel → bookFlight → confirm | X1→F4, X3→F15 → cancelled
    function test_path_3() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_TRAVELER));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 0);
        vm.prank(accApprover);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_APPROVE));
        p.approveBudget(id, false);
        vm.prank(accTraveler);
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x180);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_AGENT));
        p.bookHotel(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000041));
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accAgent);
        p.bookHotel(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000041));
        (m, ended) = _marking(id);
        assertEq(m, 0x480);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_AGENT));
        p.bookFlight(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000031));
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accAgent);
        p.bookFlight(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000031));
        (m, ended) = _marking(id);
        assertEq(m, 0x800);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_TRAVELER));
        p.confirm(id, false);
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accTraveler);
        p.confirm(id, false);
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.AlreadyEnded.selector, id));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
    }

    /// 경로 4: request → bookHotel → bookFlight → confirm | X1→F4, X3→F14 → completed
    function test_path_4() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_TRAVELER));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 0);
        vm.prank(accApprover);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_APPROVE));
        p.approveBudget(id, false);
        vm.prank(accTraveler);
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x180);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_AGENT));
        p.bookHotel(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000041));
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accAgent);
        p.bookHotel(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000041));
        (m, ended) = _marking(id);
        assertEq(m, 0x480);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_AGENT));
        p.bookFlight(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000031));
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accAgent);
        p.bookFlight(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000031));
        (m, ended) = _marking(id);
        assertEq(m, 0x800);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_TRAVELER));
        p.confirm(id, true);
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accTraveler);
        p.confirm(id, true);
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.AlreadyEnded.selector, id));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
    }

    /// 경로 5: request → approveBudget | X1→F3, X2→F7 → rejected
    function test_path_5() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_TRAVELER));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 3001);
        vm.prank(accApprover);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_APPROVE));
        p.approveBudget(id, false);
        vm.prank(accTraveler);
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 3001);
        (m, ended) = _marking(id);
        assertEq(m, 0x4);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_APPROVER));
        p.approveBudget(id, false);
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accApprover);
        p.approveBudget(id, false);
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.AlreadyEnded.selector, id));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
    }

    /// 경로 6: request → approveBudget → bookFlight → bookHotel → confirm | X1→F3, X2→F6, X3→F15 → cancelled
    function test_path_6() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_TRAVELER));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 3001);
        vm.prank(accApprover);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_APPROVE));
        p.approveBudget(id, false);
        vm.prank(accTraveler);
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 3001);
        (m, ended) = _marking(id);
        assertEq(m, 0x4);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_APPROVER));
        p.approveBudget(id, true);
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accApprover);
        p.approveBudget(id, true);
        (m, ended) = _marking(id);
        assertEq(m, 0x180);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_AGENT));
        p.bookFlight(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000031));
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accAgent);
        p.bookFlight(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000031));
        (m, ended) = _marking(id);
        assertEq(m, 0x300);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_AGENT));
        p.bookHotel(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000041));
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accAgent);
        p.bookHotel(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000041));
        (m, ended) = _marking(id);
        assertEq(m, 0x800);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_TRAVELER));
        p.confirm(id, false);
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accTraveler);
        p.confirm(id, false);
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.AlreadyEnded.selector, id));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
    }

    /// 경로 7: request → approveBudget → bookFlight → bookHotel → confirm | X1→F3, X2→F6, X3→F14 → completed
    function test_path_7() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_TRAVELER));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 3001);
        vm.prank(accApprover);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_APPROVE));
        p.approveBudget(id, false);
        vm.prank(accTraveler);
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 3001);
        (m, ended) = _marking(id);
        assertEq(m, 0x4);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_APPROVER));
        p.approveBudget(id, true);
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accApprover);
        p.approveBudget(id, true);
        (m, ended) = _marking(id);
        assertEq(m, 0x180);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_AGENT));
        p.bookFlight(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000031));
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accAgent);
        p.bookFlight(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000031));
        (m, ended) = _marking(id);
        assertEq(m, 0x300);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_AGENT));
        p.bookHotel(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000041));
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accAgent);
        p.bookHotel(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000041));
        (m, ended) = _marking(id);
        assertEq(m, 0x800);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_TRAVELER));
        p.confirm(id, true);
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accTraveler);
        p.confirm(id, true);
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.AlreadyEnded.selector, id));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
    }

    /// 경로 8: request → approveBudget → bookHotel → bookFlight → confirm | X1→F3, X2→F6, X3→F15 → cancelled
    function test_path_8() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_TRAVELER));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 3001);
        vm.prank(accApprover);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_APPROVE));
        p.approveBudget(id, false);
        vm.prank(accTraveler);
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 3001);
        (m, ended) = _marking(id);
        assertEq(m, 0x4);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_APPROVER));
        p.approveBudget(id, true);
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accApprover);
        p.approveBudget(id, true);
        (m, ended) = _marking(id);
        assertEq(m, 0x180);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_AGENT));
        p.bookHotel(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000041));
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accAgent);
        p.bookHotel(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000041));
        (m, ended) = _marking(id);
        assertEq(m, 0x480);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_AGENT));
        p.bookFlight(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000031));
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accAgent);
        p.bookFlight(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000031));
        (m, ended) = _marking(id);
        assertEq(m, 0x800);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_TRAVELER));
        p.confirm(id, false);
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accTraveler);
        p.confirm(id, false);
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.AlreadyEnded.selector, id));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
    }

    /// 경로 9: request → approveBudget → bookHotel → bookFlight → confirm | X1→F3, X2→F6, X3→F14 → completed
    function test_path_9() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_TRAVELER));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 3001);
        vm.prank(accApprover);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_APPROVE));
        p.approveBudget(id, false);
        vm.prank(accTraveler);
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 3001);
        (m, ended) = _marking(id);
        assertEq(m, 0x4);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_APPROVER));
        p.approveBudget(id, true);
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accApprover);
        p.approveBudget(id, true);
        (m, ended) = _marking(id);
        assertEq(m, 0x180);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_AGENT));
        p.bookHotel(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000041));
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accAgent);
        p.bookHotel(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000041));
        (m, ended) = _marking(id);
        assertEq(m, 0x480);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_AGENT));
        p.bookFlight(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000031));
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accAgent);
        p.bookFlight(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000031));
        (m, ended) = _marking(id);
        assertEq(m, 0x800);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.NotAuthorized.selector, id, ROLE_TRAVELER));
        p.confirm(id, true);
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.TaskNotEnabled.selector, id, TASK_REQUEST));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accTraveler);
        p.confirm(id, true);
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accTraveler);
        vm.expectRevert(abi.encodeWithSelector(TravelBooking.AlreadyEnded.selector, id));
        p.request(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
    }
}

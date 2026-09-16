// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/InvoicePayment.sol";

// 자동 생성 — BlockFlow codegen (IR → Foundry 테스트). 손으로 고치지 말고 IR/템플릿을 고친 뒤 다시 생성할 것.

/// @dev L1 결제 태스크용 최소 ERC-20. 컨트랙트가 참조하는 토큰 주소에 vm.etch 로 심는다.
contract BlockFlowMockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] < amount || balanceOf[from] < amount) return false;
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev 역할 계정마다 토큰을 주고 프로세스 컨트랙트에 approve 한다.
library BlockFlowPaymentSetup {
    function setup(address[] memory accounts, address process) internal {
        Vm vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
        vm.etch(0x1000000000000000000000000000000000000001, address(new BlockFlowMockERC20()).code);
        for (uint256 i = 0; i < accounts.length; i++) {
            BlockFlowMockERC20(0x1000000000000000000000000000000000000001).mint(accounts[i], 1e30);
            vm.prank(accounts[i]);
            BlockFlowMockERC20(0x1000000000000000000000000000000000000001).approve(process, type(uint256).max);
        }
    }
}

/// @dev 무작위 역할 계정이 무작위 태스크를 호출한다. 거부는 정상이다 (fail_on_revert = false).
contract InvoicePaymentHandler is Test {
    InvoicePayment p;
    address[2] acc;

    constructor(InvoicePayment _p, address[2] memory _acc) {
        p = _p;
        acc = _acc;
    }

    function create() external {
        p.createInstance(acc);
    }

    function invoice(uint256 id, bytes32 invoiceHash, uint256 amount, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 2]);
        try p.invoice(id, invoiceHash, amount) {} catch {}
    }

    function review(uint256 id, bool accepted, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 2]);
        try p.review(id, accepted) {} catch {}
    }

    function pay(uint256 id, uint8 who) external {
        id = bound(id, 1, p.instanceCount() + 1);
        vm.prank(acc[who % 2]);
        try p.pay(id) {} catch {}
    }
}

contract InvoicePaymentInvariants is Test {
    InvoicePayment p;
    InvoicePaymentHandler h;
    uint256 constant ALL_FLOWS = 0x3f; // IR flows 집합

    function setUp() public {
        address[2] memory acc = [address(uint160(161)), address(uint160(162))];
        p = new InvoicePayment(address(this));
        h = new InvoicePaymentHandler(p, acc);
        targetContract(address(h));
        address[] memory list = new address[](2);
        for (uint256 i = 0; i < 2; i++) list[i] = acc[i];
        BlockFlowPaymentSetup.setup(list, address(p));
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
contract InvoicePaymentScenarios is Test {
    InvoicePayment p;
    address owner = address(0x01);
    address stranger = address(0xBAD);
    address accVendor = address(uint160(161));
    address accBuyer = address(uint160(162));
    bytes32 ROLE_VENDOR;
    bytes32 ROLE_BUYER;
    uint8 TASK_INVOICE;
    uint8 TASK_REVIEW;
    uint8 TASK_PAY;

    function setUp() public {
        p = new InvoicePayment(owner);
        // vm.prank 는 다음 외부 호출 1개에만 적용되므로 상수 getter 는 미리 읽어 둔다.
        ROLE_VENDOR = p.ROLE_VENDOR();
        ROLE_BUYER = p.ROLE_BUYER();
        TASK_INVOICE = p.TASK_INVOICE();
        TASK_REVIEW = p.TASK_REVIEW();
        TASK_PAY = p.TASK_PAY();
        address[] memory list = new address[](2);
        list[0] = accVendor;
        list[1] = accBuyer;
        BlockFlowPaymentSetup.setup(list, address(p));
    }

    function _create() internal returns (uint256 id) {
        id = p.createInstance([accVendor, accBuyer]);
    }

    function _marking(uint256 id) internal view returns (uint256 m, bool ended) {
        (m, ended,) = p.instances(id);
    }

    /// 경로 1: invoice → review | X1→F5 → rejected
    function test_path_1() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(InvoicePayment.NotAuthorized.selector, id, ROLE_VENDOR));
        p.invoice(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 0);
        vm.prank(accBuyer);
        vm.expectRevert(abi.encodeWithSelector(InvoicePayment.TaskNotEnabled.selector, id, TASK_REVIEW));
        p.review(id, false);
        vm.prank(accVendor);
        p.invoice(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x2);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(InvoicePayment.NotAuthorized.selector, id, ROLE_BUYER));
        p.review(id, false);
        vm.prank(accVendor);
        vm.expectRevert(abi.encodeWithSelector(InvoicePayment.TaskNotEnabled.selector, id, TASK_INVOICE));
        p.invoice(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accBuyer);
        p.review(id, false);
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accVendor);
        vm.expectRevert(abi.encodeWithSelector(InvoicePayment.AlreadyEnded.selector, id));
        p.invoice(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
    }

    /// 경로 2: invoice → review → pay | X1→F4 → completed
    function test_path_2() public {
        uint256 id = _create();
        uint256 m;
        bool ended;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(InvoicePayment.NotAuthorized.selector, id, ROLE_VENDOR));
        p.invoice(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 0);
        vm.prank(accBuyer);
        vm.expectRevert(abi.encodeWithSelector(InvoicePayment.TaskNotEnabled.selector, id, TASK_REVIEW));
        p.review(id, false);
        vm.prank(accVendor);
        p.invoice(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000001), 0);
        (m, ended) = _marking(id);
        assertEq(m, 0x2);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(InvoicePayment.NotAuthorized.selector, id, ROLE_BUYER));
        p.review(id, true);
        vm.prank(accVendor);
        vm.expectRevert(abi.encodeWithSelector(InvoicePayment.TaskNotEnabled.selector, id, TASK_INVOICE));
        p.invoice(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accBuyer);
        p.review(id, true);
        (m, ended) = _marking(id);
        assertEq(m, 0x8);
        assertFalse(ended);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(InvoicePayment.NotAuthorized.selector, id, ROLE_BUYER));
        p.pay(id);
        vm.prank(accVendor);
        vm.expectRevert(abi.encodeWithSelector(InvoicePayment.TaskNotEnabled.selector, id, TASK_INVOICE));
        p.invoice(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
        vm.prank(accBuyer);
        p.pay(id);
        (m, ended) = _marking(id);
        assertEq(m, 0x0);
        assertTrue(ended);
        assertEq(p.enabledTasks(id), 0);
        vm.prank(accVendor);
        vm.expectRevert(abi.encodeWithSelector(InvoicePayment.AlreadyEnded.selector, id));
        p.invoice(id, bytes32(0x0000000000000000000000000000000000000000000000000000000000000000), 0);
    }
}

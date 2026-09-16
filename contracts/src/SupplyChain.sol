// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SupplyChain — BPMN "공급망 납품" 프로세스에서 자동 생성된 컨트랙트 (예시)
/// @notice 생성기 출력 형태를 보여주기 위한 참조 구현. 한 컨트랙트가 여러 인스턴스를 담는다.
/// @dev 상태 인코딩: 시퀀스 플로우 1개 = uint256 marking 의 비트 1개 (1-safe 가정)
contract SupplyChain {
    // ───────────── 역할 (BPMN 레인) ─────────────
    bytes32 public constant ROLE_SUPPLIER = keccak256("Supplier");
    bytes32 public constant ROLE_CARRIER  = keccak256("Carrier");
    bytes32 public constant ROLE_BUYER    = keccak256("Buyer");
    bytes32 public constant ROLE_FINANCE  = keccak256("Finance");

    // ───────────── 시퀀스 플로우 비트 (생성기가 부여) ─────────────
    uint256 private constant F1 = 1 << 0; // Start        -> T1 ship
    uint256 private constant F2 = 1 << 1; // T1           -> T2 deliver
    uint256 private constant F3 = 1 << 2; // T2           -> T3 inspect
    uint256 private constant F4 = 1 << 3; // T3           -> X1 (XOR: accepted&&receivedQty>=qty?)
    uint256 private constant F5 = 1 << 4; // X1 [yes]     -> T4 pay
    uint256 private constant F6 = 1 << 5; // X1 [default] -> T5 raiseClaim
    uint256 private constant F7 = 1 << 6; // T4           -> End
    uint256 private constant F8 = 1 << 7; // T5           -> End (분쟁)

    // ───────────── 태스크 식별자 (이벤트/UI 용) ─────────────
    uint8 public constant TASK_SHIP    = 1;
    uint8 public constant TASK_DELIVER = 2;
    uint8 public constant TASK_INSPECT = 3;
    uint8 public constant TASK_PAY     = 4;
    uint8 public constant TASK_CLAIM   = 5;

    // ───────────── 프로세스 변수 (BPMN dataFields 확장에서 생성) ─────────────
    struct Vars {
        bytes32 shipmentHash; // 오프체인 문서는 해시만 저장
        uint256 qty;
        bytes32 trackingHash; // 오프체인 문서는 해시만 저장
        bool accepted;
        uint256 receivedQty;
        bytes32 paymentRef; // 오프체인 문서는 해시만 저장
        bytes32 claimHash; // 오프체인 문서는 해시만 저장
    }

    struct Instance {
        uint256 marking;
        bool ended;
        address creator;
    }

    // ───────────── 저장소 ─────────────
    address public owner;          // 프로세스 소유자(비전문가 계정 또는 그 스마트 계정)
    bool public paused;
    uint256 public instanceCount;
    mapping(uint256 => Instance) public instances;
    mapping(uint256 => Vars) public vars;
    mapping(uint256 => mapping(bytes32 => address)) public roleOf; // instance -> role -> account

    // ───────────── 이벤트 (오프체인 인덱서/UI 가 구독) ─────────────
    event InstanceCreated(uint256 indexed id, address indexed creator);
    event RoleBound(uint256 indexed id, bytes32 indexed role, address account);
    event TaskCompleted(uint256 indexed id, uint8 indexed taskId, address indexed actor);
    event MarkingChanged(uint256 indexed id, uint256 marking);
    event InstanceEnded(uint256 indexed id, bool completed); // completed=false 이면 반려 종료
    event Paused(bool paused);

    // ───────────── 커스텀 에러 (가스 절약 + UI 가 해석) ─────────────
    error NotOwner();
    error IsPaused();
    error NotAuthorized(uint256 id, bytes32 role);
    error TaskNotEnabled(uint256 id, uint8 taskId);
    error AlreadyEnded(uint256 id);
    error RoleCount();

    constructor(address _owner) {
        owner = _owner;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    modifier onlyRole(uint256 id, bytes32 role) {
        if (roleOf[id][role] != msg.sender) revert NotAuthorized(id, role);
        _;
    }

    /// @dev 태스크 진입 가드: 인스턴스 미종료 + 입력 플로우 토큰 보유
    function _require(uint256 id, uint256 inFlow, uint8 taskId) internal view {
        Instance storage inst = instances[id];
        if (inst.ended) revert AlreadyEnded(id);
        if (inst.marking & inFlow == 0) revert TaskNotEnabled(id, taskId);
    }

    // ───────────── 소유자 제어 ─────────────
    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    /// @notice 인스턴스 생성 + 역할 바인딩 (역할 순서: Supplier, Carrier, Buyer, Finance)
    function createInstance(address[4] calldata roleAccounts)
        external
        whenNotPaused
        returns (uint256 id)
    {
        id = ++instanceCount;
        Instance storage inst = instances[id];
        inst.creator = msg.sender;
        inst.marking = F1; // 시작 이벤트가 첫 플로우에 토큰을 놓는다

        bytes32[4] memory roles = [ROLE_SUPPLIER, ROLE_CARRIER, ROLE_BUYER, ROLE_FINANCE];
        for (uint256 i = 0; i < 4; i++) {
            if (roleAccounts[i] == address(0)) revert RoleCount();
            roleOf[id][roles[i]] = roleAccounts[i];
            emit RoleBound(id, roles[i], roleAccounts[i]);
        }
        emit InstanceCreated(id, msg.sender);
        emit MarkingChanged(id, F1);
    }

    /// @notice 소유자가 역할 담당자를 교체 (담당자 이탈 대비)
    function rebindRole(uint256 id, bytes32 role, address account) external onlyOwner {
        roleOf[id][role] = account;
        emit RoleBound(id, role, account);
    }

    // ───────────── 사용자 태스크 (BPMN userTask 1개 = 함수 1개) ─────────────

    /// T1: 출하 [Supplier]  in: F1  out: F2  sets: shipmentHash, qty
    function ship(uint256 id, bytes32 shipmentHash, uint256 qty)
        external
        whenNotPaused
        onlyRole(id, ROLE_SUPPLIER)
    {
        _require(id, F1, TASK_SHIP);
        vars[id].shipmentHash = shipmentHash;
        vars[id].qty = qty;
        _fire(id, F1, F2, TASK_SHIP);
    }

    /// T2: 운송 완료 [Carrier]  in: F2  out: F3  sets: trackingHash
    function deliver(uint256 id, bytes32 trackingHash)
        external
        whenNotPaused
        onlyRole(id, ROLE_CARRIER)
    {
        _require(id, F2, TASK_DELIVER);
        vars[id].trackingHash = trackingHash;
        _fire(id, F2, F3, TASK_DELIVER);
    }

    /// T3: 검수 [Buyer]  in: F3  out: F4  sets: accepted, receivedQty
    function inspect(uint256 id, bool accepted, uint256 receivedQty)
        external
        whenNotPaused
        onlyRole(id, ROLE_BUYER)
    {
        _require(id, F3, TASK_INSPECT);
        vars[id].accepted = accepted;
        vars[id].receivedQty = receivedQty;
        _fire(id, F3, F4, TASK_INSPECT);
    }

    /// T4: 대금 지급 [Finance]  in: F5  out: F7  sets: paymentRef
    function pay(uint256 id, bytes32 paymentRef)
        external
        whenNotPaused
        onlyRole(id, ROLE_FINANCE)
    {
        _require(id, F5, TASK_PAY);
        vars[id].paymentRef = paymentRef;
        _fire(id, F5, F7, TASK_PAY);
    }

    /// T5: 이의 제기 [Buyer]  in: F6  out: F8  sets: claimHash
    function raiseClaim(uint256 id, bytes32 claimHash)
        external
        whenNotPaused
        onlyRole(id, ROLE_BUYER)
    {
        _require(id, F6, TASK_CLAIM);
        vars[id].claimHash = claimHash;
        _fire(id, F6, F8, TASK_CLAIM);
    }

    // ───────────── 엔진 ─────────────

    /// @dev 토큰 소비/생산 후 자동 전이(게이트웨이)를 고정점까지 실행
    function _fire(uint256 id, uint256 consume, uint256 produce, uint8 taskId) internal {
        Instance storage inst = instances[id];
        uint256 m = (inst.marking & ~consume) | produce;
        emit TaskCompleted(id, taskId, msg.sender);
        m = _step(id, m);
        inst.marking = m;
        emit MarkingChanged(id, m);
    }

    /// @dev 게이트웨이/종료 이벤트 = 외부 입력 없이 진행 가능한 "침묵 전이"
    function _step(uint256 id, uint256 m) internal returns (uint256) {
        Vars storage v = vars[id];
        bool progressed = true;
        while (progressed) {
            progressed = false;

            // X1: XOR split  in: F4  out: F5 [accepted && receivedQty >= qty] | F6 [default]
            if (m & F4 != 0) {
                m &= ~F4;
                m |= (v.accepted && v.receivedQty >= v.qty) ? F5 : F6;
                progressed = true;
            }
            // End (정상 종료)  in: F7
            if (m & F7 != 0) {
                m &= ~F7;
                instances[id].ended = true;
                emit InstanceEnded(id, true);
                progressed = true;
            }
            // End (분쟁 종료)  in: F8
            if (m & F8 != 0) {
                m &= ~F8;
                instances[id].ended = true;
                emit InstanceEnded(id, false);
                progressed = true;
            }
        }
        return m;
    }

    // ───────────── 조회 (UI 용) ─────────────

    /// @notice 현재 실행 가능한 태스크 비트맵 (bit = taskId)
    function enabledTasks(uint256 id) external view returns (uint256 bits) {
        uint256 m = instances[id].marking;
        if (instances[id].ended) return 0;
        if (m & F1 != 0) bits |= 1 << TASK_SHIP;
        if (m & F2 != 0) bits |= 1 << TASK_DELIVER;
        if (m & F3 != 0) bits |= 1 << TASK_INSPECT;
        if (m & F5 != 0) bits |= 1 << TASK_PAY;
        if (m & F6 != 0) bits |= 1 << TASK_CLAIM;
    }
}

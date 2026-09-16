// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TravelBooking — BPMN "여행 예약" 프로세스에서 자동 생성된 컨트랙트 (예시)
/// @notice 생성기 출력 형태를 보여주기 위한 참조 구현. 한 컨트랙트가 여러 인스턴스를 담는다.
/// @dev 상태 인코딩: 시퀀스 플로우 1개 = uint256 marking 의 비트 1개 (1-safe 가정)
contract TravelBooking {
    // ───────────── 역할 (BPMN 레인) ─────────────
    bytes32 public constant ROLE_TRAVELER = keccak256("Traveler");
    bytes32 public constant ROLE_APPROVER = keccak256("Approver");
    bytes32 public constant ROLE_AGENT    = keccak256("Agent");

    // ───────────── 시퀀스 플로우 비트 (생성기가 부여) ─────────────
    uint256 private constant F1  = 1 << 0;  // Start        -> T1 request
    uint256 private constant F2  = 1 << 1;  // T1           -> X1 (XOR: budget>3000?)
    uint256 private constant F3  = 1 << 2;  // X1 [yes]     -> T2 approveBudget
    uint256 private constant F4  = 1 << 3;  // X1 [default] -> A1 (AND split)
    uint256 private constant F5  = 1 << 4;  // T2           -> X2 (XOR: approved?)
    uint256 private constant F6  = 1 << 5;  // X2 [yes]     -> A1
    uint256 private constant F7  = 1 << 6;  // X2 [default] -> End (반려)
    uint256 private constant F8  = 1 << 7;  // A1           -> T3 bookFlight
    uint256 private constant F9  = 1 << 8;  // A1           -> T4 bookHotel
    uint256 private constant F10 = 1 << 9;  // T3           -> A2 (AND join)
    uint256 private constant F11 = 1 << 10; // T4           -> A2
    uint256 private constant F12 = 1 << 11; // A2           -> T5 confirm
    uint256 private constant F13 = 1 << 12; // T5           -> X3 (XOR: confirmed?)
    uint256 private constant F14 = 1 << 13; // X3 [yes]     -> End
    uint256 private constant F15 = 1 << 14; // X3 [default] -> End (취소)

    // ───────────── 태스크 식별자 (이벤트/UI 용) ─────────────
    uint8 public constant TASK_REQUEST = 1;
    uint8 public constant TASK_APPROVE = 2;
    uint8 public constant TASK_FLIGHT  = 3;
    uint8 public constant TASK_HOTEL   = 4;
    uint8 public constant TASK_CONFIRM = 5;

    // ───────────── 프로세스 변수 (BPMN dataFields 확장에서 생성) ─────────────
    struct Vars {
        bytes32 destinationHash; // 오프체인 문서는 해시만 저장
        uint256 budget;
        bool approved;
        bytes32 flightHash; // 오프체인 문서는 해시만 저장
        bytes32 hotelHash; // 오프체인 문서는 해시만 저장
        bool confirmed;
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

    /// @notice 인스턴스 생성 + 역할 바인딩 (역할 순서: Traveler, Approver, Agent)
    function createInstance(address[3] calldata roleAccounts)
        external
        whenNotPaused
        returns (uint256 id)
    {
        id = ++instanceCount;
        Instance storage inst = instances[id];
        inst.creator = msg.sender;
        inst.marking = F1; // 시작 이벤트가 첫 플로우에 토큰을 놓는다

        bytes32[3] memory roles = [ROLE_TRAVELER, ROLE_APPROVER, ROLE_AGENT];
        for (uint256 i = 0; i < 3; i++) {
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

    /// T1: 출장 요청 [Traveler]  in: F1  out: F2  sets: destinationHash, budget
    function request(uint256 id, bytes32 destinationHash, uint256 budget)
        external
        whenNotPaused
        onlyRole(id, ROLE_TRAVELER)
    {
        _require(id, F1, TASK_REQUEST);
        vars[id].destinationHash = destinationHash;
        vars[id].budget = budget;
        _fire(id, F1, F2, TASK_REQUEST);
    }

    /// T2: 예산 승인 [Approver]  in: F3  out: F5  sets: approved
    function approveBudget(uint256 id, bool approved)
        external
        whenNotPaused
        onlyRole(id, ROLE_APPROVER)
    {
        _require(id, F3, TASK_APPROVE);
        vars[id].approved = approved;
        _fire(id, F3, F5, TASK_APPROVE);
    }

    /// T3: 항공 예약 [Agent]  in: F8  out: F10  sets: flightHash
    function bookFlight(uint256 id, bytes32 flightHash)
        external
        whenNotPaused
        onlyRole(id, ROLE_AGENT)
    {
        _require(id, F8, TASK_FLIGHT);
        vars[id].flightHash = flightHash;
        _fire(id, F8, F10, TASK_FLIGHT);
    }

    /// T4: 호텔 예약 [Agent]  in: F9  out: F11  sets: hotelHash
    function bookHotel(uint256 id, bytes32 hotelHash)
        external
        whenNotPaused
        onlyRole(id, ROLE_AGENT)
    {
        _require(id, F9, TASK_HOTEL);
        vars[id].hotelHash = hotelHash;
        _fire(id, F9, F11, TASK_HOTEL);
    }

    /// T5: 일정 확인 [Traveler]  in: F12  out: F13  sets: confirmed
    function confirm(uint256 id, bool confirmed)
        external
        whenNotPaused
        onlyRole(id, ROLE_TRAVELER)
    {
        _require(id, F12, TASK_CONFIRM);
        vars[id].confirmed = confirmed;
        _fire(id, F12, F13, TASK_CONFIRM);
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

            // X1: XOR split  in: F2  out: F3 [budget > 3000] | F4 [default]
            if (m & F2 != 0) {
                m &= ~F2;
                m |= (v.budget > 3000) ? F3 : F4;
                progressed = true;
            }
            // X2: XOR split  in: F5  out: F6 [approved] | F7 [default]
            if (m & F5 != 0) {
                m &= ~F5;
                m |= v.approved ? F6 : F7;
                progressed = true;
            }
            // X3: XOR split  in: F13  out: F14 [confirmed] | F15 [default]
            if (m & F13 != 0) {
                m &= ~F13;
                m |= v.confirmed ? F14 : F15;
                progressed = true;
            }
            // A1: AND split  in: F4 | F6  out: F8 & F9
            if (m & (F4 | F6) != 0) {
                m &= ~(F4 | F6);
                m |= (F8 | F9);
                progressed = true;
            }
            // A2: AND join  in: F10 & F11  out: F12
            if (m & (F10 | F11) == (F10 | F11)) {
                m &= ~(F10 | F11);
                m |= F12;
                progressed = true;
            }
            // End (정상 종료)  in: F14
            if (m & F14 != 0) {
                m &= ~F14;
                instances[id].ended = true;
                emit InstanceEnded(id, true);
                progressed = true;
            }
            // End (취소 종료)  in: F15
            if (m & F15 != 0) {
                m &= ~F15;
                instances[id].ended = true;
                emit InstanceEnded(id, false);
                progressed = true;
            }
            // End (반려 종료)  in: F7
            if (m & F7 != 0) {
                m &= ~F7;
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
        if (m & F1 != 0) bits |= 1 << TASK_REQUEST;
        if (m & F3 != 0) bits |= 1 << TASK_APPROVE;
        if (m & F8 != 0) bits |= 1 << TASK_FLIGHT;
        if (m & F9 != 0) bits |= 1 << TASK_HOTEL;
        if (m & F12 != 0) bits |= 1 << TASK_CONFIRM;
    }
}

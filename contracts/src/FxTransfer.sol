// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FxTransfer — BPMN "해외 송금" 프로세스에서 자동 생성된 컨트랙트 (예시)
/// @notice 생성기 출력 형태를 보여주기 위한 참조 구현. 한 컨트랙트가 여러 인스턴스를 담는다.
/// @dev 상태 인코딩: 시퀀스 플로우 1개 = uint256 marking 의 비트 1개 (1-safe 가정)
contract FxTransfer {
    // ───────────── 역할 (BPMN 레인) ─────────────
    bytes32 public constant ROLE_REQUESTER = keccak256("Requester");
    bytes32 public constant ROLE_FINANCE   = keccak256("Finance");

    // ───────────── 시퀀스 플로우 비트 (생성기가 부여) ─────────────
    uint256 private constant F1 = 1 << 0; // Start        -> T1 request
    uint256 private constant F2 = 1 << 1; // T1           -> T2 fetchRate
    uint256 private constant F3 = 1 << 2; // T2           -> X1 (XOR: rateKrw>0?)
    uint256 private constant F4 = 1 << 3; // X1 [yes]     -> T3 send_
    uint256 private constant F5 = 1 << 4; // X1 [default] -> End (환율 오류)
    uint256 private constant F6 = 1 << 5; // T3           -> End

    // ───────────── 태스크 식별자 (이벤트/UI 용) ─────────────
    uint8 public constant TASK_REQUEST = 1;
    uint8 public constant TASK_RATE    = 2;
    uint8 public constant TASK_SEND    = 3;

    // ───────────── 프로세스 변수 (BPMN dataFields 확장에서 생성) ─────────────
    struct Vars {
        uint256 amountUsd;
        uint256 rateKrw;
        bytes32 txRef; // 오프체인 문서는 해시만 저장
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
    address public oracle;         // L1 서비스 태스크 응답자 (소유자가 지정)
    mapping(uint256 => mapping(uint8 => bool)) private _requested; // ServiceRequested 를 한 번만 내기 위해

    // ───────────── 이벤트 (오프체인 인덱서/UI 가 구독) ─────────────
    event InstanceCreated(uint256 indexed id, address indexed creator);
    event RoleBound(uint256 indexed id, bytes32 indexed role, address account);
    event TaskCompleted(uint256 indexed id, uint8 indexed taskId, address indexed actor);
    event MarkingChanged(uint256 indexed id, uint256 marking);
    event InstanceEnded(uint256 indexed id, bool completed); // completed=false 이면 반려 종료
    event Paused(bool paused);
    event ServiceRequested(uint256 indexed id, uint8 indexed taskId); // 오프체인 오라클이 구독
    event OracleChanged(address oracle);

    // ───────────── 커스텀 에러 (가스 절약 + UI 가 해석) ─────────────
    error NotOwner();
    error IsPaused();
    error NotAuthorized(uint256 id, bytes32 role);
    error TaskNotEnabled(uint256 id, uint8 taskId);
    error AlreadyEnded(uint256 id);
    error RoleCount();
    error NotOracle();

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

    modifier onlyOracle() {
        if (msg.sender != oracle) revert NotOracle();
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

    /// @notice 서비스 태스크에 응답할 오라클 주소 지정
    function setOracle(address o) external onlyOwner {
        oracle = o;
        emit OracleChanged(o);
    }

    /// @notice 인스턴스 생성 + 역할 바인딩 (역할 순서: Requester, Finance)
    function createInstance(address[2] calldata roleAccounts)
        external
        whenNotPaused
        returns (uint256 id)
    {
        id = ++instanceCount;
        Instance storage inst = instances[id];
        inst.creator = msg.sender;
        inst.marking = F1; // 시작 이벤트가 첫 플로우에 토큰을 놓는다

        bytes32[2] memory roles = [ROLE_REQUESTER, ROLE_FINANCE];
        for (uint256 i = 0; i < 2; i++) {
            if (roleAccounts[i] == address(0)) revert RoleCount();
            roleOf[id][roles[i]] = roleAccounts[i];
            emit RoleBound(id, roles[i], roleAccounts[i]);
        }
        emit InstanceCreated(id, msg.sender);
        _notify(id, F1);
        emit MarkingChanged(id, F1);
    }

    /// @notice 소유자가 역할 담당자를 교체 (담당자 이탈 대비)
    function rebindRole(uint256 id, bytes32 role, address account) external onlyOwner {
        roleOf[id][role] = account;
        emit RoleBound(id, role, account);
    }

    // ───────────── 사용자 태스크 (BPMN userTask 1개 = 함수 1개) ─────────────

    /// T1: 송금 요청 [Requester]  in: F1  out: F2  sets: amountUsd
    function request(uint256 id, uint256 amountUsd)
        external
        whenNotPaused
        onlyRole(id, ROLE_REQUESTER)
    {
        _require(id, F1, TASK_REQUEST);
        vars[id].amountUsd = amountUsd;
        _fire(id, F1, F2, TASK_REQUEST);
    }

    /// T2: 환율 조회 [oracle]  in: F2  out: F3  sets: rateKrw
    function fetchRate(uint256 id, uint256 rateKrw)
        external
        whenNotPaused
        onlyOracle
    {
        _require(id, F2, TASK_RATE);
        vars[id].rateKrw = rateKrw;
        _fire(id, F2, F3, TASK_RATE);
    }

    /// T3: 송금 실행 [Finance]  in: F4  out: F6  sets: txRef
    function send_(uint256 id, bytes32 txRef)
        external
        whenNotPaused
        onlyRole(id, ROLE_FINANCE)
    {
        _require(id, F4, TASK_SEND);
        vars[id].txRef = txRef;
        _fire(id, F4, F6, TASK_SEND);
    }

    // ───────────── 엔진 ─────────────

    /// @dev 토큰 소비/생산 후 자동 전이(게이트웨이)를 고정점까지 실행
    function _fire(uint256 id, uint256 consume, uint256 produce, uint8 taskId) internal {
        Instance storage inst = instances[id];
        uint256 m = (inst.marking & ~consume) | produce;
        emit TaskCompleted(id, taskId, msg.sender);
        m = _step(id, m);
        inst.marking = m;
        _notify(id, m);
        emit MarkingChanged(id, m);
    }

    /// @dev 서비스 태스크가 새로 활성화되면 오라클에게 요청 이벤트를 한 번 낸다
    function _notify(uint256 id, uint256 m) internal {
        if (m & F2 != 0 && !_requested[id][TASK_RATE]) {
            _requested[id][TASK_RATE] = true;
            emit ServiceRequested(id, TASK_RATE);
        }
    }

    /// @dev 게이트웨이/종료 이벤트 = 외부 입력 없이 진행 가능한 "침묵 전이"
    function _step(uint256 id, uint256 m) internal returns (uint256) {
        Vars storage v = vars[id];
        bool progressed = true;
        while (progressed) {
            progressed = false;

            // X1: XOR split  in: F3  out: F4 [rateKrw > 0] | F5 [default]
            if (m & F3 != 0) {
                m &= ~F3;
                m |= (v.rateKrw > 0) ? F4 : F5;
                progressed = true;
            }
            // End (정상 종료)  in: F6
            if (m & F6 != 0) {
                m &= ~F6;
                instances[id].ended = true;
                emit InstanceEnded(id, true);
                progressed = true;
            }
            // End (환율 오류 종료)  in: F5
            if (m & F5 != 0) {
                m &= ~F5;
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
        if (m & F2 != 0) bits |= 1 << TASK_RATE;
        if (m & F4 != 0) bits |= 1 << TASK_SEND;
    }
}

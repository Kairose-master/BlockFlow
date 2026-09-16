// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CreditReview — BPMN "신용 심사 (템플릿)" 프로세스에서 자동 생성된 컨트랙트 (예시)
/// @notice 생성기 출력 형태를 보여주기 위한 참조 구현. 한 컨트랙트가 여러 인스턴스를 담는다.
/// @dev 상태 인코딩: 시퀀스 플로우 1개 = uint256 marking 의 비트 1개 (1-safe 가정)
contract CreditReview {
    // ───────────── 역할 (BPMN 레인) ─────────────
    bytes32 public constant ROLE_APPLICANT = keccak256("Applicant");
    bytes32 public constant ROLE_OFFICER   = keccak256("Officer");
    bytes32 public constant ROLE_COMMITTEE = keccak256("Committee");
    bytes32 public constant ROLE_DISBURSER = keccak256("Disburser");

    // ───────────── 시퀀스 플로우 비트 (생성기가 부여) ─────────────
    uint256 private constant F1  = 1 << 0;  // Start        -> T1 apply_
    uint256 private constant F2  = 1 << 1;  // T1           -> T2 score
    uint256 private constant F3  = 1 << 2;  // T2           -> X1 (XOR: score>=60?)
    uint256 private constant F4  = 1 << 3;  // X1 [yes]     -> X2 (XOR: amount>50000?)
    uint256 private constant F5  = 1 << 4;  // X1 [default] -> End (거절)
    uint256 private constant F6  = 1 << 5;  // X2 [yes]     -> T3 approve
    uint256 private constant F7  = 1 << 6;  // X2 [default] -> T4 disburse
    uint256 private constant F8  = 1 << 7;  // T3           -> X3 (XOR: approved?)
    uint256 private constant F9  = 1 << 8;  // X3 [yes]     -> T4 disburse
    uint256 private constant F10 = 1 << 9;  // X3 [default] -> End (거절)
    uint256 private constant F11 = 1 << 10; // T2 [timeout] -> End (심사 지연)
    uint256 private constant F12 = 1 << 11; // T4           -> End

    // ───────────── 태스크 식별자 (이벤트/UI 용) ─────────────
    uint8 public constant TASK_APPLY    = 1;
    uint8 public constant TASK_SCORE    = 2;
    uint8 public constant TASK_APPROVE  = 3;
    uint8 public constant TASK_DISBURSE = 4;

    // ───────────── 프로세스 변수 (BPMN dataFields 확장에서 생성) ─────────────
    struct Vars {
        uint256 amount;
        bytes32 docHash; // 오프체인 문서는 해시만 저장
        uint256 reviewWithin;
        uint256 score;
        bool approved;
        bytes32 contractHash; // 오프체인 문서는 해시만 저장
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
    mapping(uint256 => mapping(uint8 => uint64)) public startedAt; // instance -> taskId -> 활성화 시각 (L1 타이머)

    // ───────────── 이벤트 (오프체인 인덱서/UI 가 구독) ─────────────
    event InstanceCreated(uint256 indexed id, address indexed creator);
    event RoleBound(uint256 indexed id, bytes32 indexed role, address account);
    event TaskCompleted(uint256 indexed id, uint8 indexed taskId, address indexed actor);
    event MarkingChanged(uint256 indexed id, uint256 marking);
    event InstanceEnded(uint256 indexed id, bool completed); // completed=false 이면 반려 종료
    event Paused(bool paused);
    event TaskExpired(uint256 indexed id, uint8 indexed taskId);

    // ───────────── 커스텀 에러 (가스 절약 + UI 가 해석) ─────────────
    error NotOwner();
    error IsPaused();
    error NotAuthorized(uint256 id, bytes32 role);
    error TaskNotEnabled(uint256 id, uint8 taskId);
    error AlreadyEnded(uint256 id);
    error RoleCount();
    error NotExpired(uint256 id, uint8 taskId);

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

    /// @notice 인스턴스 생성 + 역할 바인딩 (역할 순서: Applicant, Officer, Committee, Disburser)
    function createInstance(address[4] calldata roleAccounts)
        external
        whenNotPaused
        returns (uint256 id)
    {
        id = ++instanceCount;
        Instance storage inst = instances[id];
        inst.creator = msg.sender;
        inst.marking = F1; // 시작 이벤트가 첫 플로우에 토큰을 놓는다

        bytes32[4] memory roles = [ROLE_APPLICANT, ROLE_OFFICER, ROLE_COMMITTEE, ROLE_DISBURSER];
        for (uint256 i = 0; i < 4; i++) {
            if (roleAccounts[i] == address(0)) revert RoleCount();
            roleOf[id][roles[i]] = roleAccounts[i];
            emit RoleBound(id, roles[i], roleAccounts[i]);
        }
        emit InstanceCreated(id, msg.sender);
        _stamp(id, F1);
        emit MarkingChanged(id, F1);
    }

    /// @notice 소유자가 역할 담당자를 교체 (담당자 이탈 대비)
    function rebindRole(uint256 id, bytes32 role, address account) external onlyOwner {
        roleOf[id][role] = account;
        emit RoleBound(id, role, account);
    }

    // ───────────── 사용자 태스크 (BPMN userTask 1개 = 함수 1개) ─────────────

    /// T1: 대출 신청 [Applicant]  in: F1  out: F2  sets: amount, docHash, reviewWithin
    function apply_(uint256 id, uint256 amount, bytes32 docHash, uint256 reviewWithin)
        external
        whenNotPaused
        onlyRole(id, ROLE_APPLICANT)
    {
        _require(id, F1, TASK_APPLY);
        vars[id].amount = amount;
        vars[id].docHash = docHash;
        vars[id].reviewWithin = reviewWithin;
        _fire(id, F1, F2, TASK_APPLY);
    }

    /// T2: 신용 평가 [Officer]  in: F2  out: F3  sets: score
    function score(uint256 id, uint256 score_)
        external
        whenNotPaused
        onlyRole(id, ROLE_OFFICER)
    {
        _require(id, F2, TASK_SCORE);
        vars[id].score = score_;
        _fire(id, F2, F3, TASK_SCORE);
    }

    /// T3: 위원회 승인 [Committee]  in: F6  out: F8  sets: approved
    function approve(uint256 id, bool approved)
        external
        whenNotPaused
        onlyRole(id, ROLE_COMMITTEE)
    {
        _require(id, F6, TASK_APPROVE);
        vars[id].approved = approved;
        _fire(id, F6, F8, TASK_APPROVE);
    }

    /// T4: 약정·지급 [Disburser]  in: F7 | F9  out: F12  sets: contractHash
    function disburse(uint256 id, bytes32 contractHash)
        external
        whenNotPaused
        onlyRole(id, ROLE_DISBURSER)
    {
        _require(id, (F7 | F9), TASK_DISBURSE);
        vars[id].contractHash = contractHash;
        _fire(id, (F7 | F9), F12, TASK_DISBURSE);
    }

    // ───────────── 타이머 만료 (L1 경계 이벤트: 기한이 지나면 누구나 호출) ─────────────

    /// T2 timeout: 신용 평가 기한(reviewWithin) 경과 시 누구나 호출  in: F2  out: F11
    function expireScore(uint256 id) external whenNotPaused {
        _require(id, F2, TASK_SCORE);
        if (block.timestamp < uint256(startedAt[id][TASK_SCORE]) + vars[id].reviewWithin) revert NotExpired(id, TASK_SCORE);
        _expire(id, F2, F11, TASK_SCORE);
    }

    // ───────────── 엔진 ─────────────

    /// @dev 토큰 소비/생산 후 자동 전이(게이트웨이)를 고정점까지 실행
    function _fire(uint256 id, uint256 consume, uint256 produce, uint8 taskId) internal {
        Instance storage inst = instances[id];
        uint256 m = (inst.marking & ~consume) | produce;
        emit TaskCompleted(id, taskId, msg.sender);
        m = _step(id, m);
        inst.marking = m;
        _stamp(id, m);
        emit MarkingChanged(id, m);
    }

    /// @dev 타이머 만료: 태스크 토큰을 만료 경로로 옮기고 침묵 전이를 실행
    function _expire(uint256 id, uint256 consume, uint256 produce, uint8 taskId) internal {
        Instance storage inst = instances[id];
        uint256 m = (inst.marking & ~consume) | produce;
        emit TaskExpired(id, taskId);
        m = _step(id, m);
        inst.marking = m;
        _stamp(id, m);
        emit MarkingChanged(id, m);
    }

    /// @dev 타이머가 붙은 태스크가 새로 활성화되면 시각을 기록
    function _stamp(uint256 id, uint256 m) internal {
        if (m & F2 != 0 && startedAt[id][TASK_SCORE] == 0) startedAt[id][TASK_SCORE] = uint64(block.timestamp);
    }

    /// @dev 게이트웨이/종료 이벤트 = 외부 입력 없이 진행 가능한 "침묵 전이"
    function _step(uint256 id, uint256 m) internal returns (uint256) {
        Vars storage v = vars[id];
        bool progressed = true;
        while (progressed) {
            progressed = false;

            // X1: XOR split  in: F3  out: F4 [score >= 60] | F5 [default]
            if (m & F3 != 0) {
                m &= ~F3;
                m |= (v.score >= 60) ? F4 : F5;
                progressed = true;
            }
            // X2: XOR split  in: F4  out: F6 [amount > 50000] | F7 [default]
            if (m & F4 != 0) {
                m &= ~F4;
                m |= (v.amount > 50000) ? F6 : F7;
                progressed = true;
            }
            // X3: XOR split  in: F8  out: F9 [approved] | F10 [default]
            if (m & F8 != 0) {
                m &= ~F8;
                m |= v.approved ? F9 : F10;
                progressed = true;
            }
            // End (정상 종료)  in: F12
            if (m & F12 != 0) {
                m &= ~F12;
                instances[id].ended = true;
                emit InstanceEnded(id, true);
                progressed = true;
            }
            // End (거절 종료)  in: F5 | F10
            if (m & (F5 | F10) != 0) {
                m &= ~(F5 | F10);
                instances[id].ended = true;
                emit InstanceEnded(id, false);
                progressed = true;
            }
            // End (심사 지연 종료)  in: F11
            if (m & F11 != 0) {
                m &= ~F11;
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
        if (m & F1 != 0) bits |= 1 << TASK_APPLY;
        if (m & F2 != 0) bits |= 1 << TASK_SCORE;
        if (m & F6 != 0) bits |= 1 << TASK_APPROVE;
        if (m & (F7 | F9) != 0) bits |= 1 << TASK_DISBURSE;
    }
}

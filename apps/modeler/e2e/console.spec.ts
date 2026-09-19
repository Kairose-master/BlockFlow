/**
 * Phase 3 완료 기준 (가이드 11장): 3인 3역할로 인스턴스를 완주한다. 여기서는 로컬 체인 모드에서
 * 배포(C1) → 새 건 시작 + 담당자 지정(C2) → 역할별 사용자로 전환해 할 일 완료(C3) → 담당자 교체(C4) → 일시정지(C5) 를 돈다.
 */
import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("blockflow.locale.v1", "ko"));
});

async function selectUser(page: Page, label: string) {
  await page.getByTestId("user-select").selectOption({ label });
}

test("경비 승인: 배포 → 새 건 → 신청·승인·지급·영수증 → 완료, 담당자 교체·일시정지", async ({ page }) => {
  test.setTimeout(120_000);
  // C1 배포 (운영자)
  await page.goto("/");
  await expect(page.getByTestId("user-select")).toBeVisible();
  await selectUser(page, "운영자 (소유자)");
  await page.getByTestId("example-select").selectOption("expense-approval");
  await expect(page.locator('[data-element-id="Task_Submit"]')).toBeVisible();
  await page.getByTestId("compile").click();
  await expect(page.getByTestId("compile-status")).toContainText("컴파일 성공", { timeout: 30_000 });
  await page.getByTestId("deploy").click();
  await expect(page).toHaveURL(/\/processes\/0x[0-9a-fA-F]{40}$/, { timeout: 30_000 });
  const boardUrl = page.url();

  // C2 새 건 시작: 신청자=김신청, 팀장=이팀장, 재무=박재무
  await page.getByTestId("new-instance").click();
  await page.getByTestId("role-Requester").selectOption({ label: "김신청" });
  await page.getByTestId("role-Manager").selectOption({ label: "이팀장" });
  await page.getByTestId("role-Finance").selectOption({ label: "박재무" });
  await page.getByTestId("create-confirm").click();
  await expect(page.getByTestId("instance-1")).toBeVisible();
  await expect(page.getByTestId("instance-status")).toContainText("[경비 신청] ← 김신청");

  // 운영자에게는 할 일이 없다
  await page.goto("/todo");
  await expect(page.getByTestId("no-todo")).toBeVisible();

  // C3 김신청: 경비 신청 5000 (고액 → 팀장 승인 필요)
  await selectUser(page, "김신청");
  await expect(page.getByTestId("todo-card")).toHaveCount(1);
  await page.getByTestId("field-amount").fill("5000");
  await page.getByTestId("complete-submit").click();
  await expect(page.getByTestId("task-done")).toContainText("다음 담당자 차례");

  // 이팀장: 승인 — 예/아니오 기본값("예")을 그대로 둔 채 완료 (기본값이 전송되는지 확인)
  await selectUser(page, "이팀장");
  await expect(page.getByTestId("todo-card")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByTestId("field-approved")).toHaveValue("true");
  await page.getByTestId("complete-approve").click();
  await expect(page.getByTestId("task-done")).toBeVisible();

  // 박재무: 지급. 김신청: 영수증 → 종료
  await selectUser(page, "박재무");
  await expect(page.getByTestId("todo-card")).toHaveCount(1, { timeout: 15_000 });
  await page.getByTestId("complete-pay").click();
  await expect(page.getByTestId("task-done")).toBeVisible();
  await selectUser(page, "김신청");
  await expect(page.getByTestId("todo-card")).toHaveCount(1, { timeout: 15_000 });
  await page.getByTestId("field-receiptHash").fill("영수증.pdf");
  await page.getByTestId("complete-uploadReceipt").click();
  await expect(page.getByTestId("task-done")).toContainText("정상 종료");

  // 보드: 완료 표시, 기록 4건
  await page.goto(boardUrl);
  await expect(page.getByTestId("instance-status")).toContainText("정상 완료", { timeout: 15_000 });
  await page.goto("/history");
  await expect(page.getByTestId("history-entry").filter({ hasText: "완료" })).toHaveCount(5); // 태스크 4 + 정상 완료 1

  // C4 담당자 교체 + C5 일시정지 (운영자): 두 번째 건에서 신청자를 최구매로 바꾸면 김신청은 할 일이 없다
  await selectUser(page, "운영자 (소유자)");
  await page.goto(boardUrl);
  await page.getByTestId("new-instance").click();
  await page.getByTestId("role-Requester").selectOption({ label: "김신청" });
  await page.getByTestId("create-confirm").click();
  await expect(page.getByTestId("instance-2")).toBeVisible();
  await page.getByTestId("instance-2").click();
  await page.getByTestId("rebind-Requester").selectOption({ label: "최구매" });
  await expect(page.getByTestId("instance-status")).toContainText("← 최구매", { timeout: 15_000 });

  await page.goto("/processes");
  await page.getByRole("button", { name: "일시정지" }).click();
  await expect(page.getByTestId("process-card")).toContainText("일시정지", { timeout: 15_000 });
  await selectUser(page, "최구매");
  await page.goto("/todo");
  await expect(page.getByTestId("no-todo")).toBeVisible(); // 멈춰 있으면 할 일이 뜨지 않는다
  await selectUser(page, "운영자 (소유자)");
  await page.goto("/processes");
  await page.getByRole("button", { name: "재개" }).click();
  await expect(page.getByTestId("process-card")).toContainText("운영 중", { timeout: 15_000 });
});

test("권한 없는 사용자는 배포·일시정지를 할 수 없다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("user-select")).toBeVisible();
  await selectUser(page, "김신청");
  await page.getByTestId("example-select").selectOption("purchase-order");
  await expect(page.locator('[data-element-id="Task_Request"]')).toBeVisible();
  await page.getByTestId("compile").click();
  await expect(page.getByTestId("compile-status")).toContainText("컴파일 성공", { timeout: 30_000 });
  await page.getByTestId("deploy").click();
  await expect(page.getByTestId("deploy-error")).toContainText("소유자만");
});

test("C6 버전 교체: 같은 프로세스를 다시 배포하면 새 버전이 되고, 이전 버전은 새 건을 받지 않는다", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(page.getByTestId("user-select")).toBeVisible();
  await selectUser(page, "운영자 (소유자)");
  for (let i = 0; i < 2; i++) {
    await page.goto("/");
    await page.getByTestId("example-select").selectOption("paper-review");
    await expect(page.locator('[data-element-id="Task_Submit"]')).toBeVisible();
    await page.getByTestId("compile").click();
    await expect(page.getByTestId("compile-status")).toContainText("컴파일 성공", { timeout: 30_000 });
    await page.getByTestId("deploy").click();
    await expect(page).toHaveURL(/\/processes\/0x/, { timeout: 30_000 });
  }
  await expect(page.getByTestId("board-version")).toHaveText("v2");
  await page.goto("/processes");
  const cards = page.getByTestId("process-card").filter({ hasText: "논문 심사" });
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: "이전 버전" })).toHaveCount(1);
  await expect(page.getByTestId("superseded")).toBeVisible();
  // 이전 버전 보드에서는 새 건 시작이 비활성
  await cards.filter({ hasText: "이전 버전" }).getByRole("link", { name: "보드 열기" }).click();
  await expect(page.getByTestId("board-version")).toHaveText("v1");
  await expect(page.getByTestId("new-instance")).toBeDisabled();
});

test("L1 타이머: 기한이 지나면 누구나 만료 처리할 수 있다 (로컬 체인 시간 건너뛰기)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(page.getByTestId("user-select")).toBeVisible();
  await selectUser(page, "운영자 (소유자)");
  await page.getByTestId("example-select").selectOption("leave-request");
  await expect(page.locator('[data-element-id="Task_Request"]')).toBeVisible();
  await page.getByTestId("compile").click();
  await expect(page.getByTestId("compile-status")).toContainText("컴파일 성공", { timeout: 30_000 });
  await page.getByTestId("deploy").click();
  await expect(page).toHaveURL(/\/processes\/0x/, { timeout: 30_000 });
  const boardUrl = page.url();
  await page.getByTestId("new-instance").click();
  await page.getByTestId("role-Employee").selectOption({ label: "김신청" });
  await page.getByTestId("role-Manager").selectOption({ label: "이팀장" });
  await page.getByTestId("create-confirm").click();
  await expect(page.getByTestId("instance-1")).toBeVisible();

  // 직원: 3일, 답변 기한 3600초
  await selectUser(page, "김신청");
  await page.goto("/todo");
  await expect(page.getByTestId("todo-card")).toHaveCount(1);
  await page.getByTestId("field-leaveDays").fill("3");
  await page.getByTestId("field-replyWithin").fill("3600");
  await page.getByTestId("complete-request").click();
  await expect(page.getByTestId("task-done")).toBeVisible();

  // 보드: 기한 남음 → 시간 건너뛰기 → 만료 처리 → 기한 만료 종료
  await selectUser(page, "운영자 (소유자)");
  await page.goto(boardUrl);
  await expect(page.getByTestId("timers")).toContainText("남음", { timeout: 15_000 });
  await expect(page.getByTestId("expire-approve")).toHaveCount(0);
  await page.getByTestId("skip-1h").click();
  await expect(page.getByTestId("expire-approve")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("expire-approve").click();
  await expect(page.getByTestId("instance-status")).toContainText("중단", { timeout: 15_000 });
  await expect(page.getByTestId("task-done")).toContainText("만료 처리");
});

test("보드의 '다이어그램 편집' 은 배포된 XML 을 모델러에 연다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("user-select")).toBeVisible();
  await selectUser(page, "운영자 (소유자)");
  await page.getByTestId("example-select").selectOption("supply-chain");
  await expect(page.locator('[data-element-id="Task_Ship"]')).toBeVisible();
  await page.getByTestId("compile").click();
  await expect(page.getByTestId("compile-status")).toContainText("컴파일 성공", { timeout: 30_000 });
  await page.getByTestId("deploy").click();
  await expect(page).toHaveURL(/\/processes\/0x/, { timeout: 30_000 });
  await page.getByTestId("edit-diagram").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("restored-notice")).toContainText("보드에서 가져온");
  await expect(page.locator('[data-element-id="Task_Ship"]')).toBeVisible();
});

test("L1 오라클: 외부 서비스 단계는 지정된 오라클 사용자만 응답할 수 있다", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(page.getByTestId("user-select")).toBeVisible();
  await selectUser(page, "운영자 (소유자)");
  await page.getByTestId("example-select").selectOption("fx-transfer");
  await expect(page.locator('[data-element-id="Service_Rate"]')).toBeVisible();
  await page.getByTestId("compile").click();
  await expect(page.getByTestId("compile-status")).toContainText("컴파일 성공", { timeout: 30_000 });
  await page.getByTestId("deploy").click();
  await expect(page).toHaveURL(/\/processes\/0x/, { timeout: 30_000 });
  const boardUrl = page.url();
  await page.getByTestId("new-instance").click();
  await page.getByTestId("role-Requester").selectOption({ label: "김신청" });
  await page.getByTestId("role-Finance").selectOption({ label: "박재무" });
  await page.getByTestId("create-confirm").click();
  await expect(page.getByTestId("instance-1")).toBeVisible();

  await selectUser(page, "김신청");
  await page.goto("/todo");
  await expect(page.getByTestId("todo-card")).toHaveCount(1);
  await page.getByTestId("field-amountUsd").fill("100");
  await page.getByTestId("complete-request").click();
  await expect(page.getByTestId("task-done")).toBeVisible();

  // 보드: 외부 서비스 응답 대기. 재무에게는 아직 할 일이 없다
  await page.goto(boardUrl);
  await expect(page.getByTestId("instance-status")).toContainText("외부 서비스 응답 대기", { timeout: 15_000 });
  await selectUser(page, "박재무");
  await page.goto("/todo");
  await expect(page.getByTestId("no-todo")).toBeVisible();

  // 오라클이 환율을 돌려준다
  await selectUser(page, "오라클 (외부 서비스)");
  await page.goto("/todo");
  await expect(page.getByTestId("todo-card")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByTestId("todo-card")).toContainText("외부 서비스 (오라클)");
  await page.getByTestId("field-rateKrw").fill("1350");
  await page.getByTestId("complete-fetchRate").click();
  await expect(page.getByTestId("task-done")).toBeVisible();

  // 재무가 송금 실행 → 완료
  await selectUser(page, "박재무");
  await page.goto("/todo");
  await expect(page.getByTestId("todo-card")).toHaveCount(1, { timeout: 15_000 });
  await page.getByTestId("field-txRef").fill("SWIFT-001");
  await page.getByTestId("complete-send_").click();
  await expect(page.getByTestId("task-done")).toContainText("정상 종료");
});

test("L1 결제: 결제 태스크를 완료하면 지출 승인 없이도 토큰이 지급된다 (로컬 데모 토큰)", async ({ page }) => {
  // 예시의 토큰 주소(0x1000…0001)에 데모 토큰을 심는 것은 로컬 모드만 한다. rpc 모드는 실제 토큰이 있어야 한다.
  test.skip(!!process.env.BLOCKFLOW_RPC_URL, "rpc 모드에는 예시 토큰 주소에 컨트랙트가 없다");
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(page.getByTestId("user-select")).toBeVisible();
  await selectUser(page, "운영자 (소유자)");
  await page.getByTestId("example-select").selectOption("invoice-payment");
  await expect(page.locator('[data-element-id="Task_Pay"]')).toBeVisible();
  await page.getByTestId("compile").click();
  await expect(page.getByTestId("compile-status")).toContainText("컴파일 성공", { timeout: 30_000 });
  await page.getByTestId("deploy").click();
  await expect(page).toHaveURL(/\/processes\/0x/, { timeout: 30_000 });
  await page.getByTestId("new-instance").click();
  await page.getByTestId("role-Vendor").selectOption({ label: "정공급" });
  await page.getByTestId("role-Buyer").selectOption({ label: "최구매" });
  await page.getByTestId("create-confirm").click();
  await expect(page.getByTestId("instance-1")).toBeVisible();

  await selectUser(page, "정공급");
  await page.goto("/todo");
  await expect(page.getByTestId("todo-card")).toHaveCount(1);
  await page.getByTestId("field-invoiceHash").fill("INV-2026-001");
  await page.getByTestId("field-amount").fill("2500");
  await page.getByTestId("complete-invoice").click();
  await expect(page.getByTestId("task-done")).toBeVisible();

  // 최구매는 앞 테스트(경비 승인 2번째 건 담당자 교체)의 할 일도 갖고 있으므로 이 프로세스 카드만 본다
  await selectUser(page, "최구매");
  await page.goto("/todo");
  const mine = page.getByTestId("todo-card").filter({ hasText: "청구 결제" });
  await expect(mine).toHaveCount(1, { timeout: 15_000 });
  await mine.getByTestId("complete-review").click(); // 승인 여부 기본값 "예"
  await expect(page.getByTestId("task-done")).toBeVisible();
  // 결제 카드
  await expect(mine).toHaveCount(1, { timeout: 15_000 });
  await expect(mine.getByTestId("payment-notice")).toContainText("공급사");
  await mine.getByTestId("complete-pay").click();
  await expect(page.getByTestId("task-done")).toContainText("2500 토큰", { timeout: 15_000 });
  await expect(page.getByTestId("task-done")).toContainText("정상 종료");
});

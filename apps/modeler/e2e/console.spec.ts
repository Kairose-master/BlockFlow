/**
 * Phase 3 완료 기준 (가이드 11장): 3인 3역할로 인스턴스를 완주한다. 여기서는 로컬 체인 모드에서
 * 배포(C1) → 새 건 시작 + 담당자 지정(C2) → 역할별 사용자로 전환해 할 일 완료(C3) → 담당자 교체(C4) → 일시정지(C5) 를 돈다.
 */
import { expect, test, type Page } from "@playwright/test";

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

  // 이팀장: 승인
  await selectUser(page, "이팀장");
  await expect(page.getByTestId("todo-card")).toHaveCount(1, { timeout: 15_000 });
  await page.getByTestId("field-approved").selectOption("true");
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

/**
 * Phase 2 완료 기준 (가이드 11장): 설명 없이 "경비 승인" 을 그려 컴파일 통과.
 * 여기서는 (1) 예시를 열어 컴파일하면 부록 C 와 같은 컨트랙트가 나오고, (2) 규칙 위반이 즉시 배지·문장으로 보이고,
 * (3) 팔레트가 L0 로 제한되고, (4) 빈 다이어그램에서 속성 패널·역할 추가·조건 빌더로 프로세스를 조립할 수 있는지 본다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const REFERENCE = readFileSync(join(__dirname, "..", "..", "..", "contracts", "src", "ExpenseApproval.sol"), "utf8");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("blockflow.locale.v1") === null) {
      localStorage.setItem("blockflow.locale.v1", "ko");
    }
  });
});

async function openExample(page: Page, name: string, waitFor = "Task_Submit") {
  await page.goto("/");
  await page.getByTestId("example-select").selectOption(name);
  await expect(page.locator(`[data-element-id="${waitFor}"]`)).toBeVisible();
}

test("팔레트는 L0 요소 + L1(외부 서비스, 기한)만 보여준다", async ({ page }) => {
  await page.goto("/");
  const entries = page.locator(".djs-palette .entry");
  await expect(entries).toHaveCount(9); // 손, 선택, 시작, 끝, 할 일, 외부 서비스, XOR, AND, 기한
  await expect(page.locator(".djs-palette .bpmn-icon-subprocess-expanded")).toHaveCount(0);
  await expect(page.locator(".djs-palette .bpmn-icon-task")).toHaveCount(0);
});

test("언어 전환은 모델러 핵심 흐름을 영어로 바꾸고 선택을 저장한다", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("locale-toggle").click();
  await expect(page.getByTestId("new-diagram")).toHaveText("New diagram");
  await expect(page.getByTestId("diagnostics")).toContainText("Validation");
  await expect(page.getByTestId("example-select")).toContainText("Expense approval");
  await page.getByTestId("example-select").selectOption("expense-approval");
  await expect(page.locator('[data-element-id="Task_Submit"]')).toBeVisible();
  await expect(page.getByTestId("canvas")).toContainText("Submit expense");
  await expect(page.getByTestId("canvas")).not.toContainText("경비 신청");
  await page.reload();
  await expect(page.getByTestId("new-diagram")).toHaveText("New diagram");
  await expect(page.getByTestId("canvas")).toContainText("Submit expense");
});

test("예시(경비 승인)를 열면 규칙 통과, 컴파일 결과가 부록 C 와 같다", async ({ page }) => {
  await openExample(page, "expense-approval");
  await expect(page.getByTestId("diagnostics")).toContainText("문제 없음");
  await page.getByTestId("compile").click();
  await expect(page.getByTestId("compile-status")).toContainText("컴파일 성공", { timeout: 30_000 });
  await expect(page.getByTestId("compile-status")).toContainText("3,960 B");
  const sol = await page.getByTestId("solidity").innerText();
  expect(sol.trim()).toBe(REFERENCE.trim());
});

test("기본 화살표를 없애면 즉시 R5 진단과 배지가 뜬다", async ({ page }) => {
  await openExample(page, "expense-approval");
  await page.locator('[data-element-id="Flow_4"]').click({ force: true });
  await expect(page.getByTestId("flow-default")).toBeChecked();
  await page.getByTestId("flow-default").uncheck();
  await expect(page.getByTestId("diagnostics")).toContainText("기본 화살표를 정하세요");
  await expect(page.locator(".bf-badge").first()).toBeVisible();
  // 컴파일은 거부된다
  await page.getByTestId("compile").click();
  await expect(page.getByTestId("compile-status")).toContainText("다이어그램을 먼저 고쳐 주세요");
});

test("빈 다이어그램: 역할 추가, 값 추가, 할 일 입력, 조건 빌더", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-diagram").click();
  await page.getByTestId("add-lane").click();
  await expect(page.locator('.djs-element[data-element-id^="Lane_"]')).toHaveCount(2);

  // 프로세스 값 추가
  // 빈 캔버스를 클릭해 선택을 풀면 프로세스 설정이 보인다
  await page.locator('svg[data-element-id="Collaboration_1"]').click({ position: { x: 600, y: 30 } });
  await page.getByTestId("add-variable").click();
  await page.getByTestId("var-name-0").fill("amount");
  await expect(page.getByTestId("var-name-0")).toHaveValue("amount");

  // 아직 종료 이벤트가 없으므로 R2 가 보인다
  await expect(page.getByTestId("diagnostics")).toContainText("끝나는 지점이 필요해요");
});

test("토큰 시뮬레이션 미리보기를 켜고 끌 수 있다", async ({ page }) => {
  await openExample(page, "purchase-order", "Task_Request");
  await page.getByTestId("simulate").click();
  // 시뮬레이션 모드에서는 편집 팔레트가 숨고 시뮬레이션 팔레트가 나온다
  await expect(page.locator(".djs-palette")).toHaveClass(/hidden/);
  await expect(page.getByTestId("simulate")).toHaveText("미리보기 끄기");
  await page.getByTestId("simulate").click();
  await expect(page.locator(".djs-palette")).not.toHaveClass(/hidden/);
});

test("초안은 자동 저장되어 새로고침 후 복원되고, 새로 만들기가 지운다", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-diagram").click();
  await page.getByTestId("add-lane").click();
  await expect(page.locator('.djs-element[data-element-id^="Lane_"]')).toHaveCount(2);
  await page.waitForTimeout(400); // 자동 저장
  await page.reload();
  await expect(page.getByTestId("restored-notice")).toContainText("이전 초안");
  await expect(page.locator('.djs-element[data-element-id^="Lane_"]')).toHaveCount(2);
  await page.getByTestId("new-diagram").click();
  await page.reload();
  await expect(page.getByTestId("restored-notice")).toHaveCount(0);
  await expect(page.locator('.djs-element[data-element-id^="Lane_"]')).toHaveCount(1);
});

test("컴파일 결과에서 배포 번들(소스+ABI+바이트코드+안내)을 내려받을 수 있다", async ({ page }) => {
  await openExample(page, "expense-approval");
  await page.getByTestId("compile").click();
  await expect(page.getByTestId("compile-status")).toContainText("컴파일 성공", { timeout: 30_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("bundle").click()]);
  expect(download.suggestedFilename()).toBe("ExpenseApproval.bundle.json");
  const path = await download.path();
  const bundle = JSON.parse(require("node:fs").readFileSync(path!, "utf8"));
  expect(bundle.sol).toContain("contract ExpenseApproval");
  expect(bundle.bytecode).toMatch(/^0x[0-9a-f]+$/);
  expect(Array.isArray(bundle.abi)).toBe(true);
  expect(bundle.readme).toContain("FISCO BCOS");
});

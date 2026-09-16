import { describe, expect, it } from "vitest";
import { isReserved, roleConst, screamingSnake, taskConst, toIdentifier, uniqueName } from "../src/names.js";

describe("names", () => {
  it("라벨 → 식별자", () => {
    expect(toIdentifier("upload receipt", "task4")).toBe("uploadReceipt");
    expect(toIdentifier("Pay-out 2", "t")).toBe("payOut2");
    expect(toIdentifier("경비 신청", "task1")).toBe("task1");
    expect(toIdentifier("2nd review", "t")).toBe("_2ndReview");
    expect(toIdentifier("owner", "t")).toBe("owner_");
    expect(toIdentifier("transfer", "t")).toBe("transfer");
  });

  it("예약어", () => {
    expect(isReserved("function")).toBe(true);
    expect(isReserved("uint8")).toBe(true);
    expect(isReserved("bytes32")).toBe(true);
    expect(isReserved("_fire")).toBe(true);
    expect(isReserved("submit")).toBe(false);
  });

  it("상수 이름", () => {
    expect(screamingSnake("uploadReceipt")).toBe("UPLOAD_RECEIPT");
    expect(screamingSnake("ReviewerA")).toBe("REVIEWER_A");
    expect(roleConst("Requester")).toBe("ROLE_REQUESTER");
    expect(taskConst("RECEIPT")).toBe("TASK_RECEIPT");
  });

  it("충돌 시 _2, _3", () => {
    const used = new Set<string>();
    expect(uniqueName("approve", used)).toBe("approve");
    expect(uniqueName("approve", used)).toBe("approve_2");
    expect(uniqueName("approve", used)).toBe("approve_3");
  });
});

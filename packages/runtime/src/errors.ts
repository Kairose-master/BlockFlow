/**
 * errors.ts — 생성 컨트랙트의 커스텀 에러 → 비전문가 문장 (가이드 8.4 "이 일은 아직 차례가 아니에요").
 *
 * 생성 코드의 에러 집합은 고정돼 있으므로 표도 고정이다. UI 는 simulate 결과를 이 표로 번역해 보여주고,
 * 실패할 트랜잭션에는 가스를 쓰지 않는다.
 */
import type { IR } from "@blockflow/ir";
import type { ContractError } from "./adapter";

export interface Translation {
  /** 사용자에게 보여줄 문장 */
  message: string;
  /** UI 힌트: 어떤 요소를 강조할지 */
  hint?: { kind: "task" | "lane" | "process"; id?: string };
}

export function translateError(err: ContractError, ir?: IR): Translation {
  const [a0, a1] = err.args;
  switch (err.name) {
    case "TaskNotEnabled": {
      const task = ir?.nodes.find((n) => (n.kind === "userTask" || n.kind === "serviceTask") && n.taskId === Number(a1));
      const label = task && (task.kind === "userTask" || task.kind === "serviceTask") ? task.label : undefined;
      return {
        message: label ? `[${label}]은(는) 아직 차례가 아니에요` : "이 일은 아직 차례가 아니에요",
        hint: { kind: "task", ...(task ? { id: task.id } : {}) },
      };
    }
    case "NotAuthorized": {
      const role = ir?.roles.find((r) => roleHash(r.key) === String(a1).toLowerCase());
      return {
        message: role ? `이 일은 [${role.label}] 담당자만 할 수 있어요` : "이 일을 할 권한이 없어요",
        hint: { kind: "lane", ...(role ? { id: role.key } : {}) },
      };
    }
    case "AlreadyEnded":
      return { message: `이 건(#${String(a0)})은 이미 끝났어요`, hint: { kind: "process" } };
    case "IsPaused":
      return { message: "프로세스가 잠시 멈춰 있어요. 소유자가 다시 시작하면 진행할 수 있어요", hint: { kind: "process" } };
    case "NotOwner":
      return { message: "프로세스 소유자만 할 수 있는 작업이에요", hint: { kind: "process" } };
    case "RoleCount":
      return { message: "모든 역할의 담당자를 지정해 주세요", hint: { kind: "lane" } };
    case "NotExpired": {
      const task = ir?.nodes.find((n) => (n.kind === "userTask" || n.kind === "serviceTask") && n.taskId === Number(a1));
      return { message: `${task && (task.kind === "userTask" || task.kind === "serviceTask") ? `[${task.label}] ` : ""}아직 기한이 지나지 않았어요`, hint: { kind: "task", ...(task ? { id: task.id } : {}) } };
    }
    case "NotOracle":
      return { message: "이 단계는 지정된 외부 서비스(오라클)만 응답할 수 있어요", hint: { kind: "task" } };
    case "PaymentFailed":
      return { message: "결제가 되지 않았어요. 토큰 잔액과 이 프로세스에 대한 지출 승인(approve)을 확인하세요", hint: { kind: "task" } };
    case "Reentrant":
      return { message: "이미 처리 중인 요청이 있어요. 잠시 후 다시 시도하세요", hint: { kind: "process" } };
    default:
      return { message: `알 수 없는 오류예요 (${err.name})` };
  }
}

// keccak256(bytes(key)) — viem 없이 쓰기 위해 지연 import 대신 호출자가 hex 를 넘기게 할 수도 있지만,
// 역할 수가 작으므로 여기서 계산한다.
import { keccak256, stringToHex } from "viem";
export function roleHash(key: string): string {
  return keccak256(stringToHex(key)).toLowerCase();
}

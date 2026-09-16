/**
 * expr.ts — 조건식 DSL (bc:expr, 가이드 4.4) 파서 + 타입 검사 + Solidity 식 변환.
 *
 *   expr    := or ;
 *   or      := and { "||" and } ;
 *   and     := cmp { "&&" cmp } ;
 *   cmp     := term ( "==" | "!=" | "<" | "<=" | ">" | ">=" ) term | "!" cmp | "(" or ")" | boolvar ;
 *   term    := variable | integer | "true" | "false" | roleaddr ;
 *   roleaddr:= "role(" identifier ")"
 *
 * 타입 규칙: uint256/int256 은 정수 리터럴·같은 타입 변수와만, bool 은 ==/!=/단독,
 * address 는 role(...) 또는 address 리터럴과만. 산술 연산은 L0 에서 제외.
 */
import type { IR, VarType } from "@blockflow/ir";

export type ExprType = VarType;

export interface CompiledExpr {
  /** Solidity 식. 변수는 `v.<name>`, 역할은 `roleOf[id][ROLE_X]`. */
  sol: string;
  /** 식 전체가 단일 bool 변수(또는 그 부정)처럼 괄호 없이 써도 되는가. */
  atomic: boolean;
  /** 참조된 변수 이름. */
  variables: string[];
  /** 참조된 역할 키. */
  roles: string[];
}

export class ExprError extends Error {
  constructor(message: string, public readonly expr: string) {
    super(`조건식 '${expr}': ${message}`);
    this.name = "ExprError";
  }
}

type Tok =
  | { t: "id"; v: string }
  | { t: "int"; v: string }
  | { t: "addr"; v: string }
  | { t: "op"; v: string }
  | { t: "eof" };

const OPS = ["||", "&&", "==", "!=", "<=", ">=", "<", ">", "!", "(", ")"];

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const addr = /^0x[0-9a-fA-F]{40}/.exec(src.slice(i));
    if (addr) {
      toks.push({ t: "addr", v: addr[0] });
      i += addr[0].length;
      continue;
    }
    const num = /^-?[0-9]+/.exec(src.slice(i));
    if (num) {
      toks.push({ t: "int", v: num[0] });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) {
      toks.push({ t: "id", v: id[0] });
      i += id[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      toks.push({ t: "op", v: op });
      i += op.length;
      continue;
    }
    throw new ExprError(`알 수 없는 문자 '${c}' (위치 ${i})`, src);
  }
  toks.push({ t: "eof" });
  return toks;
}

interface Term {
  sol: string;
  type: ExprType;
  literal: boolean;
}

interface Bool {
  sol: string;
  atomic: boolean;
  /** 이미 괄호로 감싸인 식 — 부정 시 다시 감싸지 않는다. */
  grouped?: boolean;
}

class Parser {
  private pos = 0;
  readonly variables = new Set<string>();
  readonly roles = new Set<string>();

  constructor(
    private readonly toks: Tok[],
    private readonly src: string,
    private readonly varTypes: Map<string, VarType>,
    private readonly roleKeys: Set<string>,
  ) {}

  private peek(): Tok {
    return this.toks[this.pos]!;
  }

  private next(): Tok {
    return this.toks[this.pos++]!;
  }

  private isOp(v: string): boolean {
    const t = this.peek();
    return t.t === "op" && t.v === v;
  }

  private expectOp(v: string): void {
    if (!this.isOp(v)) throw new ExprError(`'${v}' 가 필요합니다`, this.src);
    this.pos++;
  }

  parse(): Bool {
    const e = this.or();
    if (this.peek().t !== "eof") throw new ExprError("식 끝에 남은 토큰이 있습니다", this.src);
    return e;
  }

  private or(): Bool {
    const parts = [this.and()];
    while (this.isOp("||")) {
      this.pos++;
      parts.push(this.and());
    }
    if (parts.length === 1) return parts[0]!;
    return { sol: parts.map((p) => p.sol).join(" || "), atomic: false };
  }

  private and(): Bool {
    const parts = [this.cmp()];
    while (this.isOp("&&")) {
      this.pos++;
      parts.push(this.cmp());
    }
    if (parts.length === 1) return parts[0]!;
    return { sol: parts.map((p) => p.sol).join(" && "), atomic: false };
  }

  private cmp(): Bool {
    if (this.isOp("!")) {
      this.pos++;
      const inner = this.cmp();
      const bare = inner.atomic || inner.grouped;
      return { sol: bare ? `!${inner.sol}` : `!(${inner.sol})`, atomic: inner.atomic };
    }
    if (this.isOp("(")) {
      this.pos++;
      const inner = this.or();
      this.expectOp(")");
      return { sol: `(${inner.sol})`, atomic: false, grouped: true };
    }
    const left = this.term();
    const t = this.peek();
    if (t.t === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(t.v)) {
      this.pos++;
      const right = this.term();
      this.checkCompare(left, right, t.v);
      return { sol: `${left.sol} ${t.v} ${right.sol}`, atomic: false };
    }
    // 단독 bool 변수
    if (left.type !== "bool" || left.literal) {
      throw new ExprError(`'${left.sol}' 는 bool 변수가 아니므로 비교 연산자가 필요합니다`, this.src);
    }
    return { sol: left.sol, atomic: true };
  }

  private checkCompare(a: Term, b: Term, op: string): void {
    if (a.literal && b.literal) throw new ExprError("리터럴끼리 비교할 수 없습니다", this.src);
    coerceLiteral(a, b);
    coerceLiteral(b, a);
    if (a.type !== b.type) throw new ExprError(`타입이 다릅니다 (${a.type} vs ${b.type})`, this.src);
    const ordered = op === "<" || op === "<=" || op === ">" || op === ">=";
    if (ordered && (a.type === "bool" || a.type === "address" || a.type === "bytes32")) {
      throw new ExprError(`${a.type} 에는 '${op}' 를 쓸 수 없습니다`, this.src);
    }
  }

  private term(): Term {
    const t = this.next();
    if (t.t === "int") {
      // 정수 리터럴: 상대 변수 타입에 맞춰 uint256/int256. 음수면 int256.
      return { sol: t.v, type: t.v.startsWith("-") ? "int256" : "uint256", literal: true };
    }
    if (t.t === "addr") return { sol: t.v, type: "address", literal: true };
    if (t.t === "id") {
      if (t.v === "true" || t.v === "false") return { sol: t.v, type: "bool", literal: true };
      if (t.v === "role") {
        this.expectOp("(");
        const r = this.next();
        if (r.t !== "id") throw new ExprError("role( 뒤에는 역할 이름이 와야 합니다", this.src);
        this.expectOp(")");
        if (!this.roleKeys.has(r.v)) throw new ExprError(`역할 '${r.v}' 가 선언되지 않았습니다`, this.src);
        this.roles.add(r.v);
        return { sol: `roleOf[id][ROLE_${screaming(r.v)}]`, type: "address", literal: false };
      }
      const vt = this.varTypes.get(t.v);
      if (!vt) throw new ExprError(`변수 '${t.v}' 가 선언되지 않았습니다`, this.src);
      this.variables.add(t.v);
      return { sol: `v.${t.v}`, type: vt, literal: false };
    }
    throw new ExprError("값이 필요합니다", this.src);
  }
}

// names.ts 와 동일 규칙 (순환 import 회피용 로컬 복사)
function screaming(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toUpperCase();
}

/** 정수 리터럴의 타입을 상대 변수(uint256/int256)에 맞춘다. 음수 리터럴은 uint256 에 맞추지 않아 타입 검사에서 걸린다. */
function coerceLiteral(a: Term, b: Term): void {
  const isInt = (t: ExprType) => t === "uint256" || t === "int256";
  if (a.literal && !b.literal && isInt(a.type) && isInt(b.type)) {
    if (b.type === "uint256" && a.sol.startsWith("-")) return;
    a.type = b.type;
  }
}

/** 조건식을 파싱·검사하고 Solidity 식으로 변환한다. */
export function compileExpr(src: string, ir: Pick<IR, "variables" | "roles">): CompiledExpr {
  const varTypes = new Map<string, VarType>(ir.variables.map((v) => [v.name, v.type]));
  const roleKeys = new Set(ir.roles.map((r) => r.key));
  const parser = new Parser(tokenize(src), src, varTypes, roleKeys);
  const result = parser.parse();
  return {
    sol: result.sol,
    atomic: result.atomic,
    variables: [...parser.variables],
    roles: [...parser.roles],
  };
}

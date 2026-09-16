/**
 * expr.ts — 조건식 DSL (bc:expr, 가이드 4.4) 파서 + 타입 검사 + Solidity 식 변환 + 평가기.
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
 *
 * 같은 AST 를 (a) Solidity 식으로 렌더링하고 (b) 시나리오 생성기가 구체 값으로 평가한다.
 */
import type { IR, VarType } from "@blockflow/ir";

export type ExprType = VarType;

export type CmpOp = "==" | "!=" | "<" | "<=" | ">" | ">=";

export type Term =
  | { t: "var"; name: string; type: ExprType }
  | { t: "int"; value: bigint; type: "uint256" | "int256" }
  | { t: "bool"; value: boolean; type: "bool" }
  | { t: "addr"; value: string; type: "address" }
  | { t: "role"; key: string; type: "address" };

export type Ast =
  | { t: "or"; parts: Ast[] }
  | { t: "and"; parts: Ast[] }
  | { t: "not"; inner: Ast }
  | { t: "group"; inner: Ast }
  | { t: "cmp"; op: CmpOp; left: Term; right: Term }
  | { t: "boolvar"; name: string };

export interface CompiledExpr {
  /** Solidity 식. 변수는 `v.<name>`, 역할은 `roleOf[id][ROLE_X]`. */
  sol: string;
  /** 식 전체가 단일 bool 변수(또는 그 부정)처럼 괄호 없이 써도 되는가. */
  atomic: boolean;
  /** 참조된 변수 이름. */
  variables: string[];
  /** 참조된 역할 키. */
  roles: string[];
  ast: Ast;
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
    const rest = src.slice(i);
    const addr = /^0x[0-9a-fA-F]{40}(?![0-9a-zA-Z_])/.exec(rest);
    if (addr) {
      toks.push({ t: "addr", v: addr[0] });
      i += addr[0].length;
      continue;
    }
    const num = /^-?[0-9]+/.exec(rest);
    if (num) {
      toks.push({ t: "int", v: num[0] });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (id) {
      toks.push({ t: "id", v: id[0] });
      i += id[0].length;
      continue;
    }
    const op = OPS.find((o) => rest.startsWith(o));
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

  parse(): Ast {
    const e = this.or();
    if (this.peek().t !== "eof") throw new ExprError("식 끝에 남은 토큰이 있습니다", this.src);
    return e;
  }

  private or(): Ast {
    const parts = [this.and()];
    while (this.isOp("||")) {
      this.pos++;
      parts.push(this.and());
    }
    return parts.length === 1 ? parts[0]! : { t: "or", parts };
  }

  private and(): Ast {
    const parts = [this.cmp()];
    while (this.isOp("&&")) {
      this.pos++;
      parts.push(this.cmp());
    }
    return parts.length === 1 ? parts[0]! : { t: "and", parts };
  }

  private cmp(): Ast {
    if (this.isOp("!")) {
      this.pos++;
      return { t: "not", inner: this.cmp() };
    }
    if (this.isOp("(")) {
      this.pos++;
      const inner = this.or();
      this.expectOp(")");
      return { t: "group", inner };
    }
    const left = this.term();
    const t = this.peek();
    if (t.t === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(t.v)) {
      this.pos++;
      const right = this.term();
      return this.compare(left, right, t.v as CmpOp);
    }
    if (left.t !== "var" || left.type !== "bool") {
      throw new ExprError(`'${termText(left)}' 는 bool 변수가 아니므로 비교 연산자가 필요합니다`, this.src);
    }
    return { t: "boolvar", name: left.name };
  }

  private compare(a: Term, b: Term, op: CmpOp): Ast {
    const isLit = (x: Term) => x.t !== "var" && x.t !== "role";
    if (isLit(a) && isLit(b)) throw new ExprError("리터럴끼리 비교할 수 없습니다", this.src);
    // 정수 리터럴의 타입을 상대 변수(uint256/int256)에 맞춘다. 음수는 uint256 에 맞추지 않아 타입 검사에서 걸린다.
    const coerce = (lit: Term, other: Term): Term => {
      if (lit.t === "int" && other.t === "var" && (other.type === "uint256" || other.type === "int256")) {
        if (other.type === "uint256" && lit.value < 0n) return lit;
        return { ...lit, type: other.type };
      }
      return lit;
    };
    a = coerce(a, b);
    b = coerce(b, a);
    if (a.type !== b.type) throw new ExprError(`타입이 다릅니다 (${a.type} vs ${b.type})`, this.src);
    const ordered = op === "<" || op === "<=" || op === ">" || op === ">=";
    if (ordered && (a.type === "bool" || a.type === "address" || a.type === "bytes32")) {
      throw new ExprError(`${a.type} 에는 '${op}' 를 쓸 수 없습니다`, this.src);
    }
    return { t: "cmp", op, left: a, right: b };
  }

  private term(): Term {
    const t = this.next();
    if (t.t === "int") return { t: "int", value: BigInt(t.v), type: t.v.startsWith("-") ? "int256" : "uint256" };
    if (t.t === "addr") return { t: "addr", value: t.v, type: "address" };
    if (t.t === "id") {
      if (t.v === "true" || t.v === "false") return { t: "bool", value: t.v === "true", type: "bool" };
      if (t.v === "role") {
        this.expectOp("(");
        const r = this.next();
        if (r.t !== "id") throw new ExprError("role( 뒤에는 역할 이름이 와야 합니다", this.src);
        this.expectOp(")");
        if (!this.roleKeys.has(r.v)) throw new ExprError(`역할 '${r.v}' 가 선언되지 않았습니다`, this.src);
        this.roles.add(r.v);
        return { t: "role", key: r.v, type: "address" };
      }
      const vt = this.varTypes.get(t.v);
      if (!vt) throw new ExprError(`변수 '${t.v}' 가 선언되지 않았습니다`, this.src);
      this.variables.add(t.v);
      return { t: "var", name: t.v, type: vt };
    }
    throw new ExprError("값이 필요합니다", this.src);
  }
}

function termText(t: Term): string {
  switch (t.t) {
    case "var":
      return t.name;
    case "int":
      return t.value.toString();
    case "bool":
      return String(t.value);
    case "addr":
      return t.value;
    case "role":
      return `role(${t.key})`;
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

function renderTerm(t: Term): string {
  switch (t.t) {
    case "var":
      return `v.${t.name}`;
    case "role":
      return `roleOf[id][ROLE_${screaming(t.key)}]`;
    default:
      return termText(t);
  }
}

/** AST → Solidity 식. */
export function renderExpr(ast: Ast): { sol: string; atomic: boolean } {
  switch (ast.t) {
    case "or":
      return { sol: ast.parts.map((p) => renderExpr(p).sol).join(" || "), atomic: false };
    case "and":
      return { sol: ast.parts.map((p) => renderExpr(p).sol).join(" && "), atomic: false };
    case "not": {
      const inner = renderExpr(ast.inner);
      const bare = inner.atomic || ast.inner.t === "group";
      return { sol: bare ? `!${inner.sol}` : `!(${inner.sol})`, atomic: inner.atomic };
    }
    case "group":
      return { sol: `(${renderExpr(ast.inner).sol})`, atomic: false };
    case "cmp":
      return { sol: `${renderTerm(ast.left)} ${ast.op} ${renderTerm(ast.right)}`, atomic: false };
    case "boolvar":
      return { sol: `v.${ast.name}`, atomic: true };
  }
}

/** 조건식을 파싱·검사하고 Solidity 식으로 변환한다. */
export function parseExpr(src: string, ir: Pick<IR, "variables" | "roles">): CompiledExpr {
  const varTypes = new Map<string, VarType>(ir.variables.map((v) => [v.name, v.type]));
  const roleKeys = new Set(ir.roles.map((r) => r.key));
  const parser = new Parser(tokenize(src), src, varTypes, roleKeys);
  const ast = parser.parse();
  const r = renderExpr(ast);
  return { sol: r.sol, atomic: r.atomic, variables: [...parser.variables], roles: [...parser.roles], ast };
}

export const compileExpr = parseExpr;

// ───────────── 평가기 (시나리오 생성용) ─────────────

/** 구체 값: 정수는 bigint, bool 은 boolean, address/bytes32 는 소문자 0x 문자열. */
export type Value = bigint | boolean | string;

export interface Env {
  vars: ReadonlyMap<string, Value>;
  /** 역할 키 → 주소. */
  roles: ReadonlyMap<string, string>;
}

function termValue(t: Term, env: Env): Value {
  switch (t.t) {
    case "var": {
      const v = env.vars.get(t.name);
      if (v === undefined) {
        // 컨트랙트에서 미설정 변수는 0 값이다.
        return t.type === "bool" ? false : t.type === "uint256" || t.type === "int256" ? 0n : "0x" + "0".repeat(t.type === "address" ? 40 : 64);
      }
      return v;
    }
    case "int":
      return t.value;
    case "bool":
      return t.value;
    case "addr":
      return t.value.toLowerCase();
    case "role": {
      const a = env.roles.get(t.key);
      if (a === undefined) throw new Error(`역할 '${t.key}' 의 주소가 없습니다`);
      return a.toLowerCase();
    }
  }
}

export function evalExpr(ast: Ast, env: Env): boolean {
  switch (ast.t) {
    case "or":
      return ast.parts.some((p) => evalExpr(p, env));
    case "and":
      return ast.parts.every((p) => evalExpr(p, env));
    case "not":
      return !evalExpr(ast.inner, env);
    case "group":
      return evalExpr(ast.inner, env);
    case "boolvar":
      return termValue({ t: "var", name: ast.name, type: "bool" }, env) === true;
    case "cmp": {
      const l = termValue(ast.left, env);
      const r = termValue(ast.right, env);
      switch (ast.op) {
        case "==":
          return l === r;
        case "!=":
          return l !== r;
        case "<":
          return (l as bigint) < (r as bigint);
        case "<=":
          return (l as bigint) <= (r as bigint);
        case ">":
          return (l as bigint) > (r as bigint);
        case ">=":
          return (l as bigint) >= (r as bigint);
      }
    }
  }
}

/** AST 안에서 변수 name 과 비교되는 정수 리터럴들 (시나리오 생성기의 후보값 산출용). */
export function literalsFor(ast: Ast, name: string, acc: bigint[] = []): bigint[] {
  switch (ast.t) {
    case "or":
    case "and":
      for (const p of ast.parts) literalsFor(p, name, acc);
      break;
    case "not":
    case "group":
      literalsFor(ast.inner, name, acc);
      break;
    case "cmp": {
      const { left, right } = ast;
      if (left.t === "var" && left.name === name && right.t === "int") acc.push(right.value);
      if (right.t === "var" && right.name === name && left.t === "int") acc.push(left.value);
      break;
    }
    case "boolvar":
      break;
  }
  return acc;
}

/**
 * names.ts — 라벨/키 → 안전한 Solidity 식별자, 충돌 처리 (가이드 6.7).
 */

/** Solidity 예약어 + 생성 골격이 이미 쓰는 이름. 함수/변수 이름으로 쓰면 접미사를 붙인다. */
const RESERVED = new Set([
  // Solidity keywords
  "abstract", "address", "after", "alias", "anonymous", "apply", "as", "assembly", "auto", "bool",
  "break", "byte", "bytes", "calldata", "case", "catch", "constant", "constructor", "continue",
  "contract", "copyof", "default", "define", "delete", "do", "else", "emit", "enum", "error",
  "event", "external", "fallback", "false", "final", "fixed", "for", "function", "hex", "if",
  "immutable", "implements", "import", "in", "indexed", "inline", "int", "interface", "internal",
  "is", "let", "library", "macro", "mapping", "match", "memory", "modifier", "mutable", "new",
  "null", "of", "override", "partial", "payable", "pragma", "private", "promise", "public", "pure",
  "receive", "reference", "relocatable", "return", "returns", "sealed", "sizeof", "static",
  "storage", "string", "struct", "supports", "switch", "this", "throw", "true", "try", "type",
  "typedef", "typeof", "ufixed", "uint", "unchecked", "unicode", "using", "var", "view",
  "virtual", "while",
  // 단위·전역
  "wei", "gwei", "ether", "seconds", "minutes", "hours", "days", "weeks", "years", "now", "super", "msg", "tx", "block",
  // 골격이 쓰는 이름 (6.1)
  "owner", "paused", "instanceCount", "instances", "vars", "roleOf", "setPaused",
  "createInstance", "rebindRole", "enabledTasks", "_require", "_fire", "_step",
]);

const KEYWORD_TYPES = /^(u?int(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?|bytes([1-9]|[12][0-9]|3[0-2])?)$/;

export function isReserved(name: string): boolean {
  return RESERVED.has(name) || KEYWORD_TYPES.test(name);
}

/**
 * 임의의 라벨(한글 포함)을 lowerCamelCase 식별자로. ASCII 가 하나도 없으면 fallback.
 *   "경비 신청"      → fallback (예: "task1")
 *   "upload receipt" → "uploadReceipt"
 *   "Pay-out 2"      → "payOut2"
 */
export function toIdentifier(label: string, fallback: string): string {
  const words = label
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let id = words
    .map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
  if (!id) id = fallback;
  if (/^[0-9]/.test(id)) id = "_" + id;
  if (isReserved(id)) id = id + "_";
  return id;
}

/** lowerCamel / UpperCamel → SCREAMING_SNAKE. "uploadReceipt" → "UPLOAD_RECEIPT", "ReviewerA" → "REVIEWER_A". */
export function screamingSnake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toUpperCase();
}

/** 이미 쓰인 이름과 충돌하면 _2, _3 … 접미사 (6.3). */
export function uniqueName(base: string, used: Set<string>): string {
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base}_${n++}`;
  used.add(name);
  return name;
}

export function roleConst(key: string): string {
  return "ROLE_" + screamingSnake(key);
}

export function taskConst(tag: string): string {
  return "TASK_" + tag.toUpperCase();
}

/** 오른쪽 공백 채움 (정렬용). */
export function padEnd(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

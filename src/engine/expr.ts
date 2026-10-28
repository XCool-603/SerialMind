/**
 * 极简表达式求值器（沙箱，不用 eval）
 * 支持：数字、+ - * / %、括号、变量名、比较
 * 变量：len（整帧长度）、offset、以及任意字段名（取解出的数值）
 */

type Token = { t: "num" | "id" | "op"; v: string };

const OPS = ["+", "-", "*", "/", "%", "(", ")", "<", ">", "<=", ">=", "==", "!=", "?", ":"];

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let s = "";
      while (i < src.length && /[0-9a-fA-FxX.]/.test(src[i])) s += src[i++];
      out.push({ t: "num", v: s });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let s = "";
      while (i < src.length && /[A-Za-z0-9_.]/.test(src[i])) s += src[i++];
      out.push({ t: "id", v: s });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (OPS.includes(two)) {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if (OPS.includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`无法识别的字符：${c}`);
  }
  return out;
}

function parseNum(s: string): number {
  if (/^0x/i.test(s)) return parseInt(s.slice(2), 16);
  return Number(s);
}

class Parser {
  private pos = 0;
  constructor(private toks: Token[], private vars: Record<string, number>) {}

  private peek(): Token | undefined {
    return this.toks[this.pos];
  }

  private eat(op: string): boolean {
    const t = this.peek();
    if (t && t.t === "op" && t.v === op) {
      this.pos++;
      return true;
    }
    return false;
  }

  parse(): number {
    const v = this.ternary();
    if (this.pos < this.toks.length) throw new Error("表达式有多余内容");
    return v;
  }

  private ternary(): number {
    const cond = this.comparison();
    if (this.eat("?")) {
      const a = this.ternary();
      if (!this.eat(":")) throw new Error("三元表达式缺少 :");
      const b = this.ternary();
      return cond ? a : b;
    }
    return cond;
  }

  private comparison(): number {
    let left = this.additive();
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== "op") break;
      if (!["<", ">", "<=", ">=", "==", "!="].includes(t.v)) break;
      this.pos++;
      const right = this.additive();
      switch (t.v) {
        case "<":
          left = left < right ? 1 : 0;
          break;
        case ">":
          left = left > right ? 1 : 0;
          break;
        case "<=":
          left = left <= right ? 1 : 0;
          break;
        case ">=":
          left = left >= right ? 1 : 0;
          break;
        case "==":
          left = left === right ? 1 : 0;
          break;
        case "!=":
          left = left !== right ? 1 : 0;
          break;
      }
    }
    return left;
  }

  private additive(): number {
    let left = this.multiplicative();
    for (;;) {
      if (this.eat("+")) left += this.multiplicative();
      else if (this.eat("-")) left -= this.multiplicative();
      else break;
    }
    return left;
  }

  private multiplicative(): number {
    let left = this.unary();
    for (;;) {
      if (this.eat("*")) left *= this.unary();
      else if (this.eat("/")) {
        const r = this.unary();
        left = r === 0 ? 0 : left / r;
      } else if (this.eat("%")) {
        const r = this.unary();
        left = r === 0 ? 0 : left % r;
      } else break;
    }
    return left;
  }

  private unary(): number {
    if (this.eat("-")) return -this.unary();
    if (this.eat("+")) return this.unary();
    return this.primary();
  }

  private primary(): number {
    const t = this.peek();
    if (!t) throw new Error("表达式意外结束");
    if (t.t === "num") {
      this.pos++;
      return parseNum(t.v);
    }
    if (t.t === "id") {
      this.pos++;
      if (!(t.v in this.vars)) throw new Error(`未知变量：${t.v}`);
      return this.vars[t.v];
    }
    if (t.t === "op" && t.v === "(") {
      this.pos++;
      const v = this.ternary();
      if (!this.eat(")")) throw new Error("缺少 )");
      return v;
    }
    throw new Error(`意外的记号：${t.v}`);
  }
}

/** 求值；出错返回 null（由调用方决定降级策略） */
export function evalExpr(src: string, vars: Record<string, number>): number | null {
  try {
    return new Parser(tokenize(src), vars).parse();
  } catch {
    return null;
  }
}

/** 表达式里引用到的字段名 */
export function exprVars(src: string): string[] {
  try {
    return tokenize(src)
      .filter((t) => t.t === "id")
      .map((t) => t.v);
  } catch {
    return [];
  }
}

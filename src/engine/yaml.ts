/**
 * YAML ⇄ 步骤 双向转换。
 *
 * 可视化编辑器是入口，YAML 是逃生舱：
 * 客户想加可视化里没有的写法（条件分支、循环、变量运算）时，直接改 YAML 再应用。
 */
import type { CaseStep } from "./types";

const KIND_HINT = "支持 set / expect / assertNo / send / delay / loop / parallel / setVar / if / while / break / continue";

const stripBraces = (s: string) => s.trim().replace(/^\{/, "").replace(/\}$/, "").trim();
const stripBrackets = (s: string) => s.trim().replace(/^\[/, "").replace(/\]$/, "").trim();

export interface YamlParseResult {
  steps: CaseStep[];
  errors: string[];
}

interface Line {
  indent: number;
  text: string;
  no: number;
}

let seq = 0;
const nextId = () => `y${Date.now()}_${++seq}`;

function leaf(kind: string, rest: string, no: number, errors: string[]): CaseStep | null {
  const id = nextId();
  switch (kind) {
    case "set": {
      const body = stripBraces(rest);
      const f = body.match(/field\s*:\s*([^,}]+)/);
      if (!f) {
        errors.push(`第 ${no} 行 set 缺少 field`);
        return null;
      }
      const v = body.match(/value\s*:\s*([^,}]+)/);
      return {
        id,
        kind: "set",
        text: "set",
        detail: "field",
        fields: [{ label: f[1].trim(), value: `= ${(v?.[1] ?? "").trim()}` }],
        timeout: "自动组包发送",
      };
    }
    case "expect": {
      const body = stripBraces(rest);
      const f = body.match(/field\s*:\s*([^,}]+)/);
      if (!f) {
        errors.push(`第 ${no} 行 expect 缺少 field`);
        return null;
      }
      let tail = body.slice(body.indexOf(f[0]) + f[0].length).replace(/^\s*,\s*/, "").trim();
      let timeout = "3s";
      const tw = tail.match(/,\s*within\s+([^,}]+)\s*$/);
      if (tw) {
        timeout = tw[1].trim();
        tail = tail.slice(0, tw.index).trim();
      }
      const op = tail.replace(/,\s*$/, "").trim();
      if (!op) {
        errors.push(`第 ${no} 行 expect 缺少断言（如 equals 3000 / range 1..9 / in 1,3,5 / > 100）`);
        return null;
      }
      return {
        id,
        kind: "expect",
        text: "expect",
        detail: "field",
        fields: [{ label: f[1].trim(), value: op }],
        timeout: `within ${timeout}`,
      };
    }
    case "assertNo": {
      const items = stripBrackets(rest)
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      return { id, kind: "assertNo", text: "assertNo", detail: "无异常", fields: items.map((x) => ({ label: x, value: "" })) };
    }
    case "send": {
      const hex = rest.replace(/^["']|["']$/g, "").trim();
      if (!hex) {
        errors.push(`第 ${no} 行 send 没有字节`);
        return null;
      }
      return { id, kind: "send", text: "send", detail: hex };
    }
    case "delay": {
      if (!rest) {
        errors.push(`第 ${no} 行 delay 没有时长`);
        return null;
      }
      return { id, kind: "delay", text: "delay", detail: `等待 ${rest}` };
    }
    case "loop":
      return { id, kind: "loop", text: "loop", detail: rest };
    case "parallel": {
      const fields = stripBrackets(rest)
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((p) => {
          const eq = p.indexOf("=");
          return eq < 0 ? { label: p, value: "=" } : { label: p.slice(0, eq).trim(), value: `= ${p.slice(eq + 1).trim()}` };
        });
      if (!fields.length) {
        errors.push(`第 ${no} 行 parallel 没有字段`);
        return null;
      }
      return { id, kind: "parallel", text: "parallel", detail: "多字段", fields };
    }
    case "setVar": {
      const m = rest.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
      if (!m) {
        errors.push(`第 ${no} 行 setVar 要写成 变量 = 表达式（如 score = score + 1）`);
        return null;
      }
      return { id, kind: "setVar", text: "setVar", detail: m[1], fields: [{ label: m[1], value: `= ${m[2].trim()}` }] };
    }
    case "break":
      return { id, kind: "break", text: "break", detail: "" };
    case "continue":
      return { id, kind: "continue", text: "continue", detail: "" };
    case "assert": {
      const val = rest.replace(/^["']|["']$/g, "").trim();
      return { id, kind: "assert", text: "断言", fields: [{ label: "contains", value: val }] };
    }
    case "extract": {
      const m = rest.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
      const vName = m ? m[1] : "val";
      const rule = m ? m[2].trim() : rest;
      return { id, kind: "extract", text: "提取变量", targetVar: vName, extractType: "regex", extractRule: rule, fields: [{ label: vName, value: rule }] };
    }
    default:
      errors.push(`第 ${no} 行类型不支持：${kind}（${KIND_HINT}）`);
      return null;
  }
}

/** 解析一个缩进层级下的所有步骤 */
function block(lines: Line[], start: number, indent: number, errors: string[], depth: number): { steps: CaseStep[]; next: number } {
  const steps: CaseStep[] = [];
  let i = start;
  if (depth > 6) {
    errors.push("嵌套超过 6 层");
    return { steps, next: lines.length };
  }

  while (i < lines.length) {
    const ln = lines[i];
    if (ln.indent < indent) break;
    if (ln.indent > indent) {
      errors.push(`第 ${ln.no} 行缩进多了`);
      i++;
      continue;
    }

    const m = ln.text.match(/^-\s*([A-Za-z_]+)\s*:?\s*(.*)$/);
    if (!m) {
      errors.push(`第 ${ln.no} 行无法识别：${ln.text}`);
      i++;
      continue;
    }
    const kind = m[1];
    const rest = (m[2] ?? "").trim();

    if (kind === "if" || kind === "while") {
      const raw = stripBraces(rest);
      let cond = raw;
      let maxIter: string | undefined;
      if (kind === "while") {
        const mm = raw.match(/^(.*?),\s*max\s+(\d+)$/i);
        if (mm) {
          cond = mm[1].trim();
          maxIter = mm[2];
        }
      }
      if (!cond) {
        errors.push(`第 ${ln.no} 行 ${kind} 缺少条件`);
        i++;
        continue;
      }
      i++;
      let children: CaseStep[] = [];
      let elseChildren: CaseStep[] = [];
      // 收 then/else/do 块
      while (i < lines.length && lines[i].indent > indent) {
        const sub = lines[i];
        const key = sub.text.replace(/:$/, "").trim();
        if (key === "then" || key === "do" || key === "else" || key === "children" || key === "steps") {
          i++;
          if (i >= lines.length || lines[i].indent <= sub.indent) {
            // 空块
            continue;
          }
          const childIndent = lines[i].indent;
          const r = block(lines, i, childIndent, errors, depth + 1);
          if (key === "else") elseChildren = r.steps;
          else children = r.steps;
          i = r.next;
        } else {
          errors.push(`第 ${sub.no} 行：${kind} 里只认 then / else / do`);
          i++;
        }
      }
      steps.push({
        id: nextId(),
        kind: kind as "if" | "while",
        text: kind,
        cond,
        children,
        elseChildren,
        timeout: maxIter ? `max ${maxIter}` : undefined,
      });
      continue;
    }

    const st = leaf(kind, rest, ln.no, errors);
    if (st) steps.push(st);
    i++;
  }

  return { steps, next: i };
}

export function yamlToSteps(src: string): YamlParseResult {
  const errors: string[] = [];
  const lines: Line[] = [];

  src.split(/\r?\n/).forEach((raw, idx) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed === "steps:" || trimmed === "[]") return;
    const indent = raw.length - raw.replace(/^\s+/, "").length;
    lines.push({ indent, text: trimmed, no: idx + 1 });
  });

  if (!lines.length) return { steps: [], errors: [] };

  const baseIndent = lines[0].indent;
  const { steps } = block(lines, 0, baseIndent, errors, 0);
  return { steps, errors };
}

/* ---------------- 步骤 → YAML ---------------- */

export function stepsToYaml(steps: CaseStep[]): string {
  const emit = (list: CaseStep[], pad: string): string[] => {
    const out: string[] = [];
    for (const s of list) {
      const f = s.fields?.[0];
      switch (s.kind) {
        case "if": {
          out.push(`${pad}- if: { ${s.cond ?? ""} }`);
          out.push(`${pad}  then:`);
          out.push(...emit(s.children ?? [], pad + "    "));
          if ((s.elseChildren ?? []).length) {
            out.push(`${pad}  else:`);
            out.push(...emit(s.elseChildren ?? [], pad + "    "));
          }
          break;
        }
        case "while": {
          const max = s.timeout?.match(/\d+/)?.[0];
          out.push(`${pad}- while: { ${s.cond ?? ""}${max ? `, max ${max}` : ""} }`);
          out.push(`${pad}  do:`);
          out.push(...emit(s.children ?? [], pad + "    "));
          break;
        }
        case "setVar":
          out.push(`${pad}- setVar: ${f?.label ?? ""} = ${(f?.value ?? "").replace(/^=\s*/, "")}`);
          break;
        case "break":
          out.push(`${pad}- break`);
          break;
        case "continue":
          out.push(`${pad}- continue`);
          break;
        case "set":
          out.push(`${pad}- set:    { field: ${f?.label ?? ""}, value: ${(f?.value ?? "").replace(/^=\s*/, "")} }`);
          break;
        case "expect":
          out.push(`${pad}- expect: { field: ${f?.label ?? ""}, ${f?.value ?? ""}${s.timeout ? `, ${s.timeout}` : ""} }`);
          break;
        case "assertNo":
          out.push(`${pad}- assertNo: [${(s.fields ?? []).map((x) => x.label).join(", ")}]`);
          break;
        case "send":
          out.push(`${pad}- send:   "${s.detail ?? ""}"`);
          break;
        case "delay":
          out.push(`${pad}- delay:  ${(s.detail ?? "").replace(/^等待\s*/, "")}`);
          break;
        case "loop":
          out.push(`${pad}- loop:   ${s.detail ?? ""}`);
          break;
        case "parallel":
          out.push(`${pad}- parallel: [${(s.fields ?? []).map((x) => `${x.label}=${(x.value ?? "").replace(/^=\s*/, "")}`).join(", ")}]`);
          break;
        default:
          out.push(`${pad}- ${s.kind}: ${s.detail ?? ""}`);
      }
    }
    return out;
  };

  const body = emit(steps, "  ");
  return ["steps:", ...(body.length ? body : ["  []"])].join("\n");
}
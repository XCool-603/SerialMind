import { useStore } from "../engine/store";
import { Icon, IC } from "./Icon";

/** 测试页顶部：用例 / 套件 切换（原来分成「测试」和「批量」两个页签，现在合成一个） */
export function TestModeSwitch() {
  const caseTab = useStore((s) => s.caseTab);
  const setCaseTab = useStore((s) => s.setCaseTab);
  const cases = useStore((s) => s.cases);
  const suites = useStore((s) => s.suites);

  return (
    <div className="test-mode-switch">
      <button
        className={caseTab === "cases" ? "chip active" : "chip"}
        onClick={() => setCaseTab("cases")}
        title="单个用例：编辑步骤、运行、看断言"
      >
        <Icon cp={IC.case} size={10} color={caseTab === "cases" ? "var(--t1)" : "var(--t3)"} />
        <span>用例</span>
        <span className="tag-mini">{cases.length}</span>
      </button>
      <button
        className={caseTab === "suites" ? "chip active" : "chip"}
        onClick={() => setCaseTab("suites")}
        title="套件：按标签把用例打包，一键跑一批"
      >
        <Icon cp={IC.product} size={10} color={caseTab === "suites" ? "var(--t1)" : "var(--t3)"} />
        <span>套件</span>
        <span className="tag-mini">{suites.length}</span>
      </button>
    </div>
  );
}

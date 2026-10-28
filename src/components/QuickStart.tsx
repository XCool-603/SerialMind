import { useState } from "react";
import { useStore } from "../engine/store";
import { Icon, IC } from "./Icon";

/**
 * 快速开始：4 步，每步一个按钮，做完自动打勾
 * 只在"还没配完"时出现，配完自动消失（也可手动关掉）
 */
export function QuickStart() {
  const { connection, protocols, activeProtocolId, cases, activeCaseId, setView, runActiveCase, running, openDialog } = useStore();
  const [closed, setClosed] = useState(false);

  const hasProtocol = !!protocols.find((p) => p.id === activeProtocolId && p.messages[0]?.fields.length);
  const hasCase = cases.length > 0 && cases.some((c) => c.steps.length > 0);
  const connected = connection.connected;

  const steps = [
    { done: hasProtocol, label: "确认协议帧格式", hint: "协议页里帧结构对不对", action: () => setView("protocol"), btn: "去协议页" },
    {
      done: hasCase,
      label: "生成一个用例",
      hint: "自动建「发一帧 + 断言」",
      action: () => void import("../lib/actions").then((m) => m.createSampleCase()),
      btn: "一键生成",
    },
    {
      done: connected,
      label: "连接串口",
      hint: "点顶栏「选择串口」；没硬件就选「模拟设备」",
      action: () => void useStore.getState().refreshPorts(),
      btn: "刷新端口",
    },
    {
      done: false,
      label: "跑一次看报告",
      hint: "运行后自动跳到报告页",
      action: () => {
        if (activeCaseId) void runActiveCase();
        else setView("case");
      },
      btn: running ? "运行中…" : "运行用例",
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  if (closed || doneCount >= 3) return null;

  return (
    <div className="quickstart">
      <div className="qs-head">
        <Icon cp={IC.play} size={12} color="var(--accent)" />
        <span className="qs-title">快速开始</span>
        <span className="qs-progress">
          {doneCount}/3 步已完成
        </span>
        <span className="spacer" />
        <button className="qs-close" title="隐藏" onClick={() => setClosed(true)}>
          <Icon cp={IC.close} size={11} color="var(--t4)" />
        </button>
      </div>
      <div className="qs-steps">
        {steps.map((s, i) => (
          <div className={s.done ? "qs-step done" : "qs-step"} key={i}>
            <span className="qs-num">{s.done ? "✓" : i + 1}</span>
            <div className="qs-text">
              <div className="qs-label">{s.label}</div>
              <div className="qs-hint">{s.hint}</div>
            </div>
            <button className={s.done ? "qs-btn done" : "qs-btn"} onClick={s.action} disabled={running}>
              {s.done ? "已完成" : s.btn}
            </button>
          </div>
        ))}
      </div>
      <div className="qs-foot">
        <button
          className="qs-link"
          onClick={() =>
            openDialog({
              kind: "confirm",
              title: "完整说明",
              desc: "① 建产品 → 子产品（协议类型默认 PLC）\n② 协议页确认帧结构\n③ 顶栏选串口 → 连接\n④ 用例页点「一键生成示例用例」\n⑤ 点「运行用例」→ 报告页看结果\n\n详细版见 docs/自动化配置指南.md",
              okText: "知道了",
              onOk: () => {
                /* 关闭 */
              },
            })
          }
        >
          看完整说明
        </button>
      </div>
    </div>
  );
}

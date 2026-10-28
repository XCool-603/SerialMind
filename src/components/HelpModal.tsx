import { useState } from "react";
import { Icon, IC } from "./Icon";
import guideRaw from "../../docs/自动化配置指南.md?raw";
import { APP_VERSION } from "../engine/version";

const VERSION = APP_VERSION;

/** 帮助 / 关于 */
export function HelpModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"help" | "about">("help");

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" style={{ width: 760, maxHeight: "82vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-icon" style={{ background: "var(--bg-blue)" }}>
            <Icon cp={IC.ai} size={12} color="var(--accent)" />
          </span>
          <div style={{ flex: 1 }}>
            <div className="modal-title">帮助 · SerialMind</div>
            <div className="modal-sub">5 步跑通自动化测试</div>
          </div>
          <button className="modal-close" onClick={onClose}>
            <Icon cp={IC.close} size={13} color="var(--t3)" />
          </button>
        </div>

        <div style={{ display: "flex", gap: 4, padding: "8px 14px 0" }}>
          {(
            [
              ["help", "使用说明"],
              ["about", "关于"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={tab === k ? "chip active" : "chip"} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>

        {tab === "help" ? (
          <div className="modal-body" style={{ maxHeight: "58vh", overflowY: "auto", padding: "10px 16px" }}>
            <pre className="help-md">{guideRaw}</pre>
          </div>
        ) : (
          <div className="modal-body" style={{ padding: "12px 16px", fontSize: 11, lineHeight: 1.9 }}>
            <div className="help-row">
              <span className="k">版本</span>
              <span className="v">SerialMind {VERSION}</span>
            </div>
            <div className="help-row">
              <span className="k">运行环境</span>
              <span className="v">Tauri 2 + React 19（Windows 桌面 / 浏览器）</span>
            </div>
            <div className="help-row">
              <span className="k">数据存储</span>
              <span className="v">本地 SQLite（sql.js + IndexedDB），不上云</span>
            </div>
            <div className="help-row">
              <span className="k">串口驱动</span>
              <span className="v">Rust serialport（5/6/7/8 数据位，无/奇/偶校验）</span>
            </div>
            <div className="help-row">
              <span className="k">校验算法</span>
              <span className="v">22 种（ADD8/ADD16/INV8/NEG8/LRC/XOR8/BCC/NEGXOR8/CRC8×4/CRC16×7/CRC32×2/Fletcher16）</span>
            </div>
            <div className="help-row">
              <span className="k">数据位置</span>
              <span className="v">IndexedDB → localStorage 兜底；清库在状态栏红字处点「重置」</span>
            </div>
            <div className="help-row">
              <span className="k">自检入口</span>
              <span className="v">顶栏「✔ 自检」→ 整机验收（不需要硬件，跑完整链路）</span>
            </div>
            <div className="help-row">
              <span className="k">文档</span>
              <span className="v">docs/自动化配置指南.md · docs/本轮改动记录.md</span>
            </div>
            <div style={{ marginTop: 10, color: "var(--t4)", fontSize: 10 }}>
              所有收发都是真实串口数据；报告由真实执行产生，不含演示数据。
            </div>
          </div>
        )}

        <div className="modal-foot">
          <span className="spacer" />
          <button className="btn-primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

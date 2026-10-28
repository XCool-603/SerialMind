import { useMemo } from "react";
import { useStore } from "../engine/store";
import { Icon, IC } from "../components/Icon";
import { CRANE_PROTOCOL, type PdlField } from "../engine/pdl";
import { encodeMessage, decodeFrame, findChecksum, resolveLayout } from "../engine/codec";
import { toHex } from "../engine/bytes";
import { computeChecksum } from "../engine/crc";

const MSG = CRANE_PROTOCOL.messages[0];

const VALUES = { addr: 1, func: 3, byte_count: 2, position: 3000, in_position: 1, target_point: 3, speed_rpm: -120, err_code: 0, reserved: 0 };

/** 样例帧（设备实际用 BADC 发 position），组包结果（当前配置 ABCD） */
export function buildRoundTripCase() {
  const devFields: PdlField[] = MSG.fields.map((f) => (f.name === "position" ? { ...f, byteOrder: "BADC" as const } : f));
  const cfgFields: PdlField[] = MSG.fields.map((f) => (f.name === "position" ? { ...f, byteOrder: "ABCD" as const } : f));
  const sample = encodeMessage(CRANE_PROTOCOL, { ...MSG, fields: devFields }, VALUES);
  const rebuilt = encodeMessage(CRANE_PROTOCOL, { ...MSG, fields: cfgFields }, VALUES);
  const diffIndexes: number[] = [];
  for (let i = 0; i < Math.max(sample.length, rebuilt.length); i++) {
    if (sample[i] !== rebuilt[i]) diffIndexes.push(i);
  }
  const crcField = findChecksum(MSG);
  const crcOff = resolveLayout(MSG, rebuilt.length).find((l) => l.field.id === crcField?.id)?.offset ?? rebuilt.length - 2;
  const expectCrc = computeChecksum("CRC16/MODBUS", rebuilt.slice(0, crcOff));
  return { sample, rebuilt, diffIndexes, crcOff, expectCrc };
}

export function RoundTripModal() {
  const { showRoundTripModal, setShowRoundTripModal, requestOrderFix, requestForceSave } = useStore();
  const rt = useMemo(() => buildRoundTripCase(), []);
  if (!showRoundTripModal) return null;

  const dec = decodeFrame(CRANE_PROTOCOL, rt.sample);
  const diffCount = rt.diffIndexes.length;
  const expectCrcHex = [rt.rebuilt[rt.crcOff], rt.rebuilt[rt.crcOff + 1]]
    .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
    .join(" ");
  const actualCrcHex = [rt.sample[rt.crcOff], rt.sample[rt.crcOff + 1]]
    .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
    .join(" ");
  const posSample = [rt.sample[3], rt.sample[4]].map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
  const posRebuilt = [rt.rebuilt[3], rt.rebuilt[4]].map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");

  const byteRow = (bytes: number[], diff: number[], kind: "sample" | "rebuilt") => (
    <div className="byte-chips">
      {bytes.map((b, i) => {
        const isDiff = diff.includes(i);
        const cls = isDiff ? (kind === "rebuilt" ? "byte-chip diff" : "byte-chip len") : "byte-chip";
        return (
          <span key={i} className={cls}>
            {b.toString(16).toUpperCase().padStart(2, "0")}
          </span>
        );
      })}
    </div>
  );

  return (
    <div className="modal-mask" onClick={() => setShowRoundTripModal(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-icon">
            <Icon cp={IC.error} size={12} color="var(--red)" />
          </span>
          <div style={{ flex: 1 }}>
            <div className="row gap-8">
              <span className="modal-title">样例帧 round-trip 校验未通过</span>
              <span className="pill red">禁止保存</span>
            </div>
            <div className="modal-sub">
              协议「起升PLC 控制协议 v3」组包结果与样例帧存在 {diffCount} 个字节差异，请检查字段长度、字节序或校验算法。
            </div>
          </div>
          <button className="modal-close" onClick={() => setShowRoundTripModal(false)}>
            <Icon cp={IC.close} size={13} color="var(--t3)" />
          </button>
        </div>

        <div className="modal-body">
          <div>
            <div className="section-title">
              <span>逐字节对比</span>
              <span className="legend-right">
                <span>
                  <span className="legend-dot" style={{ background: "var(--bg-panel-4)" }} />
                  一致
                </span>
                <span>
                  <span className="legend-dot" style={{ background: "var(--red)" }} />
                  差异
                </span>
                <span>
                  <span className="legend-dot" style={{ background: "#7fa6d8" }} />
                  长度不一致
                </span>
              </span>
            </div>
            <div className="byte-line">
              <span className="label">样例帧</span>
              {byteRow(rt.sample, [], "sample")}
              <span className="tail">{rt.sample.length} 字节</span>
            </div>
            <div className="byte-line">
              <span className="label">组包结果</span>
              {byteRow(rt.rebuilt, rt.diffIndexes, "rebuilt")}
              <span className="tail">{rt.rebuilt.length} 字节</span>
            </div>
            <div className="offset-line">
              <span className="label">偏移</span>
              <span className="offset-chips">
                {rt.rebuilt.map((_, i) => (
                  <span key={i} className="offset-chip">
                    {i}
                  </span>
                ))}
              </span>
            </div>
          </div>

          <div>
            <div className="section-title">差异归因（按可能性排序）</div>

            <div className="cause-card">
              <span className="cause-num">1</span>
              <div className="cause-main">
                <div className="cause-head">
                  <span className="cause-title">字节序配置不一致</span>
                  <span className="pill red" style={{ height: 15 }}>高置信</span>
                </div>
                <div className="cause-desc">
                  position 字段当前为 ABCD（大端），样例帧实际为 BADC（字节交换），期望 {posSample}，实际组包 {posRebuilt}。
                </div>
                <div className="cause-actions">
                  <button className="btn sm" onClick={requestOrderFix}>
                    <Icon cp={IC.edit} size={10} color="var(--t2)" />
                    <span>把 position 改为 BADC</span>
                  </button>
                  <button className="btn sm" onClick={() => setShowRoundTripModal(false)}>
                    忽略此条
                  </button>
                </div>
              </div>
            </div>

            <div className="cause-card">
              <span className="cause-num">2</span>
              <div className="cause-main">
                <div className="cause-head">
                  <span className="cause-title">校验算法或校验范围错误</span>
                  <span className="pill amber" style={{ height: 15 }}>中置信</span>
                </div>
                <div className="cause-desc">
                  CRC 结果 {expectCrcHex} 与样例 {actualCrcHex} 不一致。可能是校验范围包含/不包含地址字节，或算法应为 CRC16/CCITT。
                </div>
                <div className="cause-actions">
                  </div>
              </div>
            </div>
          </div>

          <div>
            <div className="selfcheck">
              <div className="selfcheck-row">
                <Icon cp={IC.check} size={11} color="var(--green)" />
                <span className="n">字段连续性（offset 无空洞）</span>
                <span className="v ok">通过</span>
              </div>
              <div className="selfcheck-row">
                <Icon cp={IC.check} size={11} color="var(--green)" />
                <span className="n">长度自洽（声明 {rt.rebuilt.length}B = 实际 {rt.sample.length}B）</span>
                <span className="v ok">通过</span>
              </div>
              <div className="selfcheck-row">
                <Icon cp={IC.error} size={11} color="var(--red)" />
                <span className="n">round-trip 逐字节一致</span>
                <span className="v bad">失败 · {diffCount} 字节差异</span>
              </div>
              <div className="selfcheck-row">
                <Icon cp={IC.check} size={11} color="var(--green)" />
                <span className="n">枚举合理性（func 取值 03/06 已定义）</span>
                <span className="v ok">通过</span>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <span className="spacer" />
          <button className="btn" onClick={requestForceSave}>
            <Icon cp={IC.warn} size={11} color="var(--amber)" />
            <span>强制保存（可配）</span>
          </button>
          <button className="btn-primary" onClick={requestOrderFix} style={{ height: 28, padding: "0 12px" }}>
            <Icon cp={IC.refresh} size={12} color="#fff" />
            <span>重新校验</span>
          </button>
        </div>
      </div>
    </div>
  );
}

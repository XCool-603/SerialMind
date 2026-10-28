import { useState } from "react";
import { useStore } from "../engine/store";
import { Icon, IC } from "./Icon";

export function DialogHost() {
  const dialog = useStore((s) => s.dialog);
  const closeDialog = useStore((s) => s.closeDialog);
  const [values, setValues] = useState<Record<string, string>>({});

  if (!dialog) return null;

  const init = () => {
    const v: Record<string, string> = {};
    for (const f of dialog.fields ?? []) v[f.key] = f.value ?? "";
    return v;
  };
  const current = Object.keys(values).length ? values : init();

  const submit = () => {
    dialog.onOk(current);
    setValues({});
    closeDialog();
  };

  return (
    <div className="dlg-mask" onClick={closeDialog}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <div className="dlg-head">
          <span className="dlg-title">{dialog.title}</span>
          <button className="modal-close" onClick={closeDialog}>
            <Icon cp={IC.close} size={13} color="var(--t3)" />
          </button>
        </div>
        {dialog.desc && <div className="dlg-desc">{dialog.desc}</div>}

        {dialog.kind === "form" && (
          <div className="dlg-body">
            {(dialog.fields ?? []).map((f) => (
              <div className="dlg-row" key={f.key}>
                <span className="dlg-label">{f.label}</span>
                {f.type === "select" ? (
                  <select
                    className="dlg-input"
                    value={current[f.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...current, [f.key]: e.target.value }))}
                  >
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === "checkbox" ? (
                  <button
                    className={current[f.key] === "1" ? "switch-track on" : "switch-track"}
                    style={{ marginLeft: "auto" }}
                    onClick={() =>
                      setValues((v) => ({ ...current, [f.key]: current[f.key] === "1" ? "" : "1" }))
                    }
                  >
                    <span className="switch-knob" />
                  </button>
                ) : (
                  <input
                    className="dlg-input"
                    type={f.type === "number" ? "number" : "text"}
                    value={current[f.key] ?? ""}
                    placeholder={f.placeholder}
                    onChange={(e) => setValues((v) => ({ ...current, [f.key]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submit();
                    }}
                    autoFocus={f === dialog.fields?.[0]}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        <div className="dlg-foot">
          <button className="btn" onClick={closeDialog}>
            取消
          </button>
          <button className={dialog.danger ? "btn-primary danger" : "btn-primary"} onClick={submit}>
            {dialog.okText ?? "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}

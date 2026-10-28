import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

import "./styles/tokens.css";
import "./styles/shell.css";
import "./styles/terminal.css";
import "./styles/protocol.css";
import "./styles/modal.css";
import "./styles/case.css";
import "./styles/misc.css";

import { useStore } from "./engine/store";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// 启动时初始化 SQLite 并载入工作区
void useStore.getState().init();

// 规则引擎心跳：200ms 评估一次触发器（真发帧、真计数）
setInterval(() => {
  useStore.getState().tickRules();
}, 200);

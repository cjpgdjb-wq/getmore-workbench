import { Bell, CircleHelp, FlaskConical, Sparkles } from "lucide-react";
import { useWorkbench } from "../state/workbench";

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d="M12 3.2 14.1 9l5.9 2.1-5.9 2.1L12 19l-2.1-5.8L4 11.1 9.9 9 12 3.2Z"
          fill="currentColor"
          opacity="0.95"
        />
        <path d="M18.6 15.6 19.5 18l2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4Z" fill="currentColor" opacity="0.7" />
      </svg>
    </span>
  );
}

export default function AppHeader() {
  const { activeTab, setActiveTab } = useWorkbench();
  const inWorkspace = activeTab === "workspace" || activeTab === "partner";

  return (
    <header className="app-header">
      <div className="brand">
        <BrandMark />
        <div className="brand-text">
          <span className="brand-name">GETmore</span>
          <span className="brand-sub">智能经营工作台</span>
        </div>
      </div>

      <nav className="app-nav" aria-label="主导航">
        <button
          className={inWorkspace ? "is-active" : ""}
          onClick={() => {
            if (!inWorkspace) setActiveTab("workspace");
          }}
        >
          <span className="nav-dot" aria-hidden="true" />
          GETmore 工作台
        </button>
        <button className={activeTab === "data" ? "is-active" : ""} onClick={() => setActiveTab("data")}>
          数据
        </button>
      </nav>

      <div className="header-right">
        <span className="demo-pill" title="当前所有指标均为本地模拟数据，未连接任何广告平台">
          <FlaskConical size={12} />
          <span>模拟数据</span>
        </span>
        <button className="header-icon" aria-label="智能助手" data-tip="Copilot 可用" title="Copilot 可用">
          <Sparkles size={17} />
        </button>
        <button className="header-icon" aria-label="消息通知" data-tip="消息通知" title="消息通知">
          <Bell size={17} />
          <i className="dot" />
        </button>
        <button className="header-icon" aria-label="帮助中心" data-tip="帮助中心" title="帮助中心">
          <CircleHelp size={17} />
        </button>
        <span className="header-sep" />
        <div className="user-chip" title="优化师">
          <span className="avatar">示</span>
          <span className="user-meta">
            <span className="user-name">示例用户</span>
            <span className="user-role">优化师</span>
          </span>
        </div>
      </div>
    </header>
  );
}

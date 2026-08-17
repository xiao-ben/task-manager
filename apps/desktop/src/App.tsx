import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  IconMonth,
  IconSearch,
  IconSettings,
  IconToday,
  IconWeek,
  IconWidget,
} from "./components/Icons";
import {
  OnboardingWizard,
  shouldShowOnboarding,
  shouldShowOnboardingAsync,
} from "./components/OnboardingWizard";
import { SearchPalette } from "./components/SearchPalette";
import { WidgetPage } from "./pages/WidgetPage";
import { DayPage } from "./pages/DayPage";
import { PeriodPage } from "./pages/PeriodPage";
import { SettingsPage } from "./pages/SettingsPage";
import {
  getSyncStatus,
  subscribeSync,
  syncNow,
  initLocalStore,
} from "./lib/sync";
import { loadSettings } from "./lib/settings";

async function openDesktopWidget() {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("show_widget");
  } catch {
    window.location.hash = "#/widget";
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [sync, setSync] = useState(getSyncStatus());
  const [searchOpen, setSearchOpen] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(() => shouldShowOnboarding());

  useEffect(() => {
    void initLocalStore();
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("ensure_sidecar_cmd");
      } catch {
        /* browser / already starting in Rust setup */
      }
      // Existing users (sidecar/.env key / local data) should not see the wizard
      const show = await shouldShowOnboardingAsync();
      setOnboardOpen(show);
    })();
    return subscribeSync(() => setSync(getSyncStatus()));
  }, []);

  useEffect(() => {
    const tick = () => {
      if (!loadSettings().syncEnabled) return;
      void syncNow();
    };
    const onOnline = () => tick();
    window.addEventListener("online", onOnline);
    const t = window.setInterval(tick, 30_000);
    tick();
    return () => {
      window.removeEventListener("online", onOnline);
      window.clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (meta && e.key.toLowerCase() === "n") {
        e.preventDefault();
        navigate("/");
        window.setTimeout(() => {
          const el = document.querySelector<HTMLInputElement>(
            'input[aria-label="新待办"]',
          );
          el?.focus();
        }, 50);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="主导航">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden>
            今
          </div>
          <div>
            <div className="brand">任务台</div>
            <div className="brand-sub">个人工作台</div>
          </div>
        </div>

        <nav className="side-nav">
          <NavLink to="/" end>
            <span className="nav-icon">
              <IconToday size={16} />
            </span>
            <span className="nav-label">今日</span>
          </NavLink>
          <NavLink to="/week">
            <span className="nav-icon">
              <IconWeek size={16} />
            </span>
            <span className="nav-label">本周</span>
          </NavLink>
          <NavLink to="/month">
            <span className="nav-icon">
              <IconMonth size={16} />
            </span>
            <span className="nav-label">本月</span>
          </NavLink>
          <button
            type="button"
            className="side-nav-btn"
            title="搜索任务（⌘K）"
            aria-label="搜索任务"
            onClick={() => setSearchOpen(true)}
          >
            <span className="nav-icon">
              <IconSearch size={16} />
            </span>
            <span className="nav-label">搜索</span>
          </button>
          <button
            type="button"
            className="side-nav-btn"
            title="显示小窗"
            aria-label="显示小窗"
            onClick={() => void openDesktopWidget()}
          >
            <span className="nav-icon">
              <IconWidget size={16} />
            </span>
            <span className="nav-label">显示小窗</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <NavLink to="/settings" className="side-nav-settings" title="设置">
            <span className="nav-icon">
              <IconSettings size={16} />
            </span>
            <span className="nav-label">设置</span>
          </NavLink>
          <span
            className={`pill ${
              sync.label === "已同步"
                ? "ok"
                : sync.label === "远端离线" || sync.label.startsWith("待同步")
                  ? "warn"
                  : "neutral"
            }`}
            title={sync.lastError ?? undefined}
          >
            {sync.label}
          </span>
        </div>
      </aside>

      <div className="content">
        <div className="content-inner rise">{children}</div>
      </div>

      <SearchPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(task) => {
          navigate(`/?day=${task.day}&focus=${task.id}`);
        }}
      />
      <OnboardingWizard
        open={onboardOpen}
        onClose={() => setOnboardOpen(false)}
      />
    </div>
  );
}

export default function App() {
  const loc = useLocation();
  const isWidget =
    loc.pathname === "/widget" || loc.search.includes("mode=widget");

  if (isWidget) {
    return <WidgetPage />;
  }

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<DayPage />} />
        <Route path="/week" element={<PeriodPage kind="week" />} />
        <Route path="/month" element={<PeriodPage kind="month" />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Shell>
  );
}

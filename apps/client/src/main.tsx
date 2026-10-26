import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsProvider } from './lib/settings';
import { StoreProvider } from './store/StoreProvider';
import { UiProvider } from './lib/ui';
import { App, Toasts } from './App';
import { MiniWindow } from './components/MiniWindow';
import { TaskDetail } from './components/task/TaskDetail';
import { isAuxWindow, isMiniWindow, isSettingsWindow } from './lib/windows';
import { installCrossWindow } from './lib/cross-window';
import { SettingsWindow } from './pages/Settings';
import { initLoginError, startAccountWatch } from './lib/account';
import { registerServiceWorker } from './lib/reminders';
import { initNativeLogin } from './lib/native-login';
import { installExternalLinks } from './lib/external';
import { installContextMenuBlock } from './lib/contextmenu';
import { installRootScrollGuard } from './lib/root-scroll';
import { applyLocalePref, initialLocalePref, loadLocale, resolveLocale } from './lib/i18n';
import { LocaleRoot } from './lib/locale';
import { preloadMdEditor } from './components/editor/LazyMdEditor';
import './skin/tokens.css';
import './styles/app.css';
import './styles/task.css';
import './styles/library.css';
import './styles/types.css';
import './styles/lookup.css';
import './styles/editor.css';
import './styles/journal.css';
import './styles/attachments.css';
import './styles/lunar.css';
import './styles/prop-chips.css';
import './styles/settings.css';
import './styles/project.css';
import './skin/skins.css';

// 登录失败回跳带的 ?login_error：先取出并从地址栏去掉，再渲染
initLoginError();
// 账户状态（同步跟着它开 / 停）；原生端监听登录回调的 deep link
// 小窗、设置窗口不跑同步、不接登录回调（都交给主窗口）
const mini = isMiniWindow();
const settingsWin = isSettingsWindow();
if (!isAuxWindow()) {
  registerServiceWorker();
  void initNativeLogin();
}
// 窗口之间：账户、同步状态、提醒开关（Tauri 桌面，见 lib/cross-window.ts）
installCrossWindow();
// App 里的外链交给系统浏览器
installExternalLinks();
// 浏览器 / WebView 自带的右键菜单不出（能打字的地方除外）
installContextMenuBlock();
// 整页不滚：外层万一被滚动了就复位（桌面布局才管，手机软键盘要滚整页）
installRootScrollGuard();

// 编辑器在空闲时先加载好：新建面板一打开就能写
const idle = (cb: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(cb, { timeout: 3000 }) : setTimeout(cb, 1500));
idle(preloadMdEditor);

// 界面语言：先按本机记的（或 ?lang=）加载好词典、切好，演示数据、第一屏都用这个语言；登录同步后以同步的设置为准
const pref = initialLocalePref();
void loadLocale(resolveLocale(pref))
  .catch(() => {})
  .then(() => {
    applyLocalePref(pref);
    // 账户状态里有给人看的说明（「同步服务尚未上线」），要等词典好了再查，不然德语界面里冒出中文
    if (!mini) startAccountWatch();
    render();
  });

function render() {
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <StoreProvider>
        <LocaleRoot>
          <UiProvider>
            {settingsWin ? (
              <>
                <SettingsWindow />
                <Toasts />
              </>
            ) : mini ? (
              <>
                <MiniWindow />
                <TaskDetail />
                <Toasts />
              </>
            ) : (
              <App />
            )}
          </UiProvider>
        </LocaleRoot>
      </StoreProvider>
    </SettingsProvider>
  </StrictMode>,
);
}

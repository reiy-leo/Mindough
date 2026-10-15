import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsProvider } from './lib/settings';
import { StoreProvider } from './store/StoreProvider';
import { UiProvider } from './lib/ui';
import { App } from './App';
import { initLoginError, startAccountWatch } from './lib/account';
import { initNativeLogin } from './lib/native-login';
import { installExternalLinks } from './lib/external';
import { applyLocalePref, initialLocalePref } from './lib/i18n';
import { LocaleRoot } from './lib/locale';
import './skin/tokens.css';
import './styles/app.css';
import './styles/task.css';
import './styles/library.css';
import './skin/skins.css';

// 界面语言：先按本机记的（或 ?lang=）切好，演示数据、第一屏都用这个语言；登录同步后以同步的设置为准
applyLocalePref(initialLocalePref());
// 登录失败回跳带的 ?login_error：先取出并从地址栏去掉，再渲染
initLoginError();
// 账户状态（同步跟着它开 / 停）；原生端监听登录回调的 deep link
startAccountWatch();
void initNativeLogin();
// App 里的外链交给系统浏览器
installExternalLinks();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <StoreProvider>
        <LocaleRoot>
          <UiProvider>
            <App />
          </UiProvider>
        </LocaleRoot>
      </StoreProvider>
    </SettingsProvider>
  </StrictMode>,
);

import { StrictMode } from 'react';
import { I18nProvider } from 'react-aria-components';
import { createRoot } from 'react-dom/client';
import { SettingsProvider } from './lib/settings';
import { StoreProvider } from './store/StoreProvider';
import { UiProvider } from './lib/ui';
import { App } from './App';
import { initLoginError } from './lib/account';
import './skin/tokens.css';
import './styles/app.css';
import './styles/task.css';
import './skin/skins.css';

// 登录失败回跳带的 ?login_error：先取出并从地址栏去掉，再渲染
initLoginError();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider locale="zh-CN">
    <SettingsProvider>
      <StoreProvider>
        <UiProvider>
          <App />
        </UiProvider>
      </StoreProvider>
    </SettingsProvider>
    </I18nProvider>
  </StrictMode>,
);

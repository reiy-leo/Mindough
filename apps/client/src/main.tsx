import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsProvider } from './lib/settings';
import { StoreProvider } from './store/StoreProvider';
import { UiProvider } from './lib/ui';
import { App } from './App';
import './skin/tokens.css';
import './styles/app.css';
import './skin/skins.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <StoreProvider>
        <UiProvider>
          <App />
        </UiProvider>
      </StoreProvider>
    </SettingsProvider>
  </StrictMode>,
);

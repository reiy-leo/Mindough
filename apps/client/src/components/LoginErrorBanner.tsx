import { AlertCircle, X } from 'lucide-react';
import { Button as RacButton } from 'react-aria-components';
import { dismissLoginError, loginErrorText, useLoginError } from '../lib/account';

/** 登录失败提示：可关闭；URL 里的 login_error 已在启动时去掉。 */
export function LoginErrorBanner() {
  const code = useLoginError();
  if (!code) return null;
  return (
    <div className="banner banner-error" role="alert">
      <AlertCircle size={18} aria-hidden />
      <span className="grow">{loginErrorText(code)} 不登录也能照常使用，数据都在本机。</span>
      <RacButton className="icon-btn" aria-label="关闭提示" onPress={dismissLoginError}>
        <X size={16} />
      </RacButton>
    </div>
  );
}

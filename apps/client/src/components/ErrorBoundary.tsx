/**
 * 界面出错时别整页白屏（Rei 2026-10-27「点击了一个任务，没有出现详情，而是页面变空白」）：
 * 渲染抛错的那一块换成一张小卡片，写明出错信息，可以「再试一次」；其余部分照常能用。
 * resetKey 变了（比如换了一件任务）自动重试。出错信息同时打到控制台，方便开发者工具里看。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { tr } from '../lib/i18n';

type Props = { children: ReactNode; resetKey?: unknown };
type State = { error: Error | null; key: unknown };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, key: this.props.resetKey };
  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[mindough] 界面出错', error, info.componentStack);
  }
  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-card" role="alert">
        <TriangleAlert size={20} aria-hidden />
        <div className="error-card-title">{tr('这里出错了，内容没显示出来')}</div>
        <code className="error-card-msg">{String(error.message || error).slice(0, 300)}</code>
        <button type="button" className="btn btn-secondary" onClick={() => this.setState({ error: null })}>
          {tr('再试一次')}
        </button>
      </div>
    );
  }
}

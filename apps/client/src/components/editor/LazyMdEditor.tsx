/** 按需加载 Markdown 编辑器（Milkdown 有点大）；加载完之前显示排好版的预览，样子一样。 */
import { lazy, Suspense } from 'react';
import { Markdown } from '../Markdown';
import type { MdEditorProps } from './MdEditor';

const Impl = lazy(() => import('./MdEditor'));

export function LazyMdEditor(props: MdEditorProps) {
  return (
    <Suspense
      fallback={
        <div className={`md-editor is-loading${props.className ? ` ${props.className}` : ''}`}>
          <div className="md-editor-root">{props.value.trim() ? <Markdown source={props.value} /> : <div className="md md-editor-content"><p className="md-placeholder" data-placeholder={props.placeholder ?? ''} /></div>}</div>
        </div>
      }
    >
      <Impl {...props} />
    </Suspense>
  );
}

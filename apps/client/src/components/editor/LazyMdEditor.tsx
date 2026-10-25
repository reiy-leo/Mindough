/** 按需加载 Markdown 编辑器（Tiptap + remark 有点大）；加载完之前显示排好版的预览，样子一样。 */
import { lazy, Suspense } from 'react';
import { Markdown } from '../Markdown';
import type { MdEditorProps } from './MdEditor';

const load = () => import('./MdEditor');
const Impl = lazy(load);

/** 提前把编辑器加载好（新建面板一打开就能写，不等下载）。 */
export function preloadMdEditor() {
  void load();
}

export function LazyMdEditor(props: MdEditorProps) {
  return (
    <Suspense
      fallback={
        <div className={`md-editor is-loading${props.className ? ` ${props.className}` : ''}`}>
          <div className="md-editor-root">{props.value.trim() ? <Markdown source={props.value} className="md-editor-content" /> : <div className="md md-editor-content"><p className="md-placeholder" data-placeholder={props.placeholder ?? ''} /></div>}</div>
        </div>
      }
    >
      <Impl {...props} />
    </Suspense>
  );
}

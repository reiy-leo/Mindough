/**
 * 资料 / 人物的备注：和任务内容一样，所见即所得的 Markdown 编辑器（存的还是 markdown）。
 * 编辑时下方出现格式工具栏；空的时候显示占位「写点什么…」（docs/COPY.md）。
 */
import { useId } from 'react';
import { LazyMdEditor } from '../editor/LazyMdEditor';

import { tr } from '../../lib/i18n';

export function NoteField({ value, onChange, label = tr('备注'), placeholder = tr('写点什么…'), className }: { value: string; onChange: (v: string) => void; label?: string; placeholder?: string; className?: string }) {
  const id = useId();
  return (
    <div className={`field note-field${className ? ` ${className}` : ''}`} role="group" aria-labelledby={id}>
      <span className="field-label note-field-label" id={id}>
        {label}
      </span>
      <LazyMdEditor className="input note-editor" label={label} placeholder={placeholder} value={value} onChange={onChange} />
    </div>
  );
}

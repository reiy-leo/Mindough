/**
 * 资料 / 人物的备注：和任务内容一样——写好后显示排版后的样子，点一下接着改；空的时候直接是输入框。
 * 「支持 Markdown」只是标签旁一行小字，写法放在悬停提示里（docs/COPY.md）。
 */
import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { AutoTextarea, Tip } from '../../ui/primitives';
import { MARKDOWN_HELP, Markdown } from '../Markdown';

export function NoteField({ value, onChange, label = '备注', placeholder = '写点什么…', className }: { value: string; onChange: (v: string) => void; label?: string; placeholder?: string; className?: string }) {
  const [editing, setEditing] = useState(!value.trim());
  const [focus, setFocus] = useState(false);
  const open = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a, input, button')) return;
    setFocus(true);
    setEditing(true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && e.target === e.currentTarget) {
      e.preventDefault();
      setFocus(true);
      setEditing(true);
    }
  };
  return (
    <div className={`field note-field${className ? ` ${className}` : ''}`}>
      <span className="field-label note-field-label">
        {label}
        <Tip content={MARKDOWN_HELP}>
          <RacButton className="link-btn note-md-hint">支持 Markdown</RacButton>
        </Tip>
      </span>
      {editing ? (
        <AutoTextarea
          label={label}
          className="input note-textarea"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoFocus={focus}
          minRows={3}
          onBlur={() => value.trim() && setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && value.trim()) {
              e.stopPropagation();
              e.preventDefault();
              setEditing(false);
            }
          }}
        />
      ) : (
        <div className="input note-preview" tabIndex={0} role="group" aria-label={`${label}，按回车编辑`} onClick={open} onKeyDown={onKey}>
          <Markdown source={value} />
        </div>
      )}
    </div>
  );
}

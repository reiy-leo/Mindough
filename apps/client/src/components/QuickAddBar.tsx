import { useRef, useState, type ReactNode } from 'react';
import { Form, Input, TextField } from 'react-aria-components';
import { Plus } from 'lucide-react';
import { useUi } from '../lib/ui';
import { useSettings } from '../lib/settings';
import { afterQuickAdd, quickAdd } from '../lib/quick-add';

/**
 * 列表页最上面的快速添加框（Rei 2026-10-26「我的一天、待安排、可做的中间列的header去掉，换成输入框」）。
 * 回车建任务，马上打开它（「从这里添加任务后立即打开任务」）；焦点、滚动见 lib/quick-add。
 * create 负责建任务并放到对的地方（今天 / 待安排），返回新任务的 id。
 * trailing：输入框行尾的小图标按钮（比如我的一天的「打开小窗」）。
 */
export function QuickAddBar({ placeholder, label, create, trailing }: { placeholder: string; label: string; create: (text: string) => string; trailing?: ReactNode }) {
  const ui = useUi();
  const { layout } = useSettings();
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const add = () => {
    const id = quickAdd({ create, openEditor: ui.openEditor }, draft);
    if (!id) return;
    setDraft('');
    afterQuickAdd(id, input.current, layout);
  };
  return (
    <Form
      className="add-bar"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <Plus size={18} className="add-bar-icon" aria-hidden />
      <TextField aria-label={label} value={draft} onChange={setDraft} className="add-bar-field">
        <Input ref={input} className="add-bar-input" placeholder={placeholder} />
      </TextField>
      {trailing}
    </Form>
  );
}

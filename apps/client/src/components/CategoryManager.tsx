/**
 * 设置 → 任务 → 类型 打开的弹层（Rei 2026-10-26：打卡分类、项目分类合成一套「类型」）。
 * 里面就是 CategoryEditor，和侧栏「管理 → 类型」页用的是同一个组件。
 */
import { Button, Sheet } from '../ui/primitives';
import { CategoryEditor } from './CategoryEditor';
import { tr, trc } from '../lib/i18n';

export function CategoryManager({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={trc('分类', '类型')}
      className="modal-cats"
      footer={
        <>
          <span className="grow" />
          <Button variant="primary" onPress={() => onOpenChange(false)}>
            {tr('完成')}</Button>
        </>
      }
    >
      <CategoryEditor />
    </Sheet>
  );
}

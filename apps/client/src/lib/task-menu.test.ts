import { describe, expect, it } from 'vitest';
import { detailMenu } from './task-menu';

const ids = (m: ReturnType<typeof detailMenu>) => m.map((e) => (e.separator ? `|${e.id}` : e.id)).join(' ');

describe('任务详情「…」菜单（关闭挪进菜单，Rei 2026-10-17）', () => {
  it('没做完的普通任务：我的一天 | 关闭 | 删除', () => {
    const m = detailMenu({ status: '待办', recurrence: null, completion_mode: 'once' }, false);
    expect(ids(m)).toBe('myday |close |delete');
    expect(m.find((e) => e.id === 'close')!.label).toBe('关闭');
    expect(m[0]!.label).toBe('加入我的一天');
    expect(m.at(-1)).toMatchObject({ id: 'delete', danger: true });
  });
  it('计时 / 计数任务多一项「直接标为完成」，放在关闭前面、同一组', () => {
    expect(ids(detailMenu({ status: '进行中', recurrence: null, completion_mode: 'timer' }, true))).toBe('myday |done close |delete');
    expect(detailMenu({ status: '待办', recurrence: null, completion_mode: 'count' }, true)[0]!.label).toBe('移出我的一天');
  });
  it('定期打卡：关闭叫「不再打卡」，没有直接标为完成', () => {
    const m = detailMenu({ status: '待办', recurrence: 'FREQ=DAILY', completion_mode: 'timer' }, false);
    expect(ids(m)).toBe('myday |close |delete');
    expect(m[1]!.label).toBe('不再打卡');
  });
  it('已关闭 / 已完成的任务：换成「重新打开」（打卡叫「恢复打卡」）', () => {
    expect(ids(detailMenu({ status: '关闭', recurrence: null, completion_mode: 'once' }, false))).toBe('myday |reopen |delete');
    expect(detailMenu({ status: '完成', recurrence: null, completion_mode: 'once' }, false)[1]!.label).toBe('重新打开');
    expect(detailMenu({ status: '关闭', recurrence: 'FREQ=DAILY', completion_mode: 'once' }, false)[1]!.label).toBe('恢复打卡');
  });
});

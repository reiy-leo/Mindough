import { describe, expect, it } from 'vitest';
import {
  countConfigForUnit,
  countConfigWithQuick,
  countConfigWithStep,
  countStep,
  defaultStepFor,
  formatDelta,
  newCountConfig,
  parseCountInput,
  quickAmounts,
  roundAmount,
} from '../src/count';
import { Store } from '../src/store';
import { MemoryAdapter } from '../src/storage/memory';
import { local, mkTask } from './helpers';

async function open(now = local(2026, 10, 26, 10)) {
  let t = now.getTime();
  const adapter = new MemoryAdapter();
  const store = await Store.open(adapter, { deviceId: 'dev1', now: () => new Date(t) });
  return { store, adapter, advance: (ms: number) => (t += ms) };
}

describe('计数步长（count.ts）', () => {
  it('按单位给默认步长：mL 250、页 10、分钟 5、次 1，不认识的单位 1', () => {
    expect(defaultStepFor('mL')).toBe(250);
    expect(defaultStepFor(' ML ')).toBe(250);
    expect(defaultStepFor('毫升')).toBe(250);
    expect(defaultStepFor('页')).toBe(10);
    expect(defaultStepFor('分钟')).toBe(5);
    expect(defaultStepFor('次')).toBe(1);
    expect(defaultStepFor('杯')).toBe(1);
    expect(defaultStepFor('L')).toBe(0.5);
    expect(defaultStepFor('个俯卧撑')).toBe(1);
    expect(defaultStepFor(null)).toBe(1);
    expect(newCountConfig('mL')).toEqual({ step: 250 });
  });

  it('换单位：没手改过步长就跟着换，手改过不覆盖', () => {
    let cfg = newCountConfig(null);
    cfg = countConfigForUnit(cfg, 'mL');
    expect(cfg.step).toBe(250);
    cfg = countConfigForUnit(cfg, '页');
    expect(cfg.step).toBe(10);
    cfg = countConfigWithStep(cfg, 300);
    expect(cfg).toEqual({ step: 300, step_set: true });
    cfg = countConfigForUnit(cfg, '分钟');
    expect(cfg.step).toBe(300);
    // 步长不能是 0 或负数
    expect(countConfigWithStep(cfg, 0)).toBe(cfg);
    expect(countConfigWithStep(cfg, -5)).toBe(cfg);
  });

  it('快捷按钮：默认步长、步长 × 2；「次」只给 +1；老任务只有 +1', () => {
    expect(quickAmounts(mkTask('a', { unit: 'mL', count_config: { step: 250 } }))).toEqual([250, 500]);
    expect(quickAmounts(mkTask('a', { unit: '次', count_config: { step: 1 } }))).toEqual([1]);
    expect(quickAmounts(mkTask('a', { unit: null, count_config: { step: 1 } }))).toEqual([1]);
    expect(quickAmounts(mkTask('a', { unit: '杯', count_config: { step: 1 } }))).toEqual([1, 2]);
    // 老任务：配置是空的，单位是 mL 也照旧只有 +1
    expect(quickAmounts(mkTask('a', { unit: 'mL', count_config: {} }))).toEqual([1]);
    expect(countStep(mkTask('a', { unit: 'mL', count_config: {} }))).toBe(1);
  });

  it('快捷按钮可以改：最多三个、去重、去掉非正数；删光退回步长', () => {
    const cfg = countConfigWithQuick({ step: 250 }, [250, 500, 500, -1, 0, 750, 1000]);
    expect(cfg.quick).toEqual([250, 500, 750]);
    expect(quickAmounts(mkTask('a', { unit: 'mL', count_config: cfg }))).toEqual([250, 500, 750]);
    expect(quickAmounts(mkTask('a', { unit: 'mL', count_config: { step: 250, quick: [] } }))).toEqual([250]);
    // 改了快捷按钮，再换单位不动它
    expect(countConfigForUnit(cfg, '页').quick).toEqual([250, 500, 750]);
  });

  it('坏数据当老任务处理', () => {
    expect(countStep(mkTask('a', { count_config: null as never }))).toBe(1);
    expect(countStep(mkTask('a', { count_config: [] as never }))).toBe(1);
    expect(countStep(mkTask('a', { count_config: { step: 'x' } as never }))).toBe(1);
    expect(quickAmounts(mkTask('a', { count_config: { quick: 'x' } as never }))).toEqual([1]);
  });

  it('手输：「+330」加、「-100」减、「1200」改成总数；看不懂或没变返回 null', () => {
    expect(parseCountInput('+330', 500)).toBe(330);
    expect(parseCountInput('＋330', 500)).toBe(330);
    expect(parseCountInput('-100', 500)).toBe(-100);
    expect(parseCountInput('1200', 500)).toBe(700);
    expect(parseCountInput('200', 500)).toBe(-300);
    expect(parseCountInput('1,200', 0)).toBe(1200);
    expect(parseCountInput('0.5', 0.25)).toBe(0.25);
    expect(parseCountInput('500', 500)).toBeNull();
    expect(parseCountInput('abc', 0)).toBeNull();
    expect(parseCountInput('', 0)).toBeNull();
  });

  it('小数不出浮点误差；快捷按钮上的字', () => {
    expect(roundAmount(0.1 + 0.2)).toBe(0.3);
    expect(formatDelta(250)).toBe('+250');
    expect(formatDelta(0.5)).toBe('+0.5');
    expect(formatDelta(-100)).toBe('−100');
  });
});

describe('计数加量、手输、撤销（Store）', () => {
  it('按快捷量加，加够自动完成；撤销那一次就改回待办', async () => {
    const { store, advance } = await open();
    const t = store.createTask({ completion_mode: 'count', target_value: 2000, unit: 'mL', count_config: newCountConfig('mL') });
    for (let i = 0; i < 3; i++) {
      store.checkIn(t.id, 'add', 500);
      advance(1000);
    }
    expect(store.progress(t.id)!.value).toBe(1500);
    const r = store.checkIn(t.id, 'add', 500);
    expect(r.completed).not.toBeNull();
    expect(store.get('task', t.id)!.status).toBe('完成');
    const p = store.undoCheckIn(r.event.id)!;
    expect(p.value).toBe(1500);
    expect(store.get('task', t.id)!.status).toBe('待办');
  });

  it('手输总数记成差值事件（可以是负数）', async () => {
    const { store } = await open();
    const t = store.createTask({ completion_mode: 'count', target_value: 2000, unit: 'mL', count_config: newCountConfig('mL') });
    store.checkIn(t.id, 'add', 250);
    store.checkIn(t.id, 'add', parseCountInput('1200', store.progress(t.id)!.value)!);
    expect(store.progress(t.id)!.value).toBe(1200);
    store.checkIn(t.id, 'add', parseCountInput('800', 1200)!);
    expect(store.progress(t.id)!.value).toBe(800);
  });

  it('撤销上一次：撤的是这个周期最后一次加量，一直撤到没有', async () => {
    const { store, advance } = await open();
    const t = store.createTask({ completion_mode: 'count', target_value: 8, unit: '杯', recurrence: 'FREQ=DAILY', count_config: newCountConfig('杯') });
    store.checkIn(t.id, 'add', 1);
    advance(1000);
    store.checkIn(t.id, 'add', 2);
    const last = store.lastCountAdd(t.id)!;
    expect(last.amount).toBe(2);
    store.undoCheckIn(last.id);
    expect(store.progress(t.id)!.value).toBe(1);
    store.undoCheckIn(store.lastCountAdd(t.id)!.id);
    expect(store.progress(t.id)!.value).toBe(0);
    expect(store.lastCountAdd(t.id)).toBeUndefined();
    // 撤销是墓碑：行还在，标了 deleted
    expect(store.raw('check_in', last.id)?.deleted).toBe(true);
  });

  it('老任务（没有 count_config 的行）打开后补成空对象，照旧每次 +1', async () => {
    const adapter = new MemoryAdapter();
    const old = mkTask('00000000-0000-7000-8000-000000000001', { completion_mode: 'count', target_value: 3, unit: '杯' }) as unknown as Record<string, unknown>;
    delete old.count_config;
    await adapter.applyRemoteChanges([{ table: 'task', row: old as never }]);
    const store = await Store.open(adapter, { deviceId: 'dev1', now: () => local(2026, 10, 26, 10) });
    const t = store.get('task', old.id as string)!;
    expect(t.count_config).toEqual({});
    expect(countStep(t)).toBe(1);
    expect(quickAmounts(t)).toEqual([1]);
  });

  it('拉下来的老行（云端还没有 count_config）也补成空对象', async () => {
    const { store } = await open();
    const old = mkTask('00000000-0000-7000-8000-000000000002', { completion_mode: 'count', updated_at: '9999999999999-0000-dev2' }) as unknown as Record<string, unknown>;
    delete old.count_config;
    store.applyRemote([{ table: 'task', row: old as never }]);
    expect(store.get('task', old.id as string)!.count_config).toEqual({});
  });
});

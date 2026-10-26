import type { CheckIn, CheckInKind, Task } from '../src/types';

let n = 0;
export function ci(task_id: string, period_key: string, kind: CheckInKind, at: string | Date, amount = 0): CheckIn {
  n++;
  return {
    id: `ci-${String(n).padStart(6, '0')}`,
    updated_at: '',
    deleted: false,
    task_id,
    period_key,
    kind,
    amount,
    at: typeof at === 'string' ? at : at.toISOString(),
  };
}

export function mkTask(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    updated_at: '',
    deleted: false,
    body_md: id,
    status: '待办',
    group_id: null,
    scheduled_date: null,
    type_id: null,
    type_data: {},
    completion_mode: 'once',
    target_value: null,
    unit: null,
    target_date: null,
    recurrence: null,
    checkin_category_id: null,
    library_item_id: null,
    remind_time: null,
    time_zone: null,
    count_config: {},
    done_at: null,
    sort: 0,
    created_at: new Date(2026, 0, 1, 8).toISOString(),
    ...patch,
  };
}

/** 本地时间。 */
export const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

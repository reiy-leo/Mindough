import { describe, expect, it } from 'vitest';
import { BUILTIN_TYPE_IDS } from '@mindough/core';
import { parseDeepLink, parseHashLink, parseLinkDate } from './deeplink';
import { href, parseHash } from './router';

const now = new Date(2026, 9, 16, 12);

describe('深链接 mindough://', () => {
  it('task / view', () => {
    expect(parseDeepLink('mindough://task/abc-123', now)).toEqual({ kind: 'task', id: 'abc-123' });
    expect(parseDeepLink('mindough://view/inbox', now)).toEqual({ kind: 'view', route: { page: 'backlog' } });
    expect(parseDeepLink('mindough://view/timeline', now)).toEqual({ kind: 'view', route: { page: 'agenda' } });
    expect(parseDeepLink('mindough://view/nope', now)?.kind).toBe('invalid');
    // 界面上「组」改叫「项目」（2026-10-25）：view/projects 是别名，view/groups 照旧
    expect(parseDeepLink('mindough://view/projects', now)).toEqual({ kind: 'view', route: { page: 'groups' } });
    expect(parseDeepLink('mindough://view/groups', now)).toEqual({ kind: 'view', route: { page: 'groups' } });
    // 关系图页删掉了：旧链接打开我的一天，不算写错
    expect(parseDeepLink('mindough://view/graph', now)).toEqual({ kind: 'view', route: { page: 'myday' } });
    expect(parseHash('#/graph')).toEqual({ page: 'myday' });
    expect(parseHash('#/projects')).toEqual({ page: 'groups' });
    expect(parseHash('#/projects/g1')).toEqual({ page: 'group', id: 'g1' });
    expect(href({ page: 'group', id: 'g1' })).toBe('#/groups/g1');
    expect(parseDeepLink('mindough://task', now)?.kind).toBe('invalid');
  });
  it('new：中文、日期、我的一天、类型', () => {
    expect(parseDeepLink(`mindough://new?text=${encodeURIComponent('买牙膏')}&date=today&myday=1&type=movie`, now)).toEqual({
      kind: 'new', text: '买牙膏', date: '2026-10-16', myDay: true, typeId: BUILTIN_TYPE_IDS.movie, groupId: null,
    });
    expect(parseDeepLink('mindough://new', now)).toMatchObject({ kind: 'new', text: '', date: null, myDay: false, typeId: null });
  });
  it('checkin 默认 +1，乱写的数量当 1', () => {
    expect(parseDeepLink('mindough://checkin/t1?amount=3', now)).toEqual({ kind: 'checkin', id: 't1', amount: 3 });
    expect(parseDeepLink('mindough://checkin/t1?amount=-2', now)).toEqual({ kind: 'checkin', id: 't1', amount: 1 });
  });
  it('auth 不归这里；还没做的 host 是 invalid；别的协议不管', () => {
    expect(parseDeepLink('mindough://auth?code=x', now)).toBeNull();
    expect(parseDeepLink('mindough://timer/t1?action=start', now)?.kind).toBe('invalid');
    expect(parseDeepLink('https://mindough.rei8t.dev/', now)).toBeNull();
  });
  it('日期', () => {
    expect(parseLinkDate('tomorrow', now)).toBe('2026-10-17');
    expect(parseLinkDate('2026-10-20', now)).toBe('2026-10-20');
    expect(parseLinkDate('next week', now)).toBeNull();
  });
  it('web hash', () => {
    expect(parseHashLink('#/task/abc', now)).toEqual({ kind: 'task', id: 'abc' });
    expect(parseHashLink('#/new?text=hi', now)).toMatchObject({ kind: 'new', text: 'hi' });
    expect(parseHashLink('#/checkin-now/t1', now)).toEqual({ kind: 'checkin', id: 't1', amount: 1 });
    expect(parseHashLink('#/checkin', now)).toBeNull();
    expect(parseHashLink('#/myday', now)).toBeNull();
  });
});

describe('日记的深链接与路由（Rei 2026-10-17）', () => {
  it('mindough://journal/today、/2026-10-17、乱写的原样带着；view/journal', () => {
    expect(parseDeepLink('mindough://journal/today', now)).toEqual({ kind: 'journal', date: 'today' });
    expect(parseDeepLink('mindough://journal', now)).toEqual({ kind: 'journal', date: 'today' });
    expect(parseDeepLink('mindough://journal/2026-10-17', now)).toEqual({ kind: 'journal', date: '2026-10-17' });
    expect(parseDeepLink('mindough://journal/TODAY', now)).toEqual({ kind: 'journal', date: 'today' });
    expect(parseDeepLink('mindough://journal/2026-02-30', now)).toEqual({ kind: 'journal', date: '2026-02-30' });
    expect(parseDeepLink('mindough://view/journal', now)).toEqual({ kind: 'view', route: { page: 'journal' } });
  });
  it('#/journal、#/journal/today、#/journal/2026-10-17 是普通页面（不走深链接队列）', () => {
    expect(parseHashLink('#/journal', now)).toBeNull();
    expect(parseHash('#/journal')).toEqual({ page: 'journal' });
    expect(parseHash('#/journal/today')).toEqual({ page: 'journal' });
    expect(parseHash('#/journal/2026-10-17')).toEqual({ page: 'journal', date: '2026-10-17' });
    expect(href({ page: 'journal', date: '2026-10-17' })).toBe('#/journal/2026-10-17');
    expect(href({ page: 'journal' })).toBe('#/journal');
  });
});

describe('倒数日单独一页（Rei 2026-10-26）', () => {
  it('view/countdown、#/countdown；打卡页照旧', () => {
    expect(parseDeepLink('mindough://view/countdown', now)).toEqual({ kind: 'view', route: { page: 'countdown' } });
    expect(parseDeepLink('mindough://view/countdowns', now)).toEqual({ kind: 'view', route: { page: 'countdown' } });
    expect(parseDeepLink('mindough://view/checkin', now)).toEqual({ kind: 'view', route: { page: 'checkin' } });
    expect(parseHash('#/countdown')).toEqual({ page: 'countdown' });
    expect(parseHash('#/countdown?task=t1')).toEqual({ page: 'countdown' });
    expect(href({ page: 'countdown' })).toBe('#/countdown');
    expect(parseHash('#/checkin')).toEqual({ page: 'checkin' });
    expect(parseHashLink('#/countdown', now)).toBeNull();
  });
  it('旧的打卡页倒数日锚点打开倒数日页', () => {
    expect(parseHash('#/checkin#countdown')).toEqual({ page: 'countdown' });
    expect(parseHash('#/checkin/countdown')).toEqual({ page: 'countdown' });
    expect(parseHash('#/checkin#other')).toEqual({ page: 'checkin' });
  });
});

describe('设置分成五项（Rei 2026-10-26）', () => {
  it('#/settings/<项> 能深链到某一项，旧的 #/settings 照旧能用，认不得的项当作 #/settings', () => {
    expect(parseHash('#/settings')).toEqual({ page: 'settings' });
    expect(parseHash('#/settings/appearance')).toEqual({ page: 'settings', section: 'appearance' });
    expect(parseHash('#/settings/tasks')).toEqual({ page: 'settings', section: 'tasks' });
    expect(parseHash('#/settings/nope')).toEqual({ page: 'settings' });
    expect(href({ page: 'settings', section: 'data' })).toBe('#/settings/data');
    expect(href({ page: 'settings' })).toBe('#/settings');
  });
  it('mindough://view/settings 和 view/settings/<项>', () => {
    expect(parseDeepLink('mindough://view/settings', now)).toEqual({ kind: 'view', route: { page: 'settings' } });
    expect(parseDeepLink('mindough://view/settings/reminders', now)).toEqual({ kind: 'view', route: { page: 'settings', section: 'reminders' } });
    expect(parseDeepLink('mindough://view/settings/xyz', now)).toEqual({ kind: 'view', route: { page: 'settings' } });
  });
});

/**
 * 演示数据：相对“今天”生成，含组、依赖链、人物、各类型任务、打卡历史（确定性伪随机）。
 */
import { addDays, toDateKey } from '../dates';
import { formatRecurrence, isDueOn, parseRecurrence, periodKeyFor } from '../recurrence';
import type { Store } from '../store';
import type { CheckInKind, FieldValue, Task } from '../types';
import { BUILTIN_TYPE_IDS as T } from './builtin-types';
// 演示数据按生成时的界面语言写（tr）；选项值（电影 / 剧集 / 晚餐 / PC（Steam））是数据，保持中文原样，显示时再翻译。
import { BUILTIN_CHECKIN_CATEGORY_IDS } from './builtin-checkin-categories';

import { tr } from '../i18n';

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** 生成一张渐变 SVG 图（海报 / 横幅 / 头像），作 data URL。 */
export function svgArt(text: string, c1: string, c2: string, w: number, h: number, round = false): string {
  const fs = Math.round(Math.min(w, h) * (round ? 0.42 : 0.16));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>${
    round ? `<circle cx="${w / 2}" cy="${h / 2}" r="${w / 2}" fill="url(#g)"/>` : `<rect width="${w}" height="${h}" fill="url(#g)"/>`
  }<text x="50%" y="${round ? '50%' : '86%'}" dominant-baseline="${round ? 'central' : 'auto'}" text-anchor="middle" font-family="-apple-system,'PingFang SC','Microsoft YaHei',sans-serif" font-size="${fs}" font-weight="700" fill="rgba(255,255,255,.92)">${esc(text)}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function seedDemo(store: Store): void {
  const now = store.now();
  const today = toDateKey(now);
  const d = (n: number) => addDays(today, n);
  const iso = (dayOffset: number, hour = 9, min = 0) => {
    const x = new Date(now);
    x.setDate(x.getDate() + dayOffset);
    x.setHours(hour, min, 0, 0);
    return x.toISOString();
  };
  const rand = mulberry32(20261015);

  store.batch(() => {
    const asset = (url: string, w: number, h: number) =>
      store.insert('asset', { sha256: '', mime: 'image/svg+xml', width: w, height: h, r2_key: null, url }).id;

    // 分类
    const life = store.insert('category', { name: tr('生活'), color: '#34c759' });
    const work = store.insert('category', { name: tr('工作'), color: '#0a84ff' });
    const fun = store.insert('category', { name: tr('爱好'), color: '#af52de' });

    // 人物
    const mom = store.insert('person', {
      name: tr('妈妈'),
      avatar_asset_id: asset(svgArt(tr('妈'), '#ff9a8b', '#ff6a88', 96, 96, true), 96, 96),
      relation: tr('家人'),
      birthday: '1966-03-08',
      note_md: tr('喜欢花，周末下午方便打电话。'),
    });
    const lin = store.insert('person', {
      name: tr('小林'),
      avatar_asset_id: asset(svgArt(tr('林'), '#6dd5ed', '#2193b0', 96, 96, true), 96, 96),
      relation: tr('朋友'),
      birthday: null,
      note_md: tr('一起跑步的朋友。'),
    });
    const wang = store.insert('person', {
      name: tr('王老师'),
      avatar_asset_id: asset(svgArt(tr('王'), '#b993d6', '#8ca6db', 96, 96, true), 96, 96),
      relation: tr('同事'),
      birthday: null,
      note_md: '',
    });

    // 组
    const move = store.insert('group', {
      name: tr('搬家'),
      icon: '🏠',
      start_at: d(-6),
      end_at: d(20),
      category_id: life.id,
      default_type_id: null,
    });
    const dev = store.insert('group', {
      name: tr('Mindough 开发'),
      icon: '🧩',
      start_at: d(-10),
      end_at: d(45),
      category_id: work.id,
      default_type_id: null,
    });
    const watch = store.insert('group', {
      name: tr('周末看片'),
      icon: '🎬',
      start_at: null,
      end_at: null,
      category_id: fun.id,
      default_type_id: T.movie,
    });

    const task = (body: string, extra: Partial<Task> = {}) =>
      store.createTask({ body_md: body, created_at: iso(-40), ...extra });
    const done = (body: string, daysAgo: number, extra: Partial<Task> = {}) =>
      task(body, { status: '完成', done_at: iso(-daysAgo, 20), ...extra });
    // 关闭：不做了也算结束（解锁后续），但不算成就
    const closed = (body: string, daysAgo: number, extra: Partial<Task> = {}) =>
      task(body, { status: '关闭', done_at: iso(-daysAgo, 18), ...extra });

    // 搬家：依赖链
    const m1 = done(tr('整理要带走的东西，列一张清单\n\n- [x] 书\n- [x] 衣服\n- [x] 厨具'), 3, { group_id: move.id });
    const m2 = done(tr('联系搬家公司，比较三家报价'), 0, { group_id: move.id, done_at: new Date(now.getTime() - 2 * 3600_000).toISOString() });
    const m3 = task(tr('确定搬家日期，和房东约交接时间'), { group_id: move.id, scheduled_date: d(1) });
    const m4 = task(tr('打包书和衣服（纸箱 × 12）'), { group_id: move.id, scheduled_date: d(6) });
    const m5 = task(tr('新家网络开通，预约师傅上门'), { group_id: move.id });
    const m6 = task(tr('退押金、交钥匙'), { group_id: move.id, scheduled_date: d(14) });
    const m0 = closed(tr('找朋友借面包车自己搬（改请搬家公司了）'), 1, { group_id: move.id });
    store.addDependency(m0.id, m3.id);
    store.addDependency(m1.id, m4.id);
    store.addDependency(m2.id, m3.id);
    store.addDependency(m3.id, m4.id);
    store.addDependency(m3.id, m5.id);
    store.addDependency(m4.id, m6.id);

    // 开发：依赖链 + 项目类型
    const p0 = task(tr('## 目标\n做一个靠依赖串任务的多端 app\n\n## 下一步\n- [x] 数据模型\n- [ ] 依赖图'), {
      group_id: dev.id,
      type_id: T.project,
      type_data: { name: 'Mindough', link: 'https://github.com/reiy-leo/Mindough' },
      status: '进行中',
    });
    const p1 = done(tr('写 M0 的数据模型和单测'), 2, { group_id: dev.id });
    const p2 = task(tr('依赖图：拖线连依赖，成环时拒绝'), { group_id: dev.id, status: '进行中', scheduled_date: d(0) });
    const p3 = task(tr('打卡页：GitHub 式热力图'), { group_id: dev.id, scheduled_date: d(2) });
    const p4 = task(tr('接入 Turso 同步（M2）'), { group_id: dev.id });
    store.addDependency(p1.id, p2.id);
    store.addDependency(p1.id, p3.id);
    store.addDependency(p2.id, p4.id);
    store.addDependency(p3.id, p4.id);
    store.linkPerson(p2.id, wang.id);

    // 看片 / 书 / 游戏
    task(tr('## 想看理由\n大银幕看沙漠和沙虫\n\n## 观后感\n'), {
      group_id: watch.id,
      type_id: T.movie,
      type_data: { title: tr('沙丘 2'), year: 2024, kind: '电影', imdb: 'tt15239678', douban: '35575567' },
      scheduled_date: d(3),
    });
    task(tr('## 想看理由\n听说上海话版本很好\n'), {
      group_id: watch.id,
      type_id: T.movie,
      type_data: { title: tr('繁花'), year: 2023, kind: '剧集', episode: { season: 1, episode: 12 } },
      status: '进行中',
    });
    task(tr('## 摘录\n> 给岁月以文明，而不是给文明以岁月。\n'), {
      type_id: T.book,
      type_data: { title: tr('三体'), author: tr('刘慈欣'), total_pages: 302, pages: 230 },
      status: '进行中',
    });
    task(tr('## 目标\n通关主线，收集 120 个神庙'), {
      type_id: T.game,
      type_data: { name: tr('塞尔达传说 王国之泪'), platform: ['Nintendo Switch'], progress: 60 },
    });

    // 琐事（时间线）
    const c1 = task(tr('买牙膏和洗衣液'), { scheduled_date: d(0) });
    const c2 = task(tr('交水电费'), { scheduled_date: d(-1) });
    done(tr('牙医复诊'), 3, { scheduled_date: d(-3) });
    done(tr('取快递（门口丰巢）'), 1, { scheduled_date: d(-1) });
    const broadband = closed(tr('退掉旧宽带（房东说网络随房子留下）'), 1, { scheduled_date: d(-1) });
    const c3 = closed(tr('去超市买菜（改成网上下单了）'), 0, { scheduled_date: d(0), done_at: new Date(now.getTime() - 3600_000).toISOString() });
    const call = task(tr('## 要聊什么\n- 搬家的事\n- 国庆的照片\n'), { scheduled_date: d(2) });
    store.linkPerson(call.id, mom.id);
    task(tr('写周报'), { scheduled_date: d(1) });
    task(tr('预约年度体检'), { scheduled_date: d(5) });
    task(tr('## 想吃什么\n炸酱面 + 卤煮'), {
      type_id: T.restaurant,
      type_data: { name: tr('胡同里的炸酱面'), address: tr('东城区某胡同 12 号') },
      scheduled_date: d(4),
    });
    const trip = task(tr('## 行程\n- 岚山\n- 东福寺\n\n## 待办\n- [ ] 订酒店\n- [ ] 换日元'), {
      type_id: T.travel,
      type_data: { destination: tr('京都'), depart: d(24), return: d(29) },
      completion_mode: 'countdown',
      target_date: d(24),
    });
    store.linkPerson(trip.id, lin.id);

    // 相关任务：只是有关系，没有先后（不解锁、关系图上是虚线）
    store.linkTasks(m5.id, broadband.id);
    store.linkTasks(p0.id, p2.id);
    store.linkTasks(c1.id, c3.id);
    task(tr('年底述职'), { completion_mode: 'countdown', target_date: d(62) });

    // 资料库：每个库放几条（没有图片，界面用按名字生成的渐变占位）；同一部片可以有好几件任务
    const lib = (typeId: string, name: string, fields: Record<string, FieldValue> = {}) => store.createLibraryItem(typeId, { name, fields });
    const interstellar = lib(T.movie, tr('星际穿越'), {
      year: 2014,
      kind: '电影',
      imdb: 'tt0816692',
      douban: '1889243',
      links: [{ url: 'https://www.rottentomatoes.com/m/interstellar_2014' }, { url: 'https://www.themoviedb.org/movie/157336' }],
    });
    done('', 400, { type_id: T.movie, library_item_id: interstellar.id, body_md: tr('第一次在 IMAX 看') });
    task(tr('## 想看理由\n过年和家人一起重看一遍\n'), { type_id: T.movie, library_item_id: interstellar.id, scheduled_date: d(9) });
    lib(T.movie, tr('漫长的季节'), { year: 2023, kind: '剧集', douban: '35588177' });
    lib(T.movie, tr('请回答 1988'), { year: 2015, kind: '剧集' });
    lib(T.movie, tr('奥本海默'), { year: 2023, kind: '电影' });
    lib(T.movie, tr('千与千寻'), { year: 2001, kind: '电影' });
    lib(T.book, tr('置身事内'), { author: tr('兰小欢'), total_pages: 320 });
    lib(T.book, tr('长安的荔枝'), { author: tr('马伯庸'), total_pages: 220 });
    lib(T.book, tr('人类简史'), { author: tr('尤瓦尔·赫拉利'), total_pages: 440 });
    lib(T.book, tr('原则'), { author: tr('瑞·达利欧') });
    lib(T.game, tr('星露谷物语'), { platform: ['PC（Steam）', 'Nintendo Switch', 'iOS'], links: [{ url: 'https://store.steampowered.com/app/413150/Stardew_Valley/' }] });
    lib(T.game, tr('哈迪斯 2'), { platform: ['PC（Steam）', 'Switch 2'] });
    lib(T.game, tr('双人成行'), { platform: ['PlayStation 5', 'Xbox Series X|S', 'PC（Steam）'] });
    lib(T.game, tr('集合啦！动物森友会'), { platform: ['Nintendo Switch'] });
    lib(T.project, tr('个人主页'), { link: 'https://rei8t.dev' });
    lib(T.project, tr('家庭相册备份'));
    const guitar = lib(T.course, tr('吉他入门'), { platform: tr('B 站') });
    task(tr('练会 C、G、Am、F 四个和弦'), { type_id: T.course, library_item_id: guitar.id, type_data: { lessons: 4 }, status: '进行中' });
    lib(T.course, 'CS50', { platform: 'edX', link: 'https://cs50.harvard.edu' });
    lib(T.course, tr('日语 N3 冲刺'), { platform: tr('沪江') });
    lib(T.travel, tr('大理'));
    lib(T.travel, tr('成都'));
    lib(T.travel, tr('冰岛'));
    lib(T.shopping, tr('降噪耳机'), { price: { amount: 1299, currency: 'CNY' } });
    lib(T.shopping, tr('空气炸锅'), { price: { amount: 59.9, currency: 'GBP' } });
    lib(T.shopping, tr('跑鞋'), { price: { amount: 189, currency: 'SGD' } });
    lib(T.restaurant, tr('巷口的老火锅'), { address: tr('朝阳区某路 8 号') });
    lib(T.restaurant, tr('楼下的咖啡馆'));
    const tomato = lib(T.meal, tr('番茄炒蛋'), { ingredients: [tr('番茄 2 个'), tr('鸡蛋 3 个'), tr('葱'), tr('糖')] });
    task(tr('## 做法\n先炒蛋盛出，再炒番茄出汁\n'), { type_id: T.meal, library_item_id: tomato.id, type_data: { meal: '晚餐' }, scheduled_date: d(1) });
    lib(T.meal, tr('红烧肉'), { ingredients: [tr('五花肉'), tr('冰糖'), tr('生抽'), tr('老抽')] });
    lib(T.meal, tr('牛油果吐司'));

    // 打卡任务（重复）+ 历史
    const daily = formatRecurrence({ kind: 'daily' });
    const C = BUILTIN_CHECKIN_CATEGORY_IDS;
    const water = task(tr('每天喝 8 杯水'), { completion_mode: 'count', target_value: 8, unit: tr('杯'), recurrence: daily, checkin_category_id: C.diet, created_at: iso(-200) });
    const fast = task(tr('16 小时轻断食'), { completion_mode: 'timer', target_value: 16 * 3600_000, recurrence: daily, checkin_category_id: C.diet, created_at: iso(-120) });
    const read = task(tr('读书 30 页'), { completion_mode: 'count', target_value: 30, unit: tr('页'), recurrence: daily, checkin_category_id: C.reading, created_at: iso(-260) });
    const run = task(tr('跑步 5 公里'), {
      completion_mode: 'count',
      target_value: 5,
      unit: tr('公里'),
      recurrence: formatRecurrence({ kind: 'weekly', weekdays: [1, 3, 5] }),
      checkin_category_id: C.sport,
      created_at: iso(-300),
    });
    task(tr('睡前护肤：洁面 + 保湿'), { completion_mode: 'once', recurrence: daily, checkin_category_id: C.skincare, created_at: iso(0, 0) });
    task(tr('周六大扫除'), { completion_mode: 'once', recurrence: formatRecurrence({ kind: 'weekly', weekdays: [6] }), checkin_category_id: C.clean, created_at: iso(0, 0) });
    store.linkPerson(run.id, lin.id);
    const meditate = task(tr('冥想 10 分钟'), { completion_mode: 'once', recurrence: daily, checkin_category_id: C.meditation, created_at: iso(-90) });
    task(tr('对账、记一下上月开销'), { completion_mode: 'once', recurrence: formatRecurrence({ kind: 'monthly', day: 1 }), checkin_category_id: C.finance, created_at: iso(-330) });

    const ev = (t: Task, kind: CheckInKind, amount: number, at: string, date: string) =>
      store.insert('check_in', { task_id: t.id, period_key: periodKeyFor(parseRecurrence(t.recurrence), date), kind, amount, at });

    const history = (t: Task, days: number, rate: number, fill: (date: string, off: number) => void) => {
      const r = parseRecurrence(t.recurrence)!;
      for (let off = -days; off < 0; off++) {
        const date = d(off);
        if (!isDueOn(r, date)) continue;
        // 越近越勤快，并留出几段断档
        const streakBoost = off > -12 ? 0.25 : 0;
        if (rand() < rate + streakBoost) fill(date, off);
      }
    };
    history(water, 200, 0.62, (date, off) => {
      const cups = rand() < 0.7 ? 8 : 2 + Math.floor(rand() * 6);
      ev(water, 'add', cups, iso(off, 21), date);
    });
    history(read, 260, 0.45, (date, off) => {
      const pages = rand() < 0.6 ? 30 + Math.floor(rand() * 20) : 5 + Math.floor(rand() * 20);
      ev(read, 'add', pages, iso(off, 22), date);
    });
    history(run, 300, 0.7, (date, off) => {
      ev(run, 'add', rand() < 0.75 ? 5 : 3, iso(off, 7), date);
    });
    history(meditate, 90, 0.55, (date, off) => ev(meditate, 'add', 1, iso(off, 8), date));
    history(fast, 120, 0.5, (date, off) => {
      const hours = rand() < 0.7 ? 16 : 10 + Math.floor(rand() * 5);
      ev(fast, 'start', 0, iso(off - 1, 20), date);
      const end = new Date(Date.parse(iso(off - 1, 20)) + hours * 3600_000).toISOString();
      ev(fast, 'stop', 0, end, date);
    });
    // 今天：喝水 3 杯；断食从 8 小时前开始在计时
    ev(water, 'add', 3, iso(0, 10), today);
    ev(fast, 'start', 0, new Date(now.getTime() - 8 * 3600_000).toISOString(), today);

    // 我的一天
    const yesterday = d(-1);
    for (const t of [c2, m2, read]) store.addToMyDay(t.id, yesterday);
    for (const t of [m3, p2, water, c1, c3]) store.addToMyDay(t.id, today);
    void call;
  });
}

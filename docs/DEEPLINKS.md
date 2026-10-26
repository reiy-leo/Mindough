# Mindough 深链接 mindough:// 方案（Rei 2026-10-16 已审）

现状：scheme 是 `mindough://`，目前只注册、处理了 `auth`（登录后跳回 app）。Android 的 intent-filter 要给每个 host 单独注册；iOS 和桌面只认 scheme。

## 一、打开某个东西（只跳转，不改数据）

| host | 写法 | 示例 | 用途 |
|---|---|---|---|
| task | mindough://task/{任务id} | mindough://task/0199f2a4-7c1e-7000-8000-1a2b3c4d5e6f | 打开某件任务的详情（通知、小组件、别的 app 里的链接）；2026-10-23 起，桌面上在当前页面的右列打开，手机上整页推入 |
| view | mindough://view/{页面} | mindough://view/myday、mindough://view/inbox | 打开某个页面。页面名：myday 我的一天、inbox 待安排、timeline 列表、groups 项目、available 可做、checkin 打卡、countdown 倒数日（2026-10-26 起单独一页）、journal 日记、library 资料库、people 人物、settings 设置。设置可以带一项直接打开（Rei 2026-10-26）：`view/settings/account`、`appearance`、`data`、`reminders`、`tasks`，认不得的项当作 `view/settings`；桌面 app 里打开的是设置窗口 |
| group | mindough://group/{项目id} | mindough://group/0199f2a4-… | 打开某个组 |
| library | mindough://library/{类型}/{资料id} | mindough://library/movie/0199f2a4-…；mindough://library/book | 打开某条资料；不带 id 就是这个类型的库。类型用英文短名：movie、book、game、project、course、travel、shopping、restaurant、meal |
| person | mindough://person/{人物id} | mindough://person/0199f2a4-… | 打开某个人 |
| search | mindough://search?q={关键词} | mindough://search?q=沙丘 | 打开搜索并填好关键词 |
| journal | mindough://journal/{today 或 YYYY-MM-DD} | mindough://journal/today、mindough://journal/2026-10-17 | 打开那天的日记（Rei 2026-10-17）。today = 按「一天从几点开始」算的今天；不写日期也是今天。日期写错了，打开今天并提示「没有这一天」；是将来的日子，打开那天并提示「这天还没到，还不能写」 |

## 二、做一件事（会改数据，做完都有「撤销」提示）

| host | 写法 | 示例 | 用途 |
|---|---|---|---|
| new | mindough://new?text=…&date=…&myday=1&type=…&group=… | mindough://new?text=买牙膏&date=today；mindough://new?text=沙丘2&type=movie | 快速新建（快捷指令、Raycast、Alfred）。参数都能省：date 可以写 today / tomorrow / 2026-10-20，不带 date 就进待安排；myday=1 表示加进我的一天 |
| checkin | mindough://checkin/{任务id}?amount=1 | mindough://checkin/0199f2a4-…?amount=2 | 打卡 / 计数 +n（小组件按钮、快捷指令） |
| timer | mindough://timer/{任务id}?action=start | action=start / pause / stop | 开始、暂停、结束计时 |
| done | mindough://done/{任务id} | mindough://done/0199f2a4-… | 标为完成 |

不提供删除、关闭、改设置。外部链接只做「加东西 / 打卡」这类能撤销的事。

## 三、内部用（不对外宣传）

| host | 写法 | 用途 |
|---|---|---|
| auth | mindough://auth?code=…（失败 ?login_error=…） | 原生端 Google 登录后跳回 app（已有） |

## 四、规则

- id 都用任务 / 资料本来的 uuid；找不到就打开 app，提示「找不到这件任务」，不报错。
- app 没开时点链接：先启动 app，等数据库打开再执行。
- Web 端用同样的路径，写成 https://mindough.rei8t.dev/#/task/{id} 这样的 hash 路由。以后要做 Universal Links / App Links（点 https 链接直接打开 app），到时再单独审。
- 中文参数要 URL 编码（快捷指令会自动做）。

关系图页删掉以后（Rei 2026-10-23），旧链接 `mindough://view/graph` 打开默认页「我的一天」，不提示写错；Web 的旧地址 `#/graph` 也打开我的一天。

## 五、Rei 的决定（2026-10-16）

1. 页面都用 view/{页面}。
2. 「做一件事」都不弹确认框，直接做，提示里能撤销。
3. 第一批做 task、view、new、checkin（已做完：手机端注册了 auth、task、view、new、checkin 五个 host）；group、library、person、search、timer、done 跟 M4 一起做。

日记（2026-10-17 做完）：手机端注册了 journal host；Web 对应 #/journal、#/journal/today、#/journal/2026-10-17（普通页面路由）。`journal/today?append=…`（把一段文字接在今天日记末尾）留到 J2。

实现备注：checkin 只给「打一下 / 计数」的任务直接打卡；计时、倒数日的任务改成打开详情。Web 对应写法：#/task/{id}、#/new?text=…、#/checkin-now/{id}（打卡页 #/checkin 已占用）；倒数日页是 #/countdown，旧写法 #/checkin#countdown、#/checkin/countdown 也打开倒数日页。打开 #/task/{id} 后，地址会换成 #/myday?task={id}。三列布局里选中的任务一直写在当前页面 hash 的 ?task= 上（如 #/agenda?task=…），刷新后还选着，这个地址也能直接分享、收藏。

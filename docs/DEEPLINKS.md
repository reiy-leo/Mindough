# Mindough 深链接 mindough:// 方案（Rei 2026-10-16 已审）

现状：scheme 是 `mindough://`，只注册并处理了 `auth`（登录回跳）。手机端（Android intent-filter）每个 host 要单独注册，iOS / 桌面只认 scheme。

## 一、打开某个东西（只跳转，不改数据）

| host | 写法 | 示例 | 用途 |
|---|---|---|---|
| task | mindough://task/{任务id} | mindough://task/0199f2a4-7c1e-7000-8000-1a2b3c4d5e6f | 打开某件任务的详情（通知、小组件、别的 app 里的链接） |
| view | mindough://view/{页面} | mindough://view/myday、mindough://view/inbox | 打开某个页面。页面名：myday 我的一天、inbox 待安排、timeline 列表、groups 组、graph 关系图、available 可做、checkin 打卡、library 资料库、people 人物、settings 设置 |
| group | mindough://group/{组id} | mindough://group/0199f2a4-… | 打开某个组 |
| library | mindough://library/{类型}/{资料id} | mindough://library/movie/0199f2a4-…；mindough://library/book | 打开某条资料；不带 id 就是这个类型的库。类型用英文短名：movie、book、game、project、course、travel、shopping、restaurant、meal |
| person | mindough://person/{人物id} | mindough://person/0199f2a4-… | 打开某个人 |
| search | mindough://search?q={关键词} | mindough://search?q=沙丘 | 打开搜索并填好关键词 |

## 二、做一件事（会改数据，做完都有「撤销」提示）

| host | 写法 | 示例 | 用途 |
|---|---|---|---|
| new | mindough://new?text=…&date=…&myday=1&type=…&group=… | mindough://new?text=买牙膏&date=today；mindough://new?text=沙丘2&type=movie | 快速新建（快捷指令、Raycast、Alfred）。参数都可省：date 支持 today / tomorrow / 2026-10-20；不带 date 进待安排；myday=1 加进我的一天 |
| checkin | mindough://checkin/{任务id}?amount=1 | mindough://checkin/0199f2a4-…?amount=2 | 打卡 / 计数 +n（小组件按钮、快捷指令） |
| timer | mindough://timer/{任务id}?action=start | action=start / pause / stop | 开始、暂停、结束计时 |
| done | mindough://done/{任务id} | mindough://done/0199f2a4-… | 标为完成 |

不提供：删除、关闭、改设置。外部链接最多做「加东西 / 打卡」这一类能撤销的事。

## 三、内部用（不对外宣传）

| host | 写法 | 用途 |
|---|---|---|
| auth | mindough://auth?code=…（失败 ?login_error=…） | 原生端 Google 登录回跳（已有） |

## 四、规则

- id 全用任务 / 资料原本的 uuid；找不到时打开 app 并提示「找不到这件任务」，不报错。
- app 没开时点链接：先启动，数据库打开后再执行。
- Web 端同样的路径走 https://mindough.rei8t.dev/#/task/{id} 这种 hash 路由；以后要做 Universal Links / App Links（https 链接直接拉起 app），再单独审核。
- 中文参数要 URL 编码（快捷指令会自动做）。

## 五、Rei 的决定（2026-10-16）

1. 页面统一用 view/{页面}。
2. 「做一件事」全部不弹确认框，直接做 + 提示里可以撤销。
3. 第一批做 task、view、new、checkin（已做完：手机端注册了 auth、task、view、new、checkin 五个 host）；group、library、person、search、timer、done 跟 M4 一起做。

实现备注：checkin 只对「打一下 / 计数」的任务直接打卡；计时、倒数日的任务改为打开详情。Web 对应写法：#/task/{id}、#/new?text=…、#/checkin-now/{id}（打卡页 #/checkin 已占用）。

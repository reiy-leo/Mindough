// Mindough 主屏小组件（Android AppWidget）：读 app 写出的 widget-snapshot.json，显示 我的一天 + 今天要打卡。
// 还没接进构建：gen/android 是 CI 里 `tauri android init` 生成的。接入步骤见 docs/WIDGETS.md。
package dev.rei8t.mindough

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import org.json.JSONObject
import java.io.File

class MindoughWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val snap = readSnapshot(context)
        for (id in ids) {
            val views = RemoteViews(context.packageName, R.layout.mindough_widget)
            views.setTextViewText(R.id.widget_title, "我的一天")
            views.setTextViewText(R.id.widget_body, snap ?: "打开 Mindough 看看今天")
            // 点小组件打开 app（以后可以带 mindough://task/<id> 直接打开某件）
            val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
            if (open != null) {
                val pi = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                views.setOnClickPendingIntent(R.id.widget_root, pi)
            }
            manager.updateAppWidget(id, views)
        }
    }

    /** 快照 → 几行字：未完成的在前，完成的打勾。读不到返回 null。 */
    private fun readSnapshot(context: Context): String? {
        // Tauri 的 app_data_dir 在 Android 上是 app 的数据目录（真机上确认一下路径）
        val f = listOf(File(context.dataDir, "widget-snapshot.json"), File(context.filesDir, "widget-snapshot.json")).firstOrNull { it.exists() } ?: return null
        return try {
            val o = JSONObject(f.readText())
            val lines = mutableListOf<String>()
            fun add(key: String) {
                val arr = o.optJSONArray(key) ?: return
                for (i in 0 until arr.length()) {
                    val t = arr.getJSONObject(i)
                    lines.add((if (t.optBoolean("done")) "✓ " else "○ ") + t.optString("title"))
                }
            }
            add("myDay")
            val before = lines.size
            add("checkIns")
            if (lines.size > before && before > 0) lines.add(before, "— 今天要打卡 —")
            if (lines.isEmpty()) "今天还没有安排。" else lines.take(8).joinToString("\n")
        } catch (e: Exception) {
            null
        }
    }

    companion object {
        /** app 写完快照后可以调它刷新（以后从 Rust 侧 JNI 调）；现在靠系统按 updatePeriodMillis 刷新。 */
        fun refresh(context: Context) {
            val m = AppWidgetManager.getInstance(context)
            val ids = m.getAppWidgetIds(android.content.ComponentName(context, MindoughWidget::class.java))
            context.sendBroadcast(Intent(context, MindoughWidget::class.java).setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE).putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids))
        }
    }
}

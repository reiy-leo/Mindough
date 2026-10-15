// Mindough iOS 小组件（WidgetKit）脚手架：还没接进 Xcode 工程（gen/apple 是 `tauri ios init` 生成的）。
// 需要 App Group（如 group.dev.rei8t.mindough）：app 把 widget-snapshot.json 写进共享容器，小组件从那里读。步骤见 docs/WIDGETS.md。
import SwiftUI
import WidgetKit

struct Snapshot: Decodable {
    struct Item: Decodable { let id: String; let title: String; let done: Bool }
    let date: String
    let myDay: [Item]
    let checkIns: [Item]
}

struct Entry: TimelineEntry { let date: Date; let snap: Snapshot? }

struct Provider: TimelineProvider {
    static let group = "group.dev.rei8t.mindough"
    func load() -> Snapshot? {
        guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.group),
              let data = try? Data(contentsOf: dir.appendingPathComponent("widget-snapshot.json")) else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: data)
    }
    func placeholder(in context: Context) -> Entry { Entry(date: .now, snap: nil) }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) { completion(Entry(date: .now, snap: load())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        completion(Timeline(entries: [Entry(date: .now, snap: load())], policy: .after(.now.addingTimeInterval(30 * 60))))
    }
}

struct MindoughWidgetView: View {
    let entry: Entry
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("我的一天", systemImage: "sun.max").font(.headline)
            if let s = entry.snap, !(s.myDay.isEmpty && s.checkIns.isEmpty) {
                ForEach((s.myDay + s.checkIns).prefix(5), id: \.id) { t in
                    HStack(spacing: 6) {
                        Image(systemName: t.done ? "checkmark.circle.fill" : "circle").foregroundStyle(t.done ? .secondary : .tint)
                        Text(t.title).lineLimit(1).strikethrough(t.done).foregroundStyle(t.done ? .secondary : .primary)
                    }.font(.subheadline)
                }
            } else {
                Text("今天还没有安排。").font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .containerBackground(.background, for: .widget)
    }
}

@main
struct MindoughWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "MindoughWidget", provider: Provider()) { MindoughWidgetView(entry: $0) }
            .configurationDisplayName("Mindough")
            .description("我的一天和今天要打卡的事。")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  autoMonthMarker,
  buildHeatmap,
  formatDateZh,
  weekdayShort,
  type DateKey,
  type MonthMarker,
} from "@mindough/core";
import { useSettings } from "../lib/settings";
import { fitHeatmap } from "../lib/habit-heatmap";

import { tr } from "../lib/i18n";
/** 左侧星期标签（周一开始，隔行显示）：按当前语言（weekdayShort）。 */
const weekLabels = () => [
  weekdayShort(1),
  "",
  weekdayShort(3),
  "",
  weekdayShort(5),
  "",
  weekdayShort(0),
];

/**
 * GitHub 式热力图。格子严格正方形（固定像素，不随容器拉伸）；每月 1 号做标记。
 * 窄屏只露出最近一段（默认滚到最右），可横向滑动看全年。
 * fit：撑满容器宽度（打卡卡片展开的活动图）。按宽度算放几周、格子多大，正好填满，最近一天在最右；不滚动。
 */
export function Heatmap({
  end,
  weeks = 53,
  ratioFor,
  color,
  mini,
  label,
  describe,
  fit,
  id,
}: {
  end: DateKey;
  weeks?: number;
  ratioFor: (d: DateKey) => number | null;
  color?: string;
  mini?: boolean;
  label: string;
  describe?: (d: DateKey, ratio: number | null) => string;
  /** 撑满容器宽度：周数和格子大小按宽度算（只配 mini 用）。 */
  fit?: boolean;
  id?: string;
}) {
  const { settings, layout } = useSettings();
  const box = useRef<HTMLDivElement>(null);
  const [fitW, setFitW] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!fit || !el) return;
    const measure = () => setFitW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);
  const fitted = fit ? fitHeatmap(fitW, { minCell: layout === "mobile" ? 9 : 10, gap: 2 }) : null;
  const shownWeeks = fitted ? fitted.weeks : weeks;
  const data = useMemo(
    () => buildHeatmap({ end, weeks: shownWeeks, ratioFor }),
    [end, shownWeeks, ratioFor],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) {
      el.scrollLeft = el.scrollWidth;
      setScrolled(el.scrollLeft > 0);
    }
  }, [data, layout]);

  const cellPx = fitted ? fitted.cell : mini ? 10 : layout === "mobile" ? 11 : 14;
  const marker: MonthMarker =
    settings.monthMarker === "auto"
      ? autoMonthMarker(cellPx)
      : settings.monthMarker;
  const style = {
    "--heat-color-local": color ?? "var(--heat-color)",
    "--c": `${cellPx}px`,
  } as CSSProperties;
  const text = (d: DateKey, r: number | null) =>
    describe
      ? describe(d, r)
      : r === null
        ? tr("{date}：无需打卡", { date: formatDateZh(d) })
        : tr("{date}：完成 {pct}%", {
            date: formatDateZh(d),
            pct: Math.round(Math.min(1, r) * 100),
          });

  return (
    <div
      id={id}
      ref={box}
      className={`heatmap${mini ? " heatmap-mini" : ""}${fit ? " heatmap-fit" : ""}`}
      style={style}
    >
      <div
        className={`heatmap-scroll${scrolled && !fit ? " is-scrolled" : ""}`}
        ref={scroller}
        onScroll={(e) => setScrolled(e.currentTarget.scrollLeft > 0)}
      >
        <div className="heatmap-inner">
          {!mini && (
            <div className="heatmap-months-row" aria-hidden>
              {/* 左上角跟着星期一列钉住，滑动时月份从它下面过去，不和星期叠在一起 */}
              <span className="heatmap-corner" />
              <div
                className="heatmap-months"
                style={{ gridTemplateColumns: `repeat(${shownWeeks}, var(--c))` }}
              >
                {data.monthLabels.map((m) => (
                  <span
                    key={`${m.column}-${m.month}`}
                    style={{ gridColumn: `${m.column + 1} / span 3` }}
                  >
                    {m.label}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="heatmap-body">
            {!mini && (
              <div className="heatmap-weekdays" aria-hidden>
                {weekLabels().map((w, i) => (
                  <span key={i}>{w}</span>
                ))}
              </div>
            )}
            <div
              className="heatmap-grid"
              role="grid"
              aria-label={label}
              style={{ gridTemplateColumns: `repeat(${shownWeeks}, var(--c))` }}
            >
              {data.columns.map((col, c) =>
                col.map((cell, r) => (
                  <span
                    key={cell.date}
                    role="gridcell"
                    className={`heat-cell lv-${cell.level}${cell.future ? " is-future" : ""}${cell.ratio === null ? " is-free" : ""}${cell.date === end ? " is-today" : ""}`}
                    style={{ gridColumn: c + 1, gridRow: r + 1 }}
                    title={
                      cell.future ? undefined : text(cell.date, cell.ratio)
                    }
                    aria-label={
                      cell.future ? undefined : text(cell.date, cell.ratio)
                    }
                  >
                    {cell.monthStart !== null &&
                      !cell.future &&
                      marker === "number" && (
                        <span className="heat-month">{cell.monthStart}</span>
                      )}
                    {cell.monthStart !== null &&
                      !cell.future &&
                      marker === "dot" && <span className="heat-dot" />}
                  </span>
                )),
              )}
            </div>
          </div>
        </div>
      </div>
      {!mini && (
        <div className="heatmap-legend" aria-hidden>
          <span>{tr("少")}</span>
          {[0, 1, 2, 3].map((l) => (
            <span key={l} className={`heat-cell lv-${l}`} />
          ))}
          <span>{tr("达标")}</span>
        </div>
      )}
    </div>
  );
}

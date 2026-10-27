/**
 * Steam（游戏）：storesearch 搜商店，appdetails 取详情。中文界面 l=schinese&cc=CN，英文 l=english&cc=US。不需要密钥。
 * 平台映射到游戏类型的多选项：windows → PC（Steam），mac → macOS，linux → Linux / Steam Deck；
 * 有官网的放进「更多链接」。图标用商店的 header 图（460×215，卡片里按方形裁）。
 */
import { LookupError, decodeEntities, upstreamJson, yearOf, type Lang, type LookupResult } from './types';

const LABEL = 'Steam';
const loc = (lang: Lang) => (lang === 'zh' ? { l: 'schinese', cc: 'CN' } : { l: 'english', cc: 'US' });

interface Platforms {
  windows?: boolean;
  mac?: boolean;
  linux?: boolean;
}

/** 选项值是游戏类型里存着的中文（显示时按界面语言翻译）。 */
export function steamPlatforms(p: Platforms | undefined): string[] {
  const out: string[] = [];
  if (p?.windows) out.push('PC（Steam）');
  if (p?.mac) out.push('macOS');
  if (p?.linux) out.push('Linux / Steam Deck');
  return out;
}

interface SearchItem {
  type?: string;
  id?: number;
  name?: string;
  tiny_image?: string;
  platforms?: Platforms;
}

export async function searchSteam(q: string, lang: Lang): Promise<LookupResult[]> {
  const { l, cc } = loc(lang);
  const data = await upstreamJson<{ items?: SearchItem[] }>(LABEL, `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=${l}&cc=${cc}`);
  return (data.items ?? [])
    .filter((x) => x.type === 'app' && x.id && x.name)
    .slice(0, 8)
    .map((x) => {
      const platform = steamPlatforms(x.platforms);
      return {
        source: 'steam' as const,
        sourceId: String(x.id),
        name: decodeEntities(x.name!),
        ...(x.tiny_image ? { thumb: x.tiny_image, image: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${x.id}/header.jpg` } : {}),
        fields: (platform.length ? { platform } : {}) as LookupResult['fields'],
        url: `https://store.steampowered.com/app/${x.id}/`,
      };
    });
}

interface AppData {
  name?: string;
  header_image?: string;
  release_date?: { date?: string; coming_soon?: boolean };
  platforms?: Platforms;
  developers?: string[];
  website?: string | null;
}

export async function steamItem(id: string, lang: Lang): Promise<LookupResult> {
  if (!/^\d{1,10}$/.test(id)) throw new LookupError(400, '400 请求有误：Steam 编号是一串数字（appid）');
  const { l, cc } = loc(lang);
  const data = await upstreamJson<Record<string, { success?: boolean; data?: AppData }>>(LABEL, `https://store.steampowered.com/api/appdetails?appids=${id}&l=${l}&cc=${cc}`);
  const app = data[id];
  if (!app?.success || !app.data?.name) throw new LookupError(404, '404 未找到：Steam 上没有这款游戏（或这个地区看不到）');
  const d = app.data;
  const year = yearOf(d.release_date?.date);
  const fields: LookupResult['fields'] = {};
  const platform = steamPlatforms(d.platforms);
  if (platform.length) fields.platform = platform;
  // 官网 + Steam 商店页（Rei 2026-10-28：游戏信息里要有 Steam 链接）
  fields.links = [...(d.website && /^https?:\/\//.test(d.website) ? [{ url: d.website }] : []), { url: `https://store.steampowered.com/app/${id}/` }];
  const dev = (d.developers ?? []).slice(0, 2).join(', ');
  return {
    source: 'steam',
    sourceId: id,
    name: decodeEntities(d.name!),
    ...(year ? { year } : {}),
    ...(d.header_image ? { image: d.header_image, thumb: d.header_image } : {}),
    ...(dev ? { subtitle: dev } : {}),
    fields,
    url: `https://store.steampowered.com/app/${id}/`,
  };
}

/**
 * 附件的本机上传队列：还没传到 R2 的文件（原文件 + 图片缩略图）存在 IndexedDB `mindough-files`，
 * 离线、没登录、传失败都不丢；传好了就删。也是没传上去之前本机看图、下载的来源。
 * 没有 IndexedDB 的环境（测试、隐私模式）退回内存（关掉页面就没了，界面照样能用）。
 */
export interface PendingFile {
  id: string;
  file: Blob;
  thumb: Blob | null;
  added_at: number;
}

export interface PendingQueue {
  put(p: PendingFile): Promise<void>;
  get(id: string): Promise<PendingFile | undefined>;
  delete(id: string): Promise<void>;
  ids(): Promise<string[]>;
}

export function memoryQueue(): PendingQueue {
  const m = new Map<string, PendingFile>();
  return {
    put: async (p) => void m.set(p.id, p),
    get: async (id) => m.get(id),
    delete: async (id) => void m.delete(id),
    ids: async () => [...m.keys()],
  };
}

const DB = 'mindough-files';
const STORE = 'pending';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function idbQueue(factory: IDBFactory = indexedDB): PendingQueue {
  let opened: Promise<IDBDatabase> | null = null;
  const db = () =>
    (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = factory.open(DB, 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  const tx = async (mode: IDBTransactionMode) => (await db()).transaction(STORE, mode).objectStore(STORE);
  return {
    put: async (p) => void (await req((await tx('readwrite')).put(p))),
    get: async (id) => (await req((await tx('readonly')).get(id))) as PendingFile | undefined,
    delete: async (id) => void (await req((await tx('readwrite')).delete(id))),
    ids: async () => ((await req((await tx('readonly')).getAllKeys())) as IDBValidKey[]).map(String),
  };
}

let queue: PendingQueue | null = null;

/** 本机的队列（有 IndexedDB 用它，打不开就退回内存）。 */
export function pendingQueue(): PendingQueue {
  if (queue) return queue;
  if (typeof indexedDB === 'undefined') return (queue = memoryQueue());
  const idb = idbQueue();
  const mem = memoryQueue();
  let broken = false;
  const guard =
    <A extends unknown[], R>(f: (q: PendingQueue) => (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      if (!broken) {
        try {
          return await f(idb)(...a);
        } catch (e) {
          console.warn('附件队列：IndexedDB 不能用，先存在内存里', e);
          broken = true;
        }
      }
      return f(mem)(...a);
    };
  return (queue = { put: guard((q) => q.put), get: guard((q) => q.get), delete: guard((q) => q.delete), ids: guard((q) => q.ids) });
}

/** 测试用：换一个队列。 */
export function setPendingQueue(q: PendingQueue | null) {
  queue = q;
}

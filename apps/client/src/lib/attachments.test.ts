// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryAdapter, Store, type Attachment } from '@mindough/core';
import { memoryQueue, pendingQueue, setPendingQueue } from './attachments-queue';
import { Uploader, addAttachments, getUploader, installUploader, tooBigMessage, uploadState, type UploadFn } from './attachments';
import { uploadText } from '../components/attachments/Attachments';
import './i18n';

const KEY = (c: string) => `${'a'.repeat(16)}/f/${c.repeat(64)}`;
const tick = () => new Promise((r) => setTimeout(r, 0));
const until = async (f: () => boolean) => {
  for (let i = 0; i < 50 && !f(); i++) await tick();
};

let store: Store;
beforeEach(async () => {
  setPendingQueue(memoryQueue());
  store = await Store.open(new MemoryAdapter(), { deviceId: 'dev-a' });
});
afterEach(() => setPendingQueue(null));

function fakeUpload(opts: { fail?: number; hold?: boolean } = {}) {
  const calls: Blob[] = [];
  let fails = opts.fail ?? 0;
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  const fn: UploadFn = async (blob, onProgress, signal) => {
    calls.push(blob);
    onProgress(blob.size / 2, blob.size);
    if (opts.hold) await Promise.race([held, new Promise((_, rej) => signal.addEventListener('abort', () => rej(new DOMException('a', 'AbortError'))))]);
    if (fails > 0) {
      fails--;
      throw new Error('500 服务器内部错误');
    }
    onProgress(blob.size, blob.size);
    return { r2_key: KEY(String(calls.length)), sha256: 'x', mime: blob.type, size: blob.size };
  };
  return { fn, calls, release: () => release() };
}

const file = (name: string, size: number, type = 'application/pdf') => new File([new Uint8Array(size)], name, { type });

describe('上传队列', () => {
  it('加附件：建行、文件进本机队列、传好填上 key 并删掉本机那份', async () => {
    const up = fakeUpload();
    const stop = installUploader(store, { upload: up.fn, blocked: () => null });
    const task = store.createTask({ body_md: 'x' });
    const { added, tooBig } = await addAttachments(store, { type: 'task', id: task.id }, [file('a.pdf', 10)]);
    expect(tooBig).toEqual([]);
    const id = added[0]!.id;
    await until(() => !!store.get('attachment', id)?.r2_key);
    expect(store.get('attachment', id)).toMatchObject({ file_name: 'a.pdf', size: 10, r2_key: KEY('1') });
    expect(await pendingQueue().get(id)).toBeUndefined();
    expect(uploadState(id)).toBeUndefined();
    stop();
  });

  it('太大的不加，提示里写名字', async () => {
    installUploader(store, { upload: fakeUpload().fn, blocked: () => null })();
    const big = { name: 'big.zip', size: 50 * 1024 * 1024 + 1, type: 'application/zip' } as File;
    const r = await addAttachments(store, { type: 'task', id: 't' }, [big]);
    expect(r.tooBig).toEqual(['big.zip']);
    expect(store.list('attachment')).toEqual([]);
    expect(tooBigMessage(['big.zip'])).toBe('「big.zip」超过 50 MB，没有添加');
  });

  it('离线 / 没登录时排着，kick 后接着传', async () => {
    let block: 'offline' | 'signed-out' | null = 'offline';
    const up = fakeUpload();
    const stop = installUploader(store, { upload: up.fn, blocked: () => block });
    const { added } = await addAttachments(store, { type: 'task', id: 't' }, [file('a.pdf', 4)]);
    const id = added[0]!.id;
    expect(uploadState(id)?.phase).toBe('offline');
    block = 'signed-out';
    getUploader()!.kick();
    expect(uploadState(id)?.phase).toBe('signed-out');
    block = null;
    getUploader()!.kick();
    await until(() => !!store.get('attachment', id)?.r2_key);
    expect(up.calls).toHaveLength(1);
    stop();
  });

  it('失败显示原因，重试成功；图片先传缩略图再传原图', async () => {
    const up = fakeUpload({ fail: 1 });
    const u = new Uploader(store, { upload: up.fn, blocked: () => null });
    const row = store.addAttachment({ owner_type: 'task', owner_id: 't', file_name: 'p.jpg', mime: 'image/jpeg', size: 8 });
    const thumb = new Blob([new Uint8Array(2)], { type: 'image/webp' });
    await pendingQueue().put({ id: row.id, file: file('p.jpg', 8, 'image/jpeg'), thumb, added_at: 0 });
    u.enqueue(row.id);
    await until(() => uploadState(row.id)?.phase === 'failed');
    expect(uploadState(row.id)?.error).toBe('500 服务器内部错误');
    expect(uploadText(uploadState(row.id), row)).toBe('上传失败');
    u.retry(row.id);
    await until(() => !!store.get('attachment', row.id)?.r2_key);
    const done = store.get('attachment', row.id)!;
    expect(done.thumb_key).toBe(KEY('2'));
    expect(done.r2_key).toBe(KEY('3'));
  });

  it('取消：停掉上传、删本机文件和这一行', async () => {
    const up = fakeUpload({ hold: true });
    const u = new Uploader(store, { upload: up.fn, blocked: () => null });
    const row = store.addAttachment({ owner_type: 'task', owner_id: 't', file_name: 'a.pdf', mime: 'application/pdf', size: 8 });
    await pendingQueue().put({ id: row.id, file: file('a.pdf', 8), thumb: null, added_at: 0 });
    u.enqueue(row.id);
    await until(() => uploadState(row.id)?.phase === 'uploading');
    expect(uploadText(uploadState(row.id), row)).toBe('正在上传 50%');
    await u.cancel(row.id);
    expect(store.get('attachment', row.id)).toBeUndefined();
    expect(await pendingQueue().get(row.id)).toBeUndefined();
    up.release();
    await tick();
    expect(store.raw('attachment', row.id)?.r2_key).toBeNull();
  });

  it('启动时：已删的、已传好的从队列清掉，其余接着传', async () => {
    const up = fakeUpload();
    const mk = (name: string): Attachment => store.addAttachment({ owner_type: 'task', owner_id: 't', file_name: name, mime: 'text/plain', size: 1 });
    const gone = mk('gone.txt');
    const done = mk('done.txt');
    const todo = mk('todo.txt');
    store.removeAttachment(gone.id);
    store.setAttachmentFile(done.id, { r2_key: KEY('d') });
    for (const a of [gone, done, todo]) await pendingQueue().put({ id: a.id, file: file(a.file_name, 1, 'text/plain'), thumb: null, added_at: 0 });
    const u = new Uploader(store, { upload: up.fn, blocked: () => null });
    await u.resume();
    await until(() => !!store.get('attachment', todo.id)?.r2_key);
    expect((await pendingQueue().ids()).sort()).toEqual([]);
    expect(up.calls).toHaveLength(1);
  });

  it('别的设备加的、还没传上来', () => {
    const row = store.addAttachment({ owner_type: 'task', owner_id: 't', file_name: 'a.pdf', mime: 'application/pdf', size: 8 });
    expect(uploadText(undefined, row)).toBe('还在另一台设备上');
    expect(uploadText(undefined, { ...row, r2_key: KEY('1') })).toBeNull();
  });
});

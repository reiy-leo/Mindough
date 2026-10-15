import { useState } from 'react';
import { Cake, ChevronLeft, ImagePlus, Plus } from 'lucide-react';
import { formatDateZh } from '@mindough/core';
import { useStore } from '../store/StoreProvider';
import { useUi } from '../lib/ui';
import { saveImageAsset } from '../lib/upload';
import { href, navigate } from '../lib/router';
import { Button, Empty, Field, Section, Sheet } from '../ui/primitives';
import { Avatar } from '../components/Avatar';
import { TaskRow } from '../components/TaskRow';
import { Markdown } from '../components/Markdown';
import { NoteField } from '../components/library/NoteField';
import { BUILTIN_TYPE_IDS } from '@mindough/core';

export function PersonDialog({ id, initialName, onClose }: { id?: string; initialName?: string; onClose: () => void }) {
  const store = useStore();
  const p = store.get('person', id);
  const [name, setName] = useState(p?.name ?? initialName ?? '');
  const [relation, setRelation] = useState(p?.relation ?? '');
  const [birthday, setBirthday] = useState(p?.birthday ?? '');
  const [note, setNote] = useState(p?.note_md ?? '');
  const [avatar, setAvatar] = useState<string | null>(p?.avatar_asset_id ?? null);
  const avatarUrl = avatar ? (store.get('asset', avatar)?.url ?? avatar) : null;
  return (
    <Sheet
      isOpen
      onOpenChange={(o) => !o && onClose()}
      title={p ? '编辑人物' : '添加人物'}
      footer={
        <Button
          variant="primary"
          isDisabled={!name.trim()}
          onPress={() => {
            const data = { name: name.trim(), relation: relation || null, birthday: birthday || null, note_md: note, avatar_asset_id: avatar };
            if (p) store.update('person', p.id, data);
            else navigate({ page: 'person', id: store.insert('person', data).id });
            onClose();
          }}
        >
          保存
        </Button>
      }
    >
      <div className="person-form">
        <label className="avatar-upload">
          {avatarUrl ? <img src={avatarUrl} alt="" /> : <ImagePlus size={22} />}
          <span>头像</span>
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              void saveImageAsset(store, f).then(setAvatar);
            }}
          />
        </label>
        <div className="editor-grid grow">
          <Field label="姓名" value={name} onChange={setName} autoFocus />
          <Field label="关系" value={relation} onChange={setRelation} placeholder="家人 / 朋友 / 同事" />
          <Field label="生日" type="date" value={birthday} onChange={setBirthday} />
        </div>
      </div>
      <NoteField value={note} onChange={setNote} />
    </Sheet>
  );
}

export function PersonDetailPage({ id }: { id: string }) {
  const store = useStore();
  const ui = useUi();
  const [editing, setEditing] = useState(false);
  const p = store.get('person', id);
  if (!p) return <Empty title="找不到这个人" />;
  const tasks = store.tasksOfPerson(id);
  return (
    <div className="page">
      <a className="back-link" href={href({ page: 'people' })}>
        <ChevronLeft size={16} aria-hidden />
        人物
      </a>
      <header className="person-hero">
        <Avatar store={store} person={p} size={72} />
        <div className="grow">
          <h1 className="page-title">{p.name}</h1>
          <div className="page-subtitle">
            {p.relation ?? '未填写关系'}
            {p.birthday && (
              <>
                {' · '}
                <Cake size={13} /> {formatDateZh(p.birthday, false)}
              </>
            )}
          </div>
        </div>
        <div className="page-actions">
          <Button variant="secondary" onPress={() => setEditing(true)}>
            编辑
          </Button>
          <Button
            variant="primary"
            onPress={() => ui.openQuickCreate({ type_id: BUILTIN_TYPE_IDS.person, type_data: { person: id } })}
          >
            <Plus size={16} />
            新建相关任务
          </Button>
        </div>
      </header>
      {p.note_md && <Markdown source={p.note_md} className="card note-card" />}
      <Section title={`相关任务 ${tasks.length}`}>
        <div className="task-list plain">
          {tasks.map((t) => (
            <TaskRow key={t.id} store={store} task={t} showDate />
          ))}
          {!tasks.length && <Empty title="还没有相关任务" />}
        </div>
      </Section>
      {editing && <PersonDialog id={id} onClose={() => setEditing(false)} />}
    </div>
  );
}

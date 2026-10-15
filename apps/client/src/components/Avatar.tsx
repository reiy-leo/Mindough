import type { Person, Store } from '@mindough/core';
import { personAvatar } from '../lib/view';

export function Avatar({ store, person, size = 28 }: { store: Store; person: Person; size?: number }) {
  const url = personAvatar(store, person);
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42 }} title={person.name}>
      {url ? <img src={url} alt={person.name} /> : person.name.slice(0, 1)}
    </span>
  );
}

export function AvatarStack({ store, people, size = 20 }: { store: Store; people: Person[]; size?: number }) {
  if (!people.length) return null;
  return (
    <span className="avatar-stack">
      {people.slice(0, 3).map((p) => (
        <Avatar key={p.id} store={store} person={p} size={size} />
      ))}
    </span>
  );
}

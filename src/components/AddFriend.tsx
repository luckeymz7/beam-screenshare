import { useMemo } from 'react';
import { TContext } from './i18n';
import { ProfileCard } from './room/ProfileCard';
import { translator, type Lang } from '../lib/i18n';
import type { Theme } from '../lib/themes';

/** A friend link's page: their card, with the add button. */
export default function AddFriend({
  lang,
  person,
}: {
  lang: Lang;
  person: { id: string; name: string; image: string | null; bio: string; premium: boolean; theme: Theme | null; banner: string | null };
}) {
  const t = useMemo(() => translator(lang), [lang]);
  return (
    <TContext.Provider value={t}>
      <ProfileCard
        name={person.name}
        meta={{
          uid: person.id,
          image: person.image,
          bio: person.bio || undefined,
          premium: person.premium || undefined,
          theme: person.theme ?? undefined,
          banner: person.banner ?? undefined,
        }}
        friendButton
      />
    </TContext.Provider>
  );
}

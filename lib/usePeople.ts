import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useState } from "react";
import { getPeople, onPeopleChanged } from "./db";
import type { Person } from "./people";

// The people list, kept once for the whole app: every transaction row needs
// it, and a query per row would be slow on a long list.
let cached: Person[] | null = null;
let loading: Promise<void> | null = null;
const subscribers = new Set<(people: Person[]) => void>();

function refresh(db: Parameters<typeof getPeople>[0]) {
  if (!loading) {
    loading = getPeople(db)
      .then((people) => {
        cached = people;
        subscribers.forEach((s) => s(people));
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

export function usePeople(): Person[] {
  const db = useSQLiteContext();
  const [people, setPeople] = useState<Person[]>(cached ?? []);

  useEffect(() => {
    subscribers.add(setPeople);
    if (cached) setPeople(cached);
    else refresh(db);
    const stop = onPeopleChanged(() => {
      refresh(db);
    });
    return () => {
      subscribers.delete(setPeople);
      stop();
    };
  }, [db]);

  return people;
}

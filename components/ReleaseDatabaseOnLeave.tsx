import { useSQLiteContext } from "expo-sqlite";
import { useEffect } from "react";
import { Platform } from "react-native";

// Lets go of the database the moment the page goes away (a refresh, a close,
// leaving the site), so the page that replaces it can open it straight away.
// Only one page can hold the database at a time, and an iPhone can be slow to
// let go on its own -- the refreshed page then can't open it. If the browser
// later brings this same page back from its cache, it reloads, since the
// database here is closed.
export function ReleaseDatabaseOnLeave() {
  const db = useSQLiteContext();
  useEffect(() => {
    if (Platform.OS !== "web") return;
    let released = false;
    const onLeave = () => {
      if (released) return;
      released = true;
      db.closeAsync().catch(() => {});
    };
    const onBack = (e: PageTransitionEvent) => {
      if (e.persisted && released) window.location.reload();
    };
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("pageshow", onBack);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("pageshow", onBack);
    };
  }, [db]);
  return null;
}

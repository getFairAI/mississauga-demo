const TTL_MS = 60 * 60 * 1000;
const PREFIX = "civic.chat.";

type StoredChatRecord<T> = {
  savedAt: number;
  messages: T[];
};

const safeStorage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

export function loadChatHistory<T>(scope: string): T[] {
  const storage = safeStorage();
  if (!storage) return [];
  const key = PREFIX + scope;
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredChatRecord<T>;
    if (
      !parsed ||
      typeof parsed.savedAt !== "number" ||
      !Array.isArray(parsed.messages)
    ) {
      storage.removeItem(key);
      return [];
    }
    if (Date.now() - parsed.savedAt > TTL_MS) {
      storage.removeItem(key);
      return [];
    }
    return parsed.messages;
  } catch {
    return [];
  }
}

export function saveChatHistory<T>(scope: string, messages: T[]): void {
  const storage = safeStorage();
  if (!storage) return;
  const key = PREFIX + scope;
  try {
    if (messages.length === 0) {
      storage.removeItem(key);
      return;
    }
    const record: StoredChatRecord<T> = {
      savedAt: Date.now(),
      messages,
    };
    storage.setItem(key, JSON.stringify(record));
  } catch {
    // Silent — quota or serialization failure shouldn't crash the chat.
  }
}

export function clearChatHistory(scope: string): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.removeItem(PREFIX + scope);
  } catch {
    // ignore
  }
}

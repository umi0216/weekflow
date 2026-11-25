CREATE TABLE lan_files (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE lan_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  sender_name TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  file_id TEXT REFERENCES lan_files(id),
  created_at TEXT NOT NULL,
  CHECK (length(content) > 0 OR file_id IS NOT NULL)
);

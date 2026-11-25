CREATE TABLE lan_devices (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL,
  address TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE lan_rooms (
  id TEXT PRIMARY KEY NOT NULL,
  device_a TEXT NOT NULL REFERENCES lan_devices(id),
  device_b TEXT NOT NULL REFERENCES lan_devices(id),
  created_at TEXT NOT NULL,
  UNIQUE (device_a, device_b),
  CHECK (device_a < device_b)
);
--> statement-breakpoint
ALTER TABLE lan_messages ADD COLUMN room_id TEXT REFERENCES lan_rooms(id);
--> statement-breakpoint
ALTER TABLE lan_messages ADD COLUMN sender_device_id TEXT REFERENCES lan_devices(id);
--> statement-breakpoint
CREATE INDEX lan_messages_room ON lan_messages(room_id, id DESC);

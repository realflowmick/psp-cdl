-- SPDX-License-Identifier: CC0-1.0
-- PRAGMA application_id = 1347637297; PRAGMA user_version = 1;
CREATE TABLE psp_records (
  epoch TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('node','session','checkpoint','receipt')),
  record_key TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1 AND revision <= 9007199254740991),
  body TEXT NOT NULL,
  PRIMARY KEY (epoch, tenant_id, kind, record_key)
) WITHOUT ROWID;

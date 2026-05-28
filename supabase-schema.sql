create table if not exists candidates (
  id text primary key,
  name text not null default '',
  contact text not null default '',
  age text not null default '',
  vacancy text not null default '',
  "hhUrl" text not null default '',
  status text not null default 'Новый',
  followup text not null default '',
  owner text not null default '',
  tags jsonb not null default '[]'::jsonb,
  comment text not null default '',
  "updatedAt" text not null,
  "hhId" text not null default '',
  source text not null default 'manual'
);

create table if not exists settings (
  key text primary key,
  value text not null
);

create index if not exists candidates_updated_at_idx on candidates ("updatedAt" desc);
create index if not exists candidates_status_idx on candidates (status);
create index if not exists candidates_owner_idx on candidates (owner);

#!/usr/bin/env python3
"""Migrate public schema+data: ebcjsmpqogbwaxypgllh → bsammfevuefowmpvsnju via Management API + PostgREST."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path('/Users/shubh./Desktop/trigger_web')
MIG = ROOT / '.grok-tmp' / 'supabase-migrate-2026'
MIG.mkdir(parents=True, exist_ok=True)

SRC_REF = 'ebcjsmpqogbwaxypgllh'
NEW_REF = 'bsammfevuefowmpvsnju'
NEW_URL = f'https://{NEW_REF}.supabase.co'
SRC_URL = f'https://{SRC_REF}.supabase.co'
NEW_TOKEN = os.environ['NEW_SUPABASE_ACCESS_TOKEN']
NEW_SERVICE = os.environ['NEW_SERVICE_ROLE_KEY']
SRC_SERVICE = os.environ['SRC_SERVICE_ROLE_KEY']

LOG = (MIG / 'migrate.log').open('a', encoding='utf-8')


def log(msg: str) -> None:
    line = f'[{time.strftime("%H:%M:%S")}] {msg}'
    print(line, flush=True)
    LOG.write(line + '\n')
    LOG.flush()


def linked_query(sql: str) -> str:
    r = subprocess.run(
        ['supabase', 'db', 'query', '--linked', sql],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        timeout=180,
    )
    if r.returncode != 0:
        raise RuntimeError(f'linked query failed: {r.stderr or r.stdout}')
    return r.stdout


def parse_ascii_table(text: str) -> list[dict[str, str]]:
    lines = [ln.rstrip() for ln in text.splitlines() if ln.strip()]
    # Find header separator like ├─ or |---
    header_idx = None
    for i, ln in enumerate(lines):
        if set(ln.replace('│', '').replace('|', '').replace(' ', '')) <= set('─┼+-'):
            # separator under header
            if i > 0:
                header_idx = i - 1
                sep_idx = i
                break
        if re.match(r'^\|[-| ]+\|$', ln) or re.match(r'^├', ln):
            header_idx = i - 1
            sep_idx = i
            break
    if header_idx is None:
        # empty result
        if '┌' in text or 'No rows' in text or text.strip() == '':
            return []
        raise RuntimeError(f'cannot parse table:\n{text[:500]}')

    def split_row(ln: str) -> list[str]:
        if '│' in ln:
            parts = ln.split('│')
        else:
            parts = ln.split('|')
        return [p.strip() for p in parts[1:-1]] if len(parts) > 2 else [p.strip() for p in parts if p.strip() != '']

    headers = split_row(lines[header_idx])
    rows: list[dict[str, str]] = []
    for ln in lines[sep_idx + 1 :]:
        if ln.startswith('└') or ln.startswith('├') and '─' in ln and '│' not in ln[1:3]:
            break
        if set(ln.replace('│', '').replace('|', '').replace(' ', '')) <= set('─┴┼+-'):
            break
        if not ('│' in ln or ln.startswith('|')):
            continue
        vals = split_row(ln)
        if len(vals) != len(headers):
            continue
        rows.append(dict(zip(headers, vals)))
    return rows


def mgmt_sql(project_ref: str, token: str, sql: str) -> object:
    """Run SQL via Management API using curl (urllib gets Cloudflare 1010)."""
    url = f'https://api.supabase.com/v1/projects/{project_ref}/database/query'
    body_path = MIG / '.last_query.json'
    body_path.write_text(json.dumps({'query': sql}), encoding='utf-8')
    r = subprocess.run(
        [
            'curl',
            '-sS',
            '-X',
            'POST',
            url,
            '-H',
            f'Authorization: Bearer {token}',
            '-H',
            'Content-Type: application/json',
            '-H',
            'User-Agent: supabase-migrate/1.0',
            '--data-binary',
            f'@{body_path}',
        ],
        capture_output=True,
        text=True,
        timeout=180,
    )
    if r.returncode != 0:
        raise RuntimeError(f'Mgmt SQL curl failed: {r.stderr[:1000]}')
    raw = (r.stdout or '').strip()
    if not raw:
        return None
    if raw.startswith('error') or 'error code' in raw:
        raise RuntimeError(f'Mgmt SQL error: {raw[:1000]}')
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f'Mgmt SQL bad JSON: {raw[:1000]}') from e
    if isinstance(data, dict) and data.get('message') and data.get('error'):
        raise RuntimeError(f'Mgmt SQL API error: {data}')
    return data


def rest_get_all(base_url: str, service_key: str, table: str) -> list[dict]:
    headers = {
        'apikey': service_key,
        'Authorization': f'Bearer {service_key}',
        'Prefer': 'count=exact',
    }
    rows: list[dict] = []
    start = 0
    page = 1000
    while True:
        end = start + page - 1
        req = urllib.request.Request(
            f'{base_url}/rest/v1/{urllib.parse.quote(table)}?select=*',
            headers={**headers, 'Range': f'{start}-{end}'},
            method='GET',
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            chunk = json.loads(resp.read().decode() or '[]')
            rows.extend(chunk)
            content_range = resp.headers.get('Content-Range', '')
            # e.g. 0-999/1234 or 0-9/*
            if len(chunk) < page:
                break
            start += page
            if content_range.endswith('/*'):
                continue
            m = re.search(r'/(\d+)$', content_range)
            if m and start >= int(m.group(1)):
                break
    return rows


def rest_upsert(base_url: str, service_key: str, table: str, rows: list[dict]) -> None:
    if not rows:
        return
    headers = {
        'apikey': service_key,
        'Authorization': f'Bearer {service_key}',
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
    }
    # chunk to keep payload small
    for i in range(0, len(rows), 200):
        chunk = rows[i : i + 200]
        body = json.dumps(chunk).encode()
        req = urllib.request.Request(
            f'{base_url}/rest/v1/{urllib.parse.quote(table)}',
            data=body,
            headers=headers,
            method='POST',
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                resp.read()
        except urllib.error.HTTPError as e:
            err = e.read().decode()
            raise RuntimeError(f'upsert {table} HTTP {e.code}: {err[:1000]}') from e


def sql_literal_type(data_type: str, udt_name: str, is_nullable: str, column_default: str | None) -> str:
    # Map information_schema to CREATE TABLE types
    t = data_type.lower()
    if t == 'ARRAY':
        pass
    if udt_name.startswith('_'):
        base = udt_name[1:]
        typ = f'{base}[]'
    elif t == 'USER-DEFINED':
        typ = udt_name
    elif t == 'character varying':
        typ = 'text'  # simplify
    elif t == 'timestamp with time zone':
        typ = 'timestamptz'
    elif t == 'timestamp without time zone':
        typ = 'timestamp'
    elif t == 'double precision':
        typ = 'double precision'
    elif t == 'integer':
        typ = 'integer'
    elif t == 'bigint':
        typ = 'bigint'
    elif t == 'boolean':
        typ = 'boolean'
    elif t == 'jsonb':
        typ = 'jsonb'
    elif t == 'json':
        typ = 'json'
    elif t == 'text':
        typ = 'text'
    elif t == 'uuid':
        typ = 'uuid'
    elif t == 'numeric':
        typ = 'numeric'
    elif t == 'real':
        typ = 'real'
    elif t == 'date':
        typ = 'date'
    else:
        typ = udt_name or t

    null_sql = '' if is_nullable == 'YES' else ' not null'
    # Avoid serial ownership issues: keep defaults that are safe
    default_sql = ''
    if column_default:
        d = column_default
        # skip nextval defaults; we'll fix sequences later / use explicit ids
        if 'nextval(' not in d:
            default_sql = f' default {d}'
    return f'{typ}{null_sql}{default_sql}'


def main() -> int:
    log(f'Start migrate {SRC_REF} → {NEW_REF}')

    # 1) Tables
    tables = [
        r['tablename']
        for r in parse_ascii_table(
            linked_query("select tablename from pg_tables where schemaname='public' order by 1;")
        )
    ]
    log(f'Source tables ({len(tables)}): {tables}')

    # 2) Column metadata
    cols_raw = linked_query(
        """
        select table_name, column_name, ordinal_position, data_type, udt_name,
               is_nullable, column_default
        from information_schema.columns
        where table_schema='public'
        order by table_name, ordinal_position;
        """
    )
    cols = parse_ascii_table(cols_raw)
    by_table: dict[str, list[dict[str, str]]] = {}
    for c in cols:
        by_table.setdefault(c['table_name'], []).append(c)

    # 3) Primary keys
    pk_raw = linked_query(
        """
        select tc.table_name, kcu.column_name, kcu.ordinal_position
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on tc.constraint_name = kcu.constraint_name
         and tc.table_schema = kcu.table_schema
        where tc.table_schema='public' and tc.constraint_type='PRIMARY KEY'
        order by tc.table_name, kcu.ordinal_position;
        """
    )
    pks: dict[str, list[str]] = {}
    for r in parse_ascii_table(pk_raw):
        pks.setdefault(r['table_name'], []).append(r['column_name'])

    # 4) Create extensions + tables on NEW
    mgmt_sql(NEW_REF, NEW_TOKEN, 'create extension if not exists pgcrypto with schema extensions;')
    mgmt_sql(NEW_REF, NEW_TOKEN, 'drop table if exists public.__migrate_ping;')

    create_sql_parts: list[str] = []
    for table in tables:
        tcols = by_table[table]
        col_defs = []
        for c in tcols:
            col_defs.append(
                f'  {c["column_name"]} '
                + sql_literal_type(
                    c['data_type'],
                    c['udt_name'],
                    c['is_nullable'],
                    None if c['column_default'] in ('NULL', '') else c['column_default'],
                )
            )
        pk = pks.get(table) or []
        pk_sql = f',\n  primary key ({", ".join(pk)})' if pk else ''
        stmt = f'create table if not exists public.{table} (\n' + ',\n'.join(col_defs) + pk_sql + '\n);'
        create_sql_parts.append(stmt)
        (MIG / f'create_{table}.sql').write_text(stmt + '\n', encoding='utf-8')
        log(f'Creating {table}...')
        try:
            mgmt_sql(NEW_REF, NEW_TOKEN, stmt)
            log(f'  OK create {table}')
        except Exception as e:
            log(f'  FAIL create {table}: {e}')
            # retry without defaults
            col_defs2 = []
            for c in tcols:
                col_defs2.append(
                    f'  {c["column_name"]} '
                    + sql_literal_type(c['data_type'], c['udt_name'], c['is_nullable'], None)
                )
            stmt2 = (
                f'create table if not exists public.{table} (\n'
                + ',\n'.join(col_defs2)
                + pk_sql
                + '\n);'
            )
            mgmt_sql(NEW_REF, NEW_TOKEN, stmt2)
            log(f'  OK create {table} (no defaults)')

    # 5) Sequences
    mgmt_sql(
        NEW_REF,
        NEW_TOKEN,
        """
        create sequence if not exists public.momentum_episodes_episode_no_seq;
        create sequence if not exists public.usage_daily_ledger_id_seq;
        """,
    )

    # 6) Enable RLS flags
    rls_raw = linked_query(
        """
        select relname, relrowsecurity::text as rls
        from pg_class c
        join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and relkind='r'
        order by 1;
        """
    )
    for r in parse_ascii_table(rls_raw):
        if r['rls'] in ('t', 'true', 'TRUE'):
            mgmt_sql(NEW_REF, NEW_TOKEN, f'alter table public.{r["relname"]} enable row level security;')

    # 7) Policies — drop/recreate from source defs
    pol_raw = linked_query(
        """
        select tablename, policyname, permissive, roles::text as roles, cmd, qual, with_check
        from pg_policies where schemaname='public'
        order by tablename, policyname;
        """
    )
    for p in parse_ascii_table(pol_raw):
        table = p['tablename']
        name = p['policyname']
        cmd = p['cmd']
        roles = p['roles'].strip('{}')
        role_sql = ', '.join(roles.split(',')) if roles else 'public'
        using = p['qual'] if p['qual'] not in ('NULL', '') else None
        check = p['with_check'] if p['with_check'] not in ('NULL', '') else None
        permissive = 'permissive' if p['permissive'].upper().startswith('PERMISSIVE') else 'restrictive'
        parts = [
            f'drop policy if exists \"{name}\" on public.{table};',
            f'create policy \"{name}\" on public.{table} as {permissive} for {cmd} to {role_sql}',
        ]
        sql = parts[0] + parts[1]
        if using is not None:
            sql += f' using ({using})'
        if check is not None:
            sql += f' with check ({check})'
        sql += ';'
        try:
            mgmt_sql(NEW_REF, NEW_TOKEN, sql)
            log(f'  policy OK {table}.{name}')
        except Exception as e:
            log(f'  policy FAIL {table}.{name}: {e}')

    # 8) Copy data via PostgREST (FK-safe order)
    preferred = [
        'thresholds',
        'device_profiles',
        'assets_monitor_based_on_device',
        'episodes_stocks',
        'episodes_crypto',
        'episodes_etfs',
        'episodes_commodities',
        'episodes_indexes',
        'episodes_forex',
        'events_episodes',
        'research',
        'market_session_bulletins',
        'perplexity_prompts',
        'usage_daily_ledger',
    ]
    order = [t for t in preferred if t in tables] + [t for t in tables if t not in preferred]

    counts: dict[str, int] = {}
    for table in order:
        log(f'Copy data {table}...')
        rows = rest_get_all(SRC_URL, SRC_SERVICE, table)
        counts[table] = len(rows)
        # strip unsupported generated fields if any
        rest_upsert(NEW_URL, NEW_SERVICE, table, rows)
        # verify
        new_rows = rest_get_all(NEW_URL, NEW_SERVICE, table)
        log(f'  {table}: src={len(rows)} new={len(new_rows)}')
        if len(new_rows) != len(rows):
            log(f'  WARN count mismatch on {table}')

    # 9) setval sequences
    mgmt_sql(
        NEW_REF,
        NEW_TOKEN,
        """
        select setval('public.momentum_episodes_episode_no_seq', 765, true);
        select setval('public.usage_daily_ledger_id_seq', greatest(
          (select coalesce(max(id), 1) from public.usage_daily_ledger), 412
        ), true);
        """,
    )

    # 10) Grants for anon/authenticated (common supabase pattern)
    for table in tables:
        try:
            mgmt_sql(
                NEW_REF,
                NEW_TOKEN,
                f"""
                grant select, insert, update, delete on table public.{table} to anon, authenticated, service_role;
                """,
            )
        except Exception as e:
            log(f'grant warn {table}: {e}')

    summary = {
        'source': SRC_REF,
        'target': NEW_REF,
        'tables': counts,
        'total_rows': sum(counts.values()),
    }
    (MIG / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    log(f'DONE summary={summary}')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as e:
        log(f'FATAL: {e}')
        raise

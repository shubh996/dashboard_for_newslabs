-- Run in OLD project SQL Editor, then Download CSV / paste here.
select table_schema,
       table_name,
       ordinal_position,
       column_name,
       data_type,
       udt_name,
       is_nullable,
       column_default,
       character_maximum_length,
       numeric_precision,
       numeric_scale
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

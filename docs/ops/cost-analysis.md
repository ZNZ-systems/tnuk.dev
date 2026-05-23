# Unit economics — first 100 reviews

After ~100 paying-customer reviews, query the `runs` table:

```sql
SELECT
  user_id,
  COUNT(*) AS reviews,
  SUM(prompt_tokens) AS prompt_tokens,
  SUM(completion_tokens) AS completion_tokens
FROM runs
GROUP BY user_id
ORDER BY prompt_tokens DESC;
```

Compare median vs p95 spend. If any user exceeds **5× median** token usage, revisit fair-use policy.

Log fields are written by `POST /api/cli/session` and review completion webhooks (future).

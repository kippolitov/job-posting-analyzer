# Job-posting validation set (SC-001 / SC-002)

Each `.txt` file is the redacted main text of one real job posting; `manifest.json`
carries the human-labeled ground truth (`arrangement`, `daysInOffice`, and whether
the arrangement is `stated` outright in the text).

Run the eval with `npm run eval:postings` (live model calls — on demand, not CI).

**Release gate**: SC-001 requires ≥ 90% arrangement accuracy with zero
stated-arrangement contradictions on a **50-posting** set. The six seed postings
here exercise the harness; grow the set to 50 real redacted postings before
release sign-off. Redact company-identifying details unless the posting is public.

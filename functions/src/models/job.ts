/**
 * Re-exports the single-source-of-truth analysis/job types from shared/
 * (data-model.md §1) — no shape change, just relocated so extension/ and
 * web/ import the identical definitions instead of duplicating them.
 */
export * from "../../../shared/types/job";

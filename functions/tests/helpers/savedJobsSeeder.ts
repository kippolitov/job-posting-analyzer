import { createHash } from "node:crypto";
import type { TransactionAction } from "@azure/data-tables";
import { ensureTable } from "../../src/services/tablesService";

/**
 * Fills a SavedJobs partition with `count` well-formed rows using entity
 * batches (100 ops per transaction, same partition), so cap tests don't pay
 * for 1,000 sequential saves. Rows use canonical URLs
 * `https://seeded.example/jobs/<i>` and real sha256 RowKeys, matching what
 * the repository writes.
 */
export async function fillPartitionForTests(
  sub: string,
  count: number
): Promise<void> {
  const client = await ensureTable("SavedJobs");
  const analysisJson = JSON.stringify({
    isJobPosting: true,
    title: "Seeded",
    company: "Seed Co",
    location: null,
    arrangement: "remote",
    arrangementConfidence: "explicit",
    arrangementEvidence: null,
    daysInOffice: null,
    daysRemote: null,
    remoteRestrictions: null,
    salary: null,
    seniority: "senior",
    techStack: [],
    fit: null,
    model: "seed",
    analyzedAt: "2026-07-01T00:00:00.000Z",
  });

  const actions: TransactionAction[] = [];
  for (let i = 0; i < count; i++) {
    const canonicalUrl = `https://seeded.example/jobs/${i}`;
    actions.push([
      "create",
      {
        partitionKey: sub,
        rowKey: createHash("sha256").update(canonicalUrl).digest("hex"),
        canonicalUrl,
        sourceUrl: canonicalUrl,
        title: "Seeded",
        company: "Seed Co",
        arrangement: "remote",
        status: "interested",
        notes: "",
        analysisJson,
        savedAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
        schemaVersion: 1,
      },
    ]);
    if (actions.length === 100) {
      await client.submitTransaction(actions.splice(0, actions.length));
    }
  }
  if (actions.length > 0) {
    await client.submitTransaction(actions);
  }
}

import http from "node:http";
import { test, expect, e2eEnabled, skipReason } from "./fixtures";

// P1 journey: open the panel on a job posting page → analysis renders with
// an arrangement badge and evidence.
// Requires a live backend baked into the build (see skipReason) plus E2E=1.

const POSTING_HTML = `<!doctype html>
<html><head><title>Senior Backend Engineer - Acme</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org/",
  "@type": "JobPosting",
  "title": "Senior Backend Engineer",
  "hiringOrganization": { "@type": "Organization", "name": "Acme" },
  "jobLocation": { "@type": "Place", "address": { "addressLocality": "Austin", "addressRegion": "TX" } }
}
</script></head>
<body>
<nav>Home | Jobs | About</nav>
<main>
  <h1>Senior Backend Engineer</h1>
  <p>Acme is hiring a Senior Backend Engineer in Austin, TX.</p>
  <p>This is a hybrid role, 3 days per week in our Austin office and 2 days remote.</p>
  <p>You will build services in C# and .NET 8 on Azure. We use Kubernetes and Terraform.
  The salary range is $180,000 to $220,000 per year. Senior level, 5+ years experience.
  ${"We value ownership, craftsmanship, and collaboration. ".repeat(10)}</p>
</main>
<footer>© Acme Corp</footer>
</body></html>`;

function serveFixture(): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(POSTING_HTML);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${address.port}/jobs/42` });
    });
  });
}

test.describe("US1 — Job Posting Analyzer (P1 journey)", () => {
  test.skip(!e2eEnabled, skipReason);

  test("analyzes a job posting page and renders arrangement with evidence", async ({
    context,
    extensionId,
  }) => {
    const { server, url } = await serveFixture();
    try {
      const postingPage = await context.newPage();
      await postingPage.goto(url);

      // Open the panel after the posting tab so tab tracking picks it up.
      const sidePanel = await context.newPage();
      await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

      // Analysis progress indicator, then the result.
      await expect(
        sidePanel.getByText(/hybrid/i).first()
      ).toBeVisible({ timeout: 60_000 });
      await expect(sidePanel.getByText("Senior Backend Engineer").first()).toBeVisible();
      // Evidence quote rendered verbatim with its confidence label.
      await expect(
        sidePanel.getByText(/3 days per week in our Austin office/i).first()
      ).toBeVisible();
      // "explicit" renders as the label "stated in posting".
      await expect(
        sidePanel.getByText(/stated in posting|inferred/i).first()
      ).toBeVisible();
    } finally {
      server.close();
    }
  });
});

import { useRef, useState, type ReactNode } from "react";
import {
  declineMigration,
  runMigration,
  type LegacyData,
  type MigrationResult,
  type ProfileConflictChoice,
} from "../services/migrationService";
import type { CandidateProfile } from "../types/job";

interface MigrationPromptProps {
  data: LegacyData;
  /** Called once the offer is answered (completed or declined). */
  onDone: () => void;
}

type Phase =
  | { name: "offer" }
  | { name: "running" }
  | {
      name: "conflict";
      local: CandidateProfile;
      server: CandidateProfile;
      resolve: (choice: ProfileConflictChoice) => void;
    }
  | { name: "summary"; result: MigrationResult }
  | { name: "failed"; result: MigrationResult }
  | { name: "cap-blocked"; result: MigrationResult };

/**
 * One-time blocking offer to move pre-002 local data into the signed-in
 * account (FR-010). Decline is permanent for this device; failures keep the
 * local data intact and offer Retry (FR-011).
 */
export function MigrationPrompt({ data, onDone }: MigrationPromptProps) {
  const [phase, setPhase] = useState<Phase>({ name: "offer" });
  // The conflict promise resolver must survive re-renders.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const startMigration = async () => {
    setPhase({ name: "running" });
    const result = await runMigration(data, {
      resolveProfileConflict: (local, server) =>
        new Promise<ProfileConflictChoice>((resolve) => {
          setPhase({ name: "conflict", local, server, resolve });
        }),
    });
    if (result.status === "completed") setPhase({ name: "summary", result });
    else if (result.status === "cap-blocked") setPhase({ name: "cap-blocked", result });
    else setPhase({ name: "failed", result });
  };

  const handleDecline = async () => {
    await declineMigration();
    onDone();
  };

  const chooseProfile = (choice: ProfileConflictChoice) => {
    if (phaseRef.current.name === "conflict") {
      const { resolve } = phaseRef.current;
      setPhase({ name: "running" });
      resolve(choice);
    }
  };

  const jobsLabel = `${data.jobs.length} saved posting${data.jobs.length === 1 ? "" : "s"}`;
  const whatMoves = [
    ...(data.jobs.length > 0 ? [jobsLabel] : []),
    ...(data.profile ? ["your candidate profile"] : []),
  ].join(" and ");

  return (
    <div className="flex h-full min-h-64 items-center justify-center bg-gray-50 p-6 dark:bg-gray-950">
      <div
        role="dialog"
        aria-label="Migrate your existing data"
        className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-5 text-center dark:border-gray-800 dark:bg-gray-900"
      >
        {phase.name === "offer" && (
          <>
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
              Move your existing data to your account?
            </h2>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              This browser holds {whatMoves} from before sign-in was added.
              Migrate once and it will follow your account on every device.
            </p>
            <button
              onClick={() => void startMigration()}
              className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              Migrate to my account
            </button>
            <button
              onClick={() => void handleDecline()}
              className="mt-2 w-full rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              Don&apos;t migrate
            </button>
            <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
              If you decline, this data stays on this device only and won&apos;t
              follow you to other devices. You won&apos;t be asked again.
            </p>
          </>
        )}

        {phase.name === "running" && (
          <p role="status" className="py-6 text-sm text-gray-500 dark:text-gray-400">
            Migrating your data…
          </p>
        )}

        {phase.name === "conflict" && (
          <>
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
              Which profile do you want to keep?
            </h2>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Your account already has a profile that differs from the one on
              this device.
            </p>
            <ConflictOption
              title="Keep this device's profile"
              body={phase.local.text}
              onClick={() => chooseProfile("local")}
            />
            <ConflictOption
              title="Keep my account's profile"
              body={phase.server.text}
              onClick={() => chooseProfile("server")}
            />
          </>
        )}

        {phase.name === "summary" && (
          <>
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
              Your data has been moved to your account
            </h2>
            <ul className="mt-2 space-y-1 text-sm text-gray-500 dark:text-gray-400">
              <li>
                {phase.result.uploadedJobs} posting
                {phase.result.uploadedJobs === 1 ? "" : "s"} uploaded
              </li>
              {phase.result.skippedDuplicates > 0 && (
                <li>
                  {phase.result.skippedDuplicates} already in your account
                  (kept the account copy)
                </li>
              )}
              {phase.result.profileOutcome === "uploaded" && <li>Profile uploaded</li>}
              {phase.result.profileOutcome === "kept-server" && (
                <li>Kept your account&apos;s profile</li>
              )}
            </ul>
            <button
              onClick={onDone}
              className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              Continue
            </button>
          </>
        )}

        {phase.name === "failed" && (
          <>
            <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-300">
              The migration could not finish.
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Your data is still safe on this device — nothing was deleted.
              Check your connection and try again.
            </p>
            <button
              onClick={() => void startMigration()}
              className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              Retry
            </button>
          </>
        )}

        {phase.name === "cap-blocked" && (
          <>
            <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-300">
              Your account&apos;s library is full.
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Export your saved postings or prune archived ones from the Saved
              tab, then retry. Nothing was deleted from this device.
            </p>
            <button
              onClick={() => void startMigration()}
              className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              Retry
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ConflictOption({
  title,
  body,
  onClick,
}: {
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="mt-3 w-full rounded-lg border border-gray-200 p-3 text-left hover:border-blue-400 hover:bg-blue-50/50 dark:border-gray-700 dark:hover:border-blue-600 dark:hover:bg-blue-950/30"
    >
      <span className="block text-xs font-semibold text-gray-700 dark:text-gray-200">
        {title}
      </span>
      <ClampedText>{body}</ClampedText>
    </button>
  );
}

function ClampedText({ children }: { children: ReactNode }) {
  return (
    <span className="mt-1 line-clamp-3 block text-xs text-gray-500 dark:text-gray-400">
      {children}
    </span>
  );
}

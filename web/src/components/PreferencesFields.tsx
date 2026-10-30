import {
  ARRANGEMENT_OPTIONS,
  OFFICE_DAY_CHOICES,
  PERIOD_OPTIONS,
  SENIORITY_OPTIONS,
  type PreferencesForm,
} from "shared/preferencesForm";
import type { PreferenceArrangement, PreferencePeriod } from "shared/types/profile";

const FIELD =
  "rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200";
const LABEL = "block text-sm font-medium text-gray-700 dark:text-gray-200";

interface Props {
  form: PreferencesForm;
  onChange: (next: PreferencesForm) => void;
  disabled?: boolean;
}

/** The structured preference fields of the profile editor (FR-015). */
export function PreferencesFields({ form, onChange, disabled }: Props) {
  const set = (patch: Partial<PreferencesForm>) => onChange({ ...form, ...patch });
  const toggleArrangement = (value: PreferenceArrangement) =>
    set({
      arrangements: form.arrangements.includes(value)
        ? form.arrangements.filter((a) => a !== value)
        : [...form.arrangements, value],
    });

  return (
    <div className="mt-2 grid gap-4 sm:grid-cols-2">
      <fieldset className="sm:col-span-2" disabled={disabled}>
        <legend className={LABEL}>Work arrangement</legend>
        <div className="mt-1 flex gap-4">
          {ARRANGEMENT_OPTIONS.map((o) => (
            <label key={o.value} className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200">
              <input
                type="checkbox"
                checked={form.arrangements.includes(o.value)}
                onChange={() => toggleArrangement(o.value)}
              />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="pref-office-days" className={LABEL}>
          Maximum office days
        </label>
        <select
          id="pref-office-days"
          className={`mt-1 ${FIELD}`}
          value={form.maxOfficeDays}
          disabled={disabled}
          onChange={(e) => set({ maxOfficeDays: e.target.value })}
        >
          <option value="">No limit</option>
          {OFFICE_DAY_CHOICES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="pref-salary" className={LABEL}>
            Minimum salary
          </label>
          <input
            id="pref-salary"
            inputMode="numeric"
            className={`mt-1 w-28 ${FIELD}`}
            value={form.salaryAmount}
            disabled={disabled}
            onChange={(e) => set({ salaryAmount: e.target.value })}
          />
        </div>
        <input
          aria-label="Salary currency"
          maxLength={3}
          className={`w-16 uppercase ${FIELD}`}
          value={form.salaryCurrency}
          disabled={disabled}
          onChange={(e) => set({ salaryCurrency: e.target.value })}
        />
        <select
          aria-label="Salary period"
          className={FIELD}
          value={form.salaryPeriod}
          disabled={disabled}
          onChange={(e) => set({ salaryPeriod: e.target.value as PreferencePeriod })}
        >
          {PERIOD_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {(
        [
          ["Minimum seniority", "seniorityMin", "No minimum"],
          ["Maximum seniority", "seniorityMax", "No maximum"],
        ] as const
      ).map(([label, key, none]) => (
        <div key={key}>
          <label htmlFor={`pref-${key}`} className={LABEL}>
            {label}
          </label>
          <select
            id={`pref-${key}`}
            className={`mt-1 ${FIELD}`}
            value={form[key]}
            disabled={disabled}
            onChange={(e) => set({ [key]: e.target.value })}
          >
            <option value="">{none}</option>
            {SENIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ))}

      <div className="sm:col-span-2">
        <label htmlFor="pref-locations" className={LABEL}>
          Locations or timezones (one per line)
        </label>
        <textarea
          id="pref-locations"
          rows={2}
          className={`mt-1 w-full resize-none ${FIELD}`}
          placeholder="EU timezones only"
          value={form.locations}
          disabled={disabled}
          onChange={(e) => set({ locations: e.target.value })}
        />
      </div>

      <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200 sm:col-span-2">
        <input
          type="checkbox"
          checked={form.needsSponsorship}
          disabled={disabled}
          onChange={(e) => set({ needsSponsorship: e.target.checked })}
        />
        I need visa sponsorship
      </label>
    </div>
  );
}

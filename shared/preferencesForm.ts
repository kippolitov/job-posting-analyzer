import {
  PREFERENCE_SENIORITIES,
  isPreferences,
  type PreferenceArrangement,
  type PreferencePeriod,
  type Preferences,
} from "./types/profile";

/**
 * Form state for the preference fields, shared by the extension's options page
 * and the web Profile page (PR4). Inputs are strings, as a form holds them;
 * `preferencesFromForm` validates and converts them to the wire shape.
 */
export interface PreferencesForm {
  arrangements: PreferenceArrangement[];
  /** "" means no limit, otherwise "0".."5". */
  maxOfficeDays: string;
  salaryAmount: string;
  salaryCurrency: string;
  salaryPeriod: PreferencePeriod;
  /** "" means no bound. */
  seniorityMin: string;
  seniorityMax: string;
  /** One per line. */
  locations: string;
  needsSponsorship: boolean;
}

export const ARRANGEMENT_OPTIONS: { value: PreferenceArrangement; label: string }[] = [
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "On-site" },
];

export const PERIOD_OPTIONS: { value: PreferencePeriod; label: string }[] = [
  { value: "year", label: "per year" },
  { value: "month", label: "per month" },
  { value: "day", label: "per day" },
  { value: "hour", label: "per hour" },
];

export const OFFICE_DAY_CHOICES = ["0", "1", "2", "3", "4", "5"];

/** Seniority choices in enum order, management levels last. */
export const SENIORITY_OPTIONS = PREFERENCE_SENIORITIES.map((value) => ({
  value: value as string,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}));

export function emptyPreferencesForm(): PreferencesForm {
  return {
    arrangements: [],
    maxOfficeDays: "",
    salaryAmount: "",
    salaryCurrency: "USD",
    salaryPeriod: "year",
    seniorityMin: "",
    seniorityMax: "",
    locations: "",
    needsSponsorship: false,
  };
}

export function formFromPreferences(preferences: Preferences | null | undefined): PreferencesForm {
  const form = emptyPreferencesForm();
  if (!preferences) return form;
  return {
    arrangements: preferences.arrangements ?? [],
    maxOfficeDays:
      preferences.maxOfficeDays === undefined ? "" : String(preferences.maxOfficeDays),
    salaryAmount: preferences.minSalary ? String(preferences.minSalary.amount) : "",
    salaryCurrency: preferences.minSalary?.currency ?? form.salaryCurrency,
    salaryPeriod: preferences.minSalary?.period ?? form.salaryPeriod,
    seniorityMin: preferences.seniority?.min ?? "",
    seniorityMax: preferences.seniority?.max ?? "",
    locations: (preferences.locations ?? []).join("\n"),
    needsSponsorship: preferences.needsSponsorship === true,
  };
}

/**
 * `preferences: null` means nothing is set, which the client sends to clear
 * stored preferences. A message in `error` means the form can't be saved.
 */
export function preferencesFromForm(form: PreferencesForm): {
  preferences?: Preferences | null;
  error?: string;
} {
  const preferences: Preferences = {};
  if (form.arrangements.length > 0) preferences.arrangements = form.arrangements;
  if (form.maxOfficeDays !== "") preferences.maxOfficeDays = Number(form.maxOfficeDays);

  if (form.salaryAmount.trim() !== "") {
    const amount = Number(form.salaryAmount);
    const currency = form.salaryCurrency.trim().toUpperCase();
    if (!Number.isFinite(amount) || amount <= 0) {
      return { error: "Minimum salary must be a positive number." };
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      return { error: "Salary currency must be a three-letter code such as USD." };
    }
    preferences.minSalary = { amount, currency, period: form.salaryPeriod };
  }

  if (form.seniorityMin || form.seniorityMax) {
    const seniority: NonNullable<Preferences["seniority"]> = {};
    if (form.seniorityMin) seniority.min = form.seniorityMin as never;
    if (form.seniorityMax) seniority.max = form.seniorityMax as never;
    preferences.seniority = seniority;
  }

  const locations = form.locations
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (locations.length > 0) preferences.locations = locations;
  if (form.needsSponsorship) preferences.needsSponsorship = true;

  if (!isPreferences(preferences)) {
    return { error: "Minimum seniority can't be above maximum seniority." };
  }
  return { preferences: Object.keys(preferences).length === 0 ? null : preferences };
}

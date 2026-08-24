export interface CustomFilterCriteria {
  minVotes: string;
  minScore: string;
  yearFrom: string;
  yearTo: string;
  maxGuesses: string;
}

const STORAGE_KEY = 'csgofriberg.custom-filter';

export const EMPTY_CUSTOM_FILTER: CustomFilterCriteria = {
  minVotes: '',
  minScore: '',
  yearFrom: '',
  yearTo: '',
  maxGuesses: '',
};

export function getStoredCustomFilter(): CustomFilterCriteria {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_CUSTOM_FILTER;
    const parsed = JSON.parse(raw) as Partial<CustomFilterCriteria>;
    return {
      minVotes: typeof parsed.minVotes === 'string' ? parsed.minVotes : '',
      minScore: typeof parsed.minScore === 'string' ? parsed.minScore : '',
      yearFrom: typeof parsed.yearFrom === 'string' ? parsed.yearFrom : '',
      yearTo: typeof parsed.yearTo === 'string' ? parsed.yearTo : '',
      maxGuesses: typeof parsed.maxGuesses === 'string' ? parsed.maxGuesses : '',
    };
  } catch {
    return EMPTY_CUSTOM_FILTER;
  }
}

export function setStoredCustomFilter(value: CustomFilterCriteria): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in strict privacy modes.
  }
}

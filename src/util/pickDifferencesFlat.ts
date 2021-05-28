import { assignEntry } from './assignEntry';

// checks an object against a reference object and returns a new object containing only differences in direct descendents (one way!)
export const pickDifferencesFlat = <T extends Record<string, any>>(part: Partial<T>, full: T): Partial<T> =>
	Object.entries(part)
		.filter(([key, value]) => value !== full[key])
		.reduce(assignEntry, {});
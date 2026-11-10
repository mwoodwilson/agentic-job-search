// The competencies files are updated once a day, not after every run that adds postings (each update is a paid
// Claude step). Archives that grow wait in data/competencies.json until the day's first run.

// YYYY-MM-DD in this Mac's time zone (a 9 PM run is still that day).
export const localDay = (date = new Date(), timeZone) => date.toLocaleDateString("en-CA", { timeZone });

// state: { last: "YYYY-MM-DD" of the last update, pending: role families waiting } (or null).
// Returns the families to update now ([] if none) and the waiting list to save if this run doesn't update.
export function competenciesPlan(state, today, grew = []) {
  const pending = [...new Set([...(state?.pending || []), ...grew])];
  const due = pending.length > 0 && state?.last !== today;
  return { files: due ? pending : [], pending };
}

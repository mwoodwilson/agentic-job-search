#!/usr/bin/env node
// Finds a company's job board from an address on its careers site and checks the board answers.
//   node scripts/find-board.mjs <careers URL> [company name]
// Prints the board type, the board name (slug) and how many roles are open, then the line to paste into
// search.companies in config/preferences.json. /setup uses it for every company you add.
// The address must be one on the job board itself (click any job on the careers page and copy that address).
import { fetchCompany } from "./job-pull.mjs";
import { isMain } from "./lib/entry.mjs";

const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

// Which board an address belongs to: { ats, slug }, or null when it isn't one of the supported boards.
// Greenhouse, Lever, Ashby, Gem and Workday addresses all carry the board name; a company's own careers page doesn't.
export function parseBoardUrl(url) {
  if (typeof url !== "string") return null;
  let text = url.trim();
  if (!text || /\s/.test(text)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = "https://" + text;
  let u;
  try { u = new URL(text); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean).map(decode);
  const board = (ats, slug) => (slug ? { ats, slug } : null);

  if (/^(job-boards|boards)(\.eu)?\.greenhouse\.io$/.test(host)) {
    return board("greenhouse", parts[0] === "embed" ? u.searchParams.get("for") : parts[0]);
  }
  if (/^jobs(\.eu)?\.lever\.co$/.test(host)) return board("lever", parts[0]);
  if (host === "jobs.ashbyhq.com") return board("ashby", parts[0]);
  if (host === "jobs.gem.com") return board("gem", parts[0]);

  const workday = host.match(/^([a-z0-9-]+(?:\.wd\d+)?)\.myworkdayjobs\.com$/);
  if (workday) {
    // The first part of the path can be a language, like en-US; the next one is the site.
    const site = /^[a-z]{2}(-[A-Z]{2})?$/.test(parts[0] ?? "") ? parts[1] : parts[0];
    return board("workday", site ? `${workday[1]}/${site}` : "");
  }
  return null;
}

// A readable company name from a board name: "acme-corp" gives "Acme Corp"; a Workday board
// "acme.wd5/Acme_Careers" gives "Acme".
export function companyNameFromSlug(slug) {
  const base = String(slug).split("/")[0].split(".")[0];
  return base.split(/[\s_-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

const NOT_A_BOARD = "That address isn't on a job board I can read. Click any job on the company's careers page and use that address: it should be on greenhouse.io, lever.co, ashbyhq.com, gem.com or myworkdayjobs.com.";

// Checks the board behind an address. Returns { ok: true, ats, slug, open, entry } (entry is the line for
// search.companies; nameGuessed is true when no name was given) or { ok: false, message }.
// fetcher: how a board is read (tests give a stand-in for fetchCompany).
export async function findBoard(url, name, fetcher = fetchCompany) {
  const parsed = parseBoardUrl(url);
  if (!parsed) return { ok: false, message: NOT_A_BOARD };

  // Only the open-role count matters here, so every posting counts as already known: no posting's details are opened.
  const known = { has: () => true };
  const check = async (ats) => (await fetcher({ name: "board check", ats, slug: parsed.slug }, known, {}))?.open ?? null;

  let found = null;
  try {
    const open = await check(parsed.ats);
    if (open !== null) found = { ats: parsed.ats, open };
    // Some Ashby boards turn their API off but still list jobs on their hosted page.
    if (parsed.ats === "ashby" && (found === null || found.open === 0)) {
      const pageOpen = await check("ashby-page").catch(() => null);
      if (pageOpen !== null && (found === null || pageOpen > found.open)) found = { ats: "ashby-page", open: pageOpen };
    }
  } catch (err) {
    return { ok: false, message: `Couldn't check the board: ${err.message}. Try again in a minute.` };
  }
  if (!found) {
    return { ok: false, message: `No job board answered for "${parsed.slug}" on ${parsed.ats}. Check the address, or click a job on the careers page and use that address.` };
  }

  const given = typeof name === "string" ? name.trim() : "";
  const entry = { name: given || companyNameFromSlug(parsed.slug), ats: found.ats, slug: parsed.slug };
  return { ok: true, ats: found.ats, slug: parsed.slug, open: found.open, entry, ...(given ? {} : { nameGuessed: true }) };
}

const entryLine = (e) => `{ ${Object.entries(e).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ")} }`;

if (isMain(import.meta.url)) {
  const [url, ...nameWords] = process.argv.slice(2);
  if (!url) {
    console.log("Usage: node scripts/find-board.mjs <address of a job on the company's job board> [company name]");
    process.exit(1);
  }
  const r = await findBoard(url, nameWords.join(" "));
  if (!r.ok) {
    console.log(`✗ ${r.message}`);
    process.exit(1);
  }
  console.log(`Board type: ${r.ats}`);
  console.log(`Slug: ${r.slug}`);
  console.log(`Open roles: ${r.open}`);
  if (r.open === 0) console.log("This board has no open roles right now. You can still add it: new roles are picked up when they appear.");
  if (r.nameGuessed) console.log("The company name was guessed from the address. To change it, run this again with the name after the address.");
  console.log("Add this line to search.companies in config/preferences.json:");
  console.log(entryLine(r.entry));
}

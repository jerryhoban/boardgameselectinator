// Cloudflare Worker — serves the app's static files AND its live-lookup API
// from one script, at one address.
//
// Why this file exists (instead of the functions/api/collection.js approach
// this project started with): that approach only auto-wires up as an API
// route on Cloudflare's older "Pages" product. When this project was
// connected to GitHub through Cloudflare's current dashboard, it was created
// as a plain "Worker with static assets" instead — which uses this
// single-entry-point pattern rather than a functions/ folder. This file does
// the same job: it holds the BGG API token (via the BGG_TOKEN secret, set in
// the dashboard — never in this file), and answers /api/collection requests,
// while handing every other request off to the static files (index.html and
// friends) via the ASSETS binding declared in wrangler.jsonc.
//
// Flow for a collection lookup:
//   1. GET https://boardgamegeek.com/xmlapi2/collection?username=X&own=1&excludesubtype=boardgameexpansion
//      -> gives us the list of game IDs this person owns (BGG can return 202
//         "still compiling" the first time a collection is requested, so we
//         poll briefly).
//   2. GET https://boardgamegeek.com/xmlapi2/thing?id=1,2,3...&stats=1 (batched,
//      20 ids at a time) -> gives us each game's real BGG data: rating,
//      complexity, mechanics, categories, player-count poll, image, etc.
//   3. Reshape that into the same JSON shape the frontend already expects,
//      so the page's existing rendering/filtering code doesn't need to change.

const BGG_BASE = 'https://boardgamegeek.com';
const CHUNK_SIZE = 20;
const COLLECTION_POLL_ATTEMPTS = 6;
const COLLECTION_POLL_DELAY_MS = 2000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/collection') {
      if (request.method !== 'GET') {
        return jsonResponse({ error: 'Method not allowed.' }, 405);
      }
      return handleCollection(url, env);
    }

    // Everything else (index.html, and any other static file) is served by
    // the "assets" binding Cloudflare sets up from wrangler.jsonc.
    return env.ASSETS.fetch(request);
  },
};

async function handleCollection(url, env) {
  const username = (url.searchParams.get('username') || '').trim();

  if (!username) {
    return jsonResponse({ error: 'Enter a BoardGameGeek username.' }, 400);
  }
  const token = env.BGG_TOKEN;
  if (!token) {
    return jsonResponse(
      { error: 'Server is missing its BGG_TOKEN secret. Set it in the Worker’s Settings > Variables and Secrets.' },
      500
    );
  }

  try {
    const ids = await fetchOwnedGameIds(username, token);
    if (ids.length === 0) {
      return jsonResponse({
        username,
        games: [],
        note: 'No owned, non-expansion games found for that username (or the collection is private).',
      });
    }
    const games = await fetchGameDetails(ids, token);
    return jsonResponse({ username, games });
  } catch (err) {
    return jsonResponse({ error: err && err.message ? err.message : String(err) }, 502);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Same-origin page calling its own Worker — no CORS needed, but
      // harmless to allow in case this endpoint is ever called from
      // elsewhere during testing.
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bggFetch(path, token) {
  return fetch(`${BGG_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function fetchOwnedGameIds(username, token) {
  const path = `/xmlapi2/collection?username=${encodeURIComponent(
    username
  )}&own=1&excludesubtype=boardgameexpansion`;

  for (let attempt = 0; attempt < COLLECTION_POLL_ATTEMPTS; attempt++) {
    const res = await bggFetch(path, token);

    if (res.status === 200) {
      const xml = await res.text();
      return extractCollectionIds(xml);
    }
    if (res.status === 202) {
      // BGG is compiling this user's collection for the first time. Wait
      // and try again rather than surfacing a broken result.
      await sleep(COLLECTION_POLL_DELAY_MS);
      continue;
    }
    if (res.status === 404) {
      throw new Error(`BoardGameGeek has no user named "${username}".`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error('BGG rejected the request — the API token may be missing or invalid.');
    }
    throw new Error(`BGG collection lookup failed (status ${res.status}).`);
  }
  throw new Error('BGG is still preparing that collection. Please try again in a few seconds.');
}

async function fetchGameDetails(ids, token) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + CHUNK_SIZE));
  }

  const games = [];
  for (const chunk of chunks) {
    const path = `/xmlapi2/thing?id=${chunk.join(',')}&stats=1`;
    const res = await bggFetch(path, token);
    if (res.status !== 200) {
      throw new Error(`BGG game-detail lookup failed (status ${res.status}).`);
    }
    const xml = await res.text();
    for (const itemXml of splitItems(xml)) {
      const game = parseThingItem(itemXml);
      if (game) games.push(game);
    }
  }
  // Keep the "highest rated first" ordering the app has always used.
  games.sort((a, b) => (b.r || 0) - (a.r || 0));
  return games;
}

// ---- Minimal, targeted XML extraction -------------------------------------
// Cloudflare's Workers runtime has no DOMParser, and BGG's XML schema has
// been stable for well over a decade, so plain regexes over known, simple
// attribute patterns are more practical here than hand-rolling (or trying to
// bundle) a full XML parser with no build step. Every extractor fails soft
// (returns null/empty) rather than throwing, so one unexpected tag never
// takes down the whole batch.

function splitItems(xml) {
  const items = [];
  const re = /<item\b[^>]*>[\s\S]*?<\/item>/g;
  let m;
  while ((m = re.exec(xml))) items.push(m[0]);
  return items;
}

// The collection endpoint returns one <item ... objectid="1234" ...> per
// owned game (we've already asked it to exclude expansions). We just need
// the numeric ids so we can batch-fetch full details from /thing.
function extractCollectionIds(xml) {
  const ids = [];
  const re = /<item\b[^>]*\bobjectid="(\d+)"/g;
  let m;
  while ((m = re.exec(xml))) ids.push(m[1]);
  return ids;
}

function attr(xml, tag, attrName) {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attrName}="([^"]*)"[^>]*/?>`, 'i');
  const m = xml.match(re);
  return m ? decodeXmlEntities(m[1]) : null;
}

function tagText(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([^<]*)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? decodeXmlEntities(m[1]) : null;
}

function allLinkValues(xml, linkType) {
  const re = new RegExp(`<link\\s+type="${linkType}"[^>]*\\bvalue="([^"]*)"`, 'g');
  const values = [];
  let m;
  while ((m = re.exec(xml))) values.push(decodeXmlEntities(m[1]));
  return values;
}

function decodeXmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function toNum(str, fallback = null) {
  if (str === null || str === undefined || str === '') return fallback;
  const n = Number(str);
  return Number.isFinite(n) ? n : fallback;
}

// BGG's "suggested_numplayers" poll -> our 7-slot [1,2,3,4,5,6,'7+'] array of
// 0 (Not Recommended / no data), 1 (Recommended), 2 (Best), matching the
// scale the app has used since the spreadsheet-based version.
function parsePlayerCountPoll(xml) {
  const cat = [0, 0, 0, 0, 0, 0, 0];
  const pollMatch = xml.match(/<poll\s+name="suggested_numplayers"[\s\S]*?<\/poll>/i);
  if (!pollMatch) return cat;
  const pollXml = pollMatch[0];

  const resultsRe = /<results\s+numplayers="([^"]*)">([\s\S]*?)<\/results>/g;
  let m;
  while ((m = resultsRe.exec(pollXml))) {
    const label = m[1].trim();
    const block = m[2];
    const idx = playerCountLabelToIndex(label);
    if (idx === null) continue;

    const votes = { Best: 0, Recommended: 0, 'Not Recommended': 0 };
    const voteRe = /<result\s+value="(Best|Recommended|Not Recommended)"\s+numvotes="(\d+)"/g;
    let vm;
    while ((vm = voteRe.exec(block))) {
      votes[vm[1]] = parseInt(vm[2], 10);
    }
    if (votes.Best === 0 && votes.Recommended === 0 && votes['Not Recommended'] === 0) continue;

    if (votes.Best >= votes.Recommended && votes.Best >= votes['Not Recommended']) {
      cat[idx] = 2;
    } else if (votes.Recommended >= votes['Not Recommended']) {
      cat[idx] = 1;
    } else {
      cat[idx] = 0;
    }
  }
  return cat;
}

function playerCountLabelToIndex(label) {
  // "1".."6" -> 0..5 ; anything with a '+' (e.g. "6+", "7+") -> the last slot.
  if (label.includes('+')) return 6;
  const n = parseInt(label, 10);
  if (!Number.isFinite(n)) return null;
  if (n >= 7) return 6;
  if (n >= 1) return n - 1;
  return null;
}

function parseRecommendedAge(xml) {
  const pollMatch = xml.match(/<poll\s+name="suggested_playerage"[\s\S]*?<\/poll>/i);
  if (!pollMatch) return null;
  const pollXml = pollMatch[0];
  let best = null;
  let bestVotes = -1;
  const re = /<result\s+value="([^"]*)"\s+numvotes="(\d+)"/g;
  let m;
  while ((m = re.exec(pollXml))) {
    const votes = parseInt(m[2], 10);
    if (votes > bestVotes) {
      bestVotes = votes;
      best = m[1];
    }
  }
  if (best === null || bestVotes <= 0) return null;
  const n = parseInt(best, 10);
  return Number.isFinite(n) ? n : null;
}

function complexityBucket(weight) {
  if (weight === null || weight <= 0) return null;
  if (weight < 2) return 'Light';
  if (weight <= 3) return 'Intermediate';
  return 'Heavy';
}

function parseThingItem(itemXml) {
  try {
    const id = attr(itemXml, 'item', 'id');
    if (!id) return null;

    const primaryNameMatch = itemXml.match(/<name\s+type="primary"[^>]*\bvalue="([^"]*)"/i);
    const name = primaryNameMatch ? decodeXmlEntities(primaryNameMatch[1]) : tagText(itemXml, 'name');
    const image = tagText(itemXml, 'image');
    const minplayers = toNum(attr(itemXml, 'minplayers', 'value'));
    const maxplayers = toNum(attr(itemXml, 'maxplayers', 'value'));
    const minplaytime = toNum(attr(itemXml, 'minplaytime', 'value'));
    const maxplaytime = toNum(attr(itemXml, 'maxplaytime', 'value'));
    const playingtime = toNum(attr(itemXml, 'playingtime', 'value'));
    const minage = toNum(attr(itemXml, 'minage', 'value'));

    const statsMatch = itemXml.match(/<statistics\b[\s\S]*?<\/statistics>/i);
    const statsXml = statsMatch ? statsMatch[0] : '';
    const average = toNum(attr(statsXml, 'average', 'value'), 0);
    const averageweight = toNum(attr(statsXml, 'averageweight', 'value'), 0);

    const mechanics = allLinkValues(itemXml, 'boardgamemechanic');
    const categories = allLinkValues(itemXml, 'boardgamecategory');
    const isCooperative = categories.some((c) => /cooperative game/i.test(c));

    const pavgSource =
      minplaytime && maxplaytime ? (minplaytime + maxplaytime) / 2 : playingtime || minplaytime || maxplaytime || null;

    return {
      n: name || `Game #${id}`,
      link: `https://boardgamegeek.com/boardgame/${id}`,
      image: image || null,
      r: average,
      cat: parsePlayerCountPoll(itemXml),
      type: isCooperative ? 'Cooperative' : 'Competitive',
      pmin: minplayers,
      pmax: maxplayers,
      pavg: pavgSource !== null ? Math.round(pavgSource) : null,
      w: averageweight,
      cx: complexityBucket(averageweight),
      mech: mechanics,
      theme: categories.filter((c) => !/cooperative game/i.test(c)),
      age: parseRecommendedAge(itemXml) || minage || null,
      curated: true,
    };
  } catch (e) {
    // One malformed item shouldn't take down the whole collection.
    return null;
  }
}

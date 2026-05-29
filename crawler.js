const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const VIDEO_EXTS = /\.(mp4|mkv|avi|mov|m4v|wmv)$/i;
const SKIP_NAMES = ['../', '/', 'Subs/', 'subs/'];

const SERVERS = [
  {
    id: 'infobase',
    name: 'Infobase',
    base: 'http://103.225.94.27/Infobase',
    type: 'flat',
    roots: ['hdd-1/', 'hdd-2/', 'hdd-3/', 'hdd-4/', 'hdd-5/']
  },
  {
    id: 'fmftp',
    name: 'FmFtp',
    base: 'http://fmftp.net/data/disk-1/movies',
    type: 'deep',
    roots: ['123/', 'animation/', 'bollywood/', 'fm/', 'foreigner%20movie/',
            'hindidub/', 'hollywood/', 'horror/', 'indianbangla/', 'korean/',
            'new/', 'pakisthani/', 'tamil/', 'thai/', 'turkish/']
  }
];

const MAX_CONCURRENT = 5;
let active = 0;
const queue = [];
function schedule(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    tick();
  });
}
function tick() {
  if (active >= MAX_CONCURRENT || queue.length === 0) return;
  const { fn, resolve, reject } = queue.shift();
  active++;
  fn().then(r => { active--; resolve(r); tick(); })
      .catch(e => { active--; reject(e); tick(); });
}

async function listDir(url) {
  try {
    const res = await schedule(() => axios.get(url, { timeout: 8000 }));
    const $ = cheerio.load(res.data);
    const links = [];
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !SKIP_NAMES.includes(href) && !href.startsWith('?') && !href.startsWith('/Infobase')) {
        links.push(href);
      }
    });
    return links;
  } catch (e) {
    console.error(`Failed: ${url} — ${e.message}`);
    return [];
  }
}

function isVideo(href) {
  try { return VIDEO_EXTS.test(decodeURIComponent(href)); }
  catch(e) { return VIDEO_EXTS.test(href); }
}
function isDir(href) { return href.endsWith('/'); }

function parseTitle(filename) {
  let decoded;
  try { decoded = decodeURIComponent(filename); } catch(e) { decoded = filename; }
  let name = decoded.replace(VIDEO_EXTS, '');
  const yearMatch = name.match(/[.([ ]?(19|20)\d{2}[.) \]]/);
  const year = yearMatch ? yearMatch[0].replace(/[^0-9]/g, '') : null;
  let title = yearMatch ? name.slice(0, name.indexOf(yearMatch[0])) : name;
  title = title.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
  return { title, year };
}

function getProgressFile(serverId) {
  return path.join(__dirname, `progress-${serverId}.json`);
}

function loadProgress(serverId) {
  try {
    const f = getProgressFile(serverId);
    if (fs.existsSync(f)) {
      const data = JSON.parse(fs.readFileSync(f, 'utf8'));
      console.log(`  Resuming ${serverId} (${data.movies.length} movies cached)`);
      return data.movies;
    }
  } catch(e) {}
  return null;
}

function saveProgress(serverId, movies) {
  try {
    fs.writeFileSync(getProgressFile(serverId), JSON.stringify({ movies }, null, 2));
  } catch(e) {}
}

function clearProgress(serverId) {
  try { fs.unlinkSync(getProgressFile(serverId)); } catch(e) {}
}

async function crawlFlat(server) {
  const saved = loadProgress(server.id);
  if (saved) return saved;
  const movies = [];
  for (const root of server.roots) {
    const rootUrl = `${server.base}/${root}`;
    const entries = await listDir(rootUrl);
    for (const entry of entries) {
      if (isVideo(entry)) {
        const { title, year } = parseTitle(entry);
        movies.push({ server: server.id, title, year, url: `${rootUrl}${entry}`, filename: decodeURIComponent(entry) });
      } else if (isDir(entry)) {
        const subUrl = `${rootUrl}${entry}`;
        const files = await listDir(subUrl);
        for (const file of files) {
          if (isVideo(file)) {
            const { title, year } = parseTitle(file);
            movies.push({ server: server.id, title, year, url: `${subUrl}${file}`, filename: decodeURIComponent(file) });
          }
        }
      }
    }
  }
  saveProgress(server.id, movies);
  return movies;
}

async function crawlDeep(server, url, depth = 0, movies = []) {
  if (depth > 3) return movies;
  const entries = await listDir(url);
  for (const entry of entries) {
    if (isVideo(entry)) {
      const { title, year } = parseTitle(entry);
      let filename;
      try { filename = decodeURIComponent(entry); } catch(e) { filename = entry; }
      movies.push({ server: server.id, title, year, url: `${url}${entry}`, filename });
    } else if (isDir(entry)) {
      await crawlDeep(server, `${url}${entry}`, depth + 1, movies);
    }
  }
  return movies;
}

async function crawl() {
  console.log('Starting crawl...');
  let all = [];

  for (const server of SERVERS) {
    console.log(`Crawling ${server.name}...`);
    let movies = [];

    if (server.type === 'flat') {
      movies = await crawlFlat(server);
    } else {
      for (const root of server.roots) {
        const rootId = `${server.id}-${root.replace(/[^a-z0-9]/gi, '')}`;
        const saved = loadProgress(rootId);
        if (saved) {
          console.log(`  Skipping ${root} (cached)`);
          movies = movies.concat(saved);
          continue;
        }
        const rootUrl = `${server.base}/${root}`;
        console.log(`  Scanning ${rootUrl}`);
        const rootMovies = [];
        await crawlDeep(server, rootUrl, 0, rootMovies);
        saveProgress(rootId, rootMovies);
        movies = movies.concat(rootMovies);
        console.log(`  Saved ${rootMovies.length} from ${root}`);
      }
    }

    console.log(`  Found ${movies.length} movies from ${server.name}`);
    all = all.concat(movies);
  }

  for (const server of SERVERS) {
    clearProgress(server.id);
    for (const root of server.roots) {
      const rootId = `${server.id}-${root.replace(/[^a-z0-9]/gi, '')}`;
      clearProgress(rootId);
    }
  }

  console.log(`Total: ${all.length} movies`);
  return all;
}

module.exports = { crawl, parseTitle };

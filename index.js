const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { crawl } = require('./crawler');

const CACHE_FILE = path.join(__dirname, 'cache.json');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 6 hours
const PORT = process.env.PORT || 7050;

const manifest = {
  id: 'org.infobase.movies',
  version: '1.0.0',
  name: 'Infobase Movies',
  description: 'Stream classic and free movies from Infobase server',
  types: ['movie'],
  catalogs: [
    {
      type: 'movie',
      id: 'infobase-catalog',
      name: 'Infobase',
      extra: [{ name: 'search', isRequired: false }]
    }
  ],
  resources: ['catalog', 'stream'],
  idPrefixes: ['tt']
};

const builder = new addonBuilder(manifest);

// --- Cache helpers ---
function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (Date.now() - data.timestamp < CACHE_TTL) {
        console.log(`Loaded ${data.movies.length} movies from cache`);
        return data.movies;
      }
    }
  } catch (e) {
    console.error('Cache load error:', e.message);
  }
  return null;
}

function saveCache(movies) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ timestamp: Date.now(), movies }, null, 2));
    console.log(`Saved ${movies.length} movies to cache`);
  } catch (e) {
    console.error('Cache save error:', e.message);
  }
}

// --- Movie list ---
let movieList = [];

async function getMovies() {
  if (movieList.length > 0) return movieList;
  const cached = loadCache();
  if (cached) { movieList = cached; return movieList; }
  movieList = await crawl();
  saveCache(movieList);
  return movieList;
}

// --- Cinemeta lookup ---
async function searchCinemeta(title, year) {
  try {
    const query = encodeURIComponent(title);
    const url = `https://v3-cinemeta.strem.io/catalog/movie/top/search=${query}.json`;
    const res = await axios.get(url, { timeout: 8000 });
    const metas = res.data.metas || [];
    // Try to match by year if available
    if (year) {
      const match = metas.find(m => m.releaseInfo && m.releaseInfo.includes(year));
      if (match) return match;
    }
    return metas[0] || null;
  } catch (e) {
    return null;
  }
}

// --- Catalog handler ---
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (type !== 'movie' || id !== 'infobase-catalog') return { metas: [] };

  const movies = await getMovies();
  const search = extra && extra.search ? extra.search.toLowerCase() : null;

  let filtered = movies;
  if (search) {
    filtered = movies.filter(m => m.title.toLowerCase().includes(search));
  }

  // Return basic metas (no IMDB lookup for catalog, too slow)
  const metas = filtered.slice(0, 100).map((m) => ({
    id: `movie:${movieList.indexOf(m)}`,
    type: 'movie',
    name: m.title,
    year: m.year || '',
    poster: null,
    description: m.filename
  }));

  return { metas };
});

// --- Stream handler ---
builder.defineStreamHandler(async ({ type, id }) => {
  if (type !== 'movie') return { streams: [] };

  const movies = await getMovies();

  // If infobase internal id
  if (id.startsWith('movie:')) {
    const index = parseInt(id.split(':')[1]);
    const movie = movies[index];
    if (!movie) return { streams: [] };
    return {
      streams: [{
        url: movie.url,
        title: `${movie.server === 'fmftp' ? 'FmFtp' : 'Infobase'}\n${movie.filename}`,
        behaviorHints: { notWebReady: false }
      }]
    };
  }

  // If IMDB id (tt...), try to match by title
  if (id.startsWith('tt')) {
    try {
      const meta = await axios.get(`https://v3-cinemeta.strem.io/meta/movie/${id}.json`, { timeout: 8000 });
      const name = meta.data.meta.name.toLowerCase();
      const year = meta.data.meta.releaseInfo;
      const match = movies.find(m =>
        m.title.toLowerCase().includes(name) ||
        name.includes(m.title.toLowerCase())
      );
      if (match) {
        return {
          streams: [{
            url: match.url,
            title: `Infobase\n${match.filename}`,
            behaviorHints: { notWebReady: false }
          }]
        };
      }
    } catch (e) {
      console.error('IMDB lookup error:', e.message);
    }
  }

  return { streams: [] };
});

// --- Start ---
getMovies().then(() => {
  serveHTTP(builder.getInterface(), { port: PORT });
  console.log(`Infobase addon running on http://localhost:${PORT}`);
});

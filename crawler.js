const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'http://103.225.94.27/Infobase';
const HDD_FOLDERS = ['hdd-1', 'hdd-2', 'hdd-3', 'hdd-4', 'hdd-5'];

async function listDir(url) {
  try {
    const res = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(res.data);
    const links = [];
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (href && href !== '../' && href !== '/') {
        links.push(href);
      }
    });
    return links;
  } catch (e) {
    console.error(`Failed to list ${url}:`, e.message);
    return [];
  }
}

function parseTitle(filename) {
  // Remove extension
  let name = filename.replace(/\.[a-z0-9]{2,4}$/i, '');
  // Extract year
  const yearMatch = name.match(/[.(]?(19|20)\d{2}[.)]/);
  const year = yearMatch ? yearMatch[0].replace(/[^0-9]/g, '') : null;
  // Clean title: take everything before the year
  let title = name;
  if (yearMatch) {
    title = name.slice(0, name.indexOf(yearMatch[0]));
  }
  // Replace dots/underscores with spaces
  title = title.replace(/[._]/g, ' ').trim();
  return { title, year };
}

function isVideoFile(href) {
  return /\.(mp4|mkv|avi|mov|m4v|wmv)$/i.test(href);
}

async function crawl() {
  console.log('Starting crawl...');
  const movies = [];

  for (const hdd of HDD_FOLDERS) {
    const hddUrl = `${BASE_URL}/${hdd}/`;
    console.log(`Scanning ${hddUrl}`);
    const subDirs = await listDir(hddUrl);

    for (const sub of subDirs) {
      const subUrl = `${hddUrl}${sub}`;

      if (sub.endsWith('/')) {
        // It's a subfolder, go one level deeper
        const files = await listDir(subUrl);
        for (const file of files) {
          if (isVideoFile(file)) {
            const fileUrl = `${subUrl}${file}`;
            const decoded = decodeURIComponent(file);
            const { title, year } = parseTitle(decoded);
            movies.push({ title, year, url: fileUrl, filename: decoded });
          }
        }
      } else if (isVideoFile(sub)) {
        // File directly in hdd folder
        const fileUrl = `${hddUrl}${sub}`;
        const decoded = decodeURIComponent(sub);
        const { title, year } = parseTitle(decoded);
        movies.push({ title, year, url: fileUrl, filename: decoded });
      }
    }
  }

  console.log(`Crawl complete. Found ${movies.length} movies.`);
  return movies;
}

module.exports = { crawl, parseTitle };

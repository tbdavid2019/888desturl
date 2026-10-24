'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RAW_BASE_URL = 'https://raw.githubusercontent.com/enthec/webappanalyzer/main/src';
const TECH_FILES = [
  '_.json', 'a.json', 'b.json', 'c.json', 'd.json', 'e.json', 'f.json', 'g.json',
  'h.json', 'i.json', 'j.json', 'k.json', 'l.json', 'm.json', 'n.json', 'o.json',
  'p.json', 'q.json', 'r.json', 's.json', 't.json', 'u.json', 'v.json', 'w.json',
  'x.json', 'y.json', 'z.json'
];

function sanitizeTechEntry(tech) {
  const clean = {};
  if (tech.cats) clean.cats = tech.cats;
  if (tech.description) clean.description = tech.description;
  if (tech.headers) clean.headers = tech.headers;
  if (tech.cookies) clean.cookies = tech.cookies;
  if (tech.meta) clean.meta = tech.meta;

  const scriptSrc = [];
  if (tech.scriptSrc) {
    if (Array.isArray(tech.scriptSrc)) scriptSrc.push(...tech.scriptSrc);
    else if (typeof tech.scriptSrc === 'string') scriptSrc.push(tech.scriptSrc);
  }
  if (tech.scripts) {
    if (Array.isArray(tech.scripts)) scriptSrc.push(...tech.scripts);
    else if (typeof tech.scripts === 'string') scriptSrc.push(tech.scripts);
  }
  if (scriptSrc.length > 0) clean.scriptSrc = scriptSrc;

  if (tech.html) clean.html = tech.html;
  if (tech.dom) clean.dom = tech.dom;
  if (tech.js) clean.js = tech.js;
  if (tech.implies) clean.implies = tech.implies;
  if (tech.icon) clean.icon = tech.icon;
  if (tech.website) clean.website = tech.website;

  return clean;
}

async function loadFromLocal(localDir) {
  const categoriesPath = path.join(localDir, 'src', 'categories.json');
  const techDir = path.join(localDir, 'src', 'technologies');

  if (!fs.existsSync(categoriesPath) || !fs.existsSync(techDir)) {
    throw new Error(`Local directory does not contain src/categories.json or src/technologies: ${localDir}`);
  }

  const categories = JSON.parse(fs.readFileSync(categoriesPath, 'utf8'));
  const technologies = {};

  const files = fs.readdirSync(techDir).filter((file) => file.endsWith('.json')).sort();
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(techDir, file), 'utf8'));
    for (const [name, tech] of Object.entries(raw)) {
      technologies[name] = sanitizeTechEntry(tech);
    }
  }

  return { categories, technologies };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function loadFromRemote() {
  console.log('Fetching categories.json from GitHub...');
  const categories = await fetchJson(`${RAW_BASE_URL}/categories.json`);
  const technologies = {};

  console.log(`Fetching ${TECH_FILES.length} technology fingerprint files from GitHub...`);
  for (const file of TECH_FILES) {
    const url = `${RAW_BASE_URL}/technologies/${file}`;
    process.stdout.write(`  Fetching ${file}... `);
    const raw = await fetchJson(url);
    for (const [name, tech] of Object.entries(raw)) {
      technologies[name] = sanitizeTechEntry(tech);
    }
    console.log(`done (${Object.keys(raw).length} techs)`);
  }

  return { categories, technologies };
}

async function main() {
  const args = process.argv.slice(2);
  let localDir = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--local' && args[i + 1]) {
      localDir = args[i + 1];
      i++;
    }
  }

  if (!localDir && fs.existsSync('/tmp/webappanalyzer/src/categories.json')) {
    localDir = '/tmp/webappanalyzer';
  }

  let result;
  if (localDir) {
    console.log(`Compiling technology definitions from local directory: ${localDir}`);
    result = await loadFromLocal(localDir);
  } else {
    console.log('Compiling technology definitions from remote enthec/webappanalyzer repository...');
    result = await loadFromRemote();
  }

  const outDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outPath = path.join(outDir, 'technologies.json');
  const jsonContent = JSON.stringify(result);
  fs.writeFileSync(outPath, jsonContent, 'utf8');

  const stats = fs.statSync(outPath);
  console.log(`Successfully compiled ${Object.keys(result.technologies).length} technologies across ${Object.keys(result.categories).length} categories.`);
  console.log(`Saved to ${outPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB).`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Error updating technologies:', err);
    process.exit(1);
  });
}

module.exports = {
  sanitizeTechEntry,
  loadFromLocal,
  loadFromRemote
};

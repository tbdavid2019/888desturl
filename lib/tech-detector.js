'use strict';

const fs = require('node:fs');
const path = require('node:path');

let cachedDb = null;
let cachedIndexes = null;

function loadDatabase(customPath = null) {
  if (customPath) {
    const raw = fs.readFileSync(customPath, 'utf8');
    return JSON.parse(raw);
  }
  if (!cachedDb) {
    const dbPath = path.join(__dirname, '..', 'data', 'technologies.json');
    if (fs.existsSync(dbPath)) {
      const raw = fs.readFileSync(dbPath, 'utf8');
      cachedDb = JSON.parse(raw);
    } else {
      cachedDb = { categories: {}, technologies: {} };
    }
  }
  return cachedDb;
}

function parsePattern(rawPattern) {
  if (typeof rawPattern !== 'string' || !rawPattern) {
    return { regex: null, versionPattern: null, confidence: 100 };
  }

  const parts = rawPattern.split('\\;');
  const regexStr = parts[0];
  let versionPattern = null;
  let confidence = 100;

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith('version:')) {
      versionPattern = part.slice(8);
    } else if (part.startsWith('confidence:')) {
      const parsedConf = parseInt(part.slice(11), 10);
      if (!Number.isNaN(parsedConf)) {
        confidence = parsedConf;
      }
    }
  }

  let regex = null;
  if (regexStr) {
    try {
      regex = new RegExp(regexStr, 'i');
    } catch {
      regex = null;
    }
  }

  return { regex, versionPattern, confidence };
}

function resolveBackreferences(template, match) {
  if (!template || !match) {
    return template || '';
  }
  return template.replace(/\\(\d+)/g, (_, groupIdx) => {
    const idx = parseInt(groupIdx, 10);
    return (match[idx] !== undefined && match[idx] !== null) ? match[idx] : '';
  });
}

function evaluatePattern(patternObj, value) {
  if (!patternObj) {
    return null;
  }

  if (!patternObj.regex) {
    if (value !== undefined && value !== null) {
      return { match: true, version: null, confidence: patternObj.confidence };
    }
    return null;
  }

  if (value === undefined || value === null) {
    return null;
  }

  const match = patternObj.regex.exec(String(value));
  if (!match) {
    return null;
  }

  let version = null;
  if (patternObj.versionPattern) {
    const ternaryMatch = patternObj.versionPattern.match(/^\\(\d+)\?([^:]*):(.*)$/);
    if (ternaryMatch) {
      const groupIdx = parseInt(ternaryMatch[1], 10);
      const isTrue = Boolean(match[groupIdx]);
      version = isTrue ? ternaryMatch[2] : ternaryMatch[3];
      version = resolveBackreferences(version, match);
    } else {
      version = resolveBackreferences(patternObj.versionPattern, match);
    }
    version = version ? version.trim() : null;
    if (version === '') {
      version = null;
    }
  }

  return {
    match: true,
    version,
    confidence: patternObj.confidence
  };
}

function buildIndexes(db) {
  const technologies = (db && db.technologies) || {};
  const headerIndex = new Map();
  const cookieIndex = new Map();
  const metaIndex = new Map();
  const jsIndex = new Map();
  const scriptSrcList = [];
  const htmlList = [];
  const domList = [];
  const compiledDomRules = [];
  const allJsKeys = new Set();
  const allDomSelectors = new Set();

  for (const [techName, tech] of Object.entries(technologies)) {
    // 1. Headers index
    if (tech.headers && typeof tech.headers === 'object') {
      for (const [headerKey, rawPattern] of Object.entries(tech.headers)) {
        const lowerKey = headerKey.toLowerCase();
        if (!headerIndex.has(lowerKey)) {
          headerIndex.set(lowerKey, []);
        }
        headerIndex.get(lowerKey).push({
          techName,
          pattern: parsePattern(rawPattern)
        });
      }
    }

    // 2. Cookies index
    if (tech.cookies && typeof tech.cookies === 'object') {
      for (const [cookieKey, rawPattern] of Object.entries(tech.cookies)) {
        const lowerKey = cookieKey.toLowerCase();
        if (!cookieIndex.has(lowerKey)) {
          cookieIndex.set(lowerKey, []);
        }
        cookieIndex.get(lowerKey).push({
          techName,
          pattern: parsePattern(rawPattern)
        });
      }
    }

    // 3. Meta index
    if (tech.meta && typeof tech.meta === 'object') {
      for (const [metaKey, rawPattern] of Object.entries(tech.meta)) {
        const lowerKey = metaKey.toLowerCase();
        if (!metaIndex.has(lowerKey)) {
          metaIndex.set(lowerKey, []);
        }
        metaIndex.get(lowerKey).push({
          techName,
          pattern: parsePattern(rawPattern)
        });
      }
    }

    // 4. JS index
    if (tech.js && typeof tech.js === 'object') {
      for (const [jsKey, rawPattern] of Object.entries(tech.js)) {
        allJsKeys.add(jsKey);
        if (!jsIndex.has(jsKey)) {
          jsIndex.set(jsKey, []);
        }
        jsIndex.get(jsKey).push({
          techName,
          pattern: parsePattern(rawPattern)
        });
      }
    }

    // 5. ScriptSrc list
    if (tech.scriptSrc) {
      const arr = Array.isArray(tech.scriptSrc) ? tech.scriptSrc : [tech.scriptSrc];
      for (const rawPattern of arr) {
        if (typeof rawPattern === 'string') {
          scriptSrcList.push({
            techName,
            pattern: parsePattern(rawPattern)
          });
        }
      }
    }

    // 6. HTML list
    if (tech.html) {
      const arr = Array.isArray(tech.html) ? tech.html : [tech.html];
      for (const rawPattern of arr) {
        if (typeof rawPattern === 'string') {
          htmlList.push({
            techName,
            pattern: parsePattern(rawPattern)
          });
        }
      }
    }

    // 7. DOM list
    if (tech.dom) {
      if (Array.isArray(tech.dom)) {
        for (const selector of tech.dom) {
          if (typeof selector === 'string' && selector.trim()) {
            const trimmed = selector.trim();
            allDomSelectors.add(trimmed);
            domList.push({ techName, selector: trimmed, exists: true });
            compiledDomRules.push({ techName, selector: trimmed, exists: true, confidence: 100 });
          }
        }
      } else if (typeof tech.dom === 'object') {
        for (const [selector, subRule] of Object.entries(tech.dom)) {
          if (!selector || !selector.trim()) continue;
          const trimmed = selector.trim();
          allDomSelectors.add(trimmed);
          const entry = { techName, selector: trimmed };
          const compiled = { techName, selector: trimmed, confidence: 100 };

          if (!subRule || typeof subRule !== 'object' || Object.keys(subRule).length === 0 || subRule.exists !== undefined) {
            let conf = 100;
            let ver = null;
            if (subRule && subRule.exists && typeof subRule.exists === 'string') {
              const parsed = parsePattern(subRule.exists);
              if (parsed.confidence !== undefined) conf = parsed.confidence;
              ver = parsed.versionPattern || null;
            }
            entry.exists = true;
            compiled.exists = true;
            compiled.confidence = conf;
            compiled.version = ver;
          } else {
            let conf = 100;
            if (subRule.attributes && typeof subRule.attributes === 'object') {
              entry.attributes = {};
              compiled.attributes = {};
              for (const [attrName, rawPattern] of Object.entries(subRule.attributes)) {
                const parsed = parsePattern(rawPattern);
                if (parsed.confidence !== undefined && parsed.confidence < conf) conf = parsed.confidence;
                entry.attributes[attrName] = parsed;
                compiled.attributes[attrName] = {
                  regexStr: parsed.regex ? parsed.regex.source : (rawPattern ? rawPattern.split('\\;')[0] : null),
                  versionPattern: parsed.versionPattern
                };
              }
            }
            if (subRule.text) {
              const parsed = parsePattern(subRule.text);
              if (parsed.confidence !== undefined && parsed.confidence < conf) conf = parsed.confidence;
              entry.text = parsed;
              compiled.textRegexStr = parsed.regex ? parsed.regex.source : subRule.text.split('\\;')[0];
              compiled.textVersionPattern = parsed.versionPattern;
            }
            if (subRule.properties && typeof subRule.properties === 'object') {
              entry.properties = {};
              compiled.properties = {};
              for (const [propName, rawPattern] of Object.entries(subRule.properties)) {
                const parsed = parsePattern(rawPattern);
                if (parsed.confidence !== undefined && parsed.confidence < conf) conf = parsed.confidence;
                entry.properties[propName] = parsed;
                compiled.properties[propName] = {
                  regexStr: parsed.regex ? parsed.regex.source : (rawPattern ? rawPattern.split('\\;')[0] : null)
                };
              }
            }
            compiled.confidence = conf;
          }
          domList.push(entry);
          compiledDomRules.push(compiled);
        }
      }
    }
  }

  return {
    headerIndex,
    cookieIndex,
    metaIndex,
    jsIndex,
    scriptSrcList,
    htmlList,
    domList,
    compiledDomRules,
    allJsKeys: Array.from(allJsKeys),
    allDomSelectors: Array.from(allDomSelectors)
  };
}

function getIndexes(db) {
  if (db === cachedDb && cachedIndexes) {
    return cachedIndexes;
  }
  const indexes = buildIndexes(db);
  if (db === cachedDb) {
    cachedIndexes = indexes;
  }
  return indexes;
}

function mapCategories(catIds, categoriesMap) {
  if (!Array.isArray(catIds)) {
    return [];
  }
  return catIds.map((id) => {
    const cat = categoriesMap ? categoriesMap[String(id)] : null;
    return {
      id: Number(id),
      name: cat && cat.name ? cat.name : `Category ${id}`
    };
  });
}

function detectTechnologies(signals, customDb = null) {
  if (!signals || typeof signals !== 'object') {
    return [];
  }

  const db = customDb || loadDatabase();
  const categories = (db && db.categories) || {};
  const technologies = (db && db.technologies) || {};
  const indexes = getIndexes(db);

  const detected = new Map();

  function recordMatch(techName, matchResult) {
    const techDef = technologies[techName];
    if (!techDef) {
      return;
    }

    const existing = detected.get(techName);
    let version = existing ? existing.version : null;
    if (matchResult && matchResult.version) {
      if (!version) {
        version = matchResult.version;
      } else if (matchResult.version.length > version.length) {
        version = matchResult.version;
      }
    }

    const confidence = existing
      ? Math.min(100, Math.max(existing.confidence, (matchResult && matchResult.confidence) || 100))
      : ((matchResult && matchResult.confidence) || 100);

    detected.set(techName, {
      name: techName,
      version: version || null,
      confidence,
      categories: mapCategories(techDef.cats, categories),
      icon: techDef.icon || null,
      website: techDef.website || null,
      description: techDef.description || null
    });
  }

  // 1. Headers matching
  if (signals.headers && typeof signals.headers === 'object') {
    for (const [rawName, val] of Object.entries(signals.headers)) {
      if (val === null || val === undefined) continue;
      const lowerName = rawName.toLowerCase();
      const rules = indexes.headerIndex.get(lowerName);
      if (rules) {
        const strVal = Array.isArray(val) ? val.join(', ') : String(val);
        for (const rule of rules) {
          const res = evaluatePattern(rule.pattern, strVal);
          if (res && res.match) {
            recordMatch(rule.techName, res);
          }
        }
      }
    }
  }

  // 2. Cookies matching
  if (signals.cookies) {
    let cookieMap = {};
    if (Array.isArray(signals.cookies)) {
      for (const c of signals.cookies) {
        if (c && c.name) {
          cookieMap[c.name.toLowerCase()] = c.value || '';
        }
      }
    } else if (typeof signals.cookies === 'object') {
      for (const [k, v] of Object.entries(signals.cookies)) {
        if (k) {
          cookieMap[k.toLowerCase()] = v !== null && v !== undefined ? String(v) : '';
        }
      }
    }

    for (const [cookieName, cookieVal] of Object.entries(cookieMap)) {
      const rules = indexes.cookieIndex.get(cookieName);
      if (rules) {
        for (const rule of rules) {
          const res = evaluatePattern(rule.pattern, cookieVal);
          if (res && res.match) {
            recordMatch(rule.techName, res);
          }
        }
      }
    }
  }

  // 3. Meta tags matching
  if (signals.meta) {
    const metaMap = new Map();
    const addMeta = (k, v) => {
      if (!k) return;
      const lower = k.toLowerCase();
      if (!metaMap.has(lower)) metaMap.set(lower, []);
      metaMap.get(lower).push(v != null ? String(v) : '');
    };

    if (Array.isArray(signals.meta)) {
      for (const item of signals.meta) {
        if (item) {
          const key = item.name || item.property || item.httpEquiv;
          addMeta(key, item.content);
        }
      }
    } else if (typeof signals.meta === 'object') {
      for (const [k, v] of Object.entries(signals.meta)) {
        if (Array.isArray(v)) {
          v.forEach((val) => addMeta(k, val));
        } else {
          addMeta(k, v);
        }
      }
    }

    for (const [metaKey, contents] of metaMap.entries()) {
      const rules = indexes.metaIndex.get(metaKey);
      if (rules) {
        for (const rule of rules) {
          for (const content of contents) {
            const res = evaluatePattern(rule.pattern, content);
            if (res && res.match) {
              recordMatch(rule.techName, res);
              break;
            }
          }
        }
      }
    }
  }

  // 4. ScriptSrc matching
  if (signals.scriptSrc) {
    const scriptSrcList = Array.isArray(signals.scriptSrc)
      ? signals.scriptSrc
      : [signals.scriptSrc];

    if (scriptSrcList.length > 0) {
      for (const rule of indexes.scriptSrcList) {
        for (const scriptUrl of scriptSrcList) {
          if (!scriptUrl) continue;
          const res = evaluatePattern(rule.pattern, scriptUrl);
          if (res && res.match) {
            recordMatch(rule.techName, res);
            break;
          }
        }
      }
    }
  }

  // 5. JS globals matching
  if (signals.js && typeof signals.js === 'object') {
    for (const [jsKey, val] of Object.entries(signals.js)) {
      if (val === undefined || val === null) continue;
      const rules = indexes.jsIndex.get(jsKey);
      if (rules) {
        for (const rule of rules) {
          const res = evaluatePattern(rule.pattern, val);
          if (res && res.match) {
            recordMatch(rule.techName, res);
          }
        }
      }
    }
  }

  // 6. HTML matching
  if (typeof signals.html === 'string' && signals.html.length > 0) {
    for (const rule of indexes.htmlList) {
      const res = evaluatePattern(rule.pattern, signals.html);
      if (res && res.match) {
        recordMatch(rule.techName, res);
      }
    }
  }

  // 7. DOM matching
  if (signals.dom) {
    if (Array.isArray(signals.dom)) {
      for (const item of signals.dom) {
        if (typeof item === 'object' && item && item.techName) {
          recordMatch(item.techName, { version: item.version || null, confidence: item.confidence || 100 });
        } else if (typeof item === 'string') {
          for (const rule of indexes.domList) {
            if (rule.selector === item && rule.exists) {
              recordMatch(rule.techName, { version: null, confidence: 100 });
            }
          }
        }
      }
    } else if (typeof signals.dom === 'object') {
      for (const [key] of Object.entries(signals.dom)) {
        for (const rule of indexes.domList) {
          if (rule.selector === key && rule.exists) {
            recordMatch(rule.techName, { version: null, confidence: 100 });
          }
        }
      }
    }
  }

  // 8. Recursive implies resolution
  const queue = Array.from(detected.keys());
  const visitedImplies = new Set(detected.keys());

  while (queue.length > 0) {
    const currentName = queue.shift();
    const currentDef = technologies[currentName];
    if (currentDef && currentDef.implies) {
      const rawImplies = Array.isArray(currentDef.implies)
        ? currentDef.implies
        : [currentDef.implies];

      for (const item of rawImplies) {
        if (typeof item !== 'string' || !item.trim()) continue;
        const parts = item.split('\\;');
        const impliedName = parts[0].trim();
        let impliedVersion = null;
        let impliedConfidence = 100;

        for (let i = 1; i < parts.length; i++) {
          const part = parts[i];
          if (part.startsWith('version:')) {
            impliedVersion = part.slice(8).trim() || null;
          } else if (part.startsWith('confidence:')) {
            const pConf = parseInt(part.slice(11), 10);
            if (!Number.isNaN(pConf)) impliedConfidence = pConf;
          }
        }

        if (technologies[impliedName]) {
          recordMatch(impliedName, {
            version: impliedVersion,
            confidence: impliedConfidence
          });
          if (!visitedImplies.has(impliedName)) {
            visitedImplies.add(impliedName);
            queue.push(impliedName);
          }
        }
      }
    }
  }

  // 9. Deduplicate and sort by confidence descending, then name alphabetically
  const results = Array.from(detected.values());
  results.sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }
    return a.name.localeCompare(b.name);
  });

  return results;
}

async function extractPageTechSignals(page, navigationResponses = [], context = null, customDb = null) {
  const headers = {};
  if (Array.isArray(navigationResponses)) {
    for (const resp of navigationResponses) {
      if (!resp) continue;
      let rawHeaders = null;
      if (typeof resp.headers === 'function') {
        try {
          rawHeaders = await resp.headers();
        } catch {}
      } else if (resp.headers && typeof resp.headers === 'object') {
        rawHeaders = resp.headers;
      }
      if (rawHeaders) {
        for (const [k, v] of Object.entries(rawHeaders)) {
          if (v !== undefined && v !== null) {
            headers[k.toLowerCase()] = String(v);
          }
        }
      }
    }
  }

  const cookies = {};
  if (context && typeof context.cookies === 'function') {
    try {
      const cookieList = await context.cookies();
      if (Array.isArray(cookieList)) {
        for (const c of cookieList) {
          if (c && c.name) {
            cookies[c.name] = c.value || '';
          }
        }
      }
    } catch {}
  }

  let pageSignals = { meta: [], scriptSrc: [], html: '', js: {}, dom: [] };
  if (page && typeof page.evaluate === 'function') {
    try {
      const db = customDb || loadDatabase();
      const indexes = getIndexes(db);
      // Probe all JS keys and DOM selectors for 100% fingerprint coverage
      const jsProbeList = indexes.allJsKeys;
      const domRules = indexes.compiledDomRules;

      pageSignals = await page.evaluate(
        ({ probeJsKeys, probeDomRules }) => {
          // 1. Meta tags
          const meta = [];
          try {
            const metaNodes = document.querySelectorAll('meta');
            for (const m of metaNodes) {
              const name =
                m.getAttribute('name') ||
                m.getAttribute('property') ||
                m.getAttribute('http-equiv') ||
                '';
              const content = m.getAttribute('content') || '';
              if (name || content) {
                meta.push({ name: name.toLowerCase(), content });
              }
            }
          } catch {}

          // 2. Script src tags
          const scriptSrc = [];
          try {
            const scriptNodes = document.querySelectorAll('script[src]');
            for (const s of scriptNodes) {
              const src = s.getAttribute('src');
              if (src) scriptSrc.push(src);
            }
          } catch {}

          // 3. HTML snippet
          let html = '';
          try {
            html = document.documentElement
              ? document.documentElement.outerHTML.slice(0, 200000)
              : '';
          } catch {}

          // 4. JS Globals probe
          const js = {};
          if (Array.isArray(probeJsKeys)) {
            for (const keyPath of probeJsKeys) {
              try {
                const parts = keyPath.split('.');
                let curr = window;
                let found = true;
                for (const part of parts) {
                  if (
                    curr === null ||
                    curr === undefined ||
                    (typeof curr !== 'object' && typeof curr !== 'function')
                  ) {
                    found = false;
                    break;
                  }
                  curr = curr[part];
                }
                if (found && curr !== undefined) {
                  if (
                    typeof curr === 'string' ||
                    typeof curr === 'number' ||
                    typeof curr === 'boolean'
                  ) {
                    js[keyPath] = String(curr);
                  } else {
                    js[keyPath] = '';
                  }
                }
              } catch {}
            }
          }

          // 5. DOM selector probing with accurate attribute and text verification
          const dom = [];
          if (Array.isArray(probeDomRules)) {
            function resolveVersionTemplate(template, match) {
              if (!template || !match) return null;
              const ternary = template.match(/^\\(\d+)\?([^:]*):(.*)$/);
              let v = template;
              if (ternary) {
                const idx = parseInt(ternary[1], 10);
                v = match[idx] ? ternary[2] : ternary[3];
              }
              v = v.replace(/\\(\d+)/g, (_, g) => (match[parseInt(g, 10)] !== undefined ? match[parseInt(g, 10)] : ''));
              v = v.trim();
              return v || null;
            }

            for (const rule of probeDomRules) {
              try {
                const nodes = document.querySelectorAll(rule.selector);
                if (!nodes || nodes.length === 0) continue;

                if (rule.exists) {
                  dom.push({ techName: rule.techName, version: rule.version || null, confidence: rule.confidence || 100 });
                  continue;
                }

                for (const node of nodes) {
                  let match = true;
                  let version = null;

                  if (rule.textRegexStr) {
                    const regex = new RegExp(rule.textRegexStr, 'i');
                    const textMatch = regex.exec(node.textContent || '');
                    if (!textMatch) {
                      match = false;
                    } else if (rule.textVersionPattern) {
                      version = resolveVersionTemplate(rule.textVersionPattern, textMatch) || textMatch[1] || null;
                    } else if (textMatch[1]) {
                      version = textMatch[1];
                    }
                  }

                  if (match && rule.attributes) {
                    for (const [attr, attrRule] of Object.entries(rule.attributes)) {
                      const val = node.getAttribute(attr);
                      if (val === null) {
                        match = false;
                        break;
                      }
                      if (attrRule && attrRule.regexStr) {
                        const regex = new RegExp(attrRule.regexStr, 'i');
                        const attrMatch = regex.exec(val);
                        if (!attrMatch) {
                          match = false;
                          break;
                        } else if (attrRule.versionPattern) {
                          version = resolveVersionTemplate(attrRule.versionPattern, attrMatch) || attrMatch[1] || null;
                        } else if (attrMatch[1]) {
                          version = attrMatch[1];
                        }
                      }
                    }
                  }

                  if (match && rule.properties) {
                    for (const [prop, propRule] of Object.entries(rule.properties)) {
                      const val = String(node[prop] || '');
                      if (propRule && propRule.regexStr) {
                        const regex = new RegExp(propRule.regexStr, 'i');
                        const propMatch = regex.exec(val);
                        if (!propMatch) {
                          match = false;
                          break;
                        }
                      }
                    }
                  }

                  if (match) {
                    dom.push({ techName: rule.techName, version, confidence: rule.confidence || 100 });
                    break;
                  }
                }
              } catch {}
            }
          }

          return { meta, scriptSrc, html, js, dom };
        },
        { probeJsKeys: jsProbeList, probeDomRules: domRules }
      );
    } catch {}
  }

  return {
    headers,
    cookies,
    meta: pageSignals.meta || [],
    scriptSrc: pageSignals.scriptSrc || [],
    html: pageSignals.html || '',
    js: pageSignals.js || {},
    dom: pageSignals.dom || []
  };
}

module.exports = {
  loadDatabase,
  parsePattern,
  resolveBackreferences,
  evaluatePattern,
  detectTechnologies,
  extractPageTechSignals
};

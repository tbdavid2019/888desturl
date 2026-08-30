const COMMON_TRACKING_PARAMETERS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  '_ga',
  '_gl',
  'igshid',
  'mibextid',
  'mc_cid',
  'mc_eid'
]);

const THREADS_TRACKING_PARAMETERS = new Set(['xmt', 'slof']);

function isThreadsHost(hostname) {
  const normalizedHostname = hostname.toLowerCase();
  return normalizedHostname === 'threads.com' || normalizedHostname.endsWith('.threads.com');
}

function isTrackingParameter(name, hostname) {
  const normalizedName = name.toLowerCase();

  if (normalizedName.startsWith('utm_') || COMMON_TRACKING_PARAMETERS.has(normalizedName)) {
    return true;
  }

  return isThreadsHost(hostname) && THREADS_TRACKING_PARAMETERS.has(normalizedName);
}

function analyzeUrl(urlString) {
  if (typeof urlString !== 'string' || !urlString) {
    return {
      clean_url: null,
      removed_tracking_parameters: []
    };
  }

  try {
    const parsed = new URL(urlString);
    const removedTrackingParameters = [];
    const seenRemovedParameters = new Set();

    for (const [name] of Array.from(parsed.searchParams.entries())) {
      if (!isTrackingParameter(name, parsed.hostname)) {
        continue;
      }

      const normalizedName = name.toLowerCase();
      parsed.searchParams.delete(name);
      if (!seenRemovedParameters.has(normalizedName)) {
        removedTrackingParameters.push(name);
        seenRemovedParameters.add(normalizedName);
      }
    }

    return {
      clean_url: parsed.toString(),
      removed_tracking_parameters: removedTrackingParameters
    };
  } catch {
    return {
      clean_url: null,
      removed_tracking_parameters: []
    };
  }
}

function normalizeUrl(input) {
  if (typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  let candidateString = trimmed;

  if (/^https?:\/\//i.test(candidateString)) {
    // Already has http:// or https:// scheme
  } else if (candidateString.startsWith('//')) {
    candidateString = `https:${candidateString}`;
  } else if (/^localhost(:\d+)?(\/.*)?$/i.test(candidateString)) {
    candidateString = `http://${candidateString}`;
  } else {
    candidateString = `https://${candidateString}`;
  }

  try {
    const candidate = new URL(candidateString);
    if (!['http:', 'https:'].includes(candidate.protocol)) {
      return null;
    }

    const host = candidate.hostname;
    if (!host || host.includes(' ') || host.includes('\t') || host.includes('\n')) {
      return null;
    }

    if (!host.includes('.') && host !== 'localhost') {
      return null;
    }

    return candidate.toString();
  } catch {
    return null;
  }
}

module.exports = {
  analyzeUrl,
  normalizeUrl
};


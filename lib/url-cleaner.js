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

module.exports = {
  analyzeUrl
};

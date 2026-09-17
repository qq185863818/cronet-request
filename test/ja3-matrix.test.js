'use strict';

const fs = require('node:fs');
const path = require('node:path');
const requests = require('..');

const TARGET_URL = 'https://tls.peet.ws/api/all';
const LOG_DIR = path.join(__dirname, '..', 'logs');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const TARGETS = [
  {
    name: 'batch-1-group-1',
    ja3: '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,23-65037-45-27-65281-17613-11-0-5-35-51764-10-16-51-18-13-43,4588-29-23-24,0',
    hash: '6709371c97dd7aec954dada2145d53ba',
  },
  {
    name: 'batch-1-group-2',
    ja3: '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,35-17613-43-65037-18-10-23-27-11-16-65281-51-45-0-13-5,4588-29-23-24,0',
    hash: '992ed81184445916e6df94144e622d67',
  },
  {
    name: 'batch-1-group-3',
    ja3: '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,65281-51-65037-11-27-5-43-35-16-18-17613-10-13-23-0-45-41,4588-29-23-24,0',
    hash: 'f21e77e121cde8151701feb579e4b207',
  },
  {
    name: 'batch-2-group-1',
    ja3: '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,11-35-65037-23-0-5-43-17613-51-18-13-51764-45-10-16-27-65281-41,4588-29-23-24,0',
    hash: 'c1cfa6dddf8cfe2505832362315b4b24',
  },
  {
    name: 'batch-2-group-2',
    ja3: '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,18-23-16-17613-27-65037-51764-0-11-45-5-43-10-51-35-65281-13,4588-29-23-24,0',
    hash: '51cfa23b8120d5015ed3ce86beb3076b',
  },
  {
    name: 'batch-2-group-3',
    ja3: '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,35-65037-11-65281-23-0-18-43-17613-5-16-13-45-10-27-51764-51-41,4588-29-23-24,0',
    hash: 'f8704afb9d0183d05fc218d5a2f10694',
  },
];

const RANDOM_VARIANTS = [
  { name: 'false', value: false, attempts: 1 },
  { name: 'true', value: true, attempts: 5 },
];

const TRUST_VARIANTS = [
  { name: 'empty', ids: [] },
  { name: 'provided', ids: ['2a03', '2b0601'] },
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJa3(value) {
  const parts = String(value || '').split(',');
  return {
    ciphers: (parts[1] || '').split('-').filter(Boolean).map(Number),
    extensions: (parts[2] || '').split('-').filter(Boolean).map(Number),
    curves: (parts[3] || '').split('-').filter(Boolean).map(Number),
  };
}

function targetParts(target) {
  return parseJa3(target.ja3);
}

function withoutGrease(values) {
  return values.filter((value) =>
    !((value & 0x0f0f) === 0x0a0a && (value >> 8) === (value & 0xff)));
}

function unique(values) {
  return [...new Set(values)];
}

function hasPreSharedKey(body) {
  return (body.tls?.extensions || []).some((extension) =>
    /\(41\)$/.test(String(extension.name || '')));
}

function createSession(target, random, trust) {
  const expectedExtensions = targetParts(target).extensions;
  const usesTrustAnchors = expectedExtensions.includes(51764);
  return requests.session({
    trust_env: false,
    enableQuic: true,
    enableHttp2: true,
    userAgent: USER_AGENT,
    tls: {
      profile: false,
      extensionOrder: expectedExtensions,
      randomizeExtensions: random.value,
      experimentalOptions: {
        // Enable the extension only for targets that contain 51764. The
        // trust_anchor_ids value is varied for every target in the matrix.
        tls_extensions: usesTrustAnchors ? ['trust_anchors'] : [],
        trust_anchor_ids: trust.ids,
      },
    },
  });
}

function summarize(target, random, trust, phase, attempt, body, logFile) {
  const actual = parseJa3(body.tls?.ja3);
  const expected = targetParts(target);
  const actualExtensions = withoutGrease(actual.extensions);
  const expectedExtensions = withoutGrease(expected.extensions);
  return {
    target: target.name,
    randomize: random.value,
    trustAnchorIds: trust.name,
    phase,
    attempt,
    logFile,
    status: body.http?.status || 200,
    ip: body.ip || null,
    httpVersion: body.http_version || null,
    actualJa3: body.tls?.ja3 || '',
    actualJa3Hash: body.tls?.ja3_hash || '',
    expectedJa3: target.ja3,
    expectedJa3Hash: target.hash,
    exactJa3Match: body.tls?.ja3 === target.ja3,
    exactJa3HashMatch: body.tls?.ja3_hash === target.hash,
    cipherOrderMatch: JSON.stringify(actual.ciphers) === JSON.stringify(expected.ciphers),
    extensionOrderMatch: JSON.stringify(actualExtensions) === JSON.stringify(expectedExtensions),
    curveOrderMatch: JSON.stringify(actual.curves) === JSON.stringify(expected.curves),
    actualExtensions,
    expectedExtensions,
    hasPreSharedKey: hasPreSharedKey(body),
  };
}

async function requestBody(session, target, random, trust, phase, attempt) {
  const response = await session.asyncGet(TARGET_URL, {
    timeout: 45000,
    disableCache: true,
    headers: [['X-jsCronet-JA3-Run', RUN_ID]],
  });
  const body = await response.json();
  if (response.status_code !== 200) {
    throw new Error(`tls.peet.ws returned ${response.status_code}`);
  }
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const fileName = `${RUN_ID}__${target.name}__random-${random.name}__trust-${trust.name}__${phase}-${attempt}.json`;
  const logPath = path.join(LOG_DIR, fileName);
  fs.writeFileSync(logPath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return {
    body,
    logFile: path.relative(path.join(__dirname, '..'), logPath).replaceAll('\\', '/'),
    cronetVersion: requests.cronet.version,
    tlsExtensionsSupported: requests.cronet.tlsExtensionsSupported,
  };
}

async function runScenario(target, random, trust) {
  const expected = targetParts(target);
  const needsPreSharedKey = expected.extensions.includes(41);
  const results = [];
  let version;
  let extensionsSupported = false;

  if (needsPreSharedKey) {
    const session = createSession(target, random, trust);
    try {
      const warmup = await requestBody(session, target, random, trust, 'warmup', 0);
      version = warmup.cronetVersion;
      extensionsSupported = warmup.tlsExtensionsSupported;
      results.push(summarize(target, random, trust, 'warmup', 0, warmup.body, warmup.logFile));
      await wait(3000);
      requests.closeConnections();
      await wait(500);
      for (let attempt = 1; attempt <= random.attempts; attempt += 1) {
        if (attempt > 1) {
          await wait(1000);
          requests.closeConnections();
          await wait(500);
        }
        const observation = await requestBody(session, target, random, trust, 'observation', attempt);
        version = observation.cronetVersion;
        extensionsSupported = observation.tlsExtensionsSupported;
        results.push(summarize(target, random, trust, 'observation', attempt, observation.body, observation.logFile));
      }
    } finally {
      await session.close();
    }
  } else {
    for (let attempt = 1; attempt <= random.attempts; attempt += 1) {
      const session = createSession(target, random, trust);
      try {
        const observation = await requestBody(session, target, random, trust, 'observation', attempt);
        version = observation.cronetVersion;
        extensionsSupported = observation.tlsExtensionsSupported;
        results.push(summarize(target, random, trust, 'observation', attempt, observation.body, observation.logFile));
      } finally {
        await session.close();
      }
      if (attempt < random.attempts) await wait(1000);
    }
  }
  return { results, version, extensionsSupported };
}

function buildAnalysis(results) {
  const analysis = [];
  for (const target of TARGETS) {
    for (const random of RANDOM_VARIANTS) {
      for (const trust of TRUST_VARIANTS) {
        const rows = results.filter((row) => row.target === target.name &&
          row.phase === 'observation' && row.randomize === random.value &&
          row.trustAnchorIds === trust.name);
        const orders = unique(rows.map((row) => row.actualExtensions.join('-')));
        const hashes = unique(rows.map((row) => row.actualJa3Hash));
        analysis.push({
          target: target.name,
          randomize: random.value,
          trustAnchorIds: trust.name,
          samples: rows.length,
          exactJa3Matches: rows.filter((row) => row.exactJa3Match).length,
          exactHashMatches: rows.filter((row) => row.exactJa3HashMatch).length,
          extensionOrderMatches: rows.filter((row) => row.extensionOrderMatch).length,
          uniqueJa3Hashes: hashes,
          uniqueExtensionOrders: orders,
          randomOrderObserved: random.value && orders.length > 1,
          preSharedKeyObserved: rows.some((row) => row.hasPreSharedKey),
        });
      }
    }
  }
  return analysis;
}

async function main() {
  const results = [];
  let cronetVersion = null;
  let tlsExtensionsSupported = null;
  for (const target of TARGETS) {
    for (const random of RANDOM_VARIANTS) {
      for (const trust of TRUST_VARIANTS) {
        try {
          const scenario = await runScenario(target, random, trust);
          results.push(...scenario.results);
          cronetVersion = scenario.version || cronetVersion;
          tlsExtensionsSupported = scenario.extensionsSupported;
        } catch (error) {
          results.push({
            target: target.name,
            randomize: random.value,
            trustAnchorIds: trust.name,
            error: error.message,
          });
          try { requests.close(); } catch {}
        }
      }
    }
  }

  const summary = {
    runId: RUN_ID,
    targetUrl: TARGET_URL,
    nativePath: requests.nativePath,
    cronetVersion,
    tlsExtensionsSupported,
    results,
    analysis: buildAnalysis(results),
  };
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const summaryPath = path.join(LOG_DIR, `${RUN_ID}__ja3-matrix-summary.json`);
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    runId: RUN_ID,
    summaryFile: path.relative(path.join(__dirname, '..'), summaryPath).replaceAll('\\', '/'),
    nativePath: summary.nativePath,
    cronetVersion: summary.cronetVersion,
    tlsExtensionsSupported: summary.tlsExtensionsSupported,
    requestErrors: results.filter((row) => row.error).length,
    analysis: summary.analysis,
  }, null, 2));
  if (results.some((row) => row.error)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error);
  try { requests.close(); } catch {}
  process.exitCode = 1;
});

'use strict';

const net = require('net');
const { EventEmitter } = require('events');

/**
 * Check if a single TCP port is open/in-use on a host.
 *
 * @param {number} port - Port number (1-65535)
 * @param {object} [opts] - Options
 * @param {string} [opts.host='127.0.0.1'] - Host to check
 * @param {number} [opts.timeout=1000] - Connection timeout in ms
 * @returns {Promise<{port:number, host:string, open:boolean, err?:string}>}
 */
function checkPort(port, opts = {}) {
  const host = opts.host || '127.0.0.1';
  const timeout = opts.timeout || 1000;

  return new Promise((resolve) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      resolve({ port, host, open: false, err: 'invalid port number' });
      return;
    }

    const socket = new net.Socket();
    let settled = false;

    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeout);
    socket.once('connect', () => done({ port, host, open: true }));
    socket.once('timeout', () => done({ port, host, open: false, err: 'timeout' }));
    socket.once('error', (err) => done({ port, host, open: false, err: err.code || err.message }));
    socket.connect(port, host);
  });
}

/**
 * Parse a port specification string into an array of port numbers.
 *
 * Formats:
 *   "80"           → [80]
 *   "80,443,8080"  → [80, 443, 8080]
 *   "8000-8100"    → [8000, 8001, ..., 8100]
 *   "80,8000-8005" → [80, 8000, 8001, 8002, 8003, 8004, 8005]
 *
 * @param {string} spec - Port specification
 * @returns {number[]} Array of port numbers
 */
function parsePortSpec(spec) {
  const ports = [];
  const parts = spec.split(',').map((s) => s.trim()).filter(Boolean);

  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-').map((s) => s.trim());
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
        throw new Error(`invalid port range: "${part}"`);
      }
      for (let p = start; p <= end; p++) {
        if (p >= 1 && p <= 65535) ports.push(p);
      }
    } else {
      const p = parseInt(part, 10);
      if (Number.isNaN(p)) throw new Error(`invalid port: "${part}"`);
      if (p < 1 || p > 65535) throw new Error(`port out of range: ${p}`);
      ports.push(p);
    }
  }

  // dedupe while preserving order
  return [...new Set(ports)];
}

/**
 * Well-known port descriptions for common services.
 */
const COMMON_PORTS = {
  20: 'FTP-DATA',
  21: 'FTP',
  22: 'SSH',
  23: 'TELNET',
  25: 'SMTP',
  53: 'DNS',
  80: 'HTTP',
  110: 'POP3',
  143: 'IMAP',
  443: 'HTTPS',
  993: 'IMAPS',
  995: 'POP3S',
  1433: 'SQL Server',
  1521: 'Oracle DB',
  3000: 'Node.js Dev',
  3306: 'MySQL',
  3389: 'RDP',
  5432: 'PostgreSQL',
  5601: 'Kibana',
  5672: 'RabbitMQ',
  6379: 'Redis',
  6443: 'K8s API',
  8080: 'HTTP Alt',
  8443: 'HTTPS Alt',
  9000: 'PHP-FPM',
  9042: 'Cassandra',
  9090: 'Prometheus',
  9092: 'Kafka',
  9200: 'Elasticsearch',
  11211: 'Memcached',
  27017: 'MongoDB',
};

/**
 * Get the service name for a port number, if known.
 * @param {number} port
 * @returns {string|null}
 */
function portService(port) {
  return COMMON_PORTS[port] || null;
}

/**
 * Scan multiple ports concurrently with a concurrency limit.
 *
 * @param {number[]} ports - Array of port numbers
 * @param {object} [opts] - Options
 * @param {string} [opts.host='127.0.0.1'] - Host to scan
 * @param {number} [opts.timeout=1000] - Per-port timeout in ms
 * @param {number} [opts.concurrency=50] - Max concurrent connections
 * @param {function} [opts.onResult] - Callback per result
 * @returns {Promise<object[]>} Array of results
 */
async function scanPorts(ports, opts = {}) {
  const host = opts.host || '127.0.0.1';
  const timeout = opts.timeout || 1000;
  const concurrency = opts.concurrency || 50;
  const onResult = opts.onResult;

  const results = [];
  let index = 0;

  async function worker() {
    while (index < ports.length) {
      const currentIndex = index++;
      const port = ports[currentIndex];
      const result = await checkPort(port, { host, timeout });
      if (result.open) result.service = portService(port);
      results.push(result);
      if (onResult) onResult(result);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, ports.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

/**
 * Classify scan severity for CI mode.
 * - error:   required port is closed, or forbidden port is open
 * - warning: optionally-open port is closed
 *
 * @param {object[]} results - Scan results
 * @param {object} policy - { required: number[], forbidden: number[] }
 * @returns {{severity:'pass'|'warning'|'error', messages:string[]}}
 */
function classifyResults(results, policy = {}) {
  const messages = [];
  let severity = 'pass';
  const openPorts = new Set(results.filter((r) => r.open).map((r) => r.port));

  if (policy.required) {
    for (const port of policy.required) {
      if (!openPorts.has(port)) {
        severity = 'error';
        messages.push(`required port ${port} is not open`);
      }
    }
  }

  if (policy.forbidden) {
    for (const port of policy.forbidden) {
      if (openPorts.has(port)) {
        severity = 'error';
        messages.push(`forbidden port ${port} is open`);
      }
    }
  }

  if (severity === 'pass' && messages.length === 0) {
    messages.push('all port checks passed');
  }

  return { severity, messages };
}

/**
 * Format scan results for terminal output.
 *
 * @param {object[]} results - Scan results
 * @param {object} [opts] - { compact: boolean }
 * @returns {string}
 */
function formatResults(results, opts = {}) {
  const lines = [];
  const open = results.filter((r) => r.open);
  const closed = results.filter((r) => !r.open);

  if (opts.compact) {
    for (const r of open) {
      lines.push(`${r.port}\tOPEN\t${r.service || ''}`.trim());
    }
  } else {
    lines.push(`Scanned ${results.length} port(s)`);
    lines.push('');

    if (open.length > 0) {
      lines.push('OPEN:');
      for (const r of open) {
        lines.push(`  ${r.port}\t${r.service ? r.service : 'unknown'}`);
      }
    }

    if (closed.length > 0 && !opts.compact) {
      const closedList = closed.map((r) => r.port);
      lines.push('');
      if (closedList.length <= 20) {
        lines.push(`CLOSED: ${closedList.join(', ')}`);
      } else {
        lines.push(`CLOSED: ${closedList.length} ports (not shown)`);
      }
    }
  }

  return lines.join('\n');
}

module.exports = {
  checkPort,
  parsePortSpec,
  scanPorts,
  portService,
  classifyResults,
  formatResults,
  COMMON_PORTS,
};

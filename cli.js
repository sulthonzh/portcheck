#!/usr/bin/env node
'use strict';

const {
  checkPort,
  parsePortSpec,
  scanPorts,
  portService,
  classifyResults,
  formatResults,
} = require('./index');

function usage() {
  console.log(`Usage: portcheck [options] <port-spec>

Check if TCP ports are in use.

Port specs:
  80              Single port
  80,443,8080     Multiple ports
  8000-8100       Port range
  80,3000-3010    Mixed

Options:
  --host <host>         Target host (default: 127.0.0.1)
  --timeout <ms>        Connection timeout per port (default: 1000)
  --concurrency <n>     Max concurrent connections (default: 50)
  --json                Output JSON
  --compact             Show only open ports
  --ci                  CI mode (exit 1 if required ports closed)
  --require <ports>     Ports that must be open (CI mode)
  --forbid <ports>      Ports that must be closed (CI mode)
  --service <port>      Show known service for a port
  -h, --help            Show this help

Examples:
  portcheck 3000
  portcheck 80,443,8080
  portcheck --host 192.168.1.1 1-1024
  portcheck --json 3000-3010
  portcheck --ci --require 3000,5432 3000-3010
  portcheck --service 5432`);
}

function parseArgs(argv) {
  const args = { ports: null, host: '127.0.0.1', timeout: 1000, concurrency: 50 };
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '--host':
        args.host = argv[++i];
        break;
      case '--timeout':
        args.timeout = parseInt(argv[++i], 10);
        break;
      case '--concurrency':
        args.concurrency = parseInt(argv[++i], 10);
        break;
      case '--json':
        args.json = true;
        break;
      case '--compact':
        args.compact = true;
        break;
      case '--ci':
        args.ci = true;
        break;
      case '--require':
        args.require = argv[++i];
        break;
      case '--forbid':
        args.forbid = argv[++i];
        break;
      case '--service':
        args.service = parseInt(argv[++i], 10);
        break;
      default:
        if (arg.startsWith('-')) {
          args.unknown = arg;
        } else {
          positional.push(arg);
        }
    }
  }

  if (positional.length > 0) args.ports = positional[0];
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    usage();
    process.exit(0);
  }

  if (args.unknown) {
    console.error(`unknown option: ${args.unknown}`);
    console.error('run --help for usage');
    process.exit(2);
  }

  if (args.service !== undefined) {
    const svc = portService(args.service);
    if (svc) {
      console.log(`${args.service}\t${svc}`);
    } else {
      console.log(`${args.service}\tno known service`);
    }
    process.exit(0);
  }

  if (!args.ports) {
    console.error('error: no port specification provided');
    console.error('run --help for usage');
    process.exit(2);
  }

  let ports;
  try {
    ports = parsePortSpec(args.ports);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(2);
  }

  if (ports.length > 10000) {
    console.error(`error: too many ports (${ports.length}). max 10000.`);
    process.exit(2);
  }

  const results = await scanPorts(ports, {
    host: args.host,
    timeout: args.timeout,
    concurrency: args.concurrency,
  });

  if (args.json) {
    const output = {
      host: args.host,
      total: results.length,
      open: results.filter((r) => r.open).length,
      closed: results.filter((r) => !r.open).length,
      results,
    };

    if (args.ci || args.require || args.forbid) {
      const policy = {};
      if (args.require) {
        try { policy.required = parsePortSpec(args.require); } catch (e) {
          console.error(`invalid --require: ${e.message}`);
          process.exit(2);
        }
      }
      if (args.forbid) {
        try { policy.forbidden = parsePortSpec(args.forbid); } catch (e) {
          console.error(`invalid --forbid: ${e.message}`);
          process.exit(2);
        }
      }
      output.classification = classifyResults(results, policy);
    }

    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(formatResults(results, { compact: args.compact }));

    if (args.ci || args.require || args.forbid) {
      const policy = {};
      if (args.require) {
        try { policy.required = parsePortSpec(args.require); } catch (e) {
          console.error(`invalid --require: ${e.message}`);
          process.exit(2);
        }
      }
      if (args.forbid) {
        try { policy.forbidden = parsePortSpec(args.forbid); } catch (e) {
          console.error(`invalid --forbid: ${e.message}`);
          process.exit(2);
        }
      }
      const cls = classifyResults(results, policy);
      console.log('');
      console.log(`[${cls.severity.toUpperCase()}] ${cls.messages.join('; ')}`);
    }
  }

  if (args.ci) {
    const policy = {};
    if (args.require) {
      try { policy.required = parsePortSpec(args.require); } catch (e) { /* already handled */ }
    }
    if (args.forbid) {
      try { policy.forbidden = parsePortSpec(args.forbid); } catch (e) { /* already handled */ }
    }
    const cls = classifyResults(results, policy);
    if (cls.severity === 'error') process.exit(1);
  }
}

main().catch((err) => {
  console.error(`fatal: ${err.message}`);
  process.exit(1);
});

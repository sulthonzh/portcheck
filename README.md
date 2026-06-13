# portcheck

Check if TCP ports are in use — batch scan ranges, JSON output, CI mode. Zero dependencies.

## Why

You spin up a dev server and it crashes with "port already in use." You SSH into a box and wonder what's running. You set up CI and need to verify a database is reachable before deploying. `portcheck` answers one question fast: **is this port open?**

No `nmap`, no 500MB install, no nonsense. Just a single file that does the job.

## Install

```bash
npm install -g portcheck
# or use directly with npx
npx portcheck 3000
```

## Quick Start

```bash
# Check a single port
portcheck 3000

# Check multiple ports
portcheck 80,443,8080

# Scan a range
portcheck 8000-8100

# Mixed
portcheck 80,3000-3010,9000

# Scan a remote host
portcheck --host 192.168.1.1 1-1024
```

## Features

- **Port specs**: single ports, comma-separated, ranges, or any combination
- **Concurrent scanning**: configurable parallelism (default 50 connections)
- **Service identification**: maps common ports to service names (HTTP, PostgreSQL, Redis, etc.)
- **CI mode**: define required and forbidden ports, exit non-zero on violations
- **JSON output**: machine-readable results for pipelines
- **Compact mode**: show only open ports (greppable)
- **Zero dependencies**: ships as a single file

## CLI Options

```
Options:
  --host <host>         Target host (default: 127.0.0.1)
  --timeout <ms>        Connection timeout per port (default: 1000)
  --concurrency <n>     Max concurrent connections (default: 50)
  --json                Output JSON
  --compact             Show only open ports
  --ci                  CI mode (exit 1 if policy violated)
  --require <ports>     Ports that must be open (CI mode)
  --forbid <ports>      Ports that must be closed (CI mode)
  --service <port>      Show known service for a port
  -h, --help            Show this help
```

## Examples

### Dev workflow — find what's blocking your port

```bash
$ portcheck 3000
Scanned 1 port(s)

OPEN:
  3000    Node.js Dev
```

Oops, Node is still running. Now you know.

### Scan a range on your local network

```bash
$ portcheck --host 192.168.1.1 --compact 1-1024
22      OPEN    SSH
80      OPEN    HTTP
443     OPEN    HTTPS
```

### CI — verify services before deploying

```bash
# Fail if Postgres isn't up, or if port 22 (SSH) is exposed
portcheck --ci --require 5432 --forbid 22 5432,22
```

Exit code 0 = all good. Exit code 1 = policy violation.

### JSON output for pipelines

```bash
$ portcheck --json 3000-3002
{
  "host": "127.0.0.1",
  "total": 3,
  "open": 1,
  "closed": 2,
  "results": [
    { "port": 3000, "host": "127.0.0.1", "open": true, "service": "Node.js Dev" },
    { "port": 3001, "host": "127.0.0.1", "open": false, "err": "ECONNREFUSED" },
    { "port": 3002, "host": "127.0.0.1", "open": false, "err": "ECONNREFUSED" }
  ]
}
```

### Look up a known service

```bash
$ portcheck --service 6379
6379    Redis
```

## API

```js
const { checkPort, scanPorts, parsePortSpec, portService } = require('portcheck');

// Check one port
const result = await checkPort(3000, { host: '127.0.0.1', timeout: 500 });
// → { port: 3000, host: '127.0.0.1', open: true }

// Scan multiple ports
const results = await scanPorts([80, 443, 8080], {
  host: '127.0.0.1',
  timeout: 1000,
  concurrency: 50,
  onResult: (r) => console.log(r.port, r.open),
});

// Parse a port spec string
parsePortSpec('80,8000-8005');
// → [80, 8000, 8001, 8002, 8003, 8004, 8005]

// Get service name
portService(5432); // → 'PostgreSQL'
```

## Known Ports

Includes service mappings for common ports: SSH (22), HTTP (80), HTTPS (443), PostgreSQL (5432), Redis (6379), MySQL (3306), MongoDB (27017), Elasticsearch (9200), Kafka (9092), RabbitMQ (5672), and more.

## License

MIT

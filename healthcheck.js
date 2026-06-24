#!/usr/bin/env node
// Healthcheck for manual-tools container
try {
  const res = await fetch('http://localhost:3000/api/health')
  if (res.ok) {
    process.exit(0)
  }
} catch {
  // server not reachable
}
process.exit(1)

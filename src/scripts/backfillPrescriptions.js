const { runPrescriptionBackfill } = require('./backfillPrescriptionsRunner');
const db = require('../db/sqlServer');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (['dry-run', 'force', 'failed-only', 'upload'].includes(key)) {
      out[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
    } else {
      out[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

async function main() {
  const result = await runPrescriptionBackfill(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.close());

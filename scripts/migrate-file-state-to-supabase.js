require('dotenv').config();

const path = require('path');

const { VALID_STATE_KEYS, createStateStore } = require('../state-store');

const ROOT = path.resolve(__dirname, '..');
const sourceDataFile = process.env.SOURCE_DATA_FILE
  ? path.resolve(process.env.SOURCE_DATA_FILE)
  : process.env.DATA_FILE
    ? path.resolve(process.env.DATA_FILE)
    : path.join(ROOT, 'ope-shared-state.json');

async function main() {
  const targetStore = createStateStore({
    storageBackend: 'supabase',
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseTablePrefix: process.env.SUPABASE_TABLE_PREFIX || 'ope_'
  });

  const sourceStore = createStateStore({
    storageBackend: 'file',
    dataFile: sourceDataFile
  });

  const state = await sourceStore.getState();
  for (const key of VALID_STATE_KEYS) {
    await targetStore.putStateValue(key, state[key]);
    const size = Array.isArray(state[key]) ? state[key].length : Object.keys(state[key] || {}).length;
    console.log(`Migrated ${key}: ${size}`);
  }

  console.log(`Supabase migration complete from ${sourceDataFile}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

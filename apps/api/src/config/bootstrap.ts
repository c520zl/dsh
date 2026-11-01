import { loadDotEnv } from './load-env';

// Imported first by the entrypoints so .env values are visible when Nest module
// options (e.g. pino log level) are evaluated at import time.
loadDotEnv();

#!/usr/bin/env node
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const volumeMountPath = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data';
const volumeAttached = Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH && process.env.RAILWAY_VOLUME_NAME);
const isDefaultPath = (value, suffix) => !value || value === `/data/${suffix}` || value === `data/${suffix}` || value === `./data/${suffix}`;
const persistentPath = (value, suffix) => resolve(volumeMountPath, isDefaultPath(value, suffix) ? suffix : value);
const definitionsDir = persistentPath(process.env.PROPERTY_SEARCH_DEFINITIONS, 'definitions');
const sourceDir = resolve('examples');
await mkdir(definitionsDir, { recursive: true });
const definitions = (await readdir(definitionsDir)).filter((name) => /\.ya?ml$/i.test(name));
if (!definitions.length) for (const name of await readdir(sourceDir)) if (/\.ya?ml$/i.test(name)) await copyFile(resolve(sourceDir, name), resolve(definitionsDir, name));

if (process.env.NODE_ENV === 'production' && !volumeAttached) console.warn(`WARNING: no Railway Volume detected at ${volumeMountPath}; /data will be lost on redeploy. Attach a volume and redeploy.`);

const defaultDefinition = resolve(definitionsDir, 'north-brisbane-under_800k.yaml');
const env = { ...process.env, PROPERTY_SEARCH_DB: persistentPath(process.env.PROPERTY_SEARCH_DB, 'property-search.sqlite'), PROPERTY_SEARCH_PROFILE: persistentPath(process.env.PROPERTY_SEARCH_PROFILE, 'browser-profile'), PROPERTY_SEARCH_DEFINITIONS: definitionsDir };
const child = spawn(process.execPath, ['bin/property-search-ui.js', defaultDefinition], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 1));

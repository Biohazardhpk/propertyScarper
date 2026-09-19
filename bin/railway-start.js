#!/usr/bin/env node
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const definitionsDir = resolve(process.env.PROPERTY_SEARCH_DEFINITIONS ?? '/data/definitions');
const sourceDir = resolve('examples');
await mkdir(definitionsDir, { recursive: true });
const definitions = (await readdir(definitionsDir)).filter((name) => /\.ya?ml$/i.test(name));
if (!definitions.length) for (const name of await readdir(sourceDir)) if (/\.ya?ml$/i.test(name)) await copyFile(resolve(sourceDir, name), resolve(definitionsDir, name));

const defaultDefinition = resolve(definitionsDir, 'north-brisbane-under_800k.yaml');
const child = spawn(process.execPath, ['bin/property-search-ui.js', defaultDefinition], { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 1));

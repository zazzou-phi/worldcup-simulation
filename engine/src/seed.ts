#!/usr/bin/env node
import { createRepository } from './api/bootstrap.js';

createRepository(undefined, true);

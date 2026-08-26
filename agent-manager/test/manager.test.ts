import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { inspect } from "../src/manager.js";

test("invalid existing manifest causes no canonical writes",async()=>{const root=await mkdtemp(path.join(tmpdir(),"afd-invalid-"));await mkdir(root,{recursive:true});await writeFile(path.join(root,"manifest.json"),JSON.stringify({manifestVersion:1,profile:{source:"../unsafe"},catalog:[],targets:[]}));await assert.rejects(inspect({root,dryRun:false}),/Invalid/);await assert.rejects(access(path.join(root,"catalog"),constants.F_OK));});

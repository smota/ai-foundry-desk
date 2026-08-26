import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { listPending, promotePending, recoverRejected, rejectPending } from "../src/review.js";

async function fixture(){const root=await mkdtemp(path.join(tmpdir(),"afd-review-"));await mkdir(path.join(root,"catalog","pending","codex","new-skill"),{recursive:true});await writeFile(path.join(root,"catalog","pending","codex","new-skill","SKILL.md"),"# skill\n");await writeFile(path.join(root,"manifest.json"),JSON.stringify({manifestVersion:1,profile:{source:"profile/base.md"},catalog:[],targets:[{agent:"codex",entries:[],profile:false}]}));return root;}
test("pending promotion requires confirmation and updates catalog",async()=>{const root=await fixture();assert.equal((await listPending(root)).length,1);await assert.rejects(promotePending(root,"codex","new-skill"),/--confirm/);await promotePending(root,"codex","new-skill",{confirm:true});const manifest=JSON.parse(await readFile(path.join(root,"manifest.json"),"utf8"));assert.equal(manifest.catalog[0].id,"new-skill");assert.deepEqual(manifest.targets[0].entries,["new-skill"]);});
test("rejected pending entries are recoverable",async()=>{const root=await fixture();const rejected=await rejectPending(root,"codex","new-skill",{confirm:true});await recoverRejected(root,"codex",path.basename(rejected),{confirm:true});assert.equal((await listPending(root))[0]?.id,"new-skill");});

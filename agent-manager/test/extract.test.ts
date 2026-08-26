import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { extractRecipe, inventoryGlobal } from "../src/extract.js";

test("extraction excludes secret-like entries, copies safe skill content, and emits no private paths",async()=>{const home=await mkdtemp(path.join(tmpdir(),"afd-extract-"));for(const id of ["safe-skill","auth-token","private-notes"]){const dir=path.join(home,".agents","skills",id);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,"SKILL.md"),"# safe\n");}const inventory=await inventoryGlobal(home);assert.deepEqual(inventory.skills.map(s=>s.id),["safe-skill"]);const output=path.join(home,"recipe.json");await extractRecipe(output,["safe-skill"],home);const text=await readFile(output,"utf8");assert.equal(text.includes(home),false);assert.equal(text.includes("token"),false);assert.equal(await readFile(path.join(home,"skills","safe-skill","SKILL.md"),"utf8"),"# safe\n");});
test("extraction fails closed on credential-like content",async()=>{const home=await mkdtemp(path.join(tmpdir(),"afd-extract-secret-"));const dir=path.join(home,".agents","skills","safe-name");await mkdir(dir,{recursive:true});await writeFile(path.join(dir,"SKILL.md"),"key: sk-abcdefghijklmnop");await assert.rejects(extractRecipe(path.join(home,"recipe.json"),["safe-name"],home),/extraction aborted/);});

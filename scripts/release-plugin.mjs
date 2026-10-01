import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';import path from 'node:path';import {ROOT} from '../server/config.mjs';
const id=process.argv[2],dir=path.join(ROOT,'dist','figmaize-plugin');
if(id&&!/^\d+$/.test(id))throw Error('Figma assigns the numeric public plugin ID');
await mkdir(dir,{recursive:true});for(const file of ['code.js','ui.html'])await copyFile(path.join(ROOT,'figma',file),path.join(dir,file));
const manifest=JSON.parse(await readFile(path.join(ROOT,'figma/manifest.json')));
if(id){manifest.id=id;manifest.networkAccess={allowedDomains:['http://localhost:4318'],reasoning:'Connects to the user-installed local figmaize capture service. Website capture and processing run on the user’s computer.'};}
await writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify({directory:dir,mode:id?'community-candidate':'development',note:id?'Requires Figma review before publication':'Import this manifest in Figma Desktop Development plugins'}));

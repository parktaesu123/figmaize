import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const files=[];
for(const dir of ['tests','extension'])for(const file of await readdir(new URL('../'+dir+'/',import.meta.url)))if(file.endsWith('.test.mjs'))files.push(dir+'/'+file);
const child=spawn(process.execPath,['--test',...files],{stdio:'inherit',cwd:new URL('../',import.meta.url)});
child.on('error',error=>{console.error(error);process.exitCode=1;});
child.on('exit',code=>process.exitCode=code??1);

import {readFile,writeFile} from 'node:fs/promises';import path from 'node:path';
import {collectionCoverage,coverageMarkdown} from '../server/site-report.mjs';
const [file,fileKey,out]=process.argv.slice(2);if(!file||!fileKey)throw Error('Usage: node scripts/site-report.mjs MANIFEST FIGMA_FILE_KEY [REPORT_PATH]');
const m=JSON.parse(await readFile(file));let j={entries:[]};try{j=JSON.parse(await readFile(path.join(path.dirname(file),'figma-import.json')));}catch(e){if(e.code!=='ENOENT')throw e;}
await writeFile(out||path.join(path.dirname(file),'coverage.md'),coverageMarkdown(m,j,fileKey));console.log(JSON.stringify(collectionCoverage(m,j)));

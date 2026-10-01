import {spawn} from 'node:child_process';
const child=spawn(process.execPath,['--test','tests/capture-url.test.mjs','tests/site-capture.test.mjs','tests/product.test.mjs','tests/site-ui.test.mjs'],{stdio:'inherit',env:{...process.env,LB_TEST_BROWSER:'1'}});
child.on('error',error=>{console.error(error);process.exitCode=1;});child.on('exit',code=>process.exitCode=code??1);

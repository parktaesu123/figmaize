import test from 'node:test';import assert from 'node:assert/strict';
import {coverageMarkdown} from '../server/site-report.mjs';
test('report derives site identity and scope from each collection, not the Toss case',()=>{
 for(const [url,pathPrefix] of [['https://example.com/products','/products'],['https://demo.test/','/']]){
  const result=coverageMarkdown({config:{url,pathPrefix},pages:[],screens:[],skipped:[],excluded:[],complete:false},{entries:[]},'test-file');
  assert.ok(result.includes(url));assert.ok(result.includes(`범위는 ${pathPrefix} 하위`));assert.ok(!result.includes('Toss'));assert.ok(!result.includes('/en-us'));
 }
});

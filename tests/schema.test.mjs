import test from 'node:test';
import assert from 'node:assert/strict';
import '../shared/schema.js';
const { validateCapture, color, paint } = globalThis.LayerBridge;
const base = () => ({ format:'layer-bridge',version:1,viewport:{width:390,height:844},nodes:[{id:'a',type:'frame',name:'Card',bounds:{x:0,y:0,width:300,height:200}}] });
test('valid scene is accepted; unsupported versions and invalid dimensions rejected', () => {
  assert.equal(validateCapture(base()).nodes.length,1);
  assert.throws(()=>validateCapture({...base(),version:2}));
  assert.throws(()=>validateCapture({...base(),viewport:{width:Infinity,height:20}}));
});
test('reject duplicate IDs, missing parents and text parents before mutation', () => {
  const value=base();value.nodes.push({...value.nodes[0]});assert.throws(()=>validateCapture(value));
  const missing=base();missing.nodes[0].parentId='unknown';assert.throws(()=>validateCapture(missing));
  const text=base();text.nodes[0].type='text';text.nodes[0].text='Title';text.nodes.push({...base().nodes[0],id:'b',parentId:'a'});assert.throws(()=>validateCapture(text));
});
test('reject external assets and executable SVG', () => {
  const value=base();value.nodes[0].image='https://example.com/private.png';assert.throws(()=>validateCapture(value));
  for(const svg of ['<svg><script>alert(1)</script></svg>','<svg onload="foo()"/>','<svg><image href="https://example.com/a.png"/></svg>']){const v=base();Object.assign(v.nodes[0],{type:'svg',svg});assert.throws(()=>validateCapture(v));}
});
test('color conversion preserves opacity, transparent fill and normalized ranges', () => {
  assert.deepEqual(color('#ff8000'),{r:1,g:128/255,b:0,a:1});
  assert.equal(color('rgba(40, 50, 60, 0.2)').a,.2);
  assert.deepEqual(paint('transparent'),[]);
  assert.deepEqual(paint('rgba(0, 0, 0, 0)'),[]);
  assert.deepEqual(color('rgb(255 128 0 / 0.5)'),{r:1,g:128/255,b:0,a:.5});
});
test('sRGB capture colors preserve normalized channels and border opacity', () => {
  assert.deepEqual(paint('color(srgb 0.109804 0.121569 0.145098 / 0.18)'),[
    {type:'SOLID',color:{r:.109804,g:.121569,b:.145098},opacity:.18}
  ]);
  assert.deepEqual(color('color(srgb 1 0.5 0)'),{r:1,g:.5,b:0,a:1});
  assert.deepEqual(paint('color(srgb 1 0 0 / 0)'),[]);
});
test('sRGB accepts numeric and percentage components and clamps Figma ranges', () => {
  assert.deepEqual(color(' COLOR(SRGB 100% 5e-1 +0 / 25%) '),{r:1,g:.5,b:0,a:.25});
  assert.deepEqual(color('color(srgb -0.1 1.2 50% / 150%)'),{r:0,g:1,b:.5,a:1});
  assert.deepEqual(paint('color(srgb 1 0 0 / -0.5)'),[]);
});
test('malformed or unsupported color values never create invalid paints', () => {
  for (const value of ['color(srgb 1 0)', 'color(srgb 1 0 0 1)', 'color(srgb 1, 0, 0)',
    'color(srgb 1 0 0 /)', 'color(srgb 1..2 0 0)', 'color(srgb 1e999 0 0)',
    'color(srgb NaN 0 0)', 'color(display-p3 1 0 0)', 'rgba(1..2, 0, 0, 1)', null, {}]) {
    assert.equal(color(value),null,String(value));
    assert.deepEqual(paint(value),[],String(value));
  }
});

test('semantic and layout metadata are optional, bounded and validated before import',()=>{
  const valid=base();Object.assign(valid.nodes[0],{semantic:{kind:'button',label:'Save',component:true},layout:{mode:'HORIZONTAL',gap:8,padding:[12,16,12,16],justify:'center',align:'center'}});
  assert.equal(validateCapture(valid),valid);
  for(const patch of [{semantic:{kind:'script',label:'X',component:true}},{semantic:{kind:'button',label:'X',component:'yes'}},{layout:{...valid.nodes[0].layout,padding:[Infinity,0,0,0]}},{layout:{...valid.nodes[0].layout,gap:-1}},{flow:{position:'absolute',grow:1,align:'auto',margin:[0,NaN,0,0]}}]){
    const value=base();Object.assign(value.nodes[0],patch);assert.throws(()=>validateCapture(value));
  }
});

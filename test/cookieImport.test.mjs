import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCookieExport } from '../dist/browser/cookieImport.js';

test('cookie import accepts browser exports and excludes unrelated sites',()=>{
  const cookies=parseCookieExport(JSON.stringify({cookies:[
    {name:'session',value:'secret-value',domain:'.chatgpt.com',path:'/',httpOnly:true,secure:true,sameSite:'no_restriction',expirationDate:1900000000},
    {name:'other',value:'private',domain:'.example.com',path:'/'}
  ]}));
  assert.equal(cookies.length,1);
  assert.equal(cookies[0].domain,'.chatgpt.com');
  assert.equal(cookies[0].sameSite,'None');
  assert.equal(cookies[0].expires,1900000000);
  assert.throws(()=>parseCookieExport(JSON.stringify([{name:'other',value:'private',domain:'example.com'}])),/No ChatGPT/);
});

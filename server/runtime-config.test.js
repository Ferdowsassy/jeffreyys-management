import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {findWinorderConfig} from './runtime-config.js';

test('Hostinger redeploys find the same private WinOrder file without an htaccess override', t => {
  const dir = mkdtempSync(join(tmpdir(),'jeffreyys-redeploy-'));
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  const root=join(dir,'hbuilds'), config=join(root,'config','winorder.env');
  mkdirSync(join(root,'config'),{recursive:true});
  const urls=['old-release','new-release'].map(release => pathToFileURL(join(root,'versions',release,'nodejs','server','index.js')));
  assert.equal(findWinorderConfig(urls[0],{NODE_ENV:'production'}),undefined);
  writeFileSync(config,'WINORDER_USERNAME=test\nWINORDER_PASSWORD=test-credential-file-for-redeploy\n',{mode:0o600});
  for (const url of urls) assert.equal(findWinorderConfig(url,{NODE_ENV:'production'}),config);
  assert.equal(findWinorderConfig(urls[1],{NODE_ENV:'development'}),undefined);
  assert.equal(findWinorderConfig(urls[1],{NODE_ENV:'production',WINORDER_USERNAME:'explicit'}),undefined);
  assert.equal(findWinorderConfig(urls[1],{NODE_ENV:'production',WINORDER_PASSWORD:'explicit'}),undefined);
  assert.equal(findWinorderConfig(urls[1],{WINORDER_CONFIG_FILE:'/private/custom.env'}),'/private/custom.env');
  assert.equal(findWinorderConfig(pathToFileURL(join(dir,'server','index.js')),{NODE_ENV:'production'}),undefined);
});

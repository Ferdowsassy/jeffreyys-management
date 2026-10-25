import mysql from 'mysql2/promise';
import {writeFile,mkdir} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {databaseConfig} from '../server/mysql-store.js';
import {repairWinorderFields} from '../server/winorder-repair.js';

const apply=process.argv.includes('--apply'), backupDir=process.argv[process.argv.indexOf('--apply')+1];
if(apply && (!backupDir || !isAbsolute(backupDir)))throw Error('--apply requires a private absolute backup directory');
if(process.env.DB_CONFIG_FILE)process.loadEnvFile(process.env.DB_CONFIG_FILE);
const db=await mysql.createConnection(databaseConfig());
const decode=value=>typeof value==='string'?JSON.parse(value):value;
try {
  await db.beginTransaction();
  await db.query('SELECT revision FROM jm_metadata WHERE id=1 FOR UPDATE');
  const [rows]=await db.query('SELECT id,payload FROM jm_orders ORDER BY position');
  const changes=rows.map(row=>{const before=decode(row.payload);return {id:row.id,before,patch:repairWinorderFields(before)};}).filter(row=>Object.keys(row.patch).length);
  const counts={};for(const row of changes)for(const key of Object.keys(row.patch))counts[key]=(counts[key]||0)+1;
  console.log(JSON.stringify({mode:apply?'apply':'dry-run',orders:changes.length,fields:counts}));
  if(apply && changes.length) {
    await mkdir(backupDir,{recursive:true,mode:0o700});
    const now=new Date().toISOString();
    await writeFile(join(backupDir,'winorder-orders-before-'+Date.now()+'.json'),JSON.stringify(changes),{mode:0o600,flag:'wx'});
    for(const row of changes)await db.execute('UPDATE jm_orders SET payload=? WHERE id=?',[JSON.stringify({...row.before,...row.patch}),row.id]);
    const [positions]=await db.query('SELECT COALESCE(MAX(position),-1)+1 AS next FROM jm_audit');
    const id=randomUUID();
    await db.execute('INSERT INTO jm_audit (id,position,payload) VALUES (?,?,?)',[id,positions[0].next,JSON.stringify({id,type:'winorderFieldRepair',employeeId:null,createdAt:now,demo:false,orders:changes.length,fields:counts})]);
    await db.query('UPDATE jm_metadata SET revision=revision+1 WHERE id=1');
    await db.commit();
  } else await db.rollback();
} catch(error) {await db.rollback();throw error;} finally {await db.end();}

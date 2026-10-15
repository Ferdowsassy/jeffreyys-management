import {randomUUID,createHash} from 'node:crypto';
import {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse} from '@simplewebauthn/server';
import webpush from 'web-push';
import {checkPin} from './store.js';
import {fail} from './domain.js';

export function mountPasskeys(app,{store,origin,production,signIn}) {
  const challenges=new Map(),limits=new Map();
  const context=req=>{const expectedOrigin=origin || new URL((production?'https://':'http://')+req.get('host')).origin;return {expectedOrigin,rpID:new URL(expectedOrigin).hostname};};
  const limit=req=>{const now=Date.now();for(const [k,v] of challenges)if(v.expires<=now)challenges.delete(k);for(const [k,v] of limits)if(v.until<=now)limits.delete(k);let l=limits.get(req.ip);if(!l){l={count:0,until:now+900000};limits.set(req.ip,l);}if(++l.count>30)fail('Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.',429);};
  function take(req,kind){const value=challenges.get(req.body?.challengeId);challenges.delete(req.body?.challengeId);if(!value || value.expires<=Date.now() || value.kind!==kind || (kind==='register' && value.token!==req.token))fail('Die Anfrage ist abgelaufen. Bitte erneut beginnen.',400);return value;}
  app.post('/api/passkeys/register/options',async(req,res,next)=>{try{
    if(!req.user)fail('Bitte zuerst mit PIN anmelden.',401);limit(req);
    if(!checkPin(String(req.body?.pin || ''),req.user.pinHash))fail('PIN stimmt nicht.',401);
    const {rpID}=context(req);
    const options=await generateRegistrationOptions({rpName:'Jeffreyys',rpID,userName:req.user.id,userDisplayName:req.user.name,userID:Buffer.from(req.user.id),attestationType:'none',excludeCredentials:(req.user.passkeys || []).map(p=>({id:p.id})),authenticatorSelection:{residentKey:'preferred',userVerification:'required',authenticatorAttachment:'platform'}});
    const challengeId=randomUUID();challenges.set(challengeId,{kind:'register',id:req.user.id,token:req.token,challenge:options.challenge,expires:Date.now()+300000});res.json({challengeId,options});
  }catch(e){next(e);}});
  app.post('/api/passkeys/register/verify',async(req,res,next)=>{try{
    if(!req.user)fail('Bitte anmelden.',401);limit(req);const c=take(req,'register'),{expectedOrigin,rpID}=context(req);
    const result=await verifyRegistrationResponse({response:req.body.response,expectedChallenge:c.challenge,expectedOrigin,expectedRPID:rpID,requireUserVerification:true});
    if(!result.verified)fail('Passkey konnte nicht bestätigt werden.');
    const credential=result.registrationInfo.credential;
    await store.transact(s=>{const e=s.employees.find(e=>e.id===c.id && e.active);if(!e)fail('Zugang nicht aktiv.',401);if(s.employees.some(e=>(e.passkeys || []).some(p=>p.id===credential.id)))fail('Dieser Passkey ist bereits registriert.',409);e.passkeys ??= [];if(e.passkeys.length>=10)fail('Maximal 10 Passkeys pro Mitarbeiter.');e.passkeys.push({id:credential.id,publicKey:Buffer.from(credential.publicKey).toString('base64url'),counter:credential.counter,transports:req.body.response.response.transports || [],createdAt:new Date().toISOString()});});
    res.json({ok:true});
  }catch(e){next(e);}});
  app.post('/api/passkeys/login/options',async(req,res,next)=>{try{
    limit(req);const employee=store.read().employees.find(e=>e.id===req.body?.id && e.active);if(!employee?.passkeys?.length)fail('Für diesen Zugang ist kein Passkey eingerichtet. Bitte PIN verwenden.',400);
    const {rpID}=context(req),options=await generateAuthenticationOptions({rpID,userVerification:'required',allowCredentials:employee.passkeys.map(p=>({id:p.id,transports:p.transports}))});
    const challengeId=randomUUID();challenges.set(challengeId,{kind:'login',id:employee.id,challenge:options.challenge,expires:Date.now()+300000});res.json({challengeId,options});
  }catch(e){next(e);}});
  app.post('/api/passkeys/login/verify',async(req,res,next)=>{try{
    limit(req);const c=take(req,'login'),{expectedOrigin,rpID}=context(req);
    const employee=store.read().employees.find(e=>e.id===c.id && e.active),p=employee?.passkeys?.find(p=>p.id===req.body.response?.id);if(!p)fail('Passkey nicht gefunden.',401);
    const verified=await verifyAuthenticationResponse({response:req.body.response,expectedChallenge:c.challenge,expectedOrigin,expectedRPID:rpID,credential:{...p,publicKey:Buffer.from(p.publicKey,'base64url')},requireUserVerification:true});
    if(!verified.verified)fail('Passkey konnte nicht bestätigt werden.',401);
    await store.transact(s=>{const current=s.employees.find(e=>e.id===c.id && e.active)?.passkeys?.find(x=>x.id===p.id);if(!current || current.counter!==p.counter)fail('Bitte die Anmeldung wiederholen.',409);current.counter=verified.authenticationInfo.newCounter;});
    signIn(req,res,employee);
  }catch(e){next(e);}});
}

const pushHost=host=>['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com','notify.windows.com'].some(h=>host===h || host.endsWith('.'+h));
export function mountNotifications(app,{store}) {
  app.get('/api/notifications',async(req,res,next)=>{try{
    let keys=store.read().settings.webPushVapid;
    if(!keys){await store.transact(s=>{s.settings.webPushVapid ??= webpush.generateVAPIDKeys();});keys=store.read().settings.webPushVapid;}
    res.json({publicKey:keys.publicKey,subscriptions:(req.user.pushSubscriptions || []).length});
  }catch(e){next(e);}});
  app.post('/api/notifications/subscribe',async(req,res,next)=>{try{
    const sub=req.body?.subscription;let url;try{url=new URL(sub?.endpoint);}catch{fail('Ungültiger Push-Endpunkt.');}
    if(url.protocol!=='https:' || url.port || url.username || url.password || !pushHost(url.hostname) || url.href.length>2000 || !/^[A-Za-z0-9_-]{20,200}$/.test(sub.keys?.p256dh || '') || !/^[A-Za-z0-9_-]{16,100}$/.test(sub.keys?.auth || ''))fail('Ungültige Push-Anmeldung.');
    await store.transact(s=>{for(const e of s.employees)e.pushSubscriptions=(e.pushSubscriptions || []).filter(x=>x.endpoint!==sub.endpoint);const e=s.employees.find(e=>e.id===req.user.id && e.active);if(!e)fail('Bitte anmelden.',401);e.pushSubscriptions=[...(e.pushSubscriptions || []).slice(-9),{endpoint:sub.endpoint,sessionHash:createHash('sha256').update(req.token).digest('hex'),keys:{p256dh:sub.keys.p256dh,auth:sub.keys.auth}}];});res.json({ok:true});
  }catch(e){next(e);}});
  app.post('/api/notifications/unsubscribe',async(req,res,next)=>{try{await store.transact(s=>{const e=s.employees.find(e=>e.id===req.user.id);e.pushSubscriptions=(e.pushSubscriptions || []).filter(x=>x.endpoint!==req.body?.endpoint);});res.json({ok:true});}catch(e){next(e);}});
  return async function notify({roles=[],ids=[],message='Es gibt Neuigkeiten in deinem Workspace.'}={}){
    const s=store.read(),keys=s.settings.webPushVapid;if(!keys)return;
    const recipients=s.employees.filter(e=>e.active && (roles.includes(e.role)||ids.includes(e.id)));
    const expired=[];
    await Promise.allSettled(recipients.flatMap(e=>(e.pushSubscriptions || []).map(async sub=>{
      try{await webpush.sendNotification(sub,JSON.stringify({title:'Jeffreyys',body:message}),{TTL:300,timeout:5000,vapidDetails:{subject:process.env.VAPID_SUBJECT || 'https://jeffreys-burger.app',...keys}});}catch(error){if([404,410].includes(error.statusCode))expired.push({id:e.id,endpoint:sub.endpoint});else console.error('Push delivery failed:',error.statusCode || error.code || 'unknown');}
    })));
    if(expired.length)await store.transact(s=>{for(const x of expired){const e=s.employees.find(e=>e.id===x.id);if(e)e.pushSubscriptions=(e.pushSubscriptions || []).filter(sub=>sub.endpoint!==x.endpoint);}});
  };
}
